const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');
const storageService = require('../services/storageService');
const documentIngestionService = require('../services/documentIngestionService');
const receiptOcrService = require('../services/receiptOcrService');
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

/**
 * POST /api/v1/receipts/scan
 *
 * Real OCR extraction for one receipt image (or pasted receipt text). The heavy
 * lifting — decoding, preprocessing, deskew, multi-pass Tesseract, optional
 * vision fallback and field extraction — lives in `receiptOcrService`.
 *
 * Contract: nothing is invented. A field that cannot be read is returned as
 * `null`, a missing date is never replaced with today's date, and a scan is
 * persisted even when the amount is missing so the user can complete it
 * manually and still confirm through the normal transaction flow.
 */
const MAX_RECEIPT_IMAGES = 5;

const receiptStorageExtension = (mimeType) => {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
};

/**
 * Duplicate detection. Two independent signals, both advisory only:
 *   • the same image bytes were scanned before (SHA-256 of the processed image)
 *   • an expense with the same amount already exists on the same date
 * The user may genuinely have two identical receipts, so this never blocks the
 * confirmation — it just lets the client warn before saving twice.
 */
const findReceiptDuplicates = async ({ userId, imageHash, amount, merchant, dateIso }) => {
  const duplicates = { image: null, transaction: null };

  if (imageHash) {
    const recentScans = await prisma.receiptScan.findMany({
      where: { userId, status: { not: 'REJECTED' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, merchant: true, amount: true, date: true, status: true, createdAt: true, items: true },
    });
    const match = recentScans.find(
      (scan) => scan.items && typeof scan.items === 'object' && scan.items.imageHash === imageHash
    );
    if (match) {
      duplicates.image = {
        scanId: match.id,
        merchant: match.merchant,
        amount: match.amount === null || match.amount === undefined ? null : Number(match.amount),
        date: formatDateOnly(match.date),
        status: match.status,
        scannedAt: match.createdAt,
      };
    }
  }

  if (Number.isFinite(amount) && amount > 0 && dateIso) {
    let parsedDate = null;
    try {
      parsedDate = parseDateOnly(dateIso, 'date');
    } catch (error) {
      parsedDate = null;
    }
    if (parsedDate) {
      const match = await prisma.transaction.findFirst({
        where: { userId, transactionType: 'EXPENSE', amount, date: parsedDate },
        orderBy: { createdAt: 'desc' },
        select: { id: true, merchant: true, amount: true, date: true, description: true },
      });
      if (match) {
        duplicates.transaction = {
          id: match.id,
          merchant: match.merchant || match.description || null,
          amount: Number(match.amount),
          date: formatDateOnly(match.date),
        };
      }
    }
  }

  return duplicates;
};

const buildScanResponse = ({ scan, parsed, gst, storedReceipt, duplicates, ocrMeta }) => {
  const amount = parsed.amount === null || parsed.amount === undefined ? null : Number(parsed.amount);
  const manual = !(Number.isFinite(amount) && amount > 0);

  return {
    scanId: scan.id,
    merchant: parsed.merchant || null,
    amount,
    formattedAmount: manual ? null : formatINR(amount),
    date: parsed.date || null,
    dateConfidence: parsed.confidence?.date ?? 0,
    category: parsed.category || 'General',
    paymentMethod: parsed.paymentMethod || null,
    receiptNumber: parsed.receiptNumber || null,
    items: Array.isArray(parsed.items) ? parsed.items : [],
    gst: gst || null,
    confidence: parsed.confidence || { merchant: 0, amount: 0, date: 0, category: 0, overall: 0 },
    sources: parsed.sources || {},
    amountLabel: parsed.amountLabel || null,
    ocrConfidence: ocrMeta?.ocrConfidence ?? null,
    ocrVariants: ocrMeta?.ocrVariants || null,
    skewAngle: ocrMeta?.skewAngle ?? null,
    imageHash: parsed.imageHash || null,
    rawTextPreview: ocrMeta?.rawText ? ocrMeta.rawText.slice(0, 500) : null,
    receiptImageUrl: storedReceipt?.url || null,
    storageKey: storedReceipt?.key || null,
    duplicates: duplicates || { image: null, transaction: null },
    status: manual ? 'MANUAL_INPUT_REQUIRED' : 'PENDING_CONFIRMATION',
    message: manual
      ? 'The total amount could not be read from this receipt. Please enter the amount (and the date, if missing) before confirming.'
      : `Extracted ${formatINR(amount)} ${parsed.category || 'General'} expense from ${parsed.merchant || 'this receipt'}. Please confirm to save it.`,
  };
};

/**
 * Scan exactly one image payload: OCR → parse → store image → persist scan.
 * Throws on unreadable input so the caller can decide between a 422 (single
 * scan) and a per-item error (batch scan).
 */
const scanOneImage = async ({ userId, imagePayload }) => {
  const decoded = receiptOcrService.decodeImagePayload(imagePayload);
  if (decoded.error) {
    const error = new Error(decoded.message);
    error.code = decoded.error;
    error.statusCode = decoded.error === 'IMAGE_TOO_LARGE' ? 413 : 400;
    throw error;
  }

  const { buffer, mimeType } = decoded;
  const extracted = await receiptOcrService.extractReceipt(buffer);

  let stored = null;
  try {
    const storageKey = `users/${userId}/receipts/receipt_${Date.now()}_${uuidv4().slice(0, 8)}${receiptStorageExtension(mimeType)}`;
    stored = await storageService.upload({
      buffer,
      key: storageKey,
      contentType: mimeType,
      metadata: { userId, documentType: 'receipts', scanDate: new Date().toISOString() },
    });
  } catch (storageErr) {
    // Losing the archive copy must not lose the extraction result.
    console.warn('[Storage] Receipt image storage notice:', storageErr.message);
  }

  const gst = documentIngestionService.extractGSTInformation(extracted.ocrText || '');
  const duplicates = await findReceiptDuplicates({
    userId,
    imageHash: extracted.imageHash,
    amount: extracted.amount,
    merchant: extracted.merchant,
    dateIso: extracted.date,
  });

  const scan = await prisma.receiptScan.create({
    data: {
      userId,
      merchant: extracted.merchant || null,
      amount: extracted.amount,
      date: extracted.date ? parseDateOnly(extracted.date, 'date') : null,
      category: extracted.category || 'General',
      items: {
        lineItems: extracted.items || [],
        gst,
        storageKey: stored?.key || null,
        receiptImageUrl: stored?.url || null,
        imageHash: extracted.imageHash || null,
        paymentMethod: extracted.paymentMethod || null,
        receiptNumber: extracted.receiptNumber || null,
        confidence: extracted.confidence || null,
        sources: extracted.sources || null,
        ocrConfidence: extracted.ocrConfidence ?? null,
        ocrVariants: extracted.ocrVariants || null,
        skewAngle: extracted.skewAngle ?? null,
        amountLabel: extracted.amountLabel || null,
      },
      rawText: (extracted.ocrText || '').slice(0, 1000),
      status: Number.isFinite(Number(extracted.amount)) && Number(extracted.amount) > 0
        ? 'PENDING_CONFIRMATION'
        : 'MANUAL_INPUT_REQUIRED',
    },
  });

  return buildScanResponse({
    scan,
    parsed: extracted,
    gst,
    storedReceipt: stored,
    duplicates,
    ocrMeta: {
      ocrConfidence: extracted.ocrConfidence,
      ocrVariants: extracted.ocrVariants,
      skewAngle: extracted.skewAngle,
      rawText: extracted.ocrText,
    },
  });
};

const scanReceipt = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { receiptText, imageData, images } = req.body || {};

    // Pasted text is a first-class input: it skips OCR but goes through the
    // exact same parser and persistence path, so confidence/duplicate rules and
    // the "never invent a date" rule stay identical.
    if (!receiptText && !imageData && !(Array.isArray(images) && images.length)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one receipt image or the receipt text is required.',
        },
      });
    }

    if (Array.isArray(images) && images.length > MAX_RECEIPT_IMAGES) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_IMAGES',
          message: `A maximum of ${MAX_RECEIPT_IMAGES} receipts can be scanned in one request.`,
        },
      });
    }

    const textOnly = !imageData && !(Array.isArray(images) && images.length);
    if (textOnly) {
      const text = String(receiptText || '').trim();
      if (text.length < 10) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'The pasted receipt text is too short to parse.' },
        });
      }

      const parsed = receiptOcrService.parseReceiptText(text);
      const gst = documentIngestionService.extractGSTInformation(text);
      const duplicates = await findReceiptDuplicates({
        userId,
        imageHash: null,
        amount: parsed.amount,
        merchant: parsed.merchant,
        dateIso: parsed.date,
      });

      const scan = await prisma.receiptScan.create({
        data: {
          userId,
          merchant: parsed.merchant || null,
          amount: parsed.amount,
          date: parsed.date ? parseDateOnly(parsed.date, 'date') : null,
          category: parsed.category || 'General',
          items: {
            lineItems: parsed.items || [],
            gst,
            confidence: parsed.confidence || null,
            sources: parsed.sources || null,
            amountLabel: parsed.amountLabel || null,
          },
          rawText: text.slice(0, 1000),
          status: Number.isFinite(Number(parsed.amount)) && Number(parsed.amount) > 0
            ? 'PENDING_CONFIRMATION'
            : 'MANUAL_INPUT_REQUIRED',
        },
      });

      return res.status(200).json({
        success: true,
        data: buildScanResponse({
          scan,
          parsed,
          gst,
          storedReceipt: null,
          duplicates,
          ocrMeta: { ocrConfidence: null, ocrVariants: null, skewAngle: null, rawText: text },
        }),
      });
    }

    const payloads = Array.isArray(images) && images.length ? images : [imageData];
    const results = [];

    for (const payload of payloads) {
      try {
        results.push({ success: true, data: await scanOneImage({ userId, imagePayload: payload }) });
      } catch (error) {
        if (payloads.length === 1) throw error;
        results.push({
          success: false,
          error: { code: error.code || 'OCR_FAILED', message: error.message },
        });
      }
    }

    if (payloads.length === 1) {
      const only = results[0];
      if (!only.success) {
        const status = only.error.code === 'IMAGE_TOO_LARGE' ? 413 : only.error.code === 'OCR_UNREADABLE' ? 422 : 400;
        return res.status(status).json({ success: false, error: only.error });
      }
      return res.status(200).json({ success: true, data: only.data });
    }

    return res.status(200).json({
      success: true,
      data: {
        multiple: true,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
        results,
      },
    });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: error.code || 'INVALID_IMAGE', message: error.message },
      });
    }
    if (error && error.code === 'OCR_UNREADABLE') {
      return res.status(422).json({
        success: false,
        error: {
          code: 'OCR_UNREADABLE',
          message:
            error.message ||
            'Could not extract readable text from the uploaded image. Please ensure the receipt is well-lit and legible, or enter details manually.',
        },
      });
    }
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
    let existingScan = null;
    if (scanId) {
      existingScan = await prisma.receiptScan.findFirst({ where: { id: scanId, userId } });
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

    // The transaction date must be a real, user-visible date. The client sends
    // the date it extracted/edited; if it did not, the stored scan date is used;
    // if neither exists we ask instead of silently booking today — a receipt
    // without a readable date historically landed on the wrong day.
    let txDate = null;
    if (date) {
      txDate = parseDateOnly(date, 'date');
    } else if (existingScan && existingScan.date) {
      txDate = parseDateOnly(existingScan.date, 'date');
    }
    if (!txDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RECEIPT_DATE_REQUIRED',
          message: 'The receipt date could not be read. Please choose the transaction date before confirming.',
        },
      });
    }

    const resolvedMerchant = String(merchant || existingScan?.merchant || '').trim();
    const resolvedCategory = String(category || existingScan?.category || 'Food & Dining').trim();

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
      where: { userId, name: { equals: resolvedCategory, mode: 'insensitive' } },
    });
    if (!categoryRecord) {
      categoryRecord = await prisma.category.create({
        data: { userId, name: resolvedCategory, categoryType: 'EXPENSE' },
      });
    }

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
          merchant: resolvedMerchant || 'Receipt Merchant',
          description: `Receipt: ${resolvedMerchant || 'Expense'}`,
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
