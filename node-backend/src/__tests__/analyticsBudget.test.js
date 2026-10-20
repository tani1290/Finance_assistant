/**
 * Controller-level tests for analytics, forecasts, insights and budgets.
 *
 * Prisma is mocked so these tests prove two things the pure engine tests cannot:
 *   1. every query is scoped to the authenticated user, and
 *   2. invalid period / monetary input is rejected before touching the database.
 */

jest.mock('../config/database', () => ({
  transaction: {
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  category: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  budget: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

const prisma = require('../config/database');
const analytics = require('../controllers/analyticsController');
const budgets = require('../controllers/budgetController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (over = {}) => ({
  user: { id: 'userA' },
  query: {},
  params: {},
  body: {},
  ...over,
});

const run = async (handler, req) => {
  const res = makeRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /analytics — validation and scoping', () => {
  it('rejects an out-of-range month before querying the database', async () => {
    const { res } = await run(analytics.getAnalytics, makeReq({ query: { month: '13', year: '2026' } }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
  });

  it('scopes every aggregate/groupBy to the authenticated user and returns MoM + dailyFlow', async () => {
    prisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 60000 }, _count: 3 })
      .mockResolvedValueOnce({ _sum: { amount: 40000 }, _count: 10 })
      .mockResolvedValueOnce({ _sum: { amount: 50000 }, _count: 2 })
      .mockResolvedValueOnce({ _sum: { amount: 30000 }, _count: 8 });
    prisma.transaction.groupBy
      .mockResolvedValueOnce([{ categoryId: 'c1', _sum: { amount: 40000 } }])
      // Postgres DATE columns surface as UTC midnight, so the mocked groupBy
      // rows use UTC dates exactly like production.
      .mockResolvedValueOnce([{ date: new Date(Date.UTC(2026, 3, 1)), _sum: { amount: 60000 } }])
      .mockResolvedValueOnce([{ date: new Date(Date.UTC(2026, 3, 1)), _sum: { amount: 60000 } }])
      .mockResolvedValueOnce([{ date: new Date(Date.UTC(2026, 3, 2)), _sum: { amount: 40000 } }]);
    prisma.category.findMany.mockResolvedValue([{ id: 'c1', name: 'Food' }]);

    const { res } = await run(analytics.getAnalytics, makeReq({ query: { month: '4', year: '2026' } }));

    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.month).toBe(4);
    expect(data.year).toBe(2026);
    expect(data.summary.totalIncome).toBe(60000);
    expect(data.summary.totalExpenses).toBe(40000);
    expect(data.monthOverMonth.incomeChange).toMatchObject({ absoluteChange: 10000, percentageChange: 20 });
    expect(data.dailyFlow).toEqual([
      { date: '2026-04-01', income: 60000, expenses: 0, net: 60000 },
      { date: '2026-04-02', income: 0, expenses: 40000, net: -40000 },
    ]);
    expect(data.categoryBreakdown[0]).toMatchObject({ category: 'Food', amount: 40000, percentage: 100 });

    for (const call of prisma.transaction.aggregate.mock.calls) {
      expect(call[0].where.userId).toBe('userA');
    }
    for (const call of prisma.transaction.groupBy.mock.calls) {
      expect(call[0].where.userId).toBe('userA');
    }
  });
});

describe('GET /analytics/forecast', () => {
  it('rejects invalid periods with 400', async () => {
    const { res } = await run(analytics.getForecast, makeReq({ query: { month: '0' } }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the user and returns a labelled, traceable estimate', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: 1000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)) },
      { amount: 1000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 2)) },
    ]);

    const { res } = await run(
      analytics.getForecast,
      makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026' } })
    );

    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('userA');
    expect(where.transactionType).toBe('EXPENSE');

    const { data } = res.json.mock.calls[0][0];
    expect(data.method).toBe('average_daily_run_rate');
    expect(data.isEstimate).toBe(true);
    expect(data.spentSoFar).toBe(2000);
    expect(data.formattedSpentSoFar).toContain('2,000');
  });

  it('never leaks another user\'s transactions into a forecast', async () => {
    const rowsByUser = {
      userA: [{ amount: 1000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)) }],
      userB: [
        { amount: 9000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)) },
        { amount: 9000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)) },
      ],
    };
    prisma.transaction.findMany.mockImplementation(({ where }) => Promise.resolve(rowsByUser[where.userId]));

    const a = await run(analytics.getForecast, makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026' } }));
    const b = await run(analytics.getForecast, makeReq({ user: { id: 'userB' }, query: { month: '4', year: '2026' } }));

    expect(a.res.json.mock.calls[0][0].data.spentSoFar).toBe(1000);
    // userB's two identical rows are an exact duplicate pair → counted once.
    expect(b.res.json.mock.calls[0][0].data.spentSoFar).toBe(9000);
    expect(b.res.json.mock.calls[0][0].data.duplicatesExcluded).toBe(1);
  });
});

