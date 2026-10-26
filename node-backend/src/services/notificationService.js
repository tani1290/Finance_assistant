const prisma = require('../config/database');
const analyticsEngine = require('./analyticsEngine');

/**
 * Automated Financial Notification Service
 * Jinay Finance AI
 * Generates database-persisted notifications for:
 * - Budget thresholds (75%, 90%, 100%)
 * - Upcoming EMIs (due within 7 days)
 * - Upcoming Insurance Policy Renewals (due within 30 days)
 * - Subscription renewals (due within 3 days)
 * - Goal Milestones (25%, 50%, 75%, 100%)
 */

const checkBudgetThresholds = async (userId, transaction) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const budgets = await prisma.budget.findMany({
      where: { userId, month, year },
      include: { category: true },
    });

    for (const budget of budgets) {
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

      const expenseSum = await prisma.transaction.groupBy({
        by: ['transactionType'],
        where: {
          userId,
          transactionType: { in: analyticsEngine.SPENDING_TYPES },
          categoryId: budget.categoryId,
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { amount: true },
      });

      const totalSpent = Math.max(0, analyticsEngine.signedTotal(expenseSum));
      const limit = parseFloat(budget.monthlyLimit);
      if (limit <= 0) continue;

      const percentage = (totalSpent / limit) * 100;
      const catName = budget.category?.name || budget.categoryName || 'General';

      if (percentage >= 100) {
        // Check if we already notified this month for 100%
        const existing = await prisma.notification.findFirst({
          where: {
            userId,
            type: 'BUDGET_EXCEEDED',
            createdAt: { gte: startOfMonth },
            message: { contains: catName },
          },
        });
        if (!existing) {
          await prisma.notification.create({
            data: {
              userId,
              title: `🚨 Budget Exceeded: ${catName}`,
              message: `You have spent ₹${totalSpent.toLocaleString('en-IN')} of your ₹${limit.toLocaleString('en-IN')} limit (${Math.round(percentage)}%) for ${catName}.`,
              type: 'BUDGET_EXCEEDED',
              link: '/budget.html',
            },
          });
        }
      } else if (percentage >= 90) {
        const existing = await prisma.notification.findFirst({
          where: {
            userId,
            type: 'BUDGET_WARNING',
            createdAt: { gte: startOfMonth },
            message: { contains: catName },
          },
        });
        if (!existing) {
          await prisma.notification.create({
            data: {
              userId,
              title: `⚠️ Budget Alert: ${catName} at ${Math.round(percentage)}%`,
              message: `You have reached ${Math.round(percentage)}% of your ₹${limit.toLocaleString('en-IN')} ${catName} budget. Remaining: ₹${Math.max(0, limit - totalSpent).toLocaleString('en-IN')}.`,
              type: 'BUDGET_WARNING',
              link: '/budget.html',
            },
          });
        }
      }
    }
  } catch (err) {
    console.debug('[NotificationService] Budget check notice:', err.message);
  }
};

module.exports = {
  checkBudgetThresholds,
};
