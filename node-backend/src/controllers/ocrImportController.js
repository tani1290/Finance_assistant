const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');
const { createWorker } = require('tesseract.js');
const storageService = require('../services/storageService');
const documentIngestionService = require('../services/documentIngestionService');
const mlCategorizerService = require('../services/mlCategorizerService');
const { v4: uuidv4 } = require('uuid');

/**
 * OCR Receipt & Bank Statement Ingestion Controller
 * Owner: Jinay Golecha (jinay_golecha)
 * ABSOLUTE RULE 1 & 15 COMPLIANCE: Zero fake OCR results.
 * Unified Ingestion Engine: PDF Text/OCR, CSV, Receipt OCR with GST breakdown & ML classification.
 */

// Bank-statement confirmation is the one multi-row write in the import flow, so
// it runs under Serializable isolation: two simultaneous confirmations of the
// same payload can no longer both miss the other's uncommitted rows and insert a
// double set. Postgres aborts one of them (P2034 / SQLSTATE 40001); because the
// whole transaction rolled back, a bounded retry re-reads the now-committed rows,
// skips them as duplicates and reports that, so the client gets a meaningful
// "nothing new to import" result instead of a raw error. A retry can never
// double-apply: the aborted attempt left no rows and no balance change behind.
const CONFIRM_IMPORT_MAX_ATTEMPTS = 3; // 1 initial attempt + 2 conflict retries
const CONFIRM_IMPORT_RETRY_DELAY_MS = 25;

const isRetryableConflict = (error) =>
  !!error &&
  (error.code === 'P2034' ||
    error.code === '40001' ||
    /serialization|deadlock|could not serialize/i.test(String(error.message || '')));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Parse structured receipt fields from extracted text
