/**
 * FinPro — Receipt OCR pipeline
 *
 * Turns a photographed (or digital) receipt image into structured expense data:
 *   decode → validate → preprocess (deskew / contrast / denoise / threshold)
 *   → multi-pass Tesseract OCR → optional Gemini vision interpretation
 *   → deterministic field extraction with per-field confidence.
 *
 * Design rules:
 *   • Never invent a value. A field that cannot be read is returned as null.
 *   • Never substitute today's date for a missing receipt date.
 *   • Prefer the amount actually paid / grand total over subtotal, tax, or an
 *     arbitrary number that happens to be printed on the receipt.
 *   • Keep the pipeline deterministic and locally testable; the paid vision
 *     fallback is opt-in, bounded, and only runs when it can add value.
 */

'use strict';

const crypto = require('crypto');
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
const mlCategorizerService = require('./mlCategorizerService');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MIN_OCR_WIDTH = 1200;
const MAX_OCR_WIDTH = 2400;
const OCR_VARIANTS = ['enhanced', 'binarized'];
const VISION_TIMEOUT_MS = 20_000;
const VISION_MIN_CONFIDENCE = 0.5;

const MIME_BY_MAGIC = [
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

const sniffImageMime = (buffer) => {
  for (const entry of MIME_BY_MAGIC) {
    if (entry.test(buffer)) return entry.mime;
  }
  return null;
};

/**
 * Accept a data URL, raw base64 string, or Buffer. Returns a validated buffer
 * and its detected MIME type. A mislabelled payload is rejected rather than
 * handed to the image decoder.
 */
const decodeImagePayload = (input) => {
  let buffer;

  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === 'string') {
    const dataUrl = input.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (dataUrl) {
      buffer = Buffer.from(dataUrl[2], 'base64');
    } else {
      buffer = Buffer.from(input, 'base64');
    }
  } else {
    return { error: 'INVALID_IMAGE', message: 'Image payload must be a data URL, base64 string, or binary buffer.' };
  }

  if (!buffer || buffer.length < 100) {
    return { error: 'INVALID_IMAGE', message: 'Image payload is invalid or empty.' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { error: 'IMAGE_TOO_LARGE', message: 'Image size exceeds the maximum limit of 10 MB.' };
  }

  const mimeType = sniffImageMime(buffer);
  if (!mimeType) {
    return { error: 'INVALID_IMAGE_FORMAT', message: 'Only PNG, JPEG, and WebP images are supported.' };
  }

  return { buffer, mimeType };
};

const toImageHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Estimate small rotations using a projection-profile search. A correctly
 * aligned page of text produces sharp peaks in the horizontal ink profile, so
 * the angle with the highest row-variance wins. The search is deliberately
 * bounded: receipts are hand-held, not architecturally rotated.
 */
const estimateSkewAngle = async (buffer) => {
  try {
    const { data, info } = await sharp(buffer)
      .resize({ width: 640, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    if (!width || !height) return 0;

    let mean = 0;
    for (let i = 0; i < data.length; i += 1) mean += data[i];
    mean /= data.length;

    const scoreAt = (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const centerX = width / 2;
      const centerY = height / 2;
      const rowInk = new Float64Array(height);
      const rowCount = new Float64Array(height);

      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const dx = x - centerX;
          const dy = y - centerY;
          const sourceX = Math.round(centerX + dx * cos - dy * sin);
          const sourceY = Math.round(centerY + dx * sin + dy * cos);
          if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
          const value = data[sourceY * width + sourceX];
          if (value < mean * 0.82) {
            // Ink is projected onto the *destination* row: when the angle
            // matches the page rotation, each text line collapses into a few
            // rows and the profile becomes sharply peaked.
            rowInk[y] += 1;
            rowCount[y] += 1;
          }
        }
      }

      let sum = 0;
      let sumSq = 0;
      let rows = 0;
      for (let y = 0; y < height; y += 1) {
        if (rowCount[y] === 0) continue;
        const ink = rowInk[y];
        sum += ink;
        sumSq += ink * ink;
        rows += 1;
      }
      if (!rows) return 0;
      return sumSq / rows - (sum / rows) ** 2;
    };

    const baseline = scoreAt(0);
    let bestAngle = 0;
    let bestScore = baseline;
    for (let angle = -6; angle <= 6; angle += 1) {
      if (angle === 0) continue;
      const score = scoreAt(angle);
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }
    // Only correct a rotation that produces a clearly sharper profile; a tiny
    // improvement is noise and rotating by it would blur the text.
    return Math.abs(bestAngle) >= 0.75 && bestScore > baseline * 1.03 ? bestAngle : 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Build OCR-ready variants. Each transformation is conditional: tiny images
 * are upscaled, huge images are capped, and the binarized pass is only used in
 * addition to the grayscale pass (never instead of it), because thresholding
 * can destroy faded thermal print.
 */
const preprocessReceiptImage = async (buffer) => {
  const metadata = await sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const sourceWidth = metadata.width || 0;
  const sourceHeight = metadata.height || 0;
  if (!sourceWidth || !sourceHeight) {
    const error = new Error('Could not read image dimensions.');
    error.code = 'INVALID_IMAGE';
    throw error;
  }

  let pipeline = sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  if (sourceWidth < MIN_OCR_WIDTH) {
    pipeline = pipeline.resize({ width: MIN_OCR_WIDTH, kernel: 'lanczos3', withoutEnlargement: false });
  } else if (sourceWidth > MAX_OCR_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_OCR_WIDTH, kernel: 'lanczos3', withoutEnlargement: true });
  }

  // Grayscale + contrast normalisation + gentle sharpening is the safest
  // common baseline for printed and photographed receipts. `normalize` also
  // pulls down uneven illumination without clipping highlights the way a hard
  // threshold does.
  const enhanced = await pipeline
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.1, m1: 0.9, m2: 0.4 })
    .linear(1.08, -8)
    .png()
    .toBuffer();

  const skewAngle = await estimateSkewAngle(enhanced);
  // `estimateSkewAngle` returns the sampling rotation that flattens the text
  // rows, which is the inverse of the image rotation. Sharp's positive angle is
  // clockwise, so the correction is applied with the opposite sign.
  const straightened = skewAngle
    ? await sharp(enhanced).rotate(-skewAngle, { background: '#ffffff' }).png().toBuffer()
    : enhanced;

  let binarized = null;
  try {
    binarized = await sharp(straightened).threshold(165).png().toBuffer();
  } catch (error) {
    binarized = null;
  }

  return {
    variants: [
      { name: 'enhanced', buffer: straightened },
      ...(binarized ? [{ name: 'binarized', buffer: binarized }] : []),
    ],
    skewAngle,
    width: sourceWidth,
    height: sourceHeight,
    processedBuffer: straightened,
  };
};

