/**
 * FinPro — Financial Analytics Engine
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * Pure, deterministic, I/O-free financial calculations that are shared by the
 * analytics, budget and AI-insight controllers. The module deliberately has no
 * database, network or clock dependency: callers pass the already
 * user-scoped rows (and, when relevant, `now`) in, and receive plain objects
 * back. This keeps every figure unit-testable and prevents the financial
 * business logic from being duplicated across controllers or the frontend.
 *
 * Conventions (kept consistent with the rest of FinPro):
 *  - classification follows the persisted Transaction.transactionType, the same
 *    way the dashboard/analytics/budget controllers already classify rows;
 *  - INCOME  -> income totals only;
 *  - EXPENSE -> expense totals only;
 *  - REFUND / REVERSAL are explicit simulator rows: they credit the account
 *    and are SUBTRACTED from expenses (they are adjustments, not income).
 *    Legacy INCOME rows whose narration looks like a refund stay inside
 *    income, exactly as before, so historical figures do not move;
 *  - TRANSFER / INVESTMENT / LOAN_PAYMENT are internal or capital movements and
 *    are therefore excluded from both income and expenses (they are reported
 *    separately so nothing is silently dropped);
 *  - a "refund" is an explicit REFUND/REVERSAL row, or an INCOME row whose
 *    narration looks like a refund/cashback/reversal. The latter is counted
 *    inside income (consistent with the existing dashboards) and reported
 *    separately; it is NEVER subtracted from expenses, so nothing is
 *    double-counted.
 *
 * All monetary values returned are plain numbers rounded to 2 decimals.
 */

'use strict';

const SPENDING_TYPES = Object.freeze(['EXPENSE', 'REFUND', 'REVERSAL']);

/**
 * A REFUND/REVERSAL row is a negative spending adjustment. Everything else
 * that reaches the spending projection is a positive EXPENSE.
 */
const signedSpendingAmount = (tx) => {
  const type = String((tx && tx.transactionType) || '').toUpperCase();
  const amount = Math.abs(toNumber(tx && tx.amount));
  return type === 'REFUND' || type === 'REVERSAL' ? -amount : amount;
};

// Refund / cashback narration heuristics (case-insensitive, word-bounded).
const REFUND_PATTERN = /\b(refund|refunded|cashback|reversal|reversed|reverted|chargeback|money\s*back)\b/i;

const UNCATEGORIZED = 'Uncategorized';
const FORECAST_METHOD = 'average_daily_run_rate';

/**
 * Safely coerce any monetary-ish value (number, numeric string, Prisma Decimal)
 * into a finite number. Never returns NaN.
 */