const parseReceiptText = (rawText) => {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  let merchant = null;
  let amount = null;
  let date = null;
  let category = 'General';
  const items = [];

  const textLower = rawText.toLowerCase();

  // 1. Merchant Detection: Check known brands
  const knownMerchants = [
    { pattern: /starbucks/i, name: 'Starbucks Coffee', cat: 'Food & Dining' },
    { pattern: /mcdonald|mcd/i, name: "McDonald's", cat: 'Food & Dining' },
    { pattern: /subway/i, name: 'Subway', cat: 'Food & Dining' },
    { pattern: /domino/i, name: "Domino's Pizza", cat: 'Food & Dining' },
    { pattern: /swiggy/i, name: 'Swiggy', cat: 'Food & Dining' },
    { pattern: /zomato/i, name: 'Zomato', cat: 'Food & Dining' },
    { pattern: /d-?mart|avenue\s+supermarts/i, name: 'DMart Supermarket', cat: 'Groceries' },
    { pattern: /reliance\s+(?:fresh|smart|retail)/i, name: 'Reliance Retail', cat: 'Groceries' },
    { pattern: /nature'?s\s+basket/i, name: "Nature's Basket", cat: 'Groceries' },
    { pattern: /bigbasket/i, name: 'BigBasket', cat: 'Groceries' },
    { pattern: /apollo\s+pharmacy/i, name: 'Apollo Pharmacy', cat: 'Healthcare' },
    { pattern: /medplus/i, name: 'MedPlus Pharmacy', cat: 'Healthcare' },
    { pattern: /uber/i, name: 'Uber Rides', cat: 'Transport' },
    { pattern: /ola/i, name: 'Ola Cabs', cat: 'Transport' },
    { pattern: /shell|bharat\s+petroleum|indian\s+oil|hp\s+petrol/i, name: 'Fuel Station', cat: 'Transport' },
    { pattern: /amazon/i, name: 'Amazon India', cat: 'Shopping' },
    { pattern: /flipkart/i, name: 'Flipkart', cat: 'Shopping' },
    { pattern: /zara/i, name: 'Zara', cat: 'Shopping' },
    { pattern: /h&m|hnm/i, name: 'H&M', cat: 'Shopping' },
    { pattern: /croma/i, name: 'Croma Electronics', cat: 'Shopping' },
    { pattern: /ikea/i, name: 'IKEA', cat: 'Shopping' },
  ];

  for (const km of knownMerchants) {
    if (km.pattern.test(textLower)) {
      merchant = km.name;
      category = km.cat;
      break;
    }
  }

  // Fallback to first line that isn't a tax or header line
  if (!merchant && lines.length > 0) {
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const candidate = lines[i].replace(/[^\w\s&'-]/g, '').trim();
      if (candidate.length >= 3 && !/invoice|tax|receipt|bill|gstin|pan/i.test(candidate)) {
        merchant = candidate;
        break;
      }
    }
  }
  if (!merchant) merchant = 'Retail Merchant';

  // 2. Amount Detection
  const totalRegex = /(?:grand\s+total|net\s+total|total\s+amount|bill\s+amount|amount\s+payable|total|net\s+payable|bal(?:ance)?\s+due|subtotal)[\s:=₹rs\.]*([\d,]+(?:\.\d{1,2})?)/i;
  const matchTotal = rawText.match(totalRegex);
  if (matchTotal && matchTotal[1]) {
    const parsed = parseFloat(matchTotal[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) amount = parsed;
  }

  // Fallback: look for currency symbol followed by numbers
  if (!amount) {
    const currencyRegex = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
    let match;
    let maxFound = 0;
    while ((match = currencyRegex.exec(rawText)) !== null) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > maxFound) maxFound = val;
    }
    if (maxFound > 0) amount = maxFound;
  }

  // Last resort amount fallback: highest reasonable monetary value in lines
  if (!amount) {
    const anyNumberRegex = /\b\d+(?:,\d{3})*(?:\.\d{2})\b/g;
    const nums = rawText.match(anyNumberRegex);
    if (nums) {
      const vals = nums.map(n => parseFloat(n.replace(/,/g, ''))).filter(v => v > 0 && v < 1000000);
      if (vals.length > 0) {
        amount = Math.max(...vals);
      }
    }
  }

  // 3. Date Detection
  const datePatterns = [
    /\b(\d{4}[-/.]\d{2}[-/.]\d{2})\b/, // YYYY-MM-DD
    /\b(\d{2}[-/.]\d{2}[-/.]\d{4})\b/, // DD-MM-YYYY
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i,
  ];
  for (const dp of datePatterns) {
    const dm = rawText.match(dp);
    if (dm && dm[1]) {
      const parsedDate = new Date(dm[1]);
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate.toISOString().split('T')[0];
        break;
      }
    }
  }
  if (!date) {
    date = new Date().toISOString().split('T')[0];
  }

  // 4. ML / Keyword Categorization Refinement
  if (category === 'General') {
    const mlPred = mlCategorizerService.predict(merchant, amount);
    category = mlPred.category;
  }

  // 5. Items extraction: lines with quantity or price patterns
  lines.forEach(line => {
    if (line.length > 4 && /\d/.test(line) && !/total|gst|tax|cash|change|card|subtotal/i.test(line)) {
      items.push(line.replace(/[^\w\s.,-]/g, '').trim());
    }
  });

  return {
    merchant,
    amount: amount ? Math.round(amount * 100) / 100 : null,
    date,
    category,
    items: items.slice(0, 5),
  };
};

/**
 * POST /api/v1/receipts/scan
 * Performs real OCR extraction using Tesseract.js on uploaded receipt image or text
 * Extracts GST data (GSTIN, CGST, SGST, IGST, total GST) when present
 */
