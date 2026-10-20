const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const financialTwin = require('../services/financialTwinService');
const analyticsEngine = require('../services/analyticsEngine');

// Columns needed to feed the pure analytics engine for an authenticated user.
// `id` is included so duplicate-suspect reports can identify individual rows for
// the owner to review (rows are always user-scoped before they reach this).
const ANALYTICS_TX_SELECT = {
  id: true,
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
 * Analytics, Health Scoring & Reports Controller
 * Owner: Jinay Golecha (jinay_golecha)
 */

/**
 * GET /api/v1/analytics
 */
const getAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const period = req.query.period || 'month'; // month | year | week

    let startDate;
    let endDate = null;
    let moMonth = null;
    let moYear = null;

    // Explicit month/year takes precedence over the rolling `period`, and lets
    // us compute a true month-over-month comparison.
    if (req.query.month !== undefined || req.query.year !== undefined) {
      const parsed = analyticsEngine.parsePeriodInput({ month: req.query.month, year: req.query.year, now });
      if (!parsed.valid) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error },
        });
      }
      const bounds = analyticsEngine.getMonthBounds(parsed.year, parsed.month);
      startDate = bounds.start;
      endDate = bounds.end;
      moMonth = parsed.month;
      moYear = parsed.year;
    } else if (period === 'week') {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      moMonth = now.getMonth() + 1;
      moYear = now.getFullYear();
    }

    const dateFilter = endDate ? { gte: startDate, lte: endDate } : { gte: startDate };

    const [income, expenses, categoryBreakdown, monthlyTrend, incomeTrend, expenseTrend] = await Promise.all([
      prisma.transaction.aggregate({
        where: { userId, transactionType: 'INCOME', date: dateFilter },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { userId, transactionType: 'EXPENSE', date: dateFilter },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, transactionType: 'EXPENSE', date: dateFilter },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      prisma.transaction.groupBy({
        by: ['date'],
        where: { userId, date: dateFilter },
        _sum: { amount: true },
        orderBy: { date: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['date'],
        where: { userId, transactionType: 'INCOME', date: dateFilter },
        _sum: { amount: true },
        orderBy: { date: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['date'],
        where: { userId, transactionType: 'EXPENSE', date: dateFilter },
        _sum: { amount: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Resolve category names
    const categoryIds = categoryBreakdown.map(c => c.categoryId).filter(Boolean);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

    const totalIncome = parseFloat(income._sum.amount || 0);
    const totalExpenses = parseFloat(expenses._sum.amount || 0);
    const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

    // Month-over-month (only meaningful when a calendar month is in play).
    let monthOverMonth = null;
    if (moMonth && moYear) {
      const prev = previousMonthOf(moYear, moMonth);
      const prevBounds = analyticsEngine.getMonthBounds(prev.year, prev.month);
      const [prevIncome, prevExpenses] = await Promise.all([
        prisma.transaction.aggregate({
          where: { userId, transactionType: 'INCOME', date: { gte: prevBounds.start, lte: prevBounds.end } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.transaction.aggregate({
          where: { userId, transactionType: 'EXPENSE', date: { gte: prevBounds.start, lte: prevBounds.end } },
          _sum: { amount: true },
          _count: true,
        }),
      ]);
      const prevIncomeTotal = parseFloat(prevIncome._sum.amount || 0);
      const prevExpenseTotal = parseFloat(prevExpenses._sum.amount || 0);
      const toSummary = (inc, exp) => ({
        income: inc,
        expenses: exp,
        netCashFlow: inc - exp,
        savings: inc - exp,
        savingsRate: inc > 0 ? analyticsEngine.round1(((inc - exp) / inc) * 100) : null,
      });
      monthOverMonth = analyticsEngine.monthOverMonth(
        toSummary(totalIncome, totalExpenses),
        toSummary(prevIncomeTotal, prevExpenseTotal)
      );
    }

    // Merge the per-day income/expense series so the frontend can plot a true
    // income-vs-expense trend (the legacy `monthlyTrend` is preserved as-is).
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const incomeByDay = new Map(incomeTrend.map((t) => [dayKey(t.date), parseFloat(t._sum.amount || 0)]));
    const expenseByDay = new Map(expenseTrend.map((t) => [dayKey(t.date), parseFloat(t._sum.amount || 0)]));
    const allDays = Array.from(new Set([...incomeByDay.keys(), ...expenseByDay.keys()])).sort();
    const dailyFlow = allDays.map((day) => {
      const dayIncome = incomeByDay.get(day) || 0;
      const dayExpense = expenseByDay.get(day) || 0;
      return { date: day, income: dayIncome, expenses: dayExpense, net: analyticsEngine.round2(dayIncome - dayExpense) };
    });

    return res.status(200).json({
      success: true,
      data: {
        period,
        ...(moMonth && moYear ? { month: moMonth, year: moYear } : {}),
        summary: {
          totalIncome,
          formattedIncome: formatINR(totalIncome),
          totalExpenses,
          formattedExpenses: formatINR(totalExpenses),
          netSavings: totalIncome - totalExpenses,
          formattedNetSavings: formatINR(totalIncome - totalExpenses),
          savingsRate,
          incomeTransactions: income._count,
          expenseTransactions: expenses._count,
        },
        monthOverMonth,
        categoryBreakdown: categoryBreakdown.map(c => ({
          category: catMap[c.categoryId] || 'Uncategorized',
          amount: parseFloat(c._sum.amount || 0),
          formattedAmount: formatINR(c._sum.amount || 0),
          percentage: totalExpenses > 0 ? Math.round((parseFloat(c._sum.amount || 0) / totalExpenses) * 100) : 0,
        })),
        monthlyTrend: monthlyTrend.map(t => ({
          date: t.date,
          amount: parseFloat(t._sum.amount || 0),
        })),
        dailyFlow,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/financial-health
 * Feature 1: Advanced AI Financial Health Score (0-100)
 */
const getFinancialHealth = async (req, res, next) => {
  try {
    const health = await financialTwin.calculateDetailedHealthScore(req.user.id);
    return res.status(200).json({
      success: true,
      data: health,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/cash-flow
 * Feature 2: Cash Flow Prediction (7, 30, 90 Days)
 */
const getCashFlowPrediction = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const prediction = await financialTwin.predictCashFlow(req.user.id, days);
    return res.status(200).json({
      success: true,
      data: prediction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/anomalies
 * Feature 3: Expense Anomalies list
 */
const getExpenseAnomalies = async (req, res, next) => {
  try {
    const anomalies = await prisma.expenseAnomaly.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return res.status(200).json({
      success: true,
      data: anomalies,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/ai/anomalies/:id/feedback
 * Feature 3: Expense Anomaly Feedback (CONFIRMED_NORMAL / SUSPICIOUS / IGNORED)
 */
const submitAnomalyFeedback = async (req, res, next) => {
  try {
    const { feedback } = req.body; // CONFIRMED_NORMAL | SUSPICIOUS | IGNORED
    const anomaly = await prisma.expenseAnomaly.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!anomaly) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Anomaly not found' } });
    }

    const updated = await prisma.expenseAnomaly.update({
      where: { id: req.params.id },
      data: { userFeedback: feedback || 'CONFIRMED_NORMAL' },
    });

    return res.status(200).json({
      success: true,
      data: {
        anomaly: updated,
        message: `Feedback recorded: ${feedback}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/budget-optimize
 * Feature 4: Smart Budget Optimizer
 */
const getBudgetOptimization = async (req, res, next) => {
  try {
    const method = req.query.method || '50/30/20';
    const optimized = await financialTwin.optimizeBudget(req.user.id, method);
    return res.status(200).json({
      success: true,
      data: optimized,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/risk-radar
 * Feature 28: Financial Risk Radar
 */
const getRiskRadar = async (req, res, next) => {
  try {
    const radar = await financialTwin.evaluateRiskRadar(req.user.id);
    return res.status(200).json({
      success: true,
      data: radar,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/reports/monthly
 * Feature 22: AI Monthly Financial Report
 */
const getMonthlyFinancialReport = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year = parseInt(req.query.year) || now.getFullYear();

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0);

    const [
      user,
      incomes,
      expenses,
      categoryExpenses,
      budgets,
      portfolio,
      goals,
      loans,
      insurance,
      subscriptions,
      healthScore,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.transaction.aggregate({
        where: { userId, transactionType: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { userId, transactionType: 'EXPENSE', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, transactionType: 'EXPENSE', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      prisma.budget.findMany({ where: { userId } }),
      prisma.portfolio.findUnique({ where: { userId }, include: { investments: true } }),
      prisma.goal.findMany({ where: { userId } }),
      prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
      prisma.insurancePolicy.findMany({ where: { userId, isActive: true } }),
      prisma.subscription.findMany({ where: { userId, isActive: true } }),
      financialTwin.calculateDetailedHealthScore(userId),
    ]);

    const totalIncome = parseFloat(incomes._sum.amount || 0);
    const totalExpenses = parseFloat(expenses._sum.amount || 0);
    const netSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        reportMonth: `${month}/${year}`,
        generatedAt: new Date().toISOString(),
        user: { name: `${user?.firstName} ${user?.lastName}`.trim(), email: user?.email },
        summary: {
          totalIncome,
          formattedTotalIncome: formatINR(totalIncome),
          totalExpenses,
          formattedTotalExpenses: formatINR(totalExpenses),
          netSavings,
          formattedNetSavings: formatINR(netSavings),
          savingsRate,
          healthScore: healthScore.overallScore,
        },
        healthBreakdown: healthScore.components,
        topExpenseCategories: categoryExpenses.map(c => ({
          categoryId: c.categoryId,
          amount: parseFloat(c._sum.amount || 0),
          formattedAmount: formatINR(c._sum.amount || 0),
        })),
        activeLoansCount: loans.length,
        totalDebt: loans.reduce((s, l) => s + parseFloat(l.outstandingBalance), 0),
        insurancePoliciesCount: insurance.length,
        activeSubscriptionsCount: subscriptions.length,
        activeGoalsCount: goals.length,
        aiRecommendations: healthScore.recommendations,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/calendar/events
 */
const getCalendarEvents = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year = parseInt(req.query.year) || now.getFullYear();
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const [customEvents, loans, subscriptions, goals] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { userId, eventDate: { gte: startDate, lte: endDate } },
        orderBy: { eventDate: 'asc' },
      }),
      prisma.loan.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { id: true, loanType: true, emiAmount: true, startDate: true },
      }),
      prisma.subscription.findMany({
        where: { userId, isActive: true, nextBillingDate: { gte: startDate, lte: endDate } },
        select: { id: true, serviceName: true, cost: true, nextBillingDate: true },
      }),
      prisma.goal.findMany({
        where: { userId, status: 'ACTIVE', targetDate: { gte: startDate, lte: endDate } },
        select: { id: true, name: true, targetAmount: true, targetDate: true },
      }),
    ]);

    const events = [
      ...customEvents.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description || '',
        type: e.eventType || 'CUSTOM',
        date: e.eventDate,
        amount: e.amount ? parseFloat(e.amount) : null,
        formattedAmount: e.amount ? formatINR(e.amount) : null,
        color: e.color || '#4F46E5',
      })),
      ...loans.map(l => ({
        id: l.id + '-emi',
        title: `${l.loanType} Loan EMI Due`,
        description: `Monthly EMI: ${formatINR(l.emiAmount)}`,
        type: 'EMI',
        date: new Date(year, month - 1, new Date(l.startDate).getDate()),
        amount: parseFloat(l.emiAmount || 0),
        formattedAmount: formatINR(l.emiAmount || 0),
        color: '#EF4444',
      })),
      ...subscriptions.map(s => ({
        id: s.id + '-sub',
        title: `${s.serviceName} Renewal`,
        description: `Subscription: ${formatINR(s.cost)}`,
        type: 'SUBSCRIPTION',
        date: s.nextBillingDate,
        amount: parseFloat(s.cost || 0),
        formattedAmount: formatINR(s.cost || 0),
        color: '#F59E0B',
      })),
      ...goals.map(g => ({
        id: g.id + '-goal',
        title: `Goal Deadline: ${g.name}`,
        description: `Target: ${formatINR(g.targetAmount)}`,
        type: 'GOAL',
        date: g.targetDate,
        amount: parseFloat(g.targetAmount || 0),
        formattedAmount: formatINR(g.targetAmount || 0),
        color: '#10B981',
      })),
    ];

    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.status(200).json({
      success: true,
      data: { month, year, events },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/calendar/events
 */
const createCalendarEvent = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { title, description, eventType = 'CUSTOM', eventDate, amount, color } = req.body;

    if (!title || !eventDate) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Title and event date are required.' },
      });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        title: title.trim(),
        description: description?.trim() || null,
        eventType,
        eventDate: new Date(eventDate),
        amount: amount ? parseFloat(amount) : null,
        color: color || '#4F46E5',
      },
    });

    return res.status(201).json({ success: true, data: { ...event, message: 'Event created!' } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/calendar/events/:id
 */
const updateCalendarEvent = async (req, res, next) => {
  try {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!event) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    }

    const { title, description, eventType, eventDate, amount, color } = req.body;
    const updated = await prisma.calendarEvent.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(eventType && { eventType }),
        ...(eventDate && { eventDate: new Date(eventDate) }),
        ...(amount !== undefined && { amount: amount ? parseFloat(amount) : null }),
        ...(color && { color }),
      },
    });

    return res.status(200).json({ success: true, data: { ...updated, message: 'Event updated.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/calendar/events/:id
 */
const deleteCalendarEvent = async (req, res, next) => {
  try {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!event) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    }

    await prisma.calendarEvent.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, data: { message: 'Event deleted.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/notifications
 */
const getNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/notifications
 */
const createNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'INFO' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Title and message required.' } });
    }
    const notif = await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: title.trim(),
        message: message.trim(),
        type: type,
        isRead: false,
      },
    });
    return res.status(201).json({ success: true, data: notif });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/notifications/:id/read
 */
const markNotificationRead = async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notif) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    }
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    return res.status(200).json({ success: true, data: { message: 'Marked as read.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/notifications/read-all
 */
const markAllNotificationsRead = async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    return res.status(200).json({ success: true, data: { message: 'All notifications marked as read.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/notifications/:id
 */
const deleteNotification = async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notif) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    }
    await prisma.notification.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, data: { message: 'Notification deleted.' } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/ai/credit-health (Phase 25)
 * Educational credit health assessment based on user-entered cards, loans, and DTI.
 * Strictly avoids fabricating real bureau credit scores (CIBIL/Experian).
 */
const getCreditHealth = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [profile, cards, loans] = await Promise.all([
      prisma.financialProfile.findUnique({ where: { userId } }),
      prisma.card.findMany({ where: { userId, isActive: true } }),
      prisma.loan.findMany({ where: { userId, status: 'ACTIVE' } }),
    ]);

    const monthlySalary = profile ? parseFloat(profile.monthlySalary || 0) : 0;
    const totalDebt = profile ? parseFloat(profile.totalDebt || 0) : 0;

    // Credit cards utilization
    let totalCreditLimit = 0;
    let totalCardOutstanding = 0;
    cards.forEach(c => {
      if (c.cardType === 'CREDIT') {
        totalCreditLimit += c.creditLimit ? parseFloat(c.creditLimit) : 0;
        totalCardOutstanding += parseFloat(c.outstandingAmount || 0);
      }
    });

    const utilizationPct = totalCreditLimit > 0
      ? Math.round((totalCardOutstanding / totalCreditLimit) * 10000) / 100
      : 0;

    // Loan EMIs
    let totalMonthlyEMI = 0;
    let totalLoanOutstanding = 0;
    loans.forEach(l => {
      totalMonthlyEMI += l.emiAmount ? parseFloat(l.emiAmount) : 0;
      totalLoanOutstanding += parseFloat(l.outstandingBalance || 0);
    });

    // Debt to Income
    const dtiPct = monthlySalary > 0
      ? Math.round((totalMonthlyEMI / monthlySalary) * 10000) / 100
      : 0;

    // Evaluate Credit Health Indicators
    const indicators = [];
    let healthTier = 'GOOD';

    if (totalCreditLimit > 0) {
      if (utilizationPct < 30) {
        indicators.push({ factor: 'Credit Card Utilization', status: 'HEALTHY', detail: `${utilizationPct}% utilization (Optimal under 30%)` });
      } else if (utilizationPct <= 50) {
        indicators.push({ factor: 'Credit Card Utilization', status: 'MODERATE', detail: `${utilizationPct}% utilization (Target < 30% for best profile)` });
        if (healthTier === 'EXCELLENT') healthTier = 'GOOD';
      } else {
        indicators.push({ factor: 'Credit Card Utilization', status: 'HIGH_RISK', detail: `${utilizationPct}% utilization exceeds recommended 50% threshold` });
        healthTier = 'NEEDS_ATTENTION';
      }
    } else {
      indicators.push({ factor: 'Credit Card Utilization', status: 'NOT_APPLICABLE', detail: 'No credit cards tracked yet.' });
    }

    if (monthlySalary > 0) {
      if (dtiPct < 25) {
        indicators.push({ factor: 'Debt-to-Income (DTI)', status: 'HEALTHY', detail: `EMI is ${dtiPct}% of monthly income (Comfortable buffer)` });
      } else if (dtiPct <= 45) {
        indicators.push({ factor: 'Debt-to-Income (DTI)', status: 'MODERATE', detail: `EMI is ${dtiPct}% of monthly income (Manageable)` });
        if (healthTier === 'EXCELLENT') healthTier = 'GOOD';
      } else {
        indicators.push({ factor: 'Debt-to-Income (DTI)', status: 'HIGH_RISK', detail: `EMI is ${dtiPct}% of monthly income (Heavy debt burden)` });
        healthTier = 'NEEDS_ATTENTION';
      }
    }

    const creditMix = [];
    if (cards.length > 0) creditMix.push('Revolving Credit (Cards)');
    if (loans.length > 0) creditMix.push('Installment Loans (Personal/Home/Auto)');
    indicators.push({
      factor: 'Credit Mix',
      status: creditMix.length > 1 ? 'DIVERSIFIED' : 'MODERATE',
      detail: creditMix.length > 0 ? creditMix.join(', ') : 'No credit lines active',
    });

    const recommendations = [];
    if (utilizationPct > 30) {
      recommendations.push('Pay down credit card balances to keep utilization strictly under 30% before the billing cycle closing date.');
    }
    if (dtiPct > 40) {
      recommendations.push('Prioritize prepayment or restructuring on high-interest loans to lower your monthly debt servicing ratio below 35%.');
    }
    if (cards.length === 0 && loans.length === 0) {
      recommendations.push('Consider establishing a modest credit card with automatic full monthly payments to build a disciplined credit history.');
    }

    return res.status(200).json({
      success: true,
      data: {
        assessmentType: 'Estimated / Educational Credit Health Assessment',
        isBureauScore: false,
        healthTier, // EXCELLENT | GOOD | FAIR | NEEDS_ATTENTION
        summary: {
          activeCreditCards: cards.filter(c => c.cardType === 'CREDIT').length,
          activeLoans: loans.length,
          totalCreditLimit,
          formattedTotalCreditLimit: formatINR(totalCreditLimit),
          totalCardOutstanding,
          formattedTotalCardOutstanding: formatINR(totalCardOutstanding),
          creditUtilizationPct: utilizationPct,
          totalLoanOutstanding,
          formattedTotalLoanOutstanding: formatINR(totalLoanOutstanding),
          monthlyEMIBurden: totalMonthlyEMI,
          formattedMonthlyEMIBurden: formatINR(totalMonthlyEMI),
          debtToIncomePct: dtiPct,
        },
        indicators,
        recommendations,
        disclaimer: 'This is an estimated educational credit health assessment derived from your recorded debts, cards, and income. It is NOT an official CIBIL/Experian bureau credit score.',
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/analytics/forecast?month=&year=
 * Transparent baseline spending projection from the user's real transactions.
 * Every figure is derived from persisted EXPENSE rows; the method and
 * supporting numbers are returned so the estimate can be explained.
 */
const getForecast = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const parsed = analyticsEngine.parsePeriodInput({ month: req.query.month, year: req.query.year, now });
    if (!parsed.valid) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error } });
    }

    const bounds = analyticsEngine.getMonthBounds(parsed.year, parsed.month);
    const transactions = await prisma.transaction.findMany({
      where: { userId, transactionType: 'EXPENSE', date: { gte: bounds.start, lte: bounds.end } },
      select: ANALYTICS_TX_SELECT,
    });

    const result = analyticsEngine.forecast({ transactions, year: parsed.year, month: parsed.month, now });

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        formattedSpentSoFar: formatINR(result.spentSoFar),
        formattedProjectedExpense: result.projectedExpense === null ? null : formatINR(result.projectedExpense),
        formattedAverageDailySpend: formatINR(result.averageDailySpend),
        categories: result.categories.map((c) => ({
          ...c,
          formattedSpentSoFar: formatINR(c.spentSoFar),
          formattedProjectedExpense: formatINR(c.projectedExpense),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/analytics/insights?month=&year=&warningThreshold=
 * Deterministic, traceable insights. Each entry reports the figures it was
 * derived from, its comparison period and a fact/estimate flag. No figures are
 * invented and no AI provider is required.
 */
const getInsights = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const parsed = analyticsEngine.parsePeriodInput({ month: req.query.month, year: req.query.year, now });
    if (!parsed.valid) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error } });
    }

    const { year, month } = parsed;
    const bounds = analyticsEngine.getMonthBounds(year, month);
    const prev = previousMonthOf(year, month);
    const prevBounds = analyticsEngine.getMonthBounds(prev.year, prev.month);

    const [currentTx, previousTx, budgets] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, date: { gte: bounds.start, lte: bounds.end } },
        select: ANALYTICS_TX_SELECT,
      }),
      prisma.transaction.findMany({
        where: { userId, date: { gte: prevBounds.start, lte: prevBounds.end } },
        select: ANALYTICS_TX_SELECT,
      }),
      prisma.budget.findMany({
        where: { userId, month, year },
        include: { category: { select: { id: true, name: true } } },
      }),
    ]);

    const current = analyticsEngine.summarize(currentTx);
    const previous = analyticsEngine.summarize(previousTx);
    const forecastResult = analyticsEngine.forecast({ transactions: currentTx, year, month, now });
    const budgetEval = analyticsEngine.evaluateBudgets({
      budgets,
      transactions: currentTx,
      previousTransactions: previousTx,
      year,
      month,
      warningThreshold: req.query.warningThreshold,
      now,
    });

    const insights = analyticsEngine.generateInsights({
      current,
      previous,
      budgets: budgetEval.budgets,
      forecast: forecastResult,
      monthLabel: `${month}/${year}`,
      previousLabel: `${prev.month}/${prev.year}`,
    });

    return res.status(200).json({
      success: true,
      data: {
        month,
        year,
        warningThreshold: budgetEval.warningThreshold,
        current: {
          income: current.income,
          expenses: current.expenses,
          netCashFlow: current.netCashFlow,
          savingsRate: current.savingsRate,
          refunds: current.refunds,
          duplicateSuspects: current.duplicateSuspects,
        },
        previous: {
          income: previous.income,
          expenses: previous.expenses,
          netCashFlow: previous.netCashFlow,
          savingsRate: previous.savingsRate,
          refunds: previous.refunds,
        },
        // Exact-duplicate imports are reported, never silently removed from the
        // recorded totals. Only the forecast de-duplicates (and says so).
        duplicates: {
          suspects: current.duplicateSuspects,
          groups: current.duplicateGroups.length,
        },
        // Additive: the identifying detail (date/amount/narration/id) of every
        // flagged group, so the owner can review the suspects themselves. The
        // counts above are unchanged for existing consumers.
        duplicateGroups: current.duplicateGroups,
        monthOverMonth: analyticsEngine.monthOverMonth(current, previous),
        forecast: forecastResult,
        insights,
        note: 'Insights flagged isEstimate are projections based on your recorded transactions, not guarantees.',
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAnalytics,
  getForecast,
  getInsights,
  getFinancialHealth,
  getCreditHealth,
  getCashFlowPrediction,
  getExpenseAnomalies,
  submitAnomalyFeedback,
  getBudgetOptimization,
  getRiskRadar,
  getMonthlyFinancialReport,
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
};

