/**
 * Financial Analytics Engine — unit tests.
 *
 * The engine is pure (no DB, no network, no implicit clock), so every case here
 * is deterministic: rows and `now` are supplied explicitly.
 */

const engine = require('../services/analyticsEngine');

const tx = (over) => ({
  amount: 0,
  transactionType: 'EXPENSE',
  // Prisma returns DATE columns at UTC midnight, so fixtures do too — this keeps
  // the month-window assertions independent of the machine's timezone.
  date: new Date(Date.UTC(2026, 3, 1)),
  description: null,
  merchant: null,
  category: null,
  ...over,
});

const mk = (year, month, day, amount, over = {}) =>
  tx({ amount, date: new Date(Date.UTC(year, month - 1, day)), ...over });

describe('analyticsEngine — helpers', () => {
  it('coerces numbers, numeric strings and Prisma-Decimal-like values safely', () => {
    expect(engine.toNumber(12.345)).toBeCloseTo(12.345);
    expect(engine.toNumber('4,000'.replace(',', ''))).toBe(4000);
    expect(engine.toNumber({ toString: () => '99.5' })).toBe(99.5);
    expect(engine.toNumber(undefined)).toBe(0);
    expect(engine.toNumber('not-a-number')).toBe(0);
    expect(engine.toNumber(Infinity)).toBe(0);
  });

  it('computes UTC-aligned calendar month boundaries and month lengths (leap-aware)', () => {
    const { start, end } = engine.getMonthBounds(2026, 4);
    // UTC anchoring is the whole point: the window must not drift with the
    // server's local offset (it used to drop the 1st west of UTC).
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-30T23:59:59.999Z');
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(3);
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCDate()).toBe(30);

    expect(engine.daysInMonth(2026, 2)).toBe(28);
    expect(engine.daysInMonth(2024, 2)).toBe(29);
    expect(engine.daysInMonth(2026, 1)).toBe(31);
    expect(engine.daysInMonth(2026, 4)).toBe(30);
  });

  it('keeps the day-1 and month-end rows inside the window regardless of server offset', () => {
    // These are exactly the rows Prisma hands back for a DATE column.
    const firstOfMonth = new Date(Date.UTC(2026, 3, 1));
    const lastOfMonth = new Date(Date.UTC(2026, 3, 30));
    const beforeMonth = new Date(Date.UTC(2026, 2, 31));
    const afterMonth = new Date(Date.UTC(2026, 4, 1));
    const { start, end } = engine.getMonthBounds(2026, 4);

    expect(firstOfMonth >= start && firstOfMonth <= end).toBe(true);
    expect(lastOfMonth >= start && lastOfMonth <= end).toBe(true);
    expect(beforeMonth >= start).toBe(false);
    expect(afterMonth <= end).toBe(false);
  });

  it('validates period input', () => {
    expect(engine.parsePeriodInput({ month: 0, year: 2026 }).valid).toBe(false);
    expect(engine.parsePeriodInput({ month: 13, year: 2026 }).valid).toBe(false);
    expect(engine.parsePeriodInput({ month: 5, year: 1800 }).valid).toBe(false);
    expect(engine.parsePeriodInput({ month: 'abc', year: 2026 }).valid).toBe(false);
    const ok = engine.parsePeriodInput({ month: '7', year: '2026' });
    expect(ok).toMatchObject({ valid: true, month: 7, year: 2026 });
  });
});