const normalizeForParsing = (text) =>
  text
    .split('\n')
    .map((line) =>
      line
        .replace(/[|]/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        // Common OCR confusions in receipt labels only.
        .replace(/T0TAL|TOTAI|TOTAl/g, 'TOTAL')
        .replace(/SUB[\s-]*T0TAL|SUB[\s-]*TOTAI/gi, 'SUBTOTAL')
        .replace(/AM[O0]UNT/gi, 'AMOUNT')
        .replace(/D[A4]TE/gi, 'DATE')
        .replace(/\bGST[I1L]N\b/gi, 'GSTIN')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

const currencyValue = (raw) => {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
};

const looksLikeDate = (value) => {
  if (!value) return false;
  const str = String(value);
  return (
    /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(str) ||
    /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}$/.test(str) ||
    /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(str)
  );
};

const isPlausibleAmount = (value) => Number.isFinite(value) && value > 0 && value < 10_000_000;

const KNOWN_MERCHANTS = [
  { pattern: /starbucks/i, name: 'Starbucks Coffee', category: 'Food & Dining' },
  { pattern: /mcdonald|mcd\b/i, name: "McDonald's", category: 'Food & Dining' },
  { pattern: /subway/i, name: 'Subway', category: 'Food & Dining' },
  { pattern: /domino/i, name: "Domino's Pizza", category: 'Food & Dining' },
  { pattern: /pizza\s*hut/i, name: 'Pizza Hut', category: 'Food & Dining' },
  { pattern: /burger\s*king/i, name: 'Burger King', category: 'Food & Dining' },
  { pattern: /kfc/i, name: 'KFC', category: 'Food & Dining' },
  { pattern: /swiggy/i, name: 'Swiggy', category: 'Food & Dining' },
  { pattern: /zomato/i, name: 'Zomato', category: 'Food & Dining' },
  { pattern: /blinkit|grofers/i, name: 'Blinkit', category: 'Groceries' },
  { pattern: /zepto/i, name: 'Zepto', category: 'Groceries' },
  { pattern: /big\s*basket|bigbasket/i, name: 'BigBasket', category: 'Groceries' },
  { pattern: /dmart|d-?mart|avenue\s+supermarts/i, name: 'DMart Supermarket', category: 'Groceries' },
  { pattern: /reliance\s+(?:fresh|smart|retail|digital)/i, name: 'Reliance Retail', category: 'Groceries' },
  { pattern: /more\s+supermarket|spencers|easyday|jiomart/i, name: 'Supermarket', category: 'Groceries' },
  { pattern: /nature'?s\s+basket/i, name: "Nature's Basket", category: 'Groceries' },
  { pattern: /apollo\s+pharmacy/i, name: 'Apollo Pharmacy', category: 'Healthcare' },
  { pattern: /medplus|wellness\s+forever/i, name: 'Pharmacy', category: 'Healthcare' },
  { pattern: /uber/i, name: 'Uber Rides', category: 'Transport' },
  { pattern: /ola\s*(?:cabs|money)?/i, name: 'Ola Cabs', category: 'Transport' },
  { pattern: /rapido/i, name: 'Rapido', category: 'Transport' },
  { pattern: /shell|bharat\s+petroleum|indian\s+oil|hp\s+petrol|petrol\s+pump|fuel/i, name: 'Fuel Station', category: 'Transport' },
  { pattern: /amazon/i, name: 'Amazon India', category: 'Shopping' },
  { pattern: /flipkart/i, name: 'Flipkart', category: 'Shopping' },
  { pattern: /myntra|ajio/i, name: 'Fashion Retail', category: 'Shopping' },
  { pattern: /zara/i, name: 'Zara', category: 'Shopping' },
  { pattern: /h&m|hnm/i, name: 'H&M', category: 'Shopping' },
  { pattern: /croma|reliance\s+digital/i, name: 'Electronics Retail', category: 'Shopping' },
  { pattern: /ikea/i, name: 'IKEA', category: 'Shopping' },
  { pattern: /decathlon/i, name: 'Decathlon', category: 'Shopping' },
  { pattern: /book\s*my\s*show|pvr|inox/i, name: 'Movie Theatre', category: 'Entertainment' },
  { pattern: /netflix|spotify|hotstar|prime\s+video/i, name: 'Subscription Service', category: 'Entertainment' },
  { pattern: /airtel|jio|vodafone|vi\s+recharge/i, name: 'Mobile Recharge', category: 'Utilities' },
  { pattern: /bescom|mseb|electricity|water\s+bill|gas\s+bill/i, name: 'Utility Bill', category: 'Utilities' },
];

const CATEGORY_KEYWORDS = [
  { pattern: /restaurant|cafe|coffee|bakery|food|pizza|burger|biryani|dhaba|hotel|mess|tiffin/i, category: 'Food & Dining' },
  { pattern: /grocery|supermarket|vegetable|fruit|kirana|provision|milk|dairy/i, category: 'Groceries' },
  { pattern: /pharmacy|medical|hospital|clinic|diagnostic|lab\b|chemist/i, category: 'Healthcare' },
  { pattern: /petrol|diesel|fuel|parking|toll|cab|taxi|metro|bus\s+fare|train/i, category: 'Transport' },
  { pattern: /electronics|mobile|laptop|fashion|clothing|footwear|jewell?ery/i, category: 'Shopping' },
  { pattern: /cinema|movie|game|entertainment|concert/i, category: 'Entertainment' },
  { pattern: /electricity|water|gas\s+bill|broadband|internet|recharge|mobile\s+bill/i, category: 'Utilities' },
  { pattern: /insurance|policy|premium/i, category: 'Insurance' },
  { pattern: /school|college|tuition|course|book|stationery/i, category: 'Education' },
];

const monthIndex = (token) => {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return months.indexOf(String(token).slice(0, 3).toLowerCase());
};

const validDateParts = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

/**
 * Extract the first valid date. Indian receipts are day-first, so an ambiguous
 * `03/04/2026` is read as 3 April (not 4 March). A missing date returns null —
 * the caller must ask the user rather than silently using today.
 */
const extractDate = (text) => {
  const candidates = [];

  const iso = /(?:^|\D)(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\D|$)/g;
  let match;
  while ((match = iso.exec(text)) !== null) {
    candidates.push({ kind: 'iso', parts: [Number(match[1]), Number(match[2]), Number(match[3])] });
  }

  const dmy = /(?:^|\D)(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\D|$)/g;
  while ((match = dmy.exec(text)) !== null) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // If the second component cannot be a month, the receipt is month-first.
    let month = second;
    let day = first;
    if (second > 12 && first <= 12) {
      month = first;
      day = second;
    }
    candidates.push({ kind: 'dmy', parts: [year, month, day] });
  }

  const dMonY = /(?:^|\D)(\d{1,2})\s*[-\s]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s,]*(\d{2,4})(?:\D|$)/gi;
  while ((match = dMonY.exec(text)) !== null) {
    let year = Number(match[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    candidates.push({ kind: 'dmy-text', parts: [year, monthIndex(match[2]) + 1, Number(match[1])] });
  }

  const monDY = /(?:^|\D)(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})(?:\D|$)/gi;
  while ((match = monDY.exec(text)) !== null) {
    candidates.push({ kind: 'mdy-text', parts: [Number(match[3]), monthIndex(match[1]) + 1, Number(match[2])] });
  }

  for (const candidate of candidates) {
    const [year, month, day] = candidate.parts;
    const date = validDateParts(year, month, day);
    if (!date) continue;
    const now = new Date();
    const upper = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2);
    if (date.getTime() > upper) continue;
    return {
      iso: date.toISOString().slice(0, 10),
      confidence: candidate.kind === 'iso' ? 95 : candidate.kind.endsWith('text') ? 92 : 86,
      ambiguous: candidate.kind === 'dmy',
    };
  }
  return null;
};

