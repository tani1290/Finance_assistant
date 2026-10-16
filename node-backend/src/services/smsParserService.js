const crypto = require('crypto');
const prisma = require('../config/database');
const mlCategorizerService = require('./mlCategorizerService');

/**
 * Dedicated Indian Bank SMS Parsing and Transaction Extraction Engine
 * Conforms to Master Engineering Directive Sections 4, 5, 6, and 9.
 */

// OTP & Non-transaction patterns to strictly filter out
const OTP_REGEX = /\b(otp|one[\s-]?time[\s-]?password|verification[\s-]?code|secret[\s-]?code|auth[\s-]?code|security[\s-]?code|is\s+your\s+\d{4,8})\b/i;
const PROMO_REGEX = /\b(apply\s+now|get\s+instant\s+loan|pre[\s-]?approved|click\s+here|congratulations|won|special\s+offer|discount\s+coupon|avail\s+now)\b/i;
const REQUEST_REGEX = /\b(has\s+requested|requested\s+(?:rs\.?|inr)|request\s+money|collect\s+request|pay\s+request)\b/i;
const BALANCE_ONLY_REGEX = /\b(?:avail(?:able)?\s+bal(?:ance)?|clear\s+balance|ledger\s+balance)\b/i;
const FAILED_REGEX = /\b(declined|failed|unsuccessful|failure|could\s+not\s+be\s+processed|transaction\s+declined)\b/i;

// Transaction keywords
const DEBIT_KEYWORDS = [
  'debited', 'spent', 'paid', 'withdrawn', 'purchase', 'deducted',
  'sent', 'transferred to', 'payment of', 'txn of', 'debited from', 'used at'
];

const CREDIT_KEYWORDS = [
  'credited', 'deposited', 'received', 'refund', 'refunded',
  'added to', 'salary', 'cashback', 'credited to'
];

