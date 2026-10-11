const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');

/**
 * GET /api/v1/accounts
 */
const getAccounts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const accounts = await prisma.financialAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        totalBalance,
        formattedTotalBalance: formatINR(totalBalance),
        accounts: accounts.map((acc) => ({
          id: acc.id,
          name: acc.name,
          institution: acc.institution || 'General',
          accountType: acc.accountType,
          balance: parseFloat(acc.balance),
          formattedBalance: formatINR(acc.balance),
          currency: acc.currency,
          createdAt: acc.createdAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/accounts
 */
const createAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, accountType = 'BANK', institution, balance = 0, accountNumberMasked } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Account name is required.' },
      });
    }

    const account = await prisma.financialAccount.create({
      data: {
        userId,
        name: name.trim(),
        accountType,
        institution: institution?.trim() || null,
        accountNumberMasked: accountNumberMasked ? accountNumberMasked.trim() : null,
        balance: parseFloat(balance) || 0,
        currency: 'INR',
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...account,
        formattedBalance: formatINR(account.balance),
        message: 'Account created successfully!',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/accounts/:accountId/deposit
 * Atomically deposit money into an account
 */
const depositMoney = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { accountId } = req.params;
    const { amount, source = 'Deposit', description = 'Added funds', date } = req.body;

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
      });
    }

    // Transaction (DB) for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Verify account belongs to user
      const account = await tx.financialAccount.findFirst({
        where: { id: accountId, userId },
      });

      if (!account) {
        throw Object.assign(new Error('Account not found.'), { statusCode: 404, code: 'ACCOUNT_NOT_FOUND' });
      }

      // Update balance
      const updatedAccount = await tx.financialAccount.update({
        where: { id: accountId },
        data: { balance: { increment: amountNum } },
      });

      // Find or create Income category
      let incomeCategory = await tx.category.findFirst({
        where: { userId, name: 'Income' },
      });
      if (!incomeCategory) {
        incomeCategory = await tx.category.create({
          data: { userId, name: 'Income', categoryType: 'INCOME' },
        });
      }

      // Create income transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId,
          categoryId: incomeCategory.id,
          amount: amountNum,
          transactionType: 'INCOME',
          description: `[${source}] ${description}`,
          date: date ? new Date(date) : new Date(),
          currency: 'INR',
        },
      });

      return { account: updatedAccount, transaction };
    });

    return res.status(200).json({
      success: true,
      data: {
        message: `Successfully added ${formatINR(amountNum)} to ${result.account.name}!`,
        newBalance: parseFloat(result.account.balance),
        formattedNewBalance: formatINR(result.account.balance),
        transactionId: result.transaction.id,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/accounts/:accountId
 */
const getAccount = async (req, res, next) => {
  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: req.params.accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...account, formattedBalance: formatINR(account.balance) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/accounts/:id or /api/v1/accounts/:accountId
 */
const updateAccount = async (req, res, next) => {
  try {
    const accountId = req.params.accountId || req.params.id;
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    const { name, accountType, institution, balance } = req.body;
    const updated = await prisma.financialAccount.update({
      where: { id: accountId },
      data: {
        ...(name && { name: name.trim() }),
        ...(accountType && { accountType }),
        ...(institution !== undefined && { institution: institution?.trim() || null }),
        ...(balance !== undefined && !isNaN(parseFloat(balance)) && { balance: parseFloat(balance) }),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        formattedBalance: formatINR(updated.balance),
        message: 'Account updated successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/accounts/:accountId (soft delete)
 */
const deleteAccount = async (req, res, next) => {
  try {
    const accountId = req.params.accountId || req.params.id;
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    await prisma.financialAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });

    return res.status(200).json({
      success: true,
      data: { message: 'Account deleted successfully.' },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAccounts, createAccount, depositMoney, getAccount, updateAccount, deleteAccount };