describe('analyticsEngine — summarize()', () => {
  it('totals income and expenses separately and never counts income as expense', () => {
    const s = engine.summarize([
      tx({ amount: 90000, transactionType: 'INCOME', category: { name: 'Salary' } }),
      tx({ amount: 5000, transactionType: 'EXPENSE', category: { name: 'Food' } }),
      tx({ amount: 3000, transactionType: 'EXPENSE', category: { name: 'Food' } }),
    ]);
    expect(s.income).toBe(90000);
    expect(s.expenses).toBe(8000);
    expect(s.incomeCount).toBe(1);
    expect(s.expenseCount).toBe(2);
  });

  it('computes net cash flow and savings rate', () => {
    const s = engine.summarize([
      tx({ amount: 100000, transactionType: 'INCOME' }),
      tx({ amount: 25000, transactionType: 'EXPENSE' }),
    ]);
    expect(s.netCashFlow).toBe(75000);
    expect(s.savings).toBe(75000);
    expect(s.savingsRate).toBe(75);
  });

  it('returns a null savings rate when there is no income (avoids divide-by-zero)', () => {
    const s = engine.summarize([tx({ amount: 500 })]);
    expect(s.savingsRate).toBeNull();
    expect(s.netCashFlow).toBe(-500);
  });

  it('reports category totals with percentages, sorted by amount', () => {
    const s = engine.summarize([
      tx({ amount: 6000, category: { name: 'Food' } }),
      tx({ amount: 3000, category: { name: 'Travel' } }),
      tx({ amount: 1000, category: { name: 'Food' } }),
      tx({ amount: 500, category: null }),
    ]);
    expect(s.expensesByCategory[0]).toMatchObject({ category: 'Food', amount: 7000, percentage: 67 });
    expect(s.expensesByCategory[1]).toMatchObject({ category: 'Travel', amount: 3000, percentage: 29 });
    expect(s.expensesByCategory[2]).toMatchObject({ category: 'Uncategorized', amount: 500, percentage: 5 });
    const total = s.expensesByCategory.reduce((a, c) => a + c.amount, 0);
    expect(total).toBe(10500);
  });

  it('handles an empty history', () => {
    const s = engine.summarize([]);
    expect(s.isEmpty).toBe(true);
    expect(s.income).toBe(0);
    expect(s.expenses).toBe(0);
    expect(s.netCashFlow).toBe(0);
    expect(s.savingsRate).toBeNull();
    expect(s.expensesByCategory).toEqual([]);
  });

  it('counts refunds inside income but never reduces expenses with them', () => {
    const s = engine.summarize([
      tx({ amount: 20000, transactionType: 'EXPENSE', category: { name: 'Shopping' } }),
      tx({ amount: 2000, transactionType: 'INCOME', description: 'REFUND for order 881', category: { name: 'Shopping' } }),
    ]);
    expect(s.income).toBe(2000);
    expect(s.expenses).toBe(20000); // refund does NOT net against expenses
    expect(s.refunds).toBe(2000);
    expect(s.netCashFlow).toBe(-18000);
  });

  it('excludes internal transfers, investments and loan payments from income/expense', () => {
    const s = engine.summarize([
      tx({ amount: 50000, transactionType: 'INCOME' }),
      tx({ amount: 10000, transactionType: 'EXPENSE' }),
      tx({ amount: 15000, transactionType: 'TRANSFER' }),
      tx({ amount: 8000, transactionType: 'INVESTMENT' }),
      tx({ amount: 12000, transactionType: 'LOAN_PAYMENT' }),
    ]);
    expect(s.income).toBe(50000);
    expect(s.expenses).toBe(10000);
    expect(s.excluded.transfers).toEqual({ count: 1, amount: 15000 });
    expect(s.excluded.investments).toEqual({ count: 1, amount: 8000 });
    expect(s.excluded.loanPayments).toEqual({ count: 1, amount: 12000 });
  });

  it('flags exact duplicates without dropping them from the summary totals', () => {
    const dup = { amount: 1000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 3)), description: 'UPI/PAID TO CAFE' };
    const s = engine.summarize([dup, { ...dup }, tx({ amount: 500, date: new Date(Date.UTC(2026, 3, 4)) })]);
    expect(s.duplicateSuspects).toBe(1);
    expect(s.duplicateGroups).toHaveLength(1);
    // Summaries remain a faithful reflection of persisted rows.
    expect(s.expenses).toBe(2500);
  });
});

