const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');

/**
 * GET /api/v1/budgets
 */
const getBudgets = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year = parseInt(req.query.year) || now.getFullYear();

    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // Get budgets for the month
    const budgets = await prisma.budget.findMany({
      where: { userId, month, year },
      include: { category: { select: { id: true, name: true } } },
    });

    // Get all expense transactions for the month
    const expenses = await prisma.transaction.findMany({
      where: {
        userId,
        transactionType: 'EXPENSE',
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: { category: { select: { id: true, name: true } } },
    });

    const enrichedBudgets = budgets.map((b) => {
      const catName = (b.category?.name || b.categoryName || '').toLowerCase();
      const catId = b.categoryId;

      const spent = expenses.reduce((sum, t) => {
        const matchesId = catId && t.categoryId === catId;
        const matchesName = t.category?.name && t.category.name.toLowerCase() === catName;
        if (matchesId || matchesName) {
          return sum + parseFloat(t.amount || 0);
        }
        return sum;
      }, 0);

      const limit = parseFloat(b.monthlyLimit);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;

      return {
        id: b.id,
        category: b.category?.name || b.categoryName,
        categoryName: b.category?.name || b.categoryName,
        monthlyLimit: limit,
        formattedLimit: formatINR(limit),
        spent,
        formattedSpent: formatINR(spent),
        remaining: Math.max(0, limit - spent),
        formattedRemaining: formatINR(Math.max(0, limit - spent)),
        percentageUsed: pct,
        status: pct >= 100 ? 'exceeded' : pct >= 90 ? 'alert' : pct >= 75 ? 'warning' : 'ok',
        month,
        year,
      };
    });

    const totalLimit = enrichedBudgets.reduce((s, b) => s + b.monthlyLimit, 0);
    const totalSpent = enrichedBudgets.reduce((s, b) => s + b.spent, 0);
    const totalRemaining = Math.max(0, totalLimit - totalSpent);

    return res.status(200).json({
      success: true,
      data: {
        month,
        year,
        summary: {
          totalBudgeted: totalLimit,
          totalSpent,
          totalRemaining,
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
        transactionType: 'EXPENSE',
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: { category: { select: { id: true, name: true } } },
    });

    const catName = (budget.category?.name || budget.categoryName || '').toLowerCase();
    const spent = expenses.reduce((sum, t) => {
      const matchesId = budget.categoryId && t.categoryId === budget.categoryId;
      const matchesName = t.category?.name && t.category.name.toLowerCase() === catName;
      return matchesId || matchesName ? sum + parseFloat(t.amount || 0) : sum;
    }, 0);
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
    if (!categoryName || !limit || limit <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Category name and a positive monthly limit are required.' },
      });
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
      where: { userId_categoryName_month_year: { userId, categoryName, month: parseInt(month), year: parseInt(year) } },
      update: { monthlyLimit: limit, categoryId: category.id },
      create: {
        userId,
        categoryId: category.id,
        categoryName,
        monthlyLimit: limit,
        month: parseInt(month),
        year: parseInt(year),
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
    const updated = await prisma.budget.update({
      where: { id: req.params.id },
      data: {
        ...(monthlyLimit && { monthlyLimit: parseFloat(monthlyLimit) }),
        ...(categoryName && { categoryName: categoryName.trim() }),
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