const extractAmount = (lines) => {
  const labelDefinitions = [
    { re: /\bgrand\s*total\b/i, priority: 100, label: 'grand total' },
    { re: /\btotal\s*(?:amount|payable|invoice\s*value)\b/i, priority: 98, label: 'total amount' },
    { re: /\b(?:net\s*(?:amount|payable)|amount\s*payable|total\s*payable|net\s*payable)\b/i, priority: 96, label: 'net payable' },
    { re: /\b(?:amount\s*paid|paid\s*amount|total\s*paid)\b/i, priority: 94, label: 'amount paid' },
    { re: /\b(?:balance\s*due|due\s*amount)\b/i, priority: 90, label: 'balance due' },
    { re: /\btotal\b/i, priority: 86, label: 'total' },
    { re: /\b(?:sub\s*total|subtotal)\b/i, priority: 40, label: 'subtotal' },
  ];

  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    // "Total tax", "total qty", "total items" are not payable totals.
    if (/\b(?:tax|gst|vat|qty|quantity|items?|savings?)\b/i.test(line) && !/grand\s*total|total\s*amount|amount\s*payable/i.test(line)) {
      continue;
    }

    let definition = null;
    for (const def of labelDefinitions) {
      if (def.re.test(line)) {
        definition = def;
        break;
      }
    }
    if (!definition) continue;

    const afterLabel = line.replace(definition.re, ' ');
    const numbers = afterLabel.match(/\d[\d,]*(?:\.\d{1,2})?/g) || [];
    let value = null;
    for (const token of numbers) {
      const parsed = currencyValue(token);
      if (isPlausibleAmount(parsed)) {
        value = parsed;
        break;
      }
    }

    // Label and amount may be split across two lines (common on thermal
    // receipts whose columns are far apart).
    if (value === null && index + 1 < lines.length) {
      const next = lines[index + 1];
      const nextNumbers = next.match(/\d[\d,]*(?:\.\d{1,2})?/g) || [];
      for (const token of nextNumbers) {
        const parsed = currencyValue(token);
        if (isPlausibleAmount(parsed)) {
          value = parsed;
          break;
        }
      }
    }

    if (value === null) continue;
    candidates.push({ value, priority: definition.priority, label: definition.label, lineIndex: index });
  }

  if (candidates.length) {
    // Highest-priority label wins; among equals, the later line wins because
    // receipts put the final payable total at the bottom.
    candidates.sort((a, b) => (b.priority - a.priority) || (b.lineIndex - a.lineIndex));
    const best = candidates[0];
    const confidence = best.priority >= 90 ? 94 : best.priority >= 80 ? 86 : 58;
    return { value: best.value, confidence, label: best.label };
  }

  // Currency-tagged values anywhere on the receipt.
  const currencyCandidates = [];
  const currencyRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let match;
  while ((match = currencyRe.exec(lines.join('\n'))) !== null) {
    const value = currencyValue(match[1]);
    if (isPlausibleAmount(value)) currencyCandidates.push(value);
  }
  if (currencyCandidates.length) {
    return { value: Math.max(...currencyCandidates), confidence: 55, label: 'currency value' };
  }

  // Last resort: a decimal monetary value. Reject long digit runs (invoice,
  // phone, GSTIN) and integers without decimals.
  const decimalCandidates = [];
  const decimalRe = /\b(\d{1,7}\.\d{2})\b/g;
  while ((match = decimalRe.exec(lines.join('\n'))) !== null) {
    const value = currencyValue(match[1]);
    if (isPlausibleAmount(value) && value >= 1) decimalCandidates.push(value);
  }
  if (decimalCandidates.length) {
    return { value: Math.max(...decimalCandidates), confidence: 34, label: 'decimal value' };
  }

  return { value: null, confidence: 0, label: null };
};

