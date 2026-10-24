const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const analyticsEngine = require('../services/analyticsEngine');

const BUDGET_TX_SELECT = {
  amount: true,
  transactionType: true,
  date: true,
  description: true,
  merchant: true,
  categoryId: true,
  category: { select: { name: true } },
};

const previousMonthOf = (year, month) =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

/**
 * GET /api/v1/budgets
 */
const getBudgets = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const parsed = analyticsEngine.parsePeriodInput({ month: req.query.month, year: req.query.year, now });
    if (!parsed.valid) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error } });
    }
    const { month, year } = parsed;

    const { start: startOfMonth, end: endOfMonth } = analyticsEngine.getMonthBounds(year, month);
    const prev = previousMonthOf(year, month);
    const prevBounds = analyticsEngine.getMonthBounds(prev.year, prev.month);

    const [budgets, expenses, previousExpenses] = await Promise.all([
      prisma.budget.findMany({
        where: { userId, month, year },
        include: { category: { select: { id: true, name: true } } },
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          transactionType: { in: analyticsEngine.SPENDING_TYPES },
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        select: BUDGET_TX_SELECT,
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          transactionType: { in: analyticsEngine.SPENDING_TYPES },
          date: { gte: prevBounds.start, lte: prevBounds.end },
        },
        select: BUDGET_TX_SELECT,
      }),
    ]);

    const evaluation = analyticsEngine.evaluateBudgets({
      budgets,
      transactions: expenses,
      previousTransactions: previousExpenses,
      year,
      month,
      warningThreshold: req.query.warningThreshold,
      now,
    });

    const enrichedBudgets = evaluation.budgets.map((b) => ({
      ...b,
      formattedLimit: formatINR(b.monthlyLimit),
      formattedSpent: formatINR(b.spent),
      formattedRemaining: formatINR(b.remaining),
      formattedPreviousMonthSpent: formatINR(b.previousMonthSpent),
      formattedProjectedMonthEndSpent: formatINR(b.projectedMonthEndSpent),
    }));

    const totalLimit = evaluation.summary.totalBudgeted;
    const totalSpent = evaluation.summary.totalSpent;
    const totalRemaining = evaluation.summary.totalRemaining;

    return res.status(200).json({
      success: true,
      data: {
        month,
        year,
        warningThreshold: evaluation.warningThreshold,
        summary: {
          ...evaluation.summary,
          formattedTotalBudgeted: formatINR(totalLimit),
          formattedTotalSpent: formatINR(totalSpent),
          formattedTotalRemaining: formatINR(totalRemaining),
        },
        totalLimit,
        totalSpent,
        formattedTotalLimit: formatINR(totalLimit),
        formattedTotalSpent: formatINR(totalSpent),
        budgets: enrichedBudgets,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/budgets/:id
 */
const getBudget = async (req, res, next) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { category: { select: { id: true, name: true } } },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Budget not found.' },
      });
    }

    const startOfMonth = new Date(budget.year, budget.month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(budget.year, budget.month, 0, 23, 59, 59, 999);
    const expenses = await prisma.transaction.findMany({
      where: {
        userId: req.user.id,
        transactionType: { in: analyticsEngine.SPENDING_TYPES },
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: { category: { select: { id: true, name: true } } },
    });

    const catName = (budget.category?.name || budget.categoryName || '').toLowerCase();
    const spent = Math.max(
      0,
      analyticsEngine.round2(
        expenses.reduce((sum, t) => {
          const matchesId = budget.categoryId && t.categoryId === budget.categoryId;
          const matchesName = t.category?.name && t.category.name.toLowerCase() === catName;
          return matchesId || matchesName ? sum + analyticsEngine.signedSpendingAmount(t) : sum;
        }, 0)
      )
    );
    const limit = parseFloat(budget.monthlyLimit);
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        id: budget.id,
        category: budget.category?.name || budget.categoryName,
        categoryName: budget.category?.name || budget.categoryName,
        monthlyLimit: limit,
        formattedLimit: formatINR(limit),
        spent,
        formattedSpent: formatINR(spent),
        remaining: Math.max(0, limit - spent),
        formattedRemaining: formatINR(Math.max(0, limit - spent)),
        percentageUsed: pct,
        status: pct >= 100 ? 'exceeded' : pct >= 90 ? 'alert' : pct >= 75 ? 'warning' : 'ok',
        month: budget.month,
        year: budget.year,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/budgets
 */
const createBudget = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const categoryName = req.body.categoryName || req.body.category;
    const { monthlyLimit, month = now.getMonth() + 1, year = now.getFullYear() } = req.body;

    const limit = parseFloat(monthlyLimit);
    if (!categoryName || typeof categoryName !== 'string' || !Number.isFinite(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Category name and a positive monthly limit are required.' },
      });
    }

    const period = analyticsEngine.parsePeriodInput({ month, year, now });
    if (!period.valid) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: period.error } });
    }

    // Find or create category
    let category = await prisma.category.findFirst({
      where: { userId, name: { equals: categoryName, mode: 'insensitive' } },
    });
    if (!category) {
      category = await prisma.category.create({
        data: { userId, name: categoryName, categoryType: 'EXPENSE' },
      });
    }

    // Upsert budget
    const budget = await prisma.budget.upsert({
      where: { userId_categoryName_month_year: { userId, categoryName, month: period.month, year: period.year } },
      update: { monthlyLimit: limit, categoryId: category.id },
      create: {
        userId,
        categoryId: category.id,
        categoryName,
        monthlyLimit: limit,
        month: period.month,
        year: period.year,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...budget,
        formattedLimit: formatINR(limit),
        message: `Budget for ${categoryName} set to ${formatINR(limit)}/month.`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/budgets/:id
 */
const updateBudget = async (req, res, next) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Budget not found.' },
      });
    }

    const { monthlyLimit, categoryName } = req.body;

    // Validate any provided monetary value — reject negative or non-finite input.
    let nextLimit;
    if (monthlyLimit !== undefined && monthlyLimit !== null && monthlyLimit !== '') {
      nextLimit = parseFloat(monthlyLimit);
      if (!Number.isFinite(nextLimit) || nextLimit <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'monthlyLimit must be a positive, finite amount.' },
        });
      }
    }

    const updated = await prisma.budget.update({
      where: { id: req.params.id },
      data: {
        ...(nextLimit !== undefined && { monthlyLimit: nextLimit }),
        ...(categoryName && typeof categoryName === 'string' && { categoryName: categoryName.trim() }),
      },
    });

    return res.status(200).json({
      success: true,
      data: { ...updated, formattedLimit: formatINR(updated.monthlyLimit), message: 'Budget updated successfully.' },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/budgets/:id
 */
const deleteBudget = async (req, res, next) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Budget not found.' },
      });
    }

    await prisma.budget.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, data: { message: 'Budget deleted.' } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getBudgets, getBudget, createBudget, updateBudget, deleteBudget };
