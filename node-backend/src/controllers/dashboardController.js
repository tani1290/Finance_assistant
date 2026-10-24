const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { calculateHealthScore } = require('../utils/financialMath');
const { currentMonthRange, formatDateOnly, monthLabel } = require('../utils/dateOnly');
const financialTwin = require('../services/financialTwinService');
const analyticsEngine = require('../services/analyticsEngine');

const REPORT_TIMEZONE = 'Asia/Kolkata';

/**
 * GET /api/v1/dashboard
 * Returns all financial metrics for the authenticated user
 */
const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    // Transaction dates are calendar dates (`@db.Date`). Use the month that is
    // actually current in the user-facing timezone, with inclusive date bounds,
    // so the dashboard, AI context and RAG pipeline all report the same window.
    const period = currentMonthRange(now, REPORT_TIMEZONE);
    const startOfMonth = period.start;
    const endOfMonth = period.end;

    // Run all queries in parallel for performance
    const [
      accounts,
      monthlyIncome,
      monthlyExpenses,
      allTimeBalance,
      recentTransactions,
      goals,
      activeLoan,
      portfolio,
      budgets,
      financialPlan,
      notifications,
    ] = await Promise.all([
      prisma.financialAccount.findMany({
        where: { userId, isActive: true },
        select: { balance: true },
      }),

      prisma.transaction.aggregate({
        where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),

      prisma.transaction.groupBy({
        by: ['transactionType'],
        where: {
          userId,
          transactionType: { in: analyticsEngine.SPENDING_TYPES },
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { amount: true },
      }),

      prisma.transaction.aggregate({
        where: { userId, transactionType: 'INCOME' },
        _sum: { amount: true },
      }),

      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 5,
        include: { category: { select: { name: true } } },
      }),

      prisma.goal.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),

      prisma.loan.aggregate({
        where: { userId, status: 'ACTIVE' },
        _sum: { outstandingBalance: true, emiAmount: true },
      }),

      prisma.portfolio.findUnique({
        where: { userId },
        select: { totalInvested: true, currentValue: true },
      }),

      prisma.budget.findMany({
        where: { userId, month: period.month, year: period.year },
      }),

      prisma.financialPlan.findUnique({
        where: { userId },
        select: { financialHealthScore: true, planSummary: true },
      }),

      prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    // Compute totals
    const totalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);
    const incomeAmt = parseFloat(monthlyIncome._sum.amount || 0);
    const expenseAmt = analyticsEngine.signedTotal(monthlyExpenses);
    const monthlySavings = incomeAmt - expenseAmt;
    const savingsRate = incomeAmt > 0 ? Math.round((monthlySavings / incomeAmt) * 100) : 0;
    const investmentValue = parseFloat(portfolio?.currentValue || 0);
    const loanOutstanding = parseFloat(activeLoan._sum.outstandingBalance || 0);
    const totalMonthlyEMI = parseFloat(activeLoan._sum.emiAmount || 0);
    const netWorth = totalBalance + investmentValue - loanOutstanding;

    // Budget usage
    const totalBudgetLimit = budgets.reduce((s, b) => s + parseFloat(b.monthlyLimit || 0), 0);

    // Health score from plan or calculate live using 10-factor engine
    let healthScore = financialPlan?.financialHealthScore;
    if (healthScore === undefined || healthScore === null) {
      try {
        const detailed = await financialTwin.calculateDetailedHealthScore(userId);
        healthScore = detailed.overallScore;
      } catch (err) {
        console.warn('[Dashboard] 10-factor health score calculation error:', err.message);
        healthScore = calculateHealthScore({
          monthlyIncome: incomeAmt,
          monthlyExpenses: expenseAmt,
          totalSavings: totalBalance,
          totalDebt: loanOutstanding,
          totalInvestments: investmentValue,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        // Summary metrics
        totalBalance,
        monthlyIncome: incomeAmt,
        monthlyExpenses: expenseAmt,
        monthlySavings,
        savingsRate,
        netWorth,
        investmentValue,
        loanOutstanding,
        totalMonthlyEMI,
        budgetLimit: totalBudgetLimit,
        financialHealthScore: healthScore,
        unreadNotifications: notifications,

        // The reporting window and the basis for "income". Income is the sum of
        // recorded INCOME transactions in the ledger — never the onboarding
        // salary estimate on the profile.
        incomeBasis: 'RECORDED_LEDGER_TRANSACTIONS',
        period: {
          label: monthLabel(period.year, period.month),
          start: formatDateOnly(period.start),
          end: formatDateOnly(period.end),
          timezone: REPORT_TIMEZONE,
        },

        // Formatted
        formatted: {
          totalBalance: formatINR(totalBalance),
          monthlyIncome: formatINR(incomeAmt),
          monthlyExpenses: formatINR(expenseAmt),
          monthlySavings: formatINR(monthlySavings),
          netWorth: formatINR(netWorth),
          investmentValue: formatINR(investmentValue),
          loanOutstanding: formatINR(loanOutstanding),
          totalMonthlyEMI: formatINR(totalMonthlyEMI),
        },

        // Recent data
        recentTransactions: recentTransactions.map((t) => ({
          id: t.id,
          description: t.description || t.merchant || 'Transaction',
          amount: parseFloat(t.amount),
          formattedAmount: formatINR(t.amount),
          type: t.transactionType,
          category: t.category?.name || 'Uncategorized',
          // Calendar date, not an instant: prevents a one-day shift in
          // browsers west of UTC.
          date: formatDateOnly(t.date),
        })),

        goals: goals.map((g) => ({
          id: g.id,
          name: g.name,
          targetAmount: parseFloat(g.targetAmount),
          currentAmount: parseFloat(g.currentAmount),
          formattedTarget: formatINR(g.targetAmount),
          formattedCurrent: formatINR(g.currentAmount),
          progress: g.targetAmount > 0
            ? Math.round((parseFloat(g.currentAmount) / parseFloat(g.targetAmount)) * 100)
            : 0,
        })),

        planSummary: financialPlan?.planSummary || '',
        currency: 'INR',
        locale: 'en-IN',
        timezone: 'Asia/Kolkata',
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard };
