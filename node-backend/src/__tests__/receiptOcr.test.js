/**
 * Receipt OCR extraction tests.
 *
 * These lock in the two rules that matter most for real receipts:
 *   • the amount chosen is the amount actually paid (grand total / amount paid),
 *     never a subtotal, tax line, or an arbitrary number;
 *   • a value that is not printed on the receipt comes back as `null` rather
 *     than being invented — especially today's date.
 */

const sharp = require('sharp');
const {
  parseReceiptText,
  decodeImagePayload,
  toImageHash,
  extractDate,
  estimateSkewAngle,
} = require('../services/receiptOcrService');

const DMART_RECEIPT = `DMART SUPERMARKET
GSTIN: 27AABCU9603R1ZX
Invoice No: 4471
Date: 03/04/2026
Bath Soap 45.00
Basmati Rice 5kg 620.00
Subtotal 665.00
CGST 9% 59.85
SGST 9% 59.85
Total Tax 119.70
Grand Total 784.70
Cash 800.00
Change 15.30
Thank you for shopping with us`;

describe('parseReceiptText — amount', () => {
  it('prefers the grand total over subtotal, tax and change', () => {
    const parsed = parseReceiptText(DMART_RECEIPT);
    expect(parsed.amount).toBe(784.70);
    expect(parsed.amountLabel).toBe('grand total');
    expect(parsed.confidence.amount).toBeGreaterThan(50);
  });

  it('ignores a "Total Tax" line and uses the payable total', () => {
    const parsed = parseReceiptText(`CORNER CAFE
Date 12/05/2026
Total Tax 18.00
Total Amount 236.00
UPI 236.00`);
    expect(parsed.amount).toBe(236);
  });

  it('reads an amount that sits on the line below its label', () => {
    const parsed = parseReceiptText(`CITY PHARMACY
Date 01/02/2026
Amount Payable
412.50
Card`);
    expect(parsed.amount).toBe(412.5);
  });

  it('returns null instead of guessing when no amount is printed', () => {
    const parsed = parseReceiptText(`THANK YOU
Visit again
Have a nice day`);
    expect(parsed.amount).toBeNull();
    expect(parsed.confidence.amount).toBe(0);
  });
});

describe('parseReceiptText — date', () => {
  it('reads Indian day-first dates', () => {
    expect(extractDate('Date: 03/04/2026').iso).toBe('2026-04-03');
    expect(extractDate('03-04-2026').iso).toBe('2026-04-03');
  });

  it('reads ISO and textual dates', () => {
    expect(extractDate('2026-04-03').iso).toBe('2026-04-03');
    expect(extractDate('3 Apr 2026').iso).toBe('2026-04-03');
    expect(extractDate('Apr 3, 2026').iso).toBe('2026-04-03');
  });

  it('swaps month-first dates when the day cannot be a month', () => {
    expect(extractDate('04/25/2026').iso).toBe('2026-04-25');
  });

  it('never falls back to today when the receipt has no date', () => {
    const parsed = parseReceiptText('DMART SUPERMARKET\nGrand Total 500.00');
    expect(parsed.date).toBeNull();
    expect(parsed.confidence.date).toBe(0);
  });

  it('never invents a merchant for an unlabelled receipt', () => {
    const parsed = parseReceiptText('1234\n5678\nGrand Total 500.00');
    expect(parsed.merchant).toBeNull();
  });
});

describe('parseReceiptText — merchant and category', () => {
  it('normalizes a known brand and its category', () => {
    const parsed = parseReceiptText(DMART_RECEIPT);
    expect(parsed.merchant).toBe('DMart Supermarket');
    expect(parsed.category).toBe('Groceries');
    expect(parsed.sources.merchant).toBe('known-brand');
  });

  it('keeps an unknown merchant header but classifies it from receipt text', () => {
    const parsed = parseReceiptText(`SRI LAKSHMI STORES
Date 09/09/2026
Coffee and snacks
Total 180.00`);
    expect(parsed.merchant).toBe('SRI LAKSHMI STORES');
    expect(parsed.category).toBe('Food & Dining');
  });

  it('detects the payment method and receipt number', () => {
    const parsed = parseReceiptText(DMART_RECEIPT);
    expect(parsed.paymentMethod).toBe('Cash');
    expect(parsed.receiptNumber).toContain('4471');
  });
});

describe('decodeImagePayload', () => {
  it('accepts a PNG data URL and reports the sniffed MIME type', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    const decoded = decodeImagePayload(`data:image/png;base64,${png.toString('base64')}`);
    expect(decoded.error).toBeUndefined();
    expect(decoded.mimeType).toBe('image/png');
    expect(decoded.buffer.length).toBe(png.length);
  });

  it('rejects a payload whose bytes are not a supported image format', () => {
    const fake = Buffer.from(
      `GIF89a ${'this is not really an image but it is long enough to pass the size check '.repeat(2)}`
    );
    const decoded = decodeImagePayload(fake);
    expect(decoded.error).toBe('INVALID_IMAGE_FORMAT');
  });

  it('rejects an empty payload', () => {
    expect(decodeImagePayload('').error).toBe('INVALID_IMAGE');
    expect(decodeImagePayload(null).error).toBe('INVALID_IMAGE');
  });

  it('rejects images above the size limit', () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    expect(decodeImagePayload(oversized).error).toBe('IMAGE_TOO_LARGE');
  });

  it('hashes identical bytes to the same value', () => {
    const buffer = Buffer.from('identical image bytes');
    expect(toImageHash(buffer)).toBe(toImageHash(Buffer.from('identical image bytes')));
    expect(toImageHash(buffer)).not.toBe(toImageHash(Buffer.from('different image bytes')));
  });
});

describe('estimateSkewAngle', () => {
  // 12 dark bars on a light page: the horizontal ink profile is sharply
  // peaked when the page is straight, and flattens as it rotates.
  const pageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900">
    <rect width="720" height="900" fill="#ffffff"/>
    ${Array.from({ length: 12 }, (_, i) =>
      `<rect x="80" y="${90 + i * 60}" width="560" height="16" fill="#111111"/>`
    ).join('')}
  </svg>`;

  const rotatedPage = async (degrees) => {
    const straight = await sharp(Buffer.from(pageSvg)).png().toBuffer();
    return sharp(straight)
      .rotate(degrees, { background: '#ffffff' })
      .jpeg({ quality: 95 })
      .toBuffer();
  };

  it('reports no correction for an upright page', async () => {
    const angle = await estimateSkewAngle(await rotatedPage(0));
    expect(Math.abs(angle)).toBeLessThanOrEqual(1);
  });

  it('detects a clockwise rotation so the caller can undo it', async () => {
    const angle = await estimateSkewAngle(await rotatedPage(3));
    expect(angle).toBeGreaterThanOrEqual(2);
    expect(angle).toBeLessThanOrEqual(4);
  });

  it('detects a counter-clockwise rotation with the opposite sign', async () => {
    const angle = await estimateSkewAngle(await rotatedPage(-4));
    expect(angle).toBeLessThanOrEqual(-3);
    expect(angle).toBeGreaterThanOrEqual(-5);
  });
});