describe('analyticsEngine — duplicate detection', () => {
  it('groups only rows identical on day, type, amount and normalised narration', () => {
    const a = { amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Swiggy' };
    const b = { ...a, description: '  swiggy ' }; // same narration after normalisation
    const c = { amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Zomato' };
    const groups = engine.detectExactDuplicates([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].duplicateCount).toBe(1);
  });

  it('does not collapse genuinely distinct same-day purchases', () => {
    const a = { amount: 100, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Tea' };
    const b = { amount: 100, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Coffee' };
    expect(engine.detectExactDuplicates([a, b])).toHaveLength(0);
  });

  it('dedupeExact keeps the first occurrence and reports the removed rows', () => {
    const rows = [
      { amount: 9, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'x' },
      { amount: 9, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'x' },
      { amount: 9, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'x' },
    ];
    const { kept, removed } = engine.dedupeExact(rows);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(2);
  });

  it('carries per-row identity so a person can review the suspects', () => {
    const a = { id: 'tx_a', amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Swiggy', merchant: 'Swiggy' };
    const b = { id: 'tx_b', amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Swiggy', merchant: 'Swiggy' };
    const groups = engine.detectExactDuplicates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].rows[0]).toMatchObject({
      id: 'tx_a',
      date: '2026-04-01',
      amount: 500,
      transactionType: 'EXPENSE',
      description: 'Swiggy',
      merchant: 'Swiggy',
    });
    expect(groups[0].rows.map((r) => r.id)).toEqual(['tx_a', 'tx_b']);
  });
});

describe('analyticsEngine — monthOverMonth()', () => {
  it('computes absolute and percentage changes and directions', () => {
    const current = engine.summarize([
      tx({ amount: 60000, transactionType: 'INCOME' }),
      tx({ amount: 40000, transactionType: 'EXPENSE' }),
    ]);
    const previous = engine.summarize([
      tx({ amount: 50000, transactionType: 'INCOME' }),
      tx({ amount: 30000, transactionType: 'EXPENSE' }),
    ]);
    const mom = engine.monthOverMonth(current, previous);
    expect(mom.incomeChange).toMatchObject({ current: 60000, previous: 50000, absoluteChange: 10000, percentageChange: 20, direction: 'up' });
    expect(mom.expenseChange).toMatchObject({ absoluteChange: 10000, percentageChange: 33.3, direction: 'up' });
    expect(mom.savingsRateCurrent).toBe(33.3);
    expect(mom.savingsRatePrevious).toBe(40);
    expect(mom.savingsRateChange).toBe(-6.7);
  });

  it('returns a null percentage when the previous period has no baseline', () => {
    const current = engine.summarize([tx({ amount: 500 })]);
    const previous = engine.summarize([]);
    const mom = engine.monthOverMonth(current, previous);
    expect(mom.expenseChange.percentageChange).toBeNull();
    expect(mom.expenseChange.direction).toBe('up');
  });
});

describe('analyticsEngine — forecast()', () => {
  it('projects a 20-day elapsed run rate to a 30-day month (illustrative 18000 → 27000)', () => {
    const rows = [];
    // 20 days × 900 = 18000 within April (30 days), viewed on day 20.
    for (let day = 1; day <= 20; day += 1) rows.push(mk(2026, 4, day, 900));
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 20, 12) });
    expect(f.spentSoFar).toBe(18000);
    expect(f.elapsedDays).toBe(20);
    expect(f.daysInMonth).toBe(30);
    expect(f.averageDailySpend).toBe(900);
    expect(f.projectedExpense).toBe(27000);
    expect(f.isEstimate).toBe(true);
    expect(f.method).toBe('average_daily_run_rate');
  });

  it('handles different month lengths', () => {
    const rows = [mk(2026, 2, 1, 1400)]; // February (28 days), day 1
    const f = engine.forecast({ transactions: rows, year: 2026, month: 2, now: new Date(2026, 1, 1, 12) });
    expect(f.daysInMonth).toBe(28);
    expect(f.projectedExpense).toBe(39200); // 1400 × 28

    const leapRows = [mk(2024, 2, 1, 1000)];
    const leap = engine.forecast({ transactions: leapRows, year: 2024, month: 2, now: new Date(2024, 1, 1, 12) });
    expect(leap.daysInMonth).toBe(29);
    expect(leap.projectedExpense).toBe(29000);
  });

  it('treats complete past months as realised (projection equals actual)', () => {
    const rows = [mk(2026, 1, 5, 20000), mk(2026, 1, 20, 11000)];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 1, now: new Date(2026, 1, 10, 12) });
    expect(f.isCompleteMonth).toBe(true);
    expect(f.spentSoFar).toBe(31000);
    expect(f.projectedExpense).toBe(31000);
    expect(f.elapsedDays).toBe(31);
  });

  it('ignores transactions dated after the elapsed day of the current month', () => {
    const rows = [mk(2026, 4, 1, 1000), mk(2026, 4, 19, 5000)];
    // Viewed on day 10 — the day-19 row is in the future and must be ignored.
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 10, 12) });
    expect(f.spentSoFar).toBe(1000);
    expect(f.elapsedDays).toBe(10);
    expect(f.projectedExpense).toBe(3000);
  });

  it('returns insufficient data (not a fabricated number) with zero spending', () => {
    const f = engine.forecast({ transactions: [], year: 2026, month: 4, now: new Date(2026, 3, 15, 12) });
    expect(f.insufficientData).toBe(true);
    expect(f.projectedExpense).toBe(0);
    expect(f.averageDailySpend).toBe(0);
    expect(f.transactionCount).toBe(0);
  });

  it('returns insufficient data for a future month', () => {
    const f = engine.forecast({ transactions: [], year: 2026, month: 6, now: new Date(2026, 3, 15, 12) });
    expect(f.insufficientData).toBe(true);
    expect(f.reason).toBe('future_month');
    expect(f.projectedExpense).toBeNull();
  });

  it('excludes internal transfers, investments and loan payments from the projection', () => {
    const rows = [
      mk(2026, 4, 1, 1000, { transactionType: 'EXPENSE' }),
      mk(2026, 4, 2, 50000, { transactionType: 'TRANSFER' }),
      mk(2026, 4, 3, 20000, { transactionType: 'INVESTMENT' }),
      mk(2026, 4, 4, 15000, { transactionType: 'LOAN_PAYMENT' }),
    ];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 10, 12) });
    expect(f.spentSoFar).toBe(1000);
    expect(f.transactionCount).toBe(1);
  });

  it('does not let a refund shrink expense projections', () => {
    const rows = [
      mk(2026, 4, 1, 2000, { transactionType: 'EXPENSE' }),
      mk(2026, 4, 2, 1500, { transactionType: 'INCOME', description: 'REFUND order 12' }),
    ];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 10, 12) });
    expect(f.spentSoFar).toBe(2000);
    expect(f.projectedExpense).toBe(6000);
  });

  it('removes exact duplicate imports before projecting', () => {
    const duplicate = mk(2026, 4, 1, 500, { description: 'UPI/PAID TO STORE' });
    const rows = [duplicate, { ...duplicate }, mk(2026, 4, 2, 1000)];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 2, 12) });
    expect(f.duplicatesExcluded).toBe(1);
    expect(f.spentSoFar).toBe(1500); // 500 + 1000, not 2000
    expect(f.averageDailySpend).toBe(750);
    expect(f.projectedExpense).toBe(22500);
  });

  it('produces per-category projections', () => {
    const rows = [
      mk(2026, 4, 1, 600, { category: { name: 'Food' } }),
      mk(2026, 4, 2, 600, { category: { name: 'Food' } }),
      mk(2026, 4, 2, 300, { category: { name: 'Travel' } }),
    ];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 2, 12) });
    const food = f.categories.find((c) => c.category === 'Food');
    expect(food.spentSoFar).toBe(1200);
    expect(food.projectedExpense).toBe(18000); // 1200/2×30
    expect(f.projectedExpense).toBe(22500); // (1500/2)×30
  });

  it('reconciles category projections with the overall projection (duplicates excluded exactly once)', () => {
    const duplicate = mk(2026, 4, 1, 500, { description: 'UPI/PAID TO STORE', category: { name: 'Food' } });
    const rows = [
      duplicate,
      { ...duplicate }, // exact duplicate — must be excluded from both views
      mk(2026, 4, 2, 1000, { category: { name: 'Travel' } }),
    ];
    const f = engine.forecast({ transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 10, 12) });

    expect(f.duplicatesExcluded).toBe(1);
    const categorySpent = f.categories.reduce((sum, c) => sum + c.spentSoFar, 0);
    const categoryProjected = f.categories.reduce((sum, c) => sum + c.projectedExpense, 0);
    // One set of rows drives both views, so the parts must add up to the whole —
    // a divergence would mean a category-level path deduped independently.
    expect(categorySpent).toBe(f.spentSoFar);
    expect(categoryProjected).toBeCloseTo(f.projectedExpense, 6);
  });
});