const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value) => {
  const n = toNumber(value);
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

const round1 = (value) => {
  const n = toNumber(value);
  return Math.round((n + Number.EPSILON) * 10) / 10;
};

const normalizeText = (value) =>
  (value === null || value === undefined ? '' : String(value)).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Stable UTC calendar-day key. Transaction.date is a Postgres DATE column, so
 * Prisma materialises it at UTC midnight — the UTC accessor is the correct one
 * and is immune to the server's local timezone.
 */
const dateKeyOf = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const isRefund = (tx) => {
  if (!tx || tx.transactionType !== 'INCOME') return false;
  return REFUND_PATTERN.test(`${tx.description || ''} ${tx.merchant || ''}`);
};

const categoryLabelOf = (tx) => {
  if (!tx) return UNCATEGORIZED;
  const name = (tx.category && tx.category.name) || tx.categoryName;
  const text = (name === null || name === undefined ? '' : String(name)).trim();
  return text || UNCATEGORIZED;
};

const addTo = (map, key, amount) => {
  map.set(key, round2((map.get(key) || 0) + amount));
};

const mapToSortedArray = (map, total) =>
  Array.from(map.entries())
    .map(([category, amount]) => ({
      category,
      amount: round2(amount),
      percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => (b.amount - a.amount) || a.category.localeCompare(b.category));

/**
 * Calendar month boundaries for a 1-based month number.
 *
 * Transaction.date is a Postgres DATE column that Prisma materialises at UTC
 * midnight, and `dateKeyOf` reads it through the UTC accessor. The bounds are
 * therefore built in UTC as well: the local `new Date(year, month, ...)`
 * constructor shifted the window by the server's UTC offset, which dropped the
 * 1st of the month (and leaked the next month's 1st) whenever the server ran
 * west of UTC. UTC keeps the database filter, the forecast and the duplicate
 * key on one calendar regardless of where the server is hosted.
 */
const getMonthBounds = (year, month) => ({
  start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
  end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
});

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * Validate and normalise a requested period. Returns a discriminated result so
 * controllers can map `valid: false` to a 400 without try/catch games.
 */
const parsePeriodInput = ({ month, year, now = new Date() } = {}) => {
  const resolvedMonth = month === undefined || month === null || month === '' ? now.getMonth() + 1 : parseInt(month, 10);
  const resolvedYear = year === undefined || year === null || year === '' ? now.getFullYear() : parseInt(year, 10);

  if (!Number.isInteger(resolvedMonth) || resolvedMonth < 1 || resolvedMonth > 12) {
    return { valid: false, error: 'month must be an integer between 1 and 12' };
  }
  if (!Number.isInteger(resolvedYear) || resolvedYear < 1970 || resolvedYear > 2100) {
    return { valid: false, error: 'year must be an integer between 1970 and 2100' };
  }
  return { valid: true, month: resolvedMonth, year: resolvedYear };
};

/**
 * Exact-duplicate detection.
 *
 * Two rows are considered exact duplicates only when they agree on
 * (calendar day, transaction type, absolute amount, normalised narration).
 * This is intentionally conservative: it catches the classic double-import
 * case (the same ledger line ingested twice) without collapsing genuinely
 * distinct same-day purchases that differ in amount or narration.
 */
const duplicateKeyOf = (tx) =>
  [dateKeyOf(tx && tx.date), (tx && tx.transactionType) || 'EXPENSE', round2(Math.abs(toNumber(tx && tx.amount))), normalizeText(
    `${(tx && tx.description) || ''} ${(tx && tx.merchant) || ''}`
  )].join('|');

/**
 * Minimal, user-readable identity for one row inside a duplicate group.
 *
 * Suspects are surfaced for the owner to review and confirm themselves — FinPro
 * never auto-deletes them — so the report has to carry enough context (id, date,
 * amount, narration) to tell two look-alike rows apart.
 */
const duplicateRowDetail = (tx) => ({
  id: tx && tx.id !== undefined && tx.id !== null ? tx.id : null,
  date: dateKeyOf(tx && tx.date),
  amount: round2(Math.abs(toNumber(tx && tx.amount))),
  transactionType: (tx && tx.transactionType) || 'EXPENSE',
  description: (tx && tx.description) || null,
  merchant: (tx && tx.merchant) || null,
});

const detectExactDuplicates = (transactions = []) => {
  const groups = new Map();
  (Array.isArray(transactions) ? transactions : []).forEach((tx) => {
    const key = duplicateKeyOf(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  });
  return Array.from(groups.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      duplicateCount: rows.length - 1,
      amount: round2(rows.reduce((sum, tx) => sum + Math.abs(toNumber(tx.amount)), 0)),
      // Additive: per-row identity so the owner can review the suspects. The
      // counts above are unchanged, so existing consumers keep working.
      rows: rows.map(duplicateRowDetail),
    }))
    .sort((a, b) => b.duplicateCount - a.duplicateCount);
};

/**
 * Collapse exact duplicates, keeping the first occurrence of each group.
 * Returns both the retained rows and the removed set for transparent reporting.
 */
const dedupeExact = (transactions = []) => {
  const seen = new Set();
  const kept = [];
  const removed = [];
  (Array.isArray(transactions) ? transactions : []).forEach((tx) => {
    const key = duplicateKeyOf(tx);
    if (seen.has(key)) {
      removed.push(tx);
    } else {
      seen.add(key);
      kept.push(tx);
    }
  });
  return { kept, removed };
};

/**
 * Income / expense / cash-flow summary for a set of transactions.
 * Pure function — the caller is responsible for scoping rows to the user and
 * the period.
 */
const summarize = (transactions = []) => {
  const list = Array.isArray(transactions) ? transactions : [];

  let income = 0;
  let expenses = 0;
  let refunds = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  const expensesByCategory = new Map();
  const incomeByCategory = new Map();
  const excluded = {
    transfers: { count: 0, amount: 0 },
    investments: { count: 0, amount: 0 },
    loanPayments: { count: 0, amount: 0 },
  };

  list.forEach((tx) => {
    const amount = Math.abs(toNumber(tx && tx.amount));
    const type = (tx && tx.transactionType) || 'EXPENSE';
    const category = categoryLabelOf(tx);

    if (type === 'INCOME') {
      income = round2(income + amount);
      incomeCount += 1;
      if (isRefund(tx)) refunds = round2(refunds + amount);
      addTo(incomeByCategory, category, amount);
      return;
    }

    if (type === 'EXPENSE') {
      expenses = round2(expenses + amount);
      expenseCount += 1;
      addTo(expensesByCategory, category, amount);
      return;
    }

    if (type === 'REFUND' || type === 'REVERSAL') {
      // Explicit simulator adjustment: reduce net spending, never income.
      expenses = round2(expenses - amount);
      refunds = round2(refunds + amount);
      expenseCount += 1;
      addTo(expensesByCategory, category, -amount);
      return;
    }

    // TRANSFER / INVESTMENT / LOAN_PAYMENT — excluded from income & expenses.
    const bucket = type === 'TRANSFER' ? 'transfers' : type === 'INVESTMENT' ? 'investments' : 'loanPayments';
    excluded[bucket].count += 1;
    excluded[bucket].amount = round2(excluded[bucket].amount + amount);
  });

  const netCashFlow = round2(income - expenses);
  const savings = netCashFlow;
  const savingsRate = income > 0 ? round1((savings / income) * 100) : null;
  const duplicates = detectExactDuplicates(list);

  return {
    income,
    expenses,
    netCashFlow,
    savings,
    savingsRate,
    refunds,
    incomeCount,
    expenseCount,
    transactionCount: list.length,
    expensesByCategory: mapToSortedArray(expensesByCategory, expenses),
    incomeByCategory: mapToSortedArray(incomeByCategory, income),
    excluded,
    duplicateSuspects: duplicates.reduce((sum, g) => sum + g.duplicateCount, 0),
    duplicateGroups: duplicates,
    isEmpty: incomeCount === 0 && expenseCount === 0,
  };
};

/**
 * Month-over-month comparison between two summaries.
 * Percentages are null when there is no comparable baseline (previous = 0).
 */
const monthOverMonth = (current, previous) => {
  const build = (prevValue, curValue) => {
    const prev = toNumber(prevValue);
    const cur = toNumber(curValue);
    const absolute = round2(cur - prev);
    return {
      previous: round2(prev),
      current: round2(cur),
      absoluteChange: absolute,
      percentageChange: prev > 0 ? round1((absolute / prev) * 100) : null,
      direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat',
    };
  };

  const cur = current || summarize([]);
  const prev = previous || summarize([]);

  const savingsRateChange =
    cur.savingsRate !== null && prev.savingsRate !== null ? round1(cur.savingsRate - prev.savingsRate) : null;

  return {
    comparisonPeriod: 'previous calendar month',
    incomeChange: build(prev.income, cur.income),
    expenseChange: build(prev.expenses, cur.expenses),
    netCashFlowChange: build(prev.netCashFlow, cur.netCashFlow),
    savings: build(prev.savings, cur.savings),
    savingsRateChange,
    savingsRateCurrent: cur.savingsRate,
    savingsRatePrevious: prev.savingsRate,
  };
};

/**
 * Transparent baseline spending forecast.
 *
 * Method: linear average-daily run rate over the elapsed days of the target
 * calendar month, projected to the full month length. Handles partial current
 * months (only days already elapsed contribute) and complete past months
 * (projection equals the realised total). Internal transfers, investments and
 * loan payments are excluded (only EXPENSE rows are projected) and exact
 * duplicates are removed before aggregation so a double import cannot inflate
 * the estimate.
 */
const forecast = ({ transactions = [], year, month, now = new Date() } = {}) => {
  const period = parsePeriodInput({ month, year, now });
  if (!period.valid) {
    return { valid: false, error: period.error };
  }

  const { month: m, year: y } = period;
  const totalDays = daysInMonth(y, m);
  const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  const isPastMonth = new Date(y, m - 1, 1, 0, 0, 0, 0) < new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const isFutureMonth = !isCurrentMonth && !isPastMonth;

  if (isFutureMonth) {
    return {
      valid: true,
      method: FORECAST_METHOD,
      methodLabel: 'Linear average daily run rate',
      isEstimate: true,
      label: 'Estimate — insufficient history for a future month.',
      insufficientData: true,
      reason: 'future_month',
      month: m,
      year: y,
      daysInMonth: totalDays,
      elapsedDays: 0,
      remainingDays: totalDays,
      spentSoFar: 0,
      averageDailySpend: 0,
      projectedExpense: null,
      transactionCount: 0,
      duplicatesExcluded: 0,
      isCompleteMonth: false,
      categories: [],
    };
  }

  const { start, end } = getMonthBounds(y, m);
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDays;
  // UTC-aligned so the "as of" window matches `getMonthBounds` and the
  // DATE-at-UTC-midnight rows Prisma returns.
  const asOfEnd = isCurrentMonth ? new Date(Date.UTC(y, m - 1, now.getDate(), 23, 59, 59, 999)) : end;

  // Spending rows only (expenses plus explicit refund/reversal adjustments);
  // scoped to the month and (for the current month) to days that have already
  // elapsed.
  const monthExpenses = (Array.isArray(transactions) ? transactions : []).filter((tx) => {
    if (!tx || !SPENDING_TYPES.includes(String(tx.transactionType || '').toUpperCase())) return false;
    const d = tx.date instanceof Date ? tx.date : new Date(tx.date);
    if (Number.isNaN(d.getTime())) return false;
    return d >= start && d <= asOfEnd;
  });

  const { kept, removed } = dedupeExact(monthExpenses);
  const spentSoFar = round2(kept.reduce((sum, tx) => sum + signedSpendingAmount(tx), 0));
  const insufficientData = kept.length === 0;
  const averageDailySpend = elapsedDays > 0 ? round2(spentSoFar / elapsedDays) : 0;
  const projectedExpense = insufficientData ? 0 : round2(averageDailySpend * totalDays);

  const categoryMap = new Map();
  kept.forEach((tx) => addTo(categoryMap, categoryLabelOf(tx), signedSpendingAmount(tx)));
  const categories = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      spentSoFar: round2(amount),
      projectedExpense: elapsedDays > 0 ? round2((amount / elapsedDays) * totalDays) : 0,
      transactionCount: kept.filter((tx) => categoryLabelOf(tx) === category).length,
    }))
    .sort((a, b) => b.spentSoFar - a.spentSoFar);

  return {
    valid: true,
    method: FORECAST_METHOD,
    methodLabel: 'Linear average daily run rate',
    isEstimate: true,
    label: 'Estimate based on your actual spending to date — not a guarantee.',
    insufficientData,
    reason: insufficientData ? 'no_expenses_recorded' : null,
    month: m,
    year: y,
    daysInMonth: totalDays,
    elapsedDays,
    remainingDays: Math.max(0, totalDays - elapsedDays),
    spentSoFar,
    averageDailySpend,
    projectedExpense,
    transactionCount: kept.length,
    duplicatesExcluded: removed.length,
    isCompleteMonth: !isCurrentMonth,
    categories,
  };
};