// Well-known Indian merchants and categories
const DETERMINISTIC_MERCHANTS = [
  { pattern: /swiggy|zomato|mcdonald|subway|domino|starbucks|burger\s*king|kfc|pizza\s*hut|eatclub|chai\s*point/i, category: 'Food & Dining', name: 'Food & Dining' },
  { pattern: /blinkit|zepto|instamart|bigbasket|dmart|avenue\s*supermarts|nature'?s\s*basket|reliance\s*fresh|reliance\s*smart|more\s*retail/i, category: 'Groceries', name: 'Groceries' },
  { pattern: /uber|ola|rapido|namma\s*yatri|shell|bharat\s*petroleum|bpc|indian\s*oil|ioc|hp\s*petrol|hpcl|fuel|metro\s*rail|irctc|redbus/i, category: 'Transport', name: 'Transport' },
  { pattern: /amazon|flipkart|myntra|ajio|meesho|tata\s*cliq|nykaa|zara|h&m|uniqlo|croma|reliance\s*digital|vijay\s*sales/i, category: 'Shopping', name: 'Shopping' },
  { pattern: /netflix|spotify|youtube|disney|hotstar|prime\s*video|apple\.com|google\s*play|audible/i, category: 'Subscriptions', name: 'Subscriptions' },
  { pattern: /apollo\s*pharmacy|medplus|pharmeasy|1mg|tata\s*1mg|netmeds|practo|max\s*healthcare|fortis/i, category: 'Healthcare', name: 'Healthcare' },
  { pattern: /bescom|tata\s*power|adani\s*electricity|mahavitaran|airtel|jio|vi\s*bill|vodafone|act\s*corp|tatasky|tata\s*play|water\s*board|gas\s*bill|indane|hp\s*gas/i, category: 'Bills & Utilities', name: 'Bills & Utilities' },
  { pattern: /salary|payroll|wage|stipend/i, category: 'Salary', name: 'Salary' },
  { pattern: /atm|cash\s*wdl|cash\s*withdrawal/i, category: 'Cash Withdrawal', name: 'Cash Withdrawal' },
  { pattern: /zerodha|groww|upstox|angel\s*one|kuvera|coin|indmoney|uti\s*mf|sbi\s*mf|hdfc\s*mf|icici\s*pru|nippon/i, category: 'Investments', name: 'Investments' },
  { pattern: /bajaj\s*finance|home\s*credit|emi|loan\s*repay|hdfc\s*bank\s*loan|sbi\s*loan/i, category: 'Loan Payment', name: 'Loan Payment' }
];

/**
 * Normalise a confidence value into the 0–1 fraction every consumer expects:
 * the `PendingSmsTransaction.confidence` column is @db.Decimal(5,4) (max
 * 9.9999), the web UI multiplies by 100, and the mobile app parses it as a
 * double. A stray percentage would overflow the column, so the whole SMS
 * ingest — and with it cross-device sync — must never depend on the caller
 * getting this right. Tolerates a percentage from any upstream engine.
 */
function clampConfidence(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const fraction = n > 1 ? n / 100 : n;
  return Math.min(0.9999, Math.max(0, fraction));
}

class SmsParserService {
  /**
   * Compute a deterministic hash of normalized SMS body
   */
  computeHash(text) {
    const normalized = (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Classify message type:
   * Returns: { type: 'TRANSACTION' | 'OTP' | 'PROMOTIONAL' | 'PAYMENT_REQUEST' | 'BALANCE_ENQUIRY' | 'FAILED', isTransaction: boolean, reason?: string }
   */
  classifyMessage(text) {
    if (!text || typeof text !== 'string') {
      return { type: 'INVALID', isTransaction: false, reason: 'Empty or invalid text' };
    }

    const lower = text.toLowerCase();

    // 1. Strict OTP check
    if (OTP_REGEX.test(lower)) {
      return { type: 'OTP', isTransaction: false, reason: 'Message contains an OTP or authentication code' };
    }

    // 2. Failed / declined transaction check
    if (FAILED_REGEX.test(lower)) {
      return { type: 'FAILED', isTransaction: false, reason: 'Transaction failed or was declined' };
    }

    // 3. Payment request (not completed transaction)
    if (REQUEST_REGEX.test(lower)) {
      return { type: 'PAYMENT_REQUEST', isTransaction: false, reason: 'Message describes a payment request, not a completed transaction' };
    }

    // 4. Promotional
    if (PROMO_REGEX.test(lower) && !/(?:debited|credited|spent|withdrawn)\s+(?:for|with|of)?\s*(?:rs|inr)/i.test(lower)) {
      return { type: 'PROMOTIONAL', isTransaction: false, reason: 'Promotional or offer message' };
    }

    // 5. Balance enquiry without transaction
    const hasDebit = DEBIT_KEYWORDS.some(k => lower.includes(k));
    const hasCredit = CREDIT_KEYWORDS.some(k => lower.includes(k));
    if (!hasDebit && !hasCredit && BALANCE_ONLY_REGEX.test(lower)) {
      return { type: 'BALANCE_ENQUIRY', isTransaction: false, reason: 'Balance enquiry without completed transaction' };
    }

    // Must have at least a debit/credit trigger or UPI spend trigger
    if (!hasDebit && !hasCredit && !/vpa|upi\s+ref|rrn\b|info:\s*pos/i.test(lower)) {
      return { type: 'IRRELEVANT', isTransaction: false, reason: 'No financial transaction keywords detected' };
    }

    return { type: 'TRANSACTION', isTransaction: true };
  }

  /**
   * Extract transaction amount accurately, distinguishing it from available balance
   */
  extractAmount(text) {
    // Exclude balance portions when searching for transaction amount
    // E.g. "Rs 450 debited... Avl Bal Rs 15,200" -> transaction amount is 450
    const parts = text.split(/(?:avl\s*bal|available\s*balance|bal\s*is|bal\s*inr|balance\s*:|total\s*bal)/i);
    const txPart = parts[0] || text;

    // Pattern 1: Rs./INR/₹ followed by amount
    const amountRegex = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
    let match;
    const candidates = [];

    while ((match = amountRegex.exec(txPart)) !== null) {
      const cleaned = match[1].replace(/,/g, '');
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > 0 && val < 50000000) { // sanity bound < 5 crore
        candidates.push(val);
      }
    }

    if (candidates.length > 0) {
      // First currency amount in the transaction part is almost universally the transaction amount
      return candidates[0];
    }

    // Pattern 2: Amount followed by "debited" or "credited" (e.g. "450.00 debited")
    const numBeforeWordRegex = /\b([\d,]+(?:\.\d{1,2})?)\s*(?:debited|credited|spent|withdrawn)/i;
    const matchBefore = txPart.match(numBeforeWordRegex);
    if (matchBefore) {
      const val = parseFloat(matchBefore[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }

    return null;
  }

  /**
   * Extract transaction direction: DEBIT vs CREDIT
   */
  extractDirection(text) {
    const lower = text.toLowerCase();
    
    // Check credit indicators first if explicitly refund/salary/received
    const isCredit = CREDIT_KEYWORDS.some(k => lower.includes(k));
    const isDebit = DEBIT_KEYWORDS.some(k => lower.includes(k));

    if (isCredit && !isDebit) return 'INCOME';
    if (isDebit && !isCredit) return 'EXPENSE';

    // Disambiguation for messages mentioning both (e.g., "refund credited for debited transaction")
    const creditPos = Math.max(...CREDIT_KEYWORDS.map(k => lower.indexOf(k)));
    const debitPos = Math.max(...DEBIT_KEYWORDS.map(k => lower.indexOf(k)));

    if (creditPos > -1 && creditPos < debitPos) return 'INCOME';
    return 'EXPENSE';
  }

  /**
   * Extract account identifier hint (last 4 digits / account ending)
   */
  extractAccountHint(text) {
    // Patterns: A/c XX1234, A/c *1234, Account ending 1234, Card ending 5678, A/c ...1234
    const patterns = [
      /(?:a\/c|acct|account|card)\s*(?:no\.?)?\s*(?:ending\s*)?(?:in\s*)?(?:xx|\*+|\.{2,})*(\d{3,6})/i,
      /(?:ending\s*(?:with|in)?\s*)(\d{3,6})/i,
      /\b(?:xx|\*+)(\d{4})\b/i
    ];

    for (const pat of patterns) {
      const match = text.match(pat);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract merchant, VPA, or counterparty description
   */
  extractMerchant(text) {
    // 1. Look for known merchant patterns
    for (const dm of DETERMINISTIC_MERCHANTS) {
      if (dm.pattern.test(text)) {
        return dm.name;
      }
    }

    // 2. Look for "at <MERCHANT>" or "to <MERCHANT>" or "towards <MERCHANT>"
    const atMatch = text.match(/(?:at|to|towards|info:\s*pos\/|info:)\s*([A-Za-z0-9\s&'.-]{2,30}?)(?=\s+(?:on|ref|avl|bal|using|via|\.|$))/i);
    if (atMatch && atMatch[1]) {
      const cleaned = atMatch[1].trim().replace(/^pos\//i, '').trim();
      if (cleaned.length >= 2 && !/^(?:a\/c|account|card|upi|rs|inr)/i.test(cleaned)) {
        return cleaned;
      }
    }

    // 3. Look for UPI VPA (e.g. UPI/3294829384/Zomato or UPI-swiggy@icici)
    const upiMatch = text.match(/upi\/[\d]+\/([A-Za-z0-9\s&'.-]{2,25})/i);
    if (upiMatch && upiMatch[1]) {
      return upiMatch[1].trim();
    }

    const vpaMatch = text.match(/([a-zA-Z0-9.\-_]{2,30}@[a-zA-Z]{2,15})/);
    if (vpaMatch && vpaMatch[1]) {
      return vpaMatch[1];
    }

    return 'Merchant / Counterparty';
  }

  /**
   * Extract bank or UPI reference number (RRN / Ref No / UPI Ref)
   */
  extractBankReference(text) {
    const refMatch = text.match(/(?:upi\s*ref(?:erence)?(?:\s*no)?|rrn|ref\s*no\.?|reference\s*no\.?|txn\s*id|ref:?)\s*[:#-]?\s*([A-Za-z0-9]{6,25})/i);
    if (refMatch && refMatch[1]) {
      return refMatch[1].trim();
    }
    return null;
  }

  /**
   * Extract transaction timestamp from SMS text if explicitly provided, else fallback to current time
   */
  extractDate(text) {
    // Patterns: 10-Oct-2026, 10/10/26, 10-10-2026 14:30:15
    const dateMatch = text.match(/\b(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2,4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?\b/);
    if (dateMatch) {
      try {
        const day = parseInt(dateMatch[1], 10);
        let month = dateMatch[2];
        let year = parseInt(dateMatch[3], 10);
        if (year < 100) year += 2000;

        const months = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };

        let monthIndex = 0;
        if (isNaN(month)) {
          monthIndex = months[month.toLowerCase()] || 0;
        } else {
          monthIndex = parseInt(month, 10) - 1;
        }

        const date = new Date(year, monthIndex, day);
        if (!isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2035) {
          return date;
        }
      } catch (_) {
        // fallback to now
      }
    }

    return new Date();
  }

  /**
   * Hybrid categorization logic (Direct corrections -> Rules -> ML Engine -> General)
   */
  async categorize(merchant, description, amount, direction, userId) {
    const combinedText = `${merchant || ''} ${description || ''}`.trim();

    // 1. User corrections priority (Tenant-Isolated Learning)
    if (userId) {
      try {
        const correction = await prisma.transactionCategoryCorrection.findFirst({
          where: {
            userId,
            OR: [
              { merchant: { equals: merchant, mode: 'insensitive' } },
              { description: { contains: merchant, mode: 'insensitive' } }
            ]
          },
          orderBy: { createdAt: 'desc' }
        });

        if (correction && correction.correctedCategory) {
          return {
            category: correction.correctedCategory,
            confidence: 0.99,
            reason: `Matched user's previous category correction for ${merchant}`,
            source: 'USER_RULE'
          };
        }
      } catch (err) {
        console.warn('[SMS] Error fetching category corrections:', err.message);
      }
    }

    // 2. Deterministic Rule Matching
    for (const dm of DETERMINISTIC_MERCHANTS) {
      if (dm.pattern.test(combinedText)) {
        return {
          category: dm.category,
          confidence: 0.92,
          reason: `Rule-based match for ${dm.name}`,
          source: 'DETERMINISTIC_RULE'
        };
      }
    }

    // 3. Fallback to In-Process ML Categorizer Engine
    try {
      const mlResult = mlCategorizerService.predict(combinedText, amount, direction);
      // Guard against any future drift back to a percentage — the gate below
      // compares against 0.50 and the value is persisted to a Decimal(5,4).
      const mlConfidence =
        mlResult && Number.isFinite(mlResult.confidence) && mlResult.confidence > 1
          ? mlResult.confidence / 100
          : mlResult && mlResult.confidence;
      if (mlResult && mlResult.category && mlConfidence >= 0.50) {
        return {
          category: mlResult.category,
          confidence: mlConfidence,
          reason: `ML classification (${(mlConfidence * 100).toFixed(0)}% confidence)`,
          source: 'ML_ENGINE'
        };
      }
    } catch (err) {
      console.warn('[SMS] ML prediction fallback error:', err.message);
    }

    // Default
    return {
      category: direction === 'INCOME' ? 'Income' : 'General',
      confidence: 0.40,
      reason: 'General default category; review recommended',
      source: 'FALLBACK'
    };
  }

  /**
   * Full pipeline to parse an SMS message and return a normalized candidate object
   */
  async parseMessage(rawText, rawSender = null, userId = null) {
    const classification = this.classifyMessage(rawText);
    const hash = this.computeHash(rawText);

    if (!classification.isTransaction) {
      return {
        isTransaction: false,
        classificationType: classification.type,
        rejectionReason: classification.reason,
        rawMessageHash: hash
      };
    }

    const amount = this.extractAmount(rawText);
    if (!amount || amount <= 0) {
      return {
        isTransaction: false,
        classificationType: 'NO_VALID_AMOUNT',
        rejectionReason: 'Unable to extract a reliable transaction amount',
        rawMessageHash: hash
      };
    }

    const direction = this.extractDirection(rawText);
    const merchant = this.extractMerchant(rawText);
    const accountHint = this.extractAccountHint(rawText);
    const bankReference = this.extractBankReference(rawText);
    const transactionDate = this.extractDate(rawText);

    // Confidence estimation
    let confidence = 0.85;
    if (accountHint) confidence += 0.05;
    if (bankReference) confidence += 0.05;
    if (!merchant || merchant === 'Merchant / Counterparty') confidence -= 0.10;
    confidence = Math.min(0.99, Math.max(0.50, confidence));

    // Hybrid categorization
    const catResult = await this.categorize(merchant, rawText, amount, direction, userId);

    return {
      isTransaction: true,
      amount,
      currency: 'INR',
      transactionType: direction,
      merchant,
      accountHint,
      bankReference,
      transactionDate,
      suggestedCategory: catResult.category,
      categoryConfidence: clampConfidence(catResult.confidence),
      categoryReason: catResult.reason,
      overallConfidence: confidence,
      rawSender: rawSender || 'BANK_SMS',
      rawMessageHash: hash,
      source: 'BANK_SMS'
    };
  }

  /**
   * Check for duplicate transactions in both pending queue and canonical transactions
   */
  async checkDuplicate(userId, parsedCandidate) {
    if (!userId || !parsedCandidate) return { isDuplicate: false };

    // 1. Check existing pending SMS with same hash
    const existingPending = await prisma.pendingSmsTransaction.findFirst({
      where: {
        userId,
        rawMessageHash: parsedCandidate.rawMessageHash
      }
    });

    if (existingPending) {
      return {
        isDuplicate: true,
        reason: 'Duplicate SMS message previously ingested into pending queue',
        existingPendingId: existingPending.id
      };
    }

    // 2. Check canonical transactions for exact match on amount, date (within 1 day), and matching merchant
    const startWindow = new Date(parsedCandidate.transactionDate.getTime() - 24 * 60 * 60 * 1000);
    const endWindow = new Date(parsedCandidate.transactionDate.getTime() + 24 * 60 * 60 * 1000);

    const existingCanonical = await prisma.transaction.findFirst({
      where: {
        userId,
        amount: parsedCandidate.amount,
        transactionType: parsedCandidate.transactionType,
        date: {
          gte: startWindow,
          lte: endWindow
        },
        OR: [
          { merchant: { equals: parsedCandidate.merchant, mode: 'insensitive' } },
          { description: { contains: parsedCandidate.merchant, mode: 'insensitive' } }
        ]
      }
    });

    if (existingCanonical) {
      return {
        isDuplicate: true,
        reason: `Matches existing confirmed transaction on ${existingCanonical.date.toISOString().split('T')[0]}`,
        existingTransactionId: existingCanonical.id
      };
    }

    return { isDuplicate: false };
  }
}

module.exports = new SmsParserService();