const scanReceipt = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { receiptText, imageData } = req.body;

    if (!receiptText && !imageData) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Either receipt image (imageData) or receipt text is required.' },
      });
    }

    let extractedText = (receiptText || '').trim();
    let ocrConfidence = 100;

    // If imageData is provided, perform genuine OCR via Tesseract.js
    if (imageData) {
      let imageBuffer = null;

      if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
        // Base64 data URL
        const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
        if (!match) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_IMAGE_FORMAT', message: 'Only PNG, JPEG, and WebP images are supported.' },
          });
        }
        imageBuffer = Buffer.from(match[2], 'base64');
      } else if (typeof imageData === 'string') {
        // Raw base64 string
        imageBuffer = Buffer.from(imageData, 'base64');
      } else if (Buffer.isBuffer(imageData)) {
        imageBuffer = imageData;
      }

      if (!imageBuffer || imageBuffer.length < 100) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_IMAGE', message: 'Image payload is invalid or empty.' },
        });
      }

      // Max 10MB file limit
      if (imageBuffer.length > 10 * 1024 * 1024) {
        return res.status(413).json({
          success: false,
          error: { code: 'IMAGE_TOO_LARGE', message: 'Image size exceeds maximum limit of 10MB.' },
        });
      }

      // Run Tesseract OCR Worker
      const worker = await createWorker('eng');
      try {
        const ocrResult = await worker.recognize(imageBuffer);
        extractedText = (ocrResult.data?.text || '').trim();
        ocrConfidence = Math.round(ocrResult.data?.confidence || 0);
      } finally {
        await worker.terminate();
      }

      if (!extractedText) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'OCR_UNREADABLE',
            message: 'Could not extract readable text from the uploaded image. Please ensure the receipt is well-lit and legible, or enter details manually.',
          },
        });
      }

      // Persist raw receipt image to Cloud / Local Storage Service (User-isolated path)
      try {
        const receiptExt = '.png';
        const storageKey = `users/${userId}/receipts/receipt_${Date.now()}_${uuidv4().slice(0, 8)}${receiptExt}`;
        const stored = await storageService.upload({
          buffer: imageBuffer,
          key: storageKey,
          contentType: 'image/png',
          metadata: { userId, documentType: 'receipts', scanDate: new Date().toISOString() },
        });
        req.__storedReceipt = stored;
      } catch (storageErr) {
        console.warn('[Storage] Receipt image storage notice:', storageErr.message);
      }
    }

    const parsed = parseReceiptText(extractedText);
    const gstInfo = documentIngestionService.extractGSTInformation(extractedText);
    const storedReceipt = req.__storedReceipt || null;

    if (!parsed.amount || parsed.amount <= 0) {
      return res.status(200).json({
        success: true,
        data: {
          scanId: null,
          merchant: parsed.merchant || 'Unidentified Merchant',
          amount: null,
          formattedAmount: 'Unrecognized',
          date: parsed.date,
          category: parsed.category,
          items: parsed.items,
          gst: gstInfo,
          rawText: extractedText.slice(0, 500),
          ocrConfidence,
          receiptImageUrl: storedReceipt?.url || null,
          storageKey: storedReceipt?.key || null,
          status: 'MANUAL_INPUT_REQUIRED',
          message: 'Could not detect a clear total amount from the receipt. Please enter the amount before confirming.',
        },
      });
    }

    // Persist scan preview to DB with status PENDING_CONFIRMATION
    const scan = await prisma.receiptScan.create({
      data: {
        userId,
        merchant: parsed.merchant,
        amount: parsed.amount,
        date: parseDateOnly(parsed.date, 'date'),
        category: parsed.category,
        items: {
          lineItems: parsed.items,
          gst: gstInfo,
          storageKey: storedReceipt?.key || null,
          receiptImageUrl: storedReceipt?.url || null,
          confidence: ocrConfidence,
        },
        rawText: extractedText.slice(0, 1000),
        status: 'PENDING_CONFIRMATION',
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        scanId: scan.id,
        merchant: parsed.merchant,
        amount: parsed.amount,
        formattedAmount: formatINR(parsed.amount),
        date: parsed.date,
        category: parsed.category,
        items: parsed.items,
        gst: gstInfo,
        ocrConfidence,
        rawTextPreview: extractedText.slice(0, 200),
        receiptImageUrl: storedReceipt?.url || null,
        storageKey: storedReceipt?.key || null,
        status: 'PENDING_CONFIRMATION',
        message: `Extracted ${formatINR(parsed.amount)} ${parsed.category} expense from ${parsed.merchant}. Please confirm to save to your transactions.`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/receipts/confirm
 * Atomically commits confirmed receipt to financial transactions table
 */
const confirmReceipt = async (req, res, next) => {
  // `userId`/`scanId` are declared outside the try so the catch block below can
  // recover the winner's scan when this request loses the confirmation race.
  const userId = req.user.id;
  const { scanId, accountId, amount, merchant, category, date, notes } = req.body;
  try {
    const txAmount = parseFloat(amount);
    if (!amount || isNaN(txAmount) || txAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Valid positive amount is required.' },
      });
    }

    // Idempotency: confirming a receipt must be replay-safe. Mobile clients
    // double-tap and retry on flaky networks, and each replay previously created
    // a *second* expense and decremented the balance again. If the scan is
    // already CONFIRMED we return the original transaction untouched.
    if (scanId) {
      const existingScan = await prisma.receiptScan.findFirst({ where: { id: scanId, userId } });
      if (!existingScan) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Receipt scan not found.' },
        });
      }
      if (existingScan.status === 'CONFIRMED') {
        const existingTx = existingScan.transactionId
          ? await prisma.transaction.findFirst({ where: { id: existingScan.transactionId, userId } })
          : null;
        return res.status(200).json({
          success: true,
          data: {
            transaction: existingTx,
            alreadyConfirmed: true,
            message: 'This receipt was already confirmed.',
          },
        });
      }
    }

    let account = await prisma.financialAccount.findFirst({
      where: {
        userId,
        ...(accountId ? { id: accountId } : { isActive: true }),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!account) {
      account = await prisma.financialAccount.create({
        data: { userId, name: 'Primary Account', balance: 0, currency: 'INR' },
      });
    }

    let categoryRecord = await prisma.category.findFirst({
      where: { userId, name: { equals: category || 'Food & Dining', mode: 'insensitive' } },
    });
    if (!categoryRecord) {
      categoryRecord = await prisma.category.create({
        data: { userId, name: category || 'Food & Dining', categoryType: 'EXPENSE' },
      });
    }

    const txDate = date ? parseDateOnly(date, 'date') : parseDateOnly(todayDateOnly());

    const transaction = await prisma.$transaction(async (tx) => {
      // Atomically claim the scan *before* writing any money movement. The
      // conditional updateMany is the concurrency guard: if two requests race,
      // exactly one sees count === 1 and proceeds; the loser is rejected and
      // surfaces `alreadyConfirmed` instead of creating a duplicate expense.
      if (scanId) {
        const claim = await tx.receiptScan.updateMany({
          where: { id: scanId, userId, status: { not: 'CONFIRMED' } },
          data: { status: 'CONFIRMED' },
        });
        if (claim.count === 0) {
          const raceError = new Error('Receipt already confirmed by a concurrent request.');
          raceError.code = 'RECEIPT_ALREADY_CONFIRMED';
          throw raceError;
        }
      }

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: categoryRecord.id,
          amount: txAmount,
          transactionType: 'EXPENSE',
          merchant: (merchant || 'Receipt Merchant').trim(),
          description: `Receipt: ${(merchant || 'Expense').trim()}`,
          notes: notes || 'Recorded via OCR Receipt Scanner confirmation',
          date: txDate,
        },
      });

      // Atomically decrement account balance
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: txAmount } },
      });

      if (scanId) {
        await tx.receiptScan.updateMany({
          where: { id: scanId, userId },
          data: { transactionId: createdTx.id },
        });
      }

      return createdTx;
    });

    return res.status(201).json({
      success: true,
      data: {
        transaction,
        message: `Successfully recorded ${formatINR(txAmount)} expense to ${account.name}.`,
      },
    });
  } catch (error) {
    // Lost the confirmation race: return the winner's transaction rather than an
    // error, so the client converges on the same single expense.
    if (error && error.code === 'RECEIPT_ALREADY_CONFIRMED') {
      const scan = await prisma.receiptScan.findFirst({ where: { id: scanId, userId } });
      const existingTx = scan && scan.transactionId
        ? await prisma.transaction.findFirst({ where: { id: scan.transactionId, userId } })
        : null;
      return res.status(200).json({
        success: true,
        data: {
          transaction: existingTx,
          alreadyConfirmed: true,
          message: 'This receipt was already confirmed.',
        },
      });
    }
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * POST /api/v1/import/bank-statement
 * Parses CSV statement with multi-attribute duplicate identity and ML categorization
 */
const parseBankStatement = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { csvContent, accountId } = req.body;

    if (!csvContent) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'CSV content required.' } });
    }

    const result = await documentIngestionService.processStatementCSV({
      userId,
      csvContent,
      accountId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error.message.includes('header and at least 1 data row') || error.message.includes('empty')) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CSV', message: error.message },
      });
    }
    next(error);
  }
};

