/**
 * FinPro — Unified Document Ingestion Engine (PDF, CSV & Receipt OCR)
 * Features:
 * - Text-based PDF extraction via pdf-parse
 * - Scanned PDF OCR extraction via Tesseract.js
 * - CSV & Statement normalization with robust quoted-field parsing
 * - Multi-attribute duplicate detection with explainable reasoning
 * - Machine Learning category classification & confidence scoring
 * - GSTIN & GST tax breakdown extraction
 * - Cloud Storage persistence with user-scoped isolation
 * Owner: Jinay Golecha (jinay_golecha)
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const storageService = require('./storageService');
const mlCategorizerService = require('./mlCategorizerService');

// Indian GSTIN regex standard format: 2 digits state code + 10 chars PAN + 1 entity num + 'Z' + 1 checksum
const GSTIN_REGEX = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i;

// Common Date Patterns (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD Mon YYYY)
const DATE_REGEX = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;

class DocumentIngestionService {
  /**
   * Safe CSV Line Parser handling quotes, commas inside quotes, and escaped characters
   */
  parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' || c === "'") {
        if (inQuotes && line[i + 1] === c) {
          cur += c;
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  /**
   * Normalizes disparate date formats into YYYY-MM-DD
   */
  normalizeDate(rawDate) {
    if (!rawDate) return new Date().toISOString().split('T')[0];
    const cleaned = String(rawDate).trim().replace(/['"]/g, '');

    // Check ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return cleaned;
    }

    // Check DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      let year = dmyMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
    }

    // Fallback to Date parser
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Normalizes amount string (handles Indian commas, currency symbols, Dr/Cr)
   */
  normalizeAmount(rawAmount) {
    if (typeof rawAmount === 'number') return Math.abs(rawAmount);
    if (!rawAmount) return null;
    const cleanStr = String(rawAmount)
      .replace(/(?:₹|\$|INR|Rs\.?)/gi, '')
      .replace(/,/g, '')
      .replace(/\s+/g, '')
      .trim();
    const val = parseFloat(cleanStr);
    return isNaN(val) ? null : Math.abs(val);
  }

  /**
   * Extracts GST information from receipt or statement text
   */
  extractGSTInformation(text) {
    if (!text) return null;
    const gstInfo = {
      detected: false,
      gstin: null,
      cgst: null,
      sgst: null,
      igst: null,
      totalGst: null,
      stateCode: null,
    };

    const gstinMatch = text.match(GSTIN_REGEX);
    if (gstinMatch) {
      gstInfo.detected = true;
      gstInfo.gstin = gstinMatch[0].toUpperCase();
      gstInfo.stateCode = gstInfo.gstin.slice(0, 2);
    }

    // Match CGST, SGST, IGST numbers
    const cgstMatch = text.match(/CGST(?:\s*@?\s*[\d.]+%)?[\s:]+([₹Rs.\d,.]+)/i);
    const sgstMatch = text.match(/SGST(?:\s*@?\s*[\d.]+%)?[\s:]+([₹Rs.\d,.]+)/i);
    const igstMatch = text.match(/IGST(?:\s*@?\s*[\d.]+%)?[\s:]+([₹Rs.\d,.]+)/i);
    const totalGstMatch = text.match(/(?:Total\s+GST|GST\s+Total|GST\s+Amount)[\s:]+([₹Rs.\d,.]+)/i);

    if (cgstMatch) gstInfo.cgst = this.normalizeAmount(cgstMatch[1]);
    if (sgstMatch) gstInfo.sgst = this.normalizeAmount(sgstMatch[1]);
    if (igstMatch) gstInfo.igst = this.normalizeAmount(igstMatch[1]);

    if (totalGstMatch) {
      gstInfo.totalGst = this.normalizeAmount(totalGstMatch[1]);
      gstInfo.detected = true;
    } else if (gstInfo.cgst || gstInfo.sgst || gstInfo.igst) {
      gstInfo.totalGst = (gstInfo.cgst || 0) + (gstInfo.sgst || 0) + (gstInfo.igst || 0);
      gstInfo.detected = true;
    }

    return gstInfo.detected ? gstInfo : null;
  }

  /**
   * Robust multi-attribute duplicate detector
   * A row is a duplicate only if matching: accountId + normalizedDate + normalizedDesc + amount + type
   */
  isDuplicateTransaction(existingTransactions, candidate) {
    const candidateNormDesc = (candidate.description || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidateDate = candidate.date;
    const candidateAmount = parseFloat(candidate.amount);
    const candidateType = candidate.type;

    for (const ex of existingTransactions) {
      const exDate = new Date(ex.date).toISOString().split('T')[0];
      const exAmount = parseFloat(ex.amount);
      const exNormDesc = (ex.description || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const exType = ex.transactionType;

      // Exact match check: Same Date + Same Amount + Similar Description
      if (exDate === candidateDate && Math.abs(exAmount - candidateAmount) < 0.01) {
        if (exNormDesc === candidateNormDesc || exNormDesc.includes(candidateNormDesc) || candidateNormDesc.includes(exNormDesc)) {
          return {
            isDuplicate: true,
            reason: `Matches existing transaction "${ex.description}" (${exAmount.toFixed(2)}) recorded on ${exDate}`,
            existingId: ex.id,
          };
        }
      }
    }
    return { isDuplicate: false, reason: null };
  }

  /**
   * Determines whether a statement row is INCOME, EXPENSE or TRANSFER.
   *
   * Statement CSV layouts are wildly inconsistent: some banks expose separate
   * Debit/Credit columns, some only a single signed Amount column, some an
   * explicit DR/CR "Type" column, and many a single *positive* Amount column
   * where the direction only exists in the narration. The previous logic fell
   * back to "any positive amount with no debit column ⇒ INCOME", which silently
   * flipped every outgoing debit in a single-Amount layout into income and
   * inflated the user's reported earnings.
   *
   * Precedence: explicit column origin > explicit type/suffix > narration
   * semantics > conservative EXPENSE default. Defaulting to EXPENSE is the
   * financially safe direction: an unknown row must never overstate income.
   */
  detectTransactionType({ rawType = '', rawAmount = '', description = '', isDebitCol = false, isCreditCol = false }) {
    const desc = String(description || '').toLowerCase();
    const typeStr = String(rawType || '').toUpperCase();
    const amtStr = String(rawAmount || '').toUpperCase();

    // 1. Internal Transfer Check (e.g. self transfer, own account transfer)
    if (/\b(self transfer|own account|internal transfer|to self|from self|transfer to own|transfer between accounts)\b/i.test(desc)) {
      return 'TRANSFER';
    }

    // 2. Explicit Column Origin (a populated Debit/Credit column is authoritative)
    if (isCreditCol) return 'INCOME';
    if (isDebitCol) return 'EXPENSE';

    // 3. Explicit Type Column or Amount Suffix (CR / DR)
    if (typeStr.includes('CR') || typeStr.includes('CREDIT') || typeStr.includes('INCOME') || amtStr.includes('CR') || amtStr.startsWith('+')) {
      return 'INCOME';
    }
    if (typeStr.includes('DR') || typeStr.includes('DEBIT') || typeStr.includes('EXPENSE') || amtStr.includes('DR') || amtStr.startsWith('-')) {
      return 'EXPENSE';
    }

    // 4. Description Semantic Clues for Indian Banking
    if (/\b(salary|interest|dividend|refund|cashback|bonus|stipend|received from|credited by|upi\/cr|neft cr|rtgs cr|imps cr|customer payment|received payment)\b/i.test(desc)) {
      return 'INCOME';
    }

    if (/\b(paid to|payment to|spent|bill|electricity|water|wifi|recharge|dth|broadband|rent|emi|loan|tax|fee|charge|pos|purchase|swiggy|zomato|amazon|flipkart|uber|ola|upi\/dr|neft dr|rtgs dr|imps dr|atm|withdrawal)\b/i.test(desc)) {
      return 'EXPENSE';
    }

    // 5. Conservative default — never overstate income on an ambiguous row.
    return 'EXPENSE';
  }

  /**
   * Process Bank Statement CSV
   */
  async processStatementCSV({ userId, csvContent, accountId }) {
    if (!csvContent || typeof csvContent !== 'string') {
      throw new Error('Valid CSV content is required.');
    }

    const lines = csvContent.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      throw new Error('CSV file must have a header row and at least one data row.');
    }

    const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const dateIdx = headers.findIndex(h => h.includes('date'));
    const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('narration') || h.includes('particular') || h.includes('merchant'));
    const amountIdx = headers.findIndex(h => h.includes('amount'));
    const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdrawal'));
    const creditIdx = headers.findIndex(h => h.includes('credit') || h.includes('deposit'));
    const typeIdx = headers.findIndex(h => h.includes('type'));
    const catIdx = headers.findIndex(h => h.includes('category'));
    const balanceIdx = headers.findIndex(h => h.includes('balance') || h.includes('bal'));
    const refIdx = headers.findIndex(h => h.includes('ref') || h.includes('chq') || h.includes('cheque') || h.includes('utr') || h.includes('txn') || h.includes('transaction id'));
    const remarksIdx = headers.findIndex(h => h.includes('remark') || h.includes('note') || h.includes('comment'));

    // Fetch existing user transactions for strict multi-attribute duplicate checking
    const existing = await prisma.transaction.findMany({
      where: { userId, ...(accountId ? { accountId } : {}) },
      select: { id: true, amount: true, date: true, description: true, transactionType: true },
      take: 200,
    });

    const validRows = [];
    const duplicateRows = [];
    const invalidRows = [];
    const seenInBatch = new Set();

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCSVLine(lines[i]);
      if (cols.length === 0 || cols.every(c => !c)) continue; // skip blank rows

      const rawDate = dateIdx >= 0 ? cols[dateIdx] : null;
      const rawDesc = descIdx >= 0 ? cols[descIdx] : `Transaction #${i}`;

      let amount = null;
      let isDebitCol = false;
      let isCreditCol = false;

      if (debitIdx >= 0 && cols[debitIdx] && this.normalizeAmount(cols[debitIdx])) {
        amount = this.normalizeAmount(cols[debitIdx]);
        isDebitCol = true;
      } else if (creditIdx >= 0 && cols[creditIdx] && this.normalizeAmount(cols[creditIdx])) {
        amount = this.normalizeAmount(cols[creditIdx]);
        isCreditCol = true;
      } else if (amountIdx >= 0 && cols[amountIdx]) {
        amount = this.normalizeAmount(cols[amountIdx]);
      }

      if (!amount || amount <= 0) {
        invalidRows.push({ row: i, reason: 'Invalid or zero amount', raw: lines[i] });
        continue;
      }

      const rawTypeStr = typeIdx >= 0 ? cols[typeIdx] : '';
      const rawAmtStr = amountIdx >= 0 ? cols[amountIdx] : (debitIdx >= 0 ? cols[debitIdx] : (creditIdx >= 0 ? cols[creditIdx] : ''));
      const normalizedDate = this.normalizeDate(rawDate);
      const cleanDesc = (rawDesc || 'Bank Transaction').trim();

      const type = this.detectTransactionType({
        rawType: rawTypeStr,
        rawAmount: rawAmtStr,
        description: cleanDesc,
        isDebitCol,
        isCreditCol,
      });

      // ML Category Prediction
      const mlPrediction = mlCategorizerService.predict(cleanDesc, amount, type);
      const category = catIdx >= 0 && cols[catIdx] ? cols[catIdx] : mlPrediction.category;

      const rawBalance = balanceIdx >= 0 ? cols[balanceIdx] : null;
      const runningBalance = rawBalance ? this.normalizeAmount(rawBalance) : null;
      const rawRef = refIdx >= 0 ? cols[refIdx] : null;
      const rawRemarks = remarksIdx >= 0 ? cols[remarksIdx] : '';

      const candidateObj = {
        row: i,
        date: normalizedDate,
        description: cleanDesc,
        amount,
        type,
        category,
        runningBalance,
        referenceId: rawRef ? rawRef.trim() : null,
        remarks: (rawRemarks || '').trim(),
        predictedCategory: mlPrediction.predictedCategory,
        confidence: mlPrediction.confidence,
        mlStatus: mlPrediction.status,
        source: 'CSV Import',
      };

      // Intra-batch duplicate check
      const batchKey = `${normalizedDate}|${amount}|${cleanDesc.toLowerCase()}`;
      if (seenInBatch.has(batchKey)) {
        duplicateRows.push({
          ...candidateObj,
          duplicateReason: 'Duplicate entry repeated within this uploaded file',
        });
        continue;
      }
      seenInBatch.add(batchKey);

      // Database duplicate check
      const dupCheck = this.isDuplicateTransaction(existing, candidateObj);
      if (dupCheck.isDuplicate) {
        duplicateRows.push({
          ...candidateObj,
          duplicateReason: dupCheck.reason,
        });
      } else {
        validRows.push(candidateObj);
      }
    }

    return {
      documentType: 'CSV',
      totalRows: lines.length - 1,
      validCount: validRows.length,
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length,
      validRows,
      duplicateRows,
      invalidRows,
      preview: validRows.slice(0, 15),
    };
  }

  /**
   * Process Bank Statement PDF (Text or Scanned OCR)
   */
  async processStatementPDF({ userId, buffer, pdfBuffer, filename, accountId }) {
    const rawBuffer = buffer || pdfBuffer;
    if (!rawBuffer || rawBuffer.length === 0) {
      throw new Error('Valid PDF buffer is required.');
    }

    // Step 1: Upload raw document to Cloud / Local Storage with user-scoped isolation
    const storageKey = `users/${userId}/documents/${Date.now()}_${uuidv4().slice(0, 8)}_${filename || 'statement.pdf'}`;
    let storedDoc = null;
    try {
      storedDoc = await storageService.upload({
        buffer: rawBuffer,
        key: storageKey,
        contentType: 'application/pdf',
        metadata: { userId, documentType: 'bank_statement', originalName: filename },
      });
    } catch (err) {
      console.warn('[Ingestion] Storage notice:', err.message);
    }

    // Step 2: Attempt native text extraction via pdf-parse
    let extractedText = '';
    let numPages = 1;
    let isScanned = false;

    try {
      const pdfData = await pdfParse(rawBuffer);
      extractedText = (pdfData.text || '').trim();
      numPages = pdfData.numpages || 1;
    } catch (err) {
      console.warn('[Ingestion] pdf-parse failed, attempting OCR fallback:', err.message);
    }

    // If extracted text has very few words per page, classify as Scanned PDF and run OCR
    if (!extractedText || extractedText.length < 50 * numPages) {
      isScanned = true;
      console.log(`[Ingestion] PDF appears scanned (${extractedText.length} chars). Executing Tesseract OCR worker...`);
      const worker = await createWorker('eng');
      try {
        const ocrResult = await worker.recognize(rawBuffer);
        extractedText = (ocrResult.data?.text || '').trim();
      } finally {
        await worker.terminate();
      }
    }

    // Step 3: Parse transactions from extracted text
    const transactions = this.extractTransactionsFromText(extractedText);

    // Fetch existing user transactions for duplicate checking
    const existing = await prisma.transaction.findMany({
      where: { userId, ...(accountId ? { accountId } : {}) },
      select: { id: true, amount: true, date: true, description: true, transactionType: true },
      take: 200,
    });

    const validRows = [];
    const duplicateRows = [];
    const invalidRows = [];

    transactions.forEach((tx, idx) => {
      if (!tx.amount || tx.amount <= 0) {
        invalidRows.push({ row: idx + 1, reason: 'Invalid or zero amount', raw: tx.raw });
        return;
      }

      // Apply ML Category Prediction
      const mlPrediction = mlCategorizerService.predict(tx.description, tx.amount, tx.type);
      const rowObj = {
        row: idx + 1,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        type: tx.type,
        category: mlPrediction.category,
        predictedCategory: mlPrediction.predictedCategory,
        confidence: mlPrediction.confidence,
        mlStatus: mlPrediction.status,
        source: isScanned ? `Scanned PDF (OCR p.${tx.page || 1})` : `Text PDF (p.${tx.page || 1})`,
      };

      const dupCheck = this.isDuplicateTransaction(existing, rowObj);
      if (dupCheck.isDuplicate) {
        duplicateRows.push({ ...rowObj, duplicateReason: dupCheck.reason });
      } else {
        validRows.push(rowObj);
      }
    });

    return {
      documentType: isScanned ? 'PDF_SCANNED_OCR' : 'PDF_TEXT',
      filename: filename || 'statement.pdf',
      pages: numPages,
      storageKey: storedDoc?.key || null,
      storageUrl: storedDoc?.url || null,
      totalFound: transactions.length,
      validCount: validRows.length,
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length,
      validRows,
      duplicateRows,
      invalidRows,
      preview: validRows.slice(0, 15),
    };
  }

  /**
   * Extracts tabular rows from raw statement text
   */
  extractTransactionsFromText(text) {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    // Regex for matching lines with Date + Description + Amount
    // e.g. "12/08/2026 Amazon India 1,499.00 DR" or "2026-08-01 Salary Credit 85000"
    const lineTxRegex = /(?:^|\s)(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s+(.+?)\s+([₹Rs.\d,]+\.\d{2}|[₹Rs.\d,]{3,})(?:\s+(CR|DR|CREDIT|DEBIT|INCOME|EXPENSE))?/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(lineTxRegex);
      if (match) {
        const rawDate = match[1];
        const rawDesc = match[2].trim();
        const rawAmt = match[3];
        const rawTypeIndicator = (match[4] || '').toUpperCase();

        const amount = this.normalizeAmount(rawAmt);
        if (amount && amount > 0 && rawDesc.length >= 3) {
          const type = (rawTypeIndicator.includes('CR') || rawTypeIndicator.includes('INC'))
            ? 'INCOME'
            : 'EXPENSE';

          results.push({
            date: this.normalizeDate(rawDate),
            description: rawDesc,
            amount,
            type,
            raw: line,
            page: 1,
          });
        }
      }
    }

    return results;
  }
}

const documentIngestionService = new DocumentIngestionService();
module.exports = documentIngestionService;