describe('analyticsEngine — evaluateBudgets()', () => {
  const budget = (over) => ({ id: 'b1', categoryId: 'c1', categoryName: 'Food', monthlyLimit: 10000, category: { id: 'c1', name: 'Food' }, ...over });

  it('computes utilisation, remaining and over-budget status', () => {
    const rows = [mk(2026, 4, 1, 12000, { categoryId: 'c1', category: { name: 'Food' } })];
    const result = engine.evaluateBudgets({ budgets: [budget()], transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 30, 12) });
    const b = result.budgets[0];
    expect(b.spent).toBe(12000);
    expect(b.percentageUsed).toBe(120);
    expect(b.status).toBe('exceeded');
    expect(b.overBudget).toBe(true);
    expect(b.remaining).toBe(0);
    expect(b.remainingRaw).toBe(-2000);
  });

  it('applies a configurable warning threshold', () => {
    const rows = [mk(2026, 4, 1, 8200, { categoryId: 'c1', category: { name: 'Food' } })];
    const at80 = engine.evaluateBudgets({ budgets: [budget()], transactions: rows, year: 2026, month: 4, warningThreshold: 80, now: new Date(2026, 3, 30, 12) });
    expect(at80.budgets[0].status).toBe('warning');
    const at90 = engine.evaluateBudgets({ budgets: [budget()], transactions: rows, year: 2026, month: 4, warningThreshold: 90, now: new Date(2026, 3, 30, 12) });
    expect(at90.budgets[0].status).toBe('ok');
  });

  it('clamps the warning threshold to 1..100 with a sane default', () => {
    expect(engine.normalizeThreshold('150')).toBe(100);
    expect(engine.normalizeThreshold('-5')).toBe(1);
    expect(engine.normalizeThreshold('abc')).toBe(80);
    expect(engine.normalizeThreshold(undefined, 75)).toBe(75);
  });

  it('matches category spend by id or (case-insensitive) name', () => {
    const rows = [mk(2026, 4, 2, 4000, { categoryId: null, category: { name: 'food' } })];
    const result = engine.evaluateBudgets({ budgets: [budget()], transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 30, 12) });
    expect(result.budgets[0].spent).toBe(4000);
  });

  it('does not attribute other categories, income, or transfers to a budget', () => {
    const rows = [
      mk(2026, 4, 1, 1000, { categoryId: 'c1', category: { name: 'Food' } }),
      mk(2026, 4, 1, 9999, { categoryId: 'c2', category: { name: 'Travel' } }),
      mk(2026, 4, 1, 9999, { transactionType: 'INCOME', category: { name: 'Food' } }),
      mk(2026, 4, 1, 9999, { transactionType: 'TRANSFER', category: { name: 'Food' } }),
    ];
    const result = engine.evaluateBudgets({ budgets: [budget()], transactions: rows, year: 2026, month: 4, now: new Date(2026, 3, 30, 12) });
    expect(result.budgets[0].spent).toBe(1000);
  });

  it('compares with the previous period and projects month end', () => {
    const current = [mk(2026, 4, 1, 3000, { categoryId: 'c1', category: { name: 'Food' } })];
    const previous = [mk(2026, 3, 1, 2000, { categoryId: 'c1', category: { name: 'Food' } })];
    const result = engine.evaluateBudgets({ budgets: [budget()], transactions: current, previousTransactions: previous, year: 2026, month: 4, now: new Date(2026, 3, 10, 12) });
    const b = result.budgets[0];
    expect(b.previousMonthSpent).toBe(2000);
    expect(b.changeAmount).toBe(1000);
    expect(b.changePercentage).toBe(50);
    expect(b.projectedMonthEndSpent).toBe(9000); // 3000/10×30
  });
});