/**
 * POST /api/v1/import/statement-pdf
 * Parses Bank Statement PDF (both text-based and scanned OCR)
 */
const parseBankStatementPDF = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { pdfData, accountId, filename } = req.body;

    if (!pdfData) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'PDF data (base64 string or buffer) is required.' },
      });
    }

    let pdfBuffer = null;
    if (typeof pdfData === 'string' && pdfData.startsWith('data:application/pdf;base64,')) {
      pdfBuffer = Buffer.from(pdfData.split(',')[1], 'base64');
    } else if (typeof pdfData === 'string') {
      pdfBuffer = Buffer.from(pdfData, 'base64');
    } else if (Buffer.isBuffer(pdfData)) {
      pdfBuffer = pdfData;
    }

    if (!pdfBuffer || pdfBuffer.length < 50) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PDF', message: 'Invalid or empty PDF document provided.' },
      });
    }

    // The ingestion service owns persistence for PDF statements (it uploads to
    // the user-scoped `documents/` prefix as part of processing). Uploading here
    // as well stored the same PDF twice and orphaned one copy, so the service's
    // key/url are reused directly instead of a second upload.
    const result = await documentIngestionService.processStatementPDF({
      userId,
      pdfBuffer,
      accountId,
      filename: filename || 'statement.pdf',
    });

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        storageKey: result.storageKey || null,
        documentUrl: result.storageUrl || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/import/confirm
 * Commits verified bank statement transactions to database with categories and balance updates
 */