describe('GET /analytics/insights', () => {
  it('rejects an invalid year', async () => {
    const { res } = await run(analytics.getInsights, makeReq({ query: { month: '4', year: '1800' } }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('scopes current, previous and budget queries to the user', async () => {
    prisma.transaction.findMany
      .mockResolvedValueOnce([
        { amount: 50000, transactionType: 'INCOME', date: new Date(Date.UTC(2026, 3, 1)) },
        { amount: 40000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 2)), category: { name: 'Food' }, categoryId: 'c1' },
      ])
      .mockResolvedValueOnce([
        { amount: 50000, transactionType: 'INCOME', date: new Date(Date.UTC(2026, 2, 1)) },
        { amount: 30000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 2, 2)), category: { name: 'Food' }, categoryId: 'c1' },
      ]);
    prisma.budget.findMany.mockResolvedValue([
      { id: 'b1', categoryId: 'c1', categoryName: 'Food', monthlyLimit: 10000, category: { id: 'c1', name: 'Food' } },
    ]);

    const { res } = await run(
      analytics.getInsights,
      makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026', warningThreshold: '85' } })
    );

    for (const call of prisma.transaction.findMany.mock.calls) {
      expect(call[0].where.userId).toBe('userA');
    }
    expect(prisma.budget.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'userA', month: 4, year: 2026 });

    const { data } = res.json.mock.calls[0][0];
    expect(data.warningThreshold).toBe(85);
    expect(data.current.expenses).toBe(40000);
    expect(data.previous.expenses).toBe(30000);
    expect(Array.isArray(data.insights)).toBe(true);
    const over = data.insights.find((i) => i.type === 'CATEGORY_OVER_BUDGET');
    expect(over).toBeDefined();
    expect(over.values).toMatchObject({ spent: 40000, monthlyLimit: 10000, overBy: 30000 });
    expect(data.note).toMatch(/not guarantees/i);
  });

  it('returns an empty insight list for a user with no recorded history', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.budget.findMany.mockResolvedValue([]);

    const { res } = await run(
      analytics.getInsights,
      makeReq({ user: { id: 'userEmpty' }, query: { month: '4', year: '2026' } })
    );

    const { data } = res.json.mock.calls[0][0];
    expect(data.insights).toEqual([]);
    expect(data.current.expenses).toBe(0);
    expect(data.forecast.insufficientData).toBe(true);
  });

  it('reports exact duplicate imports without removing them from recorded totals', async () => {
    const dup = {
      amount: 500,
      transactionType: 'EXPENSE',
      date: new Date(Date.UTC(2026, 3, 1)),
      description: 'Coffee',
      category: { name: 'Food' },
      categoryId: 'c1',
    };
    prisma.transaction.findMany.mockResolvedValueOnce([dup, { ...dup }]).mockResolvedValueOnce([]);
    prisma.budget.findMany.mockResolvedValue([]);

    const { res } = await run(
      analytics.getInsights,
      makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026' } })
    );

    const { data } = res.json.mock.calls[0][0];
    // Both rows remain in the recorded total; the pair is merely surfaced.
    expect(data.current.expenses).toBe(1000);
    expect(data.duplicates).toEqual({ suspects: 1, groups: 1 });
  });

  it('exposes refunds as income and the identifying detail of duplicate groups', async () => {
    const dupA = { id: 'tx_a', amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Coffee', merchant: 'Cafe', category: { name: 'Food' }, categoryId: 'c1' };
    const dupB = { id: 'tx_b', amount: 500, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), description: 'Coffee', merchant: 'Cafe', category: { name: 'Food' }, categoryId: 'c1' };
    const refund = { id: 'tx_r', amount: 1200, transactionType: 'INCOME', date: new Date(Date.UTC(2026, 3, 3)), description: 'REFUND for order 881' };
    prisma.transaction.findMany.mockResolvedValueOnce([dupA, dupB, refund]).mockResolvedValueOnce([]);
    prisma.budget.findMany.mockResolvedValue([]);

    const { res } = await run(
      analytics.getInsights,
      makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026' } })
    );

    const { data } = res.json.mock.calls[0][0];
    // A refund is counted inside income (never netted against expenses)…
    expect(data.current.income).toBe(1200);
    expect(data.current.refunds).toBe(1200);
    expect(data.current.expenses).toBe(1000);
    // …and the flagged pair carries the identity needed to review it safely.
    expect(data.duplicates).toEqual({ suspects: 1, groups: 1 });
    expect(data.duplicateGroups).toHaveLength(1);
    expect(data.duplicateGroups[0].rows.map((r) => r.id)).toEqual(['tx_a', 'tx_b']);
    expect(data.duplicateGroups[0].rows[0]).toMatchObject({
      date: '2026-04-01',
      amount: 500,
      description: 'Coffee',
      merchant: 'Cafe',
    });
  });
});