describe('analyticsEngine — generateInsights()', () => {
  const baseInput = () => ({
    current: engine.summarize([
      tx({ amount: 50000, transactionType: 'INCOME' }),
      tx({ amount: 40000, transactionType: 'EXPENSE', category: { name: 'Food' } }),
    ]),
    previous: engine.summarize([
      tx({ amount: 50000, transactionType: 'INCOME' }),
      tx({ amount: 30000, transactionType: 'EXPENSE', category: { name: 'Food' } }),
    ]),
    budgets: [],
    forecast: null,
    monthLabel: '4/2026',
    previousLabel: '3/2026',
  });

  it('raises an over-budget insight with supporting values (a fact)', () => {
    const input = baseInput();
    input.budgets = [{ category: 'Food', monthlyLimit: 10000, spent: 12000, remaining: 0, percentageUsed: 120, overBudget: true, warningThreshold: 80, status: 'exceeded' }];
    const insights = engine.generateInsights(input);
    const over = insights.find((i) => i.type === 'CATEGORY_OVER_BUDGET');
    expect(over).toBeDefined();
    expect(over.isEstimate).toBe(false);
    expect(over.severity).toBe('critical');
    expect(over.values).toMatchObject({ spent: 12000, monthlyLimit: 10000, overBy: 2000, percentageUsed: 120 });
  });

  it('flags a month-over-month category increase only for meaningful changes', () => {
    const insights = engine.generateInsights(baseInput());
    const inc = insights.find((i) => i.type === 'CATEGORY_SPEND_INCREASED');
    expect(inc).toBeDefined();
    expect(inc.values).toMatchObject({ current: 40000, previous: 30000, changeAmount: 10000, changePercentage: 33.3 });
    expect(inc.comparisonPeriod).toBe('4/2026 vs 3/2026');
  });

  it('labels the spending-pace insight as an estimate and is traceable to the forecast', () => {
    const input = baseInput();
    input.budgets = [{ category: 'Food', monthlyLimit: 5000, spent: 40000, remaining: 0, percentageUsed: 800, overBudget: true, warningThreshold: 80, status: 'exceeded' }];
    input.forecast = { projectedExpense: 60000, elapsedDays: 20, daysInMonth: 30, spentSoFar: 40000 };
    const insights = engine.generateInsights(input);
    const pace = insights.find((i) => i.type === 'SPENDING_PACE_EXCEEDS_BUDGET');
    expect(pace).toBeDefined();
    expect(pace.isEstimate).toBe(true);
    expect(pace.values).toMatchObject({ projectedExpense: 60000, totalBudget: 5000, projectedOverBy: 55000 });
  });

  it('raises a negative-cash-flow insight when expenses exceed income', () => {
    const input = baseInput();
    input.current = engine.summarize([
      tx({ amount: 10000, transactionType: 'INCOME' }),
      tx({ amount: 25000, transactionType: 'EXPENSE', category: { name: 'Food' } }),
    ]);
    input.previous = engine.summarize([]);
    const insights = engine.generateInsights(input);
    expect(insights.find((i) => i.type === 'NEGATIVE_CASH_FLOW')).toBeDefined();
  });

  it('returns no insights for an empty history (no invented claims)', () => {
    const insights = engine.generateInsights({
      current: engine.summarize([]),
      previous: engine.summarize([]),
      budgets: [],
      forecast: null,
      monthLabel: '4/2026',
      previousLabel: '3/2026',
    });
    expect(insights).toEqual([]);
  });

  it('sorts by severity (critical first)', () => {
    const input = baseInput();
    input.budgets = [
      { category: 'A', monthlyLimit: 1000, spent: 2000, remaining: 0, percentageUsed: 200, overBudget: true, warningThreshold: 80, status: 'exceeded' },
      { category: 'B', monthlyLimit: 1000, spent: 850, remaining: 150, percentageUsed: 85, overBudget: false, warningThreshold: 80, status: 'warning' },
    ];
    const insights = engine.generateInsights(input);
    expect(insights[0].severity).toBe('critical');
  });
});