const confirmBankStatementImport = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows, accountId } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No valid rows to import.' } });
    }

    // Guard against NaN/negative magnitudes before any balance is touched — a bad
    // row would otherwise poison netBalanceImpact and corrupt the account balance.
    const hasInvalidAmount = rows.some((r) => {
      const amt = parseFloat(r && r.amount);
      return !Number.isFinite(amt) || amt <= 0;
    });
    if (hasInvalidAmount) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Every row must have a positive numeric amount.' } });
    }

    let account = await prisma.financialAccount.findFirst({
      where: {
        userId,
        ...(accountId ? { id: accountId } : { isActive: true }),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!account) {
      account = await prisma.financialAccount.create({
        data: { userId, name: 'Primary Account', balance: 0, currency: 'INR' },
      });
    }

    let totalImported = 0;
    let skippedDuplicateCount = 0;
    let netBalanceImpact = 0;

    // The transactional body. It is invoked (and possibly re-invoked) by the
    // Serializable retry loop below, so it resets the per-attempt tallies first.
    const runImport = async (tx) => {
      totalImported = 0;
      skippedDuplicateCount = 0;
      netBalanceImpact = 0;

      // Re-check duplicates inside the transaction against what is already
      // committed. The preview step de-duplicates too, but a client retry (or a
      // double-tap on confirm) would otherwise re-insert every row and move the
      // balance a second time. `existing` grows as rows are created so repeated
      // rows within the same payload are skipped as well.
      const existing = await tx.transaction.findMany({
        where: { userId, accountId: account.id },
        select: { id: true, amount: true, date: true, description: true, transactionType: true },
        take: 200,
      });

      for (const row of rows) {
        const amt = parseFloat(row.amount);
        const txType = row.type === 'INCOME' ? 'INCOME' : 'EXPENSE';

        let rowDate;
        try {
          rowDate = parseDateOnly(row.date, 'date') || parseDateOnly(todayDateOnly());
        } catch {
          rowDate = parseDateOnly(todayDateOnly());
        }
        const candidateDate = formatDateOnly(rowDate);
        const candidateDescription = String(row.description || 'Imported statement transaction').trim();

        const dupCheck = documentIngestionService.isDuplicateTransaction(existing, {
          description: candidateDescription,
          date: candidateDate,
          amount: amt,
          type: txType,
        });
        if (dupCheck.isDuplicate) {
          skippedDuplicateCount++;
          continue;
        }

        let categoryId = null;
        if (row.category && row.category !== 'General' && row.category !== 'Other') {
          let categoryRecord = await tx.category.findFirst({
            where: { userId, name: { equals: row.category, mode: 'insensitive' } },
          });
          if (!categoryRecord) {
            categoryRecord = await tx.category.create({
              data: { userId, name: row.category, categoryType: txType },
            });
          }
          categoryId = categoryRecord.id;
        }

        const createdTx = await tx.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId,
            amount: amt,
            transactionType: txType,
            description: candidateDescription,
            merchant: row.merchant != null && String(row.merchant).trim() !== ''
              ? String(row.merchant).trim()
              : (row.description != null && String(row.description).trim() !== '' ? String(row.description).trim() : null),
            notes: row.remarks != null && String(row.remarks).trim() !== ''
              ? String(row.remarks).trim()
              : (row.notes != null && String(row.notes).trim() !== '' ? String(row.notes).trim() : null),
            paymentMethod: row.referenceId != null && String(row.referenceId).trim() !== ''
              ? `Ref: ${String(row.referenceId).trim()}`
              : (row.paymentMethod || null),
            date: rowDate,
          },
        });

        // Track the newly-created row so later rows in this same payload that
        // restate it are also treated as duplicates.
        existing.push({
          id: createdTx.id,
          amount: createdTx.amount,
          date: createdTx.date,
          description: createdTx.description,
          transactionType: createdTx.transactionType,
        });

        if (txType === 'INCOME') {
          netBalanceImpact += amt;
        } else {
          netBalanceImpact -= amt;
        }
        totalImported++;
      }

      // Only move the balance when something was actually imported; a fully
      // duplicate payload must not touch the account at all.
      if (totalImported > 0) {
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { balance: { increment: netBalanceImpact } },
        });
      }
    };

    // Serializable so overlapping confirmations cannot both read a stale row set.
    // On a serialization conflict the attempt is retried a bounded number of
    // times; only genuine conflicts are retried, every other error propagates.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await prisma.$transaction(runImport, { isolationLevel: 'Serializable' });
        break;
      } catch (error) {
        if (isRetryableConflict(error) && attempt < CONFIRM_IMPORT_MAX_ATTEMPTS) {
          await delay(CONFIRM_IMPORT_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw error;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        importedCount: totalImported,
        skippedDuplicateCount,
        accountName: account.name,
        netBalanceImpact,
        formattedNetImpact: formatINR(netBalanceImpact),
        message: `Successfully imported ${totalImported} transaction${totalImported === 1 ? '' : 's'} into ${account.name}${skippedDuplicateCount > 0 ? ` (${skippedDuplicateCount} duplicate${skippedDuplicateCount === 1 ? '' : 's'} skipped)` : ''}.`,
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * POST /api/v1/import/feedback
 * Records user correction to ML category predictions for active learning
 */
const recordCategoryFeedback = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { transactionId, originalPrediction, correctedCategory, confidence, text } = req.body;

    if (!correctedCategory) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Corrected category is required.' },
      });
    }

    const feedback = await mlCategorizerService.recordFeedback({
      userId,
      transactionId: transactionId || null,
      originalPrediction: originalPrediction || 'General',
      correctedCategory,
      confidence: confidence ? parseFloat(confidence) : 0.5,
      text: text || '',
    });

    return res.status(200).json({
      success: true,
      data: {
        feedback,
        message: `Active learning feedback recorded: "${originalPrediction}" -> "${correctedCategory}".`,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Receipt History (read / delete) ──────────────────────────────────────────
// Ownership is always enforced server-side: every query is scoped by
// `userId: req.user.id`. A client-supplied user id is never trusted.

const RECEIPT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reject malformed ids before they ever reach the database (a bad id would
// otherwise surface as an opaque Prisma error / 500).
const isValidReceiptId = (id) => typeof id === 'string' && RECEIPT_UUID_RE.test(id);

// Normalize the persisted `items` JSON into a predictable shape. Older rows may
// store a bare array; newer rows store an object with lineItems/gst/storageKey.
const normalizeReceiptItems = (items) => {
  const isObject = typeof items === 'object' && items !== null && !Array.isArray(items);
  const obj = isObject ? items : {};
  const lineItems = Array.isArray(items)
    ? items
    : (Array.isArray(obj.lineItems) ? obj.lineItems : []);
  const gstBreakdown = obj.gstBreakdown || obj.gst || null;
  return { obj, lineItems, gstBreakdown };
};

// Present a stored receipt to the client. Never invents values: unknown
// confidence is returned as null rather than a hardcoded default.
const formatReceiptForClient = (r) => {
  const { obj, lineItems, gstBreakdown } = normalizeReceiptItems(r.items);
  return {
    id: r.id,
    merchant: r.merchant || 'Unidentified Merchant',
    amount: r.amount !== null && r.amount !== undefined ? parseFloat(r.amount) : null,
    formattedAmount: r.amount !== null && r.amount !== undefined ? formatINR(parseFloat(r.amount)) : 'Pending',
    date: formatDateOnly(r.date),
    category: r.category || 'General',
    status: r.status,
    items: lineItems,
    gstBreakdown,
    metadata: { ...obj, gstBreakdown },
    ocrConfidence: typeof obj.confidence === 'number' ? obj.confidence : null,
    receiptImageUrl: obj.receiptImageUrl || null,
    rawText: r.rawText,
    transactionId: r.transactionId,
    createdAt: r.createdAt,
  };
};

/**
 * GET /api/v1/receipts
 * Returns all receipt scans belonging to the authenticated user (newest first).
 */
const getReceipts = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const receipts = await prisma.receiptScan.findMany({
      where: { userId },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const formatted = receipts.map(formatReceiptForClient);

    return res.status(200).json({
      success: true,
      data: {
        receipts: formatted,
        count: formatted.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/receipts/:id
 * Returns a single receipt scan owned by the authenticated user.
 */
const getReceiptById = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!isValidReceiptId(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid receipt id.' },
      });
    }

    const receipt = await prisma.receiptScan.findFirst({
      where: { id, userId },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Receipt scan not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: formatReceiptForClient(receipt),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/receipts/:id
 * Deletes a receipt scan owned by the authenticated user, and best-effort
 * removes its stored image. Only owner-scoped storage keys are ever touched.
 */
const deleteReceipt = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!isValidReceiptId(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid receipt id.' },
      });
    }

    const receipt = await prisma.receiptScan.findFirst({
      where: { id, userId },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Receipt scan not found.' },
      });
    }

    // Best-effort image cleanup. The key MUST live under this user's own
    // `users/<userId>/` namespace — a tampered or legacy key (e.g. another
    // user's folder, or an `exports/` path) is never deleted.
    const { obj } = normalizeReceiptItems(receipt.items);
    const storageKey = typeof obj.storageKey === 'string' ? obj.storageKey : null;
    const ownsKey = storageKey && !storageKey.includes('..') && storageKey.startsWith(`users/${userId}/`);
    if (ownsKey) {
      await storageService.delete(storageKey).catch(() => {});
    }

    await prisma.receiptScan.delete({ where: { id } });

    // Audit log (non-blocking, mirrors transaction deletion accounting).
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'RECEIPT_DELETE',
        entity: 'ReceiptScan',
        entityId: id,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: { message: 'Receipt scan deleted successfully.' },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  scanReceipt,
  confirmReceipt,
  getReceipts,
  getReceiptById,
  deleteReceipt,
  parseBankStatement,
  parseBankStatementPDF,
  confirmBankStatementImport,
  recordCategoryFeedback,
};