describe('GET /budgets — validation, thresholds and scoping', () => {
  it('rejects an invalid month', async () => {
    const { res } = await run(budgets.getBudgets, makeReq({ query: { month: '99' } }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.budget.findMany).not.toHaveBeenCalled();
  });

  it('scopes queries to the user and exposes threshold/over-budget/projection', async () => {
    prisma.budget.findMany.mockResolvedValue([
      { id: 'b1', categoryId: 'c1', categoryName: 'Food', monthlyLimit: 10000, category: { id: 'c1', name: 'Food' } },
    ]);
    prisma.transaction.findMany
      .mockResolvedValueOnce([{ amount: 9000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 3, 1)), categoryId: 'c1', category: { name: 'Food' } }])
      .mockResolvedValueOnce([{ amount: 4000, transactionType: 'EXPENSE', date: new Date(Date.UTC(2026, 2, 1)), categoryId: 'c1', category: { name: 'Food' } }]);

    const { res } = await run(
      budgets.getBudgets,
      makeReq({ user: { id: 'userA' }, query: { month: '4', year: '2026', warningThreshold: '90' } })
    );

    expect(prisma.budget.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'userA', month: 4, year: 2026 });
    expect(prisma.transaction.findMany.mock.calls[0][0].where.userId).toBe('userA');

    const { data } = res.json.mock.calls[0][0];
    expect(data.warningThreshold).toBe(90);
    expect(data.budgets[0]).toMatchObject({
      spent: 9000,
      percentageUsed: 90,
      status: 'alert',
      overBudget: false,
      previousMonthSpent: 4000,
      changeAmount: 5000,
    });
    expect(data.summary.totalBudgeted).toBe(10000);
    expect(data.summary.formattedTotalSpent).toContain('9,000');
  });
});

describe('POST /budgets — validation', () => {
  const base = { categoryName: 'Food', monthlyLimit: 5000, month: 4, year: 2026 };

  it('rejects negative amounts', async () => {
    const { res } = await run(budgets.createBudget, makeReq({ body: { ...base, monthlyLimit: -100 } }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-finite amounts (NaN, Infinity) and missing categories', async () => {
    for (const body of [
      { ...base, monthlyLimit: 'abc' },
      { ...base, monthlyLimit: Infinity },
      { ...base, categoryName: '' },
      { ...base, categoryName: 'Food', month: 13 },
    ]) {
      const { res } = await run(budgets.createBudget, makeReq({ body }));
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it('creates a budget scoped to the authenticated user', async () => {
    prisma.category.findFirst.mockResolvedValue({ id: 'c1', name: 'Food' });
    prisma.budget.upsert.mockResolvedValue({ id: 'b1', monthlyLimit: 5000, month: 4, year: 2026 });

    const { res } = await run(budgets.createBudget, makeReq({ user: { id: 'userA' }, body: base }));

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.category.findFirst.mock.calls[0][0].where.userId).toBe('userA');
    expect(prisma.budget.upsert.mock.calls[0][0].where.userId_categoryName_month_year).toEqual({
      userId: 'userA',
      categoryName: 'Food',
      month: 4,
      year: 2026,
    });
    expect(prisma.budget.upsert.mock.calls[0][0].create.userId).toBe('userA');
  });
});

describe('PATCH /budgets/:id — validation', () => {
  it('rejects negative or non-finite limits without updating', async () => {
    prisma.budget.findFirst.mockResolvedValue({ id: 'b1', userId: 'userA', monthlyLimit: 5000 });
    for (const monthlyLimit of [-1, 'abc', Infinity, 0]) {
      const { res } = await run(budgets.updateBudget, makeReq({ params: { id: 'b1' }, body: { monthlyLimit } }));
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

  it('accepts a positive limit for an owned budget', async () => {
    prisma.budget.findFirst.mockResolvedValue({ id: 'b1', userId: 'userA', monthlyLimit: 5000 });
    prisma.budget.update.mockResolvedValue({ id: 'b1', monthlyLimit: 2500 });
    const { res } = await run(budgets.updateBudget, makeReq({ params: { id: 'b1' }, body: { monthlyLimit: 2500 } }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.budget.update.mock.calls[0][0].data.monthlyLimit).toBe(2500);
  });

  it('does not update a budget owned by another user', async () => {
    prisma.budget.findFirst.mockResolvedValue(null);
    const { res } = await run(budgets.updateBudget, makeReq({ params: { id: 'b-other' }, body: { monthlyLimit: 2500 } }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /budgets/:id — ownership', () => {
  it('returns 404 (and does not delete) when the budget belongs to another user', async () => {
    prisma.budget.findFirst.mockResolvedValue(null);
    const { res } = await run(budgets.deleteBudget, makeReq({ user: { id: 'userA' }, params: { id: 'b-other' } }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.budget.findFirst.mock.calls[0][0].where).toEqual({ id: 'b-other', userId: 'userA' });
    expect(prisma.budget.delete).not.toHaveBeenCalled();
  });
});
