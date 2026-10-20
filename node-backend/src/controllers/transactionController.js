const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const financialTwin = require('../services/financialTwinService');
const notificationService = require('../services/notificationService');

/**
 * Transactions Controller with Anomaly Detection & ML Categorization
 * Owner: Jinay Golecha (jinay_golecha)
 */

/**
 * GET /api/v1/transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      category,
      startDate,
      endDate,
      search,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };
    if (type) where.transactionType = type.toUpperCase();
    if (category) where.category = { name: { contains: category, mode: 'insensitive' } };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { merchant: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { category: { select: { name: true } }, account: { select: { name: true } } },
        orderBy: { date: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transactions: transactions.map((t) => ({
          id: t.id,
          amount: parseFloat(t.amount),
          formattedAmount: formatINR(t.amount),
          type: t.transactionType,
          category: t.category?.name || 'Uncategorized',
          account: t.account?.name || 'Unknown',
          description: t.description || '',
          merchant: t.merchant || '',
          date: t.date,
          currency: t.currency,
          createdAt: t.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/transactions
 */
const createTransaction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      amount,
      type = 'EXPENSE',
      category: categoryName,
      accountId,
      description,
      merchant,
      date,
      notes,
      paymentMethod,
    } = req.body;

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
      });
    }

    const transactionType = ((req.body.type || req.body.transactionType || 'EXPENSE')).toUpperCase();
    const validTypes = ['INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT', 'LOAN_PAYMENT'];
    if (!validTypes.includes(transactionType)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Type must be one of: ${validTypes.join(', ')}` },
      });
    }

    // Resolve or create category
    let categoryRecord = null;
    if (categoryName) {
      categoryRecord = await prisma.category.findFirst({
        where: { userId, name: { equals: categoryName, mode: 'insensitive' } },
      });
      if (!categoryRecord) {
        categoryRecord = await prisma.category.create({
          data: {
            userId,
            name: categoryName,
            categoryType: transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
          },
        });
      }
    }

    // Find or resolve account
    let targetAccountId = accountId;
    if (targetAccountId) {
      const account = await prisma.financialAccount.findFirst({
        where: { id: targetAccountId, userId },
      });
      if (!account) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Account not found.' },
        });
      }
    } else {
      const defaultAcc = await prisma.financialAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (defaultAcc) {
        targetAccountId = defaultAcc.id;
      }
    }

    const transaction = await prisma.$transaction(async (tx) => {
      const t = await tx.transaction.create({
        data: {
          userId,
          accountId: targetAccountId || null,
          categoryId: categoryRecord?.id || null,
          amount: amountNum,
          transactionType,
          description: description?.trim() || null,
          merchant: merchant?.trim() || null,
          notes: notes?.trim() || null,
          paymentMethod: paymentMethod || null,
          date: date ? new Date(date) : new Date(),
          currency: 'INR',
        },
        include: { category: { select: { name: true } }, account: { select: { name: true } } },
      });

      // Update account balance
      if (targetAccountId) {
        const balanceDelta = transactionType === 'INCOME' ? amountNum : -amountNum;
        await tx.financialAccount.update({
          where: { id: targetAccountId },
          data: { balance: { increment: balanceDelta } },
        });
      }

      return t;
    });

    // Statistical Anomaly Detection
    let anomalyResult = { isAnomaly: false, severity: 'NORMAL' };
    if (transactionType === 'EXPENSE') {
      anomalyResult = await financialTwin.detectExpenseAnomaly(userId, {
        id: transaction.id,
        amount: amountNum,
        categoryId: categoryRecord?.name || 'General',
        merchant: merchant || description,
      });

      if (anomalyResult.isAnomaly) {
        await prisma.notification.create({
          data: {
            userId,
            title: anomalyResult.severity === 'HIGHLY_UNUSUAL' ? '⚠️ High-Value Anomaly Detected' : 'Unusual Expense Detected',
            message: anomalyResult.reason,
            type: anomalyResult.severity === 'HIGHLY_UNUSUAL' ? 'ALERT' : 'WARNING',
          },
        }).catch(() => {});
      }

      // Check budget thresholds and alert user if >= 90% or >= 100%
      notificationService.checkBudgetThresholds(userId, transaction).catch(() => {});
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'TRANSACTION_CREATE',
        entity: 'Transaction',
        entityId: transaction.id,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: {
        id: transaction.id,
        amount: parseFloat(transaction.amount),
        formattedAmount: formatINR(transaction.amount),
        type: transaction.transactionType,
        category: transaction.category?.name || 'Uncategorized',
        account: transaction.account?.name || 'Primary Account',
        date: transaction.date,
        anomalyStatus: anomalyResult.severity,
        anomalyReason: anomalyResult.reason,
        message: 'Transaction created successfully!',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/transactions/:id
 */
const getTransaction = async (req, res, next) => {
  try {
    const t = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { category: true, account: true },
    });

    if (!t) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...t, formattedAmount: formatINR(t.amount) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/transactions/:id
 */
const updateTransaction = async (req, res, next) => {
  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { category: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    const { amount, description, merchant, notes, category: newCategoryName } = req.body;

    // ML Feedback Learning: If user changed the category, store correction
    if (newCategoryName && existing.category?.name && newCategoryName.toLowerCase() !== existing.category.name.toLowerCase()) {
      await prisma.transactionCategoryCorrection.create({
        data: {
          userId: req.user.id,
          merchant: merchant || existing.merchant,
          description: description || existing.description,
          originalCategory: existing.category.name,
          correctedCategory: newCategoryName,
        },
      }).catch(() => {});
    }

    let categoryId = existing.categoryId;
    if (newCategoryName) {
      let cat = await prisma.category.findFirst({
        where: { userId: req.user.id, name: { equals: newCategoryName, mode: 'insensitive' } },
      });
      if (!cat) {
        cat = await prisma.category.create({
          data: { userId: req.user.id, name: newCategoryName, categoryType: existing.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE' },
        });
      }
      categoryId = cat.id;
    }

    const newAmountNum = amount !== undefined ? parseFloat(amount) : parseFloat(existing.amount);
    const oldAmountNum = parseFloat(existing.amount);
    if (amount !== undefined && (!Number.isFinite(newAmountNum) || newAmountNum <= 0)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
      });
    }
    const amountChanged = amount !== undefined && !isNaN(newAmountNum) && newAmountNum !== oldAmountNum;

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.transaction.update({
        where: { id: req.params.id },
        data: {
          ...(amount !== undefined && { amount: newAmountNum }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(merchant !== undefined && { merchant: merchant?.trim() || null }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          ...(categoryId && { categoryId }),
        },
        include: { category: true, account: true },
      });

      // Atomically adjust account balance if amount changed
      if (amountChanged && existing.accountId) {
        const delta = existing.transactionType === 'INCOME'
          ? (newAmountNum - oldAmountNum)
          : (oldAmountNum - newAmountNum);

        await tx.financialAccount.update({
          where: { id: existing.accountId },
          data: { balance: { increment: delta } },
        });
      }

      return t;
    });

    return res.status(200).json({
      success: true,
      data: { ...updated, formattedAmount: formatINR(updated.amount), message: 'Transaction updated successfully.' },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/transactions/:id
 */
const deleteTransaction = async (req, res, next) => {
  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    await prisma.$transaction(async (tx) => {
      // Revert account balance
      if (existing.accountId) {
        const amt = parseFloat(existing.amount);
        const reverseDelta = existing.transactionType === 'INCOME' ? -amt : amt;
        await tx.financialAccount.update({
          where: { id: existing.accountId },
          data: { balance: { increment: reverseDelta } },
        });
      }

      await tx.transaction.delete({ where: { id: req.params.id } });
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TRANSACTION_DELETE',
        entity: 'Transaction',
        entityId: req.params.id,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: { message: 'Transaction deleted successfully and balance updated.' },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/transactions/voice
 */
/**
 * POST /api/v1/transactions/parse-text
 * Extracts financial transaction details from bank SMS or natural text
 */
const parseTextEntry = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'SMS or transaction text is required.' },
      });
    }

    const parsed = parseFinancialText(text);

    return res.status(200).json({
      success: true,
      data: {
        parsed,
        formattedAmount: formatINR(parsed.amount),
        message: 'Transaction details detected. Please review and confirm to save.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/transactions/voice
 */
const parseVoiceEntry = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Voice text is required.' },
      });
    }

    const parsed = parseFinancialText(text);

    return res.status(200).json({
      success: true,
      data: {
        parsed,
        formattedAmount: formatINR(parsed.amount),
        message: 'Voice entry parsed successfully. Please confirm to save.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Comprehensive parser for Bank SMS & Natural Language
 * Detects: amount, credit/debit type, date, merchant/description, category, payment method
 */
const parseFinancialText = (rawText) => {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. Amount Extraction
  // Patterns: "INR 1,500.00", "Rs. 12,300", "Rs 450", "₹5,000", "spent 500"
  let amount = 0;
  const currencyAmountMatch = text.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹|rupees)/i) ||
    text.match(/(?:debited(?:\s+with|\s+by)?|credited(?:\s+with|\s+by)?|spent|paid|received|amount:?)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/\b(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)\b/);

  if (currencyAmountMatch) {
    const rawAmt = (currencyAmountMatch[1] || currencyAmountMatch[2] || '').replace(/,/g, '');
    const parsedAmt = parseFloat(rawAmt);
    if (!isNaN(parsedAmt) && parsedAmt > 0) {
      amount = parsedAmt;
    }
  }

  // 2. Credit / Debit Transaction Type Detection
  let type = 'EXPENSE';
  const isCredit = /\b(credited|credit|received|earned|salary|stipend|deposited|refund|cashback|bonus|income)\b/i.test(lower);
  const isDebit = /\b(debited|debit|spent|paid|withdrawn|charged|purchase|sent|payment to|payment of)\b/i.test(lower);
  const isTransfer = /\b(transferred to|transfer to)\b/i.test(lower);

  if (isTransfer) {
    type = 'TRANSFER';
  } else if (isCredit && !isDebit) {
    type = 'INCOME';
  } else if (isDebit) {
    type = 'EXPENSE';
  } else if (isCredit) {
    type = 'INCOME';
  }

  // 3. Date Detection
  // Handles: "10-Sep-2026", "01-Sep-26", "09/09/2026", "15 Oct 2026", "on 12-09-2026"
  let date = new Date().toISOString().split('T')[0];
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  const dateMatch = text.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3,9}|\d{1,2})[-/ ](\d{2,4})\b/);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    let monthPart = dateMatch[2].toLowerCase();
    let yearPart = dateMatch[3];
    if (yearPart.length === 2) yearPart = '20' + yearPart;

    let month = '01';
    if (/^\d+$/.test(monthPart)) {
      month = monthPart.padStart(2, '0');
    } else {
      const shortM = monthPart.slice(0, 3);
      if (months[shortM]) month = months[shortM];
    }
    const candidateDate = `${yearPart}-${month}-${day}`;
    if (!isNaN(Date.parse(candidateDate))) {
      date = candidateDate;
    }
  }

  // 4. Merchant / Description Detection
  let merchant = '';
  // Check known popular merchants first
  const knownMerchants = [
    'Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Uber', 'Ola', 'Myntra', 'Blinkit', 'Zepto',
    'Star Health', 'JioFiber', 'Airtel', 'Spotify', 'Netflix', 'BookMyShow', 'Apollo',
    'Tata Neu', 'BigBasket', 'Cultfit', 'HDFC Bank', 'ICICI Bank', 'SBI Bank',
  ];
  for (const km of knownMerchants) {
    if (new RegExp(`\\b${km}\\b`, 'i').test(text)) {
      merchant = km;
      break;
    }
  }

  // If not found, look for patterns: "at SWIGGY via", "to John via UPI", "by internship stipend"
  if (!merchant) {
    const atMatch = text.match(/(?:at|to|by|for|info:?|vpa:?)\s+([A-Za-z0-9\s.&_-]{2,30}?)(?:\s+via|\s+on|\s+ref|\s+avl|\s+bal|\.|$|,|;)/i);
    if (atMatch && atMatch[1]) {
      const clean = atMatch[1].replace(/^(a\/c|the|your)\s+/i, '').trim();
      if (clean && !/^(rs|inr|account|card)\b/i.test(clean)) {
        merchant = clean;
      }
    }
  }

  // 5. Payment Method
  let paymentMethod = 'UPI';
  if (/\bcredit\s*card\b/i.test(text)) paymentMethod = 'Credit Card';
  else if (/\bdebit\s*card\b/i.test(text) || /\bcard\s+ending\b/i.test(text)) paymentMethod = 'Debit Card';
  else if (/\bneft\b/i.test(text)) paymentMethod = 'NEFT';
  else if (/\brtgs\b/i.test(text)) paymentMethod = 'RTGS';
  else if (/\bimps\b/i.test(text)) paymentMethod = 'IMPS';
  else if (/\bnet\s*banking\b/i.test(text)) paymentMethod = 'Net Banking';
  else if (/\bcash\b/i.test(text)) paymentMethod = 'Cash';
  else if (/\bupi\b/i.test(text)) paymentMethod = 'UPI';

  // 6. Category Mapping
  const categoryMap = {
    'Food & Dining': ['food', 'swiggy', 'zomato', 'eat', 'dinner', 'lunch', 'restaurant', 'cafe', 'coffee', 'chai', 'mcdonalds', 'starbucks'],
    'Shopping': ['amazon', 'flipkart', 'myntra', 'shopping', 'clothes', 'bought', 'mall', 'retail', 'blinkit', 'zepto'],
    'Transport': ['uber', 'ola', 'taxi', 'auto', 'metro', 'fuel', 'petrol', 'diesel', 'bus', 'flight', 'railway', 'irctc'],
    'Utilities': ['jiofiber', 'airtel', 'electricity', 'water bill', 'recharge', 'broadband', 'phone bill', 'utility', 'gas'],
    'Entertainment': ['netflix', 'spotify', 'movie', 'hotstar', 'prime', 'cinema', 'bookmyshow', 'game'],
    'Education': ['books', 'course', 'college', 'tuition', 'fee', 'exam', 'certification', 'udemy', 'coursera'],
    'Healthcare': ['doctor', 'medicine', 'hospital', 'pharmacy', 'medical', 'star health', 'apollo', 'clinic'],
    'Salary & Income': ['salary', 'stipend', 'freelance', 'dividend', 'interest', 'bonus'],
  };

  let category = type === 'INCOME' ? 'Salary & Income' : 'General';
  for (const [catName, keywords] of Object.entries(categoryMap)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      category = catName;
      break;
    }
  }

  // 7. Clean Description
  let description = merchant ? `${merchant} (${paymentMethod})` : text.slice(0, 60);
  if (type === 'INCOME' && /stipend/i.test(text)) {
    description = 'Internship Stipend Credit';
    category = 'Salary & Income';
  } else if (type === 'INCOME' && /salary/i.test(text)) {
    description = 'Monthly Salary Credit';
    category = 'Salary & Income';
  }

  return {
    amount,
    type,
    category,
    date,
    merchant: merchant || (type === 'INCOME' ? 'Employer / Client' : 'Merchant'),
    description,
    paymentMethod,
  };
};

module.exports = {
  getTransactions,
  createTransaction,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  parseVoiceEntry,
  parseTextEntry,
};