/**
 * Budget evaluation: actuals, utilisation, remaining, configurable warning
 * thresholds, an over-budget flag, a projected month-end overspend and a
 * month-over-month comparison — all computed from the caller-supplied rows.
 */
const normalizeThreshold = (value, fallback = 80) => {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.round(parsed)));
};

const budgetMatchesTransaction = (budget, tx) => {
  if (budget.categoryId && tx.categoryId) return budget.categoryId === tx.categoryId;
  const budgetName = normalizeText(budget.categoryName || (budget.category && budget.category.name));
  const txName = normalizeText(tx.category && tx.category.name);
  return budgetName !== '' && budgetName === txName;
};

const evaluateBudgets = ({
  budgets = [],
  transactions = [],
  previousTransactions = [],
  year,
  month,
  warningThreshold = 80,
  now = new Date(),
} = {}) => {
  const threshold = normalizeThreshold(warningThreshold);
  const list = Array.isArray(budgets) ? budgets : [];

  const txExpenses = (Array.isArray(transactions) ? transactions : []).filter(
    (tx) => tx && SPENDING_TYPES.includes(String(tx.transactionType || '').toUpperCase())
  );
  const prevExpenses = (Array.isArray(previousTransactions) ? previousTransactions : []).filter(
    (tx) => tx && SPENDING_TYPES.includes(String(tx.transactionType || '').toUpperCase())
  );

  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const totalDays = daysInMonth(year, month);
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDays;

  const enriched = list.map((budget) => {
    const limit = round2(toNumber(budget.monthlyLimit));
    // Signed sum: an EXPENSE adds, a REFUND/REVERSAL subtracts. Budget spend
    // is never shown as negative — a period whose refunds exceed its expenses
    // is simply 0% used, not a negative percentage.
    const spent = round2(
      Math.max(
        0,
        txExpenses.reduce(
          (sum, tx) => (budgetMatchesTransaction(budget, tx) ? sum + signedSpendingAmount(tx) : sum),
          0
        )
      )
    );
    const previousSpent = round2(
      Math.max(
        0,
        prevExpenses.reduce(
          (sum, tx) => (budgetMatchesTransaction(budget, tx) ? sum + signedSpendingAmount(tx) : sum),
          0
        )
      )
    );

    const percentageUsed = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const remainingRaw = round2(limit - spent);
    const projectedSpent = elapsedDays > 0 ? round2((spent / elapsedDays) * totalDays) : spent;

    let status = 'ok';
    if (percentageUsed >= 100) status = 'exceeded';
    else if (percentageUsed >= 90) status = 'alert';
    else if (percentageUsed >= threshold) status = 'warning';

    const changeAmount = round2(spent - previousSpent);

    return {
      id: budget.id,
      categoryId: budget.categoryId || null,
      category: (budget.category && budget.category.name) || budget.categoryName || 'General',
      categoryName: (budget.category && budget.category.name) || budget.categoryName || 'General',
      monthlyLimit: limit,
      spent,
      remaining: Math.max(0, remainingRaw),
      remainingRaw,
      percentageUsed,
      status,
      overBudget: spent > limit,
      warningThreshold: threshold,
      previousMonthSpent: previousSpent,
      changeAmount,
      changePercentage: previousSpent > 0 ? round1((changeAmount / previousSpent) * 100) : null,
      changeDirection: changeAmount > 0 ? 'up' : changeAmount < 0 ? 'down' : 'flat',
      projectedMonthEndSpent: isCurrentMonth ? projectedSpent : spent,
      projectedOverBudget: (isCurrentMonth ? projectedSpent : spent) > limit,
      month,
      year,
    };
  });

  const sum = (key) => round2(enriched.reduce((acc, b) => acc + toNumber(b[key]), 0));

  return {
    budgets: enriched,
    warningThreshold: threshold,
    summary: {
      totalBudgeted: sum('monthlyLimit'),
      totalSpent: sum('spent'),
      totalRemaining: round2(Math.max(0, sum('monthlyLimit') - sum('spent'))),
      totalRemainingRaw: round2(sum('monthlyLimit') - sum('spent')),
      totalPreviousMonthSpent: sum('previousMonthSpent'),
      totalProjectedMonthEndSpent: sum('projectedMonthEndSpent'),
      overBudgetCount: enriched.filter((b) => b.overBudget).length,
      warningCount: enriched.filter((b) => ['warning', 'alert', 'exceeded'].includes(b.status)).length,
    },
  };
};

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/**
 * Deterministic, traceable insights. Every insight carries the figures it was
 * derived from, the comparison period, and an explicit fact/estimate flag.
 */