const cleanMerchantName = (line) =>
  line
    .replace(/[^\w\s&'.-]/g, ' ')
    .replace(/\b(?:pvt|private)\s+ltd\b/gi, '')
    .replace(/\b(?:limited|ltd)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const merchantCandidateScore = (line, index) => {
  if (!line) return -1;
  const text = line.trim();
  if (text.length < 3 || text.length > 60) return -1;
  if (!/[A-Za-z]{3}/.test(text)) return -1;
  if (isPlausibleAmount(currencyValue(text)) && !/[A-Za-z]{3}/.test(text.replace(/rs|inr|total/gi, ''))) return -1;
  if (/\b(?:gstin|gst\s*no|invoice|bill\s*(?:no|number)|receipt\s*(?:no|number)|order\s*(?:no|number)|date|time|cash|card|upi|change|thank|welcome|visit|www\.|@|phone|mobile|tel)\b/i.test(text)) {
    return -1;
  }
  // A payable/tax line is never the business name, even when it contains
  // letters ("Grand Total", "Total Payable", "Amount Due").
  if (/\b(?:grand\s*total|sub\s*total|subtotal|total|amount|balance|due|paid|tax|gst|vat|discount)\b/i.test(text)) {
    return -1;
  }
  if (/\b(?:tax\s+invoice|invoice|receipt|cash\s+memo|bill)\b/i.test(text)) return -1;

  let score = 0;
  if (index <= 2) score += 30;
  if (text === text.toUpperCase()) score += 18;
  if (/^[A-Za-z0-9&'.\s-]+$/.test(text)) score += 8;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 7) score += 8;
  if (words.length > 9) score -= 15;
  if (/\d{4,}/.test(text)) score -= 18;
  if (/\b(?:road|street|nagar|colony|sector|floor|plot|near|opposite|landmark)\b/i.test(text)) score -= 25;
  if (/\b(?:mumbai|delhi|bangalore|bengaluru|pune|chennai|hyderabad|kolkata|ahmedabad|surat|jaipur)\b/i.test(text)) score -= 8;
  return score;
};

const extractMerchant = (lines) => {
  const joined = lines.join('\n');
  for (const known of KNOWN_MERCHANTS) {
    if (known.pattern.test(joined)) {
      return { name: known.name, category: known.category, confidence: 95, source: 'known-brand' };
    }
  }

  let best = null;
  for (let index = 0; index < Math.min(lines.length, 8); index += 1) {
    const score = merchantCandidateScore(lines[index], index);
    if (score > 0 && (!best || score > best.score)) {
      best = { name: cleanMerchantName(lines[index]), score, index };
    }
  }

  if (!best || best.name.length < 3) return { name: null, category: null, confidence: 0, source: null };
  const confidence = best.score >= 55 ? 74 : best.score >= 40 ? 58 : 42;
  return { name: best.name, category: null, confidence, source: 'header' };
};

const extractPaymentMethod = (text) => {
  if (/\b(?:upi|gpay|google\s*pay|phonepe|paytm|bhim)\b/i.test(text)) return 'UPI';
  if (/\b(?:credit\s*card|debit\s*card|visa|mastercard|rupay|card)\b/i.test(text)) return 'Card';
  if (/\b(?:cash|change|cash\s*tendered)\b/i.test(text)) return 'Cash';
  if (/\b(?:net\s*banking|neft|imps)\b/i.test(text)) return 'Bank Transfer';
  if (/\bwallet\b/i.test(text)) return 'Wallet';
  return null;
};

const extractReceiptNumber = (text) => {
  const match = text.match(/\b(?:invoice|bill|receipt|order|ref(?:erence)?)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i);
  if (!match) return null;
  const value = match[1].replace(/[.,;:]$/, '');
  // Avoid returning a date or a pure word as an identifier.
  if (!/\d/.test(value) || looksLikeDate(value)) return null;
  return value;
};

const extractLineItems = (lines) => {
  const items = [];
  for (const line of lines) {
    if (items.length >= 12) break;
    if (line.length < 5 || line.length > 90) continue;
    if (/\b(?:total|subtotal|grand\s*total|tax|gst|cgst|sgst|igst|vat|discount|round\s*off|change|cash|card|upi|balance|invoice|bill\s*no|gstin|phone|date|time)\b/i.test(line)) {
      continue;
    }
    const hasQuantityPrice = /^\s*\d{1,3}\s*[xX×]\s*\d/i.test(line) || /\d+\s*(?:pcs?|nos?|qty)\b/i.test(line);
    const trailingPrice = /\s\d{1,4}(?:\.\d{2})?\s*$/.test(line);
    if (!hasQuantityPrice && !trailingPrice) continue;
    const cleaned = line.replace(/[^\w\s.,xX×/-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 5) items.push(cleaned);
  }
  return items;
};

const applyCategoryRules = (text, merchant) => {
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.pattern.test(text)) return { category: rule.category, confidence: 82, source: 'keyword' };
  }
  const prediction = mlCategorizerService.predict(merchant || '', 0);
  if (prediction && prediction.category && prediction.category !== 'General') {
    return {
      category: prediction.category,
      confidence: Math.round((prediction.confidence || 0.5) * 100),
      source: 'ml',
    };
  }
  return { category: 'General', confidence: 25, source: 'default' };
};

/**
 * Parse receipt text into structured fields. Exported for deterministic tests.
 * `lineStats` is optional line-level OCR confidence produced by Tesseract.
 */
const parseReceiptText = (rawText, lineStats = []) => {
  const text = String(rawText || '');
  const lines = normalizeForParsing(text);
  const normalizedText = lines.join('\n');
  const lineConfidence = new Map();
  for (const stat of lineStats) {
    if (!stat || !stat.text) continue;
    const key = stat.text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) continue;
    const current = lineConfidence.get(key);
    if (current === undefined || stat.confidence > current) lineConfidence.set(key, stat.confidence);
  }
  const confidenceFor = (needle) => {
    const key = String(needle || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) return null;
    if (lineConfidence.has(key)) return lineConfidence.get(key);
    for (const [line, confidence] of lineConfidence.entries()) {
      if (line.includes(key) || key.includes(line)) return confidence;
    }
    return null;
  };

  const merchantInfo = extractMerchant(lines);
  let categoryInfo = merchantInfo.category
    ? { category: merchantInfo.category, confidence: 92, source: 'known-brand' }
    : applyCategoryRules(normalizedText, merchantInfo.name);

  const amountInfo = extractAmount(lines);
  const dateInfo = extractDate(normalizedText);
  const paymentMethod = extractPaymentMethod(normalizedText);
  const receiptNumber = extractReceiptNumber(normalizedText);
  const items = extractLineItems(lines);

  const merchantOcrConfidence = confidenceFor(merchantInfo.name);
  const merchantConfidence = merchantInfo.confidence
    ? Math.round(Math.min(100, merchantInfo.confidence * 0.75 + (merchantOcrConfidence ?? merchantInfo.confidence) * 0.25))
    : 0;
  const amountOcrConfidence = confidenceFor(amountInfo.label);
  const amountConfidence = amountInfo.value
    ? Math.round(Math.min(100, amountInfo.confidence * 0.8 + (amountOcrConfidence ?? amountInfo.confidence) * 0.2))
    : 0;
  const dateConfidence = dateInfo ? dateInfo.confidence : 0;

  return {
    merchant: merchantInfo.name || null,
    amount: amountInfo.value,
    date: dateInfo ? dateInfo.iso : null,
    category: categoryInfo.category,
    paymentMethod,
    receiptNumber,
    items,
    confidence: {
      merchant: merchantConfidence,
      amount: amountConfidence,
      date: dateConfidence,
      category: Math.round(categoryInfo.confidence || 0),
      overall: Math.round(
        (merchantConfidence * 0.25 + amountConfidence * 0.4 + dateConfidence * 0.2 + (categoryInfo.confidence || 0) * 0.15)
      ),
    },
    sources: {
      merchant: merchantInfo.source,
      category: categoryInfo.source,
      amount: amountInfo.label,
    },
    amountLabel: amountInfo.label,
  };
};

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('OCR vision fallback timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

const isVisionFallbackEnabled = () => {
  if (String(process.env.OCR_VISION_FALLBACK || '').toLowerCase() === 'false') return false;
  if (process.env.NODE_ENV === 'test') return false;
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY');
};

/**
 * Optional Gemini interpretation. Used only as a fallback for low-confidence
 * Tesseract output and always returns null on failure, so OCR never depends on
 * a paid provider being reachable.
 */
const interpretWithVision = async (imageBuffer, ocrText) => {
  if (!isVisionFallbackEnabled()) return null;
  try {
    const aiService = require('./aiService');
    const client = aiService.getGeminiClient();
    const modelName = process.env.AI_MODEL || 'gemini-3.5-flash-lite';
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    const visionBuffer = await sharp(imageBuffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    const prompt = `You are reading a photographed Indian payment receipt. Return ONLY JSON with this exact shape:
{"merchant":string|null,"amount":number|null,"date":"YYYY-MM-DD"|null,"category":string|null,"paymentMethod":string|null,"receiptNumber":string|null,"tax":number|null,"items":string[],"confidence":{"merchant":number,"amount":number,"date":number,"category":number}}
Rules:
- "amount" is the final amount actually paid or the grand total. Never use subtotal, tax, discount, change, invoice number, phone number, GSTIN, or an item price.
- "merchant" is the business name at the top of the receipt. Return null instead of guessing.
- "date" is the transaction date. Return null if no date is readable; never use today's date.
- category must be one of: Food & Dining, Groceries, Healthcare, Transport, Shopping, Entertainment, Utilities, Insurance, Education, General.
- confidence values are 0-100. Set a low value when the field is inferred rather than visibly printed.
- Do not invent any value. If unsure, use null.
OCR text for reference (may contain errors):
${String(ocrText || '').slice(0, 4000)}`;

    const result = await withTimeout(
      model.generateContent([
        { inlineData: { data: visionBuffer.toString('base64'), mimeType: 'image/jpeg' } },
        { text: prompt },
      ]),
      VISION_TIMEOUT_MS
    );

    const raw = result?.response?.text?.() || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn('[OCR] Vision fallback unavailable:', error.message);
    return null;
  }
};

const mergeVisionResult = (parsed, vision) => {
  if (!vision) return parsed;
  const visionConfidence = (field) => {
    const value = vision.confidence && Number(vision.confidence[field]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  };
  const categoryList = new Set([
    'Food & Dining', 'Groceries', 'Healthcare', 'Transport', 'Shopping',
    'Entertainment', 'Utilities', 'Insurance', 'Education', 'General',
  ]);

  const merged = { ...parsed, sources: { ...parsed.sources } };
  const confidence = { ...parsed.confidence };

  const visionMerchant = typeof vision.merchant === 'string' ? vision.merchant.trim() : '';
  if (visionMerchant && visionConfidence('merchant') >= VISION_MIN_CONFIDENCE * 100 && visionConfidence('merchant') >= confidence.merchant) {
    merged.merchant = visionMerchant;
    confidence.merchant = Math.round(visionConfidence('merchant'));
    merged.sources.merchant = 'vision';
  }

  const visionAmount = Number(vision.amount);
  if (isPlausibleAmount(visionAmount) && visionConfidence('amount') >= VISION_MIN_CONFIDENCE * 100 && visionConfidence('amount') >= confidence.amount) {
    merged.amount = Math.round(visionAmount * 100) / 100;
    confidence.amount = Math.round(visionConfidence('amount'));
    merged.sources.amount = 'vision';
  }

  const visionDate = typeof vision.date === 'string' ? extractDate(vision.date) : null;
  if (visionDate && visionConfidence('date') >= VISION_MIN_CONFIDENCE * 100 && visionConfidence('date') >= confidence.date) {
    merged.date = visionDate.iso;
    confidence.date = Math.round(visionConfidence('date'));
    merged.sources.date = 'vision';
  }

  if (typeof vision.category === 'string' && categoryList.has(vision.category) && visionConfidence('category') >= VISION_MIN_CONFIDENCE * 100 && visionConfidence('category') >= confidence.category) {
    merged.category = vision.category;
    confidence.category = Math.round(visionConfidence('category'));
    merged.sources.category = 'vision';
  }

  if (!merged.paymentMethod && typeof vision.paymentMethod === 'string') merged.paymentMethod = vision.paymentMethod;
  if (!merged.receiptNumber && typeof vision.receiptNumber === 'string') merged.receiptNumber = vision.receiptNumber;
  if ((!merged.items || merged.items.length === 0) && Array.isArray(vision.items)) {
    merged.items = vision.items.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12);
  }

  confidence.overall = Math.round(
    confidence.merchant * 0.25 + confidence.amount * 0.4 + confidence.date * 0.2 + confidence.category * 0.15
  );
  merged.confidence = confidence;
  return merged;
};

const collectLineStats = (data) => {
  const stats = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        if (line?.text) {
          stats.push({ text: line.text, confidence: Number(line.confidence) || 0 });
        }
      }
    }
  }
  return stats;
};

/**
 * Run all preprocessing + OCR passes and return the best result.
 */
const runReceiptOcr = async (imageBuffer) => {
  const preprocessed = await preprocessReceiptImage(imageBuffer);
  const worker = await createWorker('eng');
  const passes = [];
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    for (const variant of preprocessed.variants) {
      try {
        const result = await worker.recognize(variant.buffer, {}, { text: true, blocks: true });
        const text = (result.data?.text || '').trim();
        const confidence = Math.round(Number(result.data?.confidence) || 0);
        passes.push({
          variant: variant.name,
          text,
          confidence,
          lineStats: collectLineStats(result.data),
        });
      } catch (error) {
        // A failed preprocessing variant must not fail the whole scan.
        console.warn(`[OCR] ${variant.name} pass failed:`, error.message);
      }
    }

    let best = passes.sort((a, b) => (b.confidence - a.confidence) || (b.text.length - a.text.length))[0];

    // Sparse text recovers receipts with separated columns (item name left,
    // price right) that SINGLE_BLOCK merges poorly. Only pay for it when the
    // first pass is weak.
    if (!best || best.confidence < 55) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(preprocessed.variants[0].buffer, {}, { text: true, blocks: true });
        const text = (result.data?.text || '').trim();
        const confidence = Math.round(Number(result.data?.confidence) || 0);
        if (text && (!best || confidence > best.confidence || text.length > best.text.length * 1.15)) {
          best = { variant: 'sparse', text, confidence, lineStats: collectLineStats(result.data) };
        }
      } catch (error) {
        console.warn('[OCR] Sparse pass failed:', error.message);
      }
    }

    return {
      ...(best || { variant: 'none', text: '', confidence: 0, lineStats: [] }),
      passes: passes.map(({ variant, confidence, text }) => ({ variant, confidence, characters: text.length })),
      skewAngle: preprocessed.skewAngle,
      processedBuffer: preprocessed.processedBuffer,
      imageWidth: preprocessed.width,
      imageHeight: preprocessed.height,
    };
  } finally {
    await worker.terminate().catch(() => {});
  }
};

/**
 * Full pipeline for one receipt: OCR → parse → optional vision fallback.
 */
const extractReceipt = async (imageBuffer) => {
  const ocr = await runReceiptOcr(imageBuffer);
  if (!ocr.text) {
    const error = new Error('Could not extract readable text from the uploaded image. Please retake the photo in good light and keep the receipt flat.');
    error.code = 'OCR_UNREADABLE';
    throw error;
  }

  let parsed = parseReceiptText(ocr.text, ocr.lineStats);
  const needsVision =
    ocr.confidence < 60 ||
    !parsed.amount ||
    !parsed.merchant ||
    !parsed.date ||
    parsed.confidence.amount < 55;

  if (needsVision) {
    const vision = await interpretWithVision(ocr.processedBuffer, ocr.text);
    parsed = mergeVisionResult(parsed, vision);
  }

  parsed.ocrConfidence = ocr.confidence;
  parsed.ocrVariants = ocr.passes;
  parsed.skewAngle = Math.round((ocr.skewAngle || 0) * 10) / 10;
  parsed.imageWidth = ocr.imageWidth;
  parsed.imageHeight = ocr.imageHeight;
  parsed.ocrText = ocr.text;
  parsed.imageHash = toImageHash(ocr.processedBuffer);
  return parsed;
};

module.exports = {
  MAX_IMAGE_BYTES,
  decodeImagePayload,
  preprocessReceiptImage,
  estimateSkewAngle,
  extractReceipt,
  parseReceiptText,
  extractAmount,
  extractDate,
  extractMerchant,
  mergeVisionResult,
  toImageHash,
  isVisionFallbackEnabled,
};