const generateInsights = ({ current, previous, budgets, forecast: forecastResult, monthLabel, previousLabel } = {}) => {
  const cur = current || summarize([]);
  const prev = previous || summarize([]);
  const budgetList = Array.isArray(budgets) ? budgets : [];
  const insights = [];
  const comparison = previousLabel && monthLabel ? `${monthLabel} vs ${previousLabel}` : 'current vs previous month';

  budgetList.forEach((budget) => {
    if (budget.overBudget) {
      const over = round2(budget.spent - budget.monthlyLimit);
      insights.push({
        type: 'CATEGORY_OVER_BUDGET',
        severity: 'critical',
        category: budget.category,
        title: `${budget.category} is over budget`,
        explanation: `You have spent ${budget.percentageUsed}% of the ${budget.category} budget.`,
        values: {
          spent: budget.spent,
          monthlyLimit: budget.monthlyLimit,
          overBy: over,
          percentageUsed: budget.percentageUsed,
        },
        comparisonPeriod: monthLabel || 'this month',
        isEstimate: false,
      });
    } else if (budget.status === 'warning' || budget.status === 'alert') {
      insights.push({
        type: 'CATEGORY_BUDGET_WARNING',
        severity: 'warning',
        category: budget.category,
        title: `${budget.category} is nearing its budget`,
        explanation: `${budget.percentageUsed}% of the ${budget.category} budget is used (warning threshold ${budget.warningThreshold}%).`,
        values: {
          spent: budget.spent,
          monthlyLimit: budget.monthlyLimit,
          remaining: budget.remaining,
          percentageUsed: budget.percentageUsed,
          warningThreshold: budget.warningThreshold,
        },
        comparisonPeriod: monthLabel || 'this month',
        isEstimate: false,
      });
    }
  });

  // Category-level month-over-month increases (facts).
  const prevByCategory = new Map(prev.expensesByCategory.map((c) => [c.category, c.amount]));
  cur.expensesByCategory.forEach((row) => {
    const previousAmount = toNumber(prevByCategory.get(row.category));
    if (previousAmount <= 0) return;
    const change = round2(row.amount - previousAmount);
    const changePercentage = round1((change / previousAmount) * 100);
    if (change > 0 && changePercentage >= 10) {
      insights.push({
        type: 'CATEGORY_SPEND_INCREASED',
        severity: 'warning',
        category: row.category,
        title: `${row.category} spending increased`,
        explanation: `${row.category} spending rose ${changePercentage}% compared with the previous month.`,
        values: { current: row.amount, previous: previousAmount, changeAmount: change, changePercentage },
        comparisonPeriod: comparison,
        isEstimate: false,
      });
    }
  });

  // Overall month-over-month (facts).
  const expenseChange = round2(cur.expenses - prev.expenses);
  if (prev.expenses > 0 && expenseChange > 0) {
    insights.push({
      type: 'MONTHLY_EXPENSES_UP',
      severity: 'info',
      title: 'Total expenses are higher than last month',
      explanation: `Total expenses of your current month are ${round1((expenseChange / prev.expenses) * 100)}% higher than the previous month.`,
      values: { current: cur.expenses, previous: prev.expenses, changeAmount: expenseChange },
      comparisonPeriod: comparison,
      isEstimate: false,
    });
  }

  // Negative cash flow (fact derived from recorded rows).
  if (cur.savingsRate !== null && cur.netCashFlow < 0) {
    insights.push({
      type: 'NEGATIVE_CASH_FLOW',
      severity: 'critical',
      title: 'Expenses exceed income',
      explanation: `You spent more than you earned — net cash flow is negative for the period.`,
      values: { income: cur.income, expenses: cur.expenses, netCashFlow: cur.netCashFlow },
      comparisonPeriod: monthLabel || 'this month',
      isEstimate: false,
    });
  }

  // Spending-pace estimate vs total budget (estimate).
  if (forecastResult && forecastResult.projectedExpense !== null && budgetList.length > 0) {
    const totalBudget = round2(budgetList.reduce((sum, b) => sum + toNumber(b.monthlyLimit), 0));
    if (totalBudget > 0 && forecastResult.projectedExpense > totalBudget) {
      insights.push({
        type: 'SPENDING_PACE_EXCEEDS_BUDGET',
        severity: 'warning',
        title: 'Projected spending may exceed your budget',
        explanation: `At the current pace you are projected to spend more than your total budget by month end.`,
        values: {
          projectedExpense: forecastResult.projectedExpense,
          totalBudget,
          projectedOverBy: round2(forecastResult.projectedExpense - totalBudget),
          elapsedDays: forecastResult.elapsedDays,
          daysInMonth: forecastResult.daysInMonth,
        },
        comparisonPeriod: monthLabel || 'this month',
        isEstimate: true,
      });
    }
  }

  return insights.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.type.localeCompare(b.type));
};

/**
 * Signed total for rows that carry `transactionType` and either a plain
 * `amount` or a Prisma `_sum.amount`. REFUND/REVERSAL rows subtract, which is
 * what makes net spending fall after a simulated refund. Used by the controllers
 * that aggregate in the database rather than through `forecast`/`summarize`.
 */
const signedTotal = (rows) =>
  round2(
    (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
      if (!row) return sum;
      const type = String(row.transactionType || '').toUpperCase();
      const raw = row.amount !== undefined ? row.amount : row._sum && row._sum.amount;
      const amount = Math.abs(toNumber(raw));
      return sum + (type === 'REFUND' || type === 'REVERSAL' ? -amount : amount);
    }, 0)
  );

module.exports = {
  SPENDING_TYPES,
  signedSpendingAmount,
  signedTotal,
  toNumber,
  round2,
  round1,
  isRefund,
  getMonthBounds,
  daysInMonth,
  parsePeriodInput,
  detectExactDuplicates,
  dedupeExact,
  summarize,
  monthOverMonth,
  forecast,
  normalizeThreshold,
  evaluateBudgets,
  generateInsights,
};
