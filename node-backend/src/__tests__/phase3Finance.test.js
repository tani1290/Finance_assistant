/**
 * Phase 3 — financial summary regressions.
 *
 * Covers the defects that made the dashboard, list pages and reports disagree:
 *  - "income this month" must be the ledger sum, never the onboarding salary;
 *  - inactive insurance policies / subscriptions must not inflate totals;
 *  - date-only columns must survive the API as `YYYY-MM-DD`;
 *  - overdue tasks must compare calendar dates, not instants.
 */

jest.mock('../config/database', () => ({
  financialAccount: { findMany: jest.fn() },
  transaction: { aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  goal: { findMany: jest.fn() },
  loan: { aggregate: jest.fn() },
  portfolio: { findUnique: jest.fn() },
  budget: { findMany: jest.fn() },
  financialPlan: { findUnique: jest.fn() },
  notification: { count: jest.fn() },
  insurancePolicy: { findMany: jest.fn() },
  subscription: { findMany: jest.fn() },
  financialTask: { findMany: jest.fn() },
}));

jest.mock('../services/financialTwinService', () => ({
  calculateDetailedHealthScore: jest.fn(),
}));

const prisma = require('../config/database');
const { getDashboard } = require('../controllers/dashboardController');
const { getInsurancePolicies } = require('../controllers/insuranceController');
const { getSubscriptions } = require('../controllers/subscriptionController');
const { getTransactions } = require('../controllers/transactionController');
const { getTasks } = require('../controllers/taskController');
const { parseDateOnly, todayDateOnly } = require('../utils/dateOnly');

const USER_ID = 'user-phase3';

async function call(handler, { query = {}, user = { id: USER_ID } } = {}) {
  const req = { user, query, body: {}, params: {} };
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const next = jest.fn();
  await handler(req, res, next);
  if (next.mock.calls.length > 0) throw next.mock.calls[0][0];
  return res;
}

function emptyDashboard(overrides = {}) {
  prisma.financialAccount.findMany.mockResolvedValue([]);
  prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } });
  prisma.transaction.groupBy.mockResolvedValue([]);
  prisma.transaction.findMany.mockResolvedValue([]);
  prisma.goal.findMany.mockResolvedValue([]);
  prisma.loan.aggregate.mockResolvedValue({ _sum: { outstandingBalance: null, emiAmount: null } });
  prisma.portfolio.findUnique.mockResolvedValue(null);
  prisma.budget.findMany.mockResolvedValue([]);
  prisma.financialPlan.findUnique.mockResolvedValue({ financialHealthScore: 65, planSummary: '' });
  prisma.notification.count.mockResolvedValue(0);
  Object.assign(prisma, overrides);
}

beforeEach(() => {
  jest.clearAllMocks();
  emptyDashboard();
});

describe('dashboard income semantics', () => {
  test('empty dataset returns zeroes, not NaN, and states the income basis', async () => {
    const res = await call(getDashboard);

    expect(res.statusCode).toBe(200);
    expect(res.payload.data.monthlyIncome).toBe(0);
    expect(res.payload.data.monthlyExpenses).toBe(0);
    expect(res.payload.data.monthlySavings).toBe(0);
    expect(res.payload.data.savingsRate).toBe(0);
    expect(res.payload.data.incomeBasis).toBe('RECORDED_LEDGER_TRANSACTIONS');
    expect(res.payload.data.period.start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(res.payload.data.period.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.payload.data.period.timezone).toBe('Asia/Kolkata');
    expect(res.payload.data.recentTransactions).toEqual([]);
  });

  test('monthly income is the ledger sum, not the profile salary estimate', async () => {
    prisma.transaction.aggregate.mockImplementation(({ where }) => {
      if (where.transactionType === 'INCOME') {
        // Only the month-scoped query is income for this month.
        return Promise.resolve({ _sum: { amount: where.date ? 120000 : 900000 } });
      }
      return Promise.resolve({ _sum: { amount: 30000 } });
    });
    prisma.transaction.groupBy.mockResolvedValue([
      { transactionType: 'EXPENSE', _sum: { amount: 30000 }, _count: { _all: 1 } },
    ]);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        description: 'Salary credit',
        amount: 120000,
        transactionType: 'INCOME',
        date: new Date(Date.UTC(2026, 9, 1)),
        category: { name: 'Salary' },
      },
    ]);
    prisma.financialAccount.findMany.mockResolvedValue([{ balance: 50000 }]);

    const res = await call(getDashboard);
    const data = res.payload.data;

    expect(data.monthlyIncome).toBe(120000);
    expect(data.monthlyExpenses).toBe(30000);
    expect(data.monthlySavings).toBe(90000);
    expect(data.savingsRate).toBe(75);
    expect(data.totalBalance).toBe(50000);
    // A ledger row is a calendar date on the wire.
    expect(data.recentTransactions[0].date).toBe('2026-10-01');
    expect(data.recentTransactions[0].date).not.toMatch(/T/);
  });

  test('the month aggregate is bounded by date-only UTC month bounds', async () => {
    const res = await call(getDashboard);
    expect(res.statusCode).toBe(200);

    const incomeCall = prisma.transaction.aggregate.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg.where.transactionType === 'INCOME' && arg.where.date);
    expect(incomeCall).toBeDefined();
    expect(incomeCall.where.date.gte).toBeInstanceOf(Date);
    expect(incomeCall.where.date.lte).toBeInstanceOf(Date);
    // Inclusive bounds: first and last day at UTC midnight.
    expect(incomeCall.where.date.gte.toISOString()).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(incomeCall.where.date.lte.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  });
});

describe('insurance summary', () => {
  test('inactive policies stay listed but do not inflate coverage or premium', async () => {
    prisma.insurancePolicy.findMany.mockResolvedValue([
      {
        id: 'p1',
        isActive: true,
        coverageAmount: '1000000',
        premium: '1000',
        premiumCycle: 'MONTHLY',
        renewalDate: new Date(Date.UTC(2027, 0, 15)),
      },
      {
        id: 'p2',
        isActive: true,
        coverageAmount: '500000',
        premium: '6000',
        premiumCycle: 'YEARLY',
        renewalDate: new Date(Date.UTC(2026, 11, 1)),
      },
      {
        id: 'p3',
        isActive: false,
        coverageAmount: '9000000',
        premium: '9000',
        premiumCycle: 'MONTHLY',
        renewalDate: new Date(Date.UTC(2027, 5, 1)),
      },
    ]);

    const res = await call(getInsurancePolicies);
    const { policies, summary } = res.payload.data;

    expect(policies).toHaveLength(3);
    expect(summary.totalPolicies).toBe(3);
    expect(summary.activePolicies).toBe(2);
    expect(summary.inactivePolicies).toBe(1);
    expect(summary.totalCoverage).toBe(1500000);
    expect(summary.annualPremium).toBe(12000 + 6000);
    // Earliest active renewal, and a date-only string.
    expect(summary.nextRenewal).toBe('2026-12-01');
    expect(policies[0].renewalDate).toBe('2027-01-15');
  });

  test('no active policies produces empty totals and a null renewal', async () => {
    prisma.insurancePolicy.findMany.mockResolvedValue([]);
    const res = await call(getInsurancePolicies);
    expect(res.payload.data.summary.totalCoverage).toBe(0);
    expect(res.payload.data.summary.annualPremium).toBe(0);
    expect(res.payload.data.summary.nextRenewal).toBeNull();
  });
});

describe('subscription summary', () => {
  test('inactive subscriptions are excluded from recurring spend', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { id: 's1', isActive: true, cost: '200', billingCycle: 'MONTHLY', nextBillingDate: new Date(Date.UTC(2026, 10, 2)) },
      { id: 's2', isActive: true, cost: '1200', billingCycle: 'ANNUAL', nextBillingDate: new Date(Date.UTC(2027, 0, 2)) },
      { id: 's3', isActive: false, cost: '500', billingCycle: 'MONTHLY', nextBillingDate: new Date(Date.UTC(2026, 11, 2)) },
    ]);

    const res = await call(getSubscriptions);
    const { subscriptions, summary } = res.payload.data;

    expect(subscriptions).toHaveLength(3);
    expect(summary.totalSubscriptions).toBe(3);
    expect(summary.activeSubscriptions).toBe(2);
    expect(summary.inactiveSubscriptions).toBe(1);
    expect(summary.monthlyTotal).toBe(300);
    expect(summary.annualTotal).toBe(3600);
    expect(subscriptions[0].nextBillingDate).toBe('2026-11-02');
  });
});

describe('transaction date filters', () => {
  test('startDate/endDate become UTC date bounds and responses stay date-only', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        amount: 250,
        transactionType: 'EXPENSE',
        date: new Date(Date.UTC(2026, 9, 31)),
        description: 'Groceries',
        merchant: '',
        currency: 'INR',
        createdAt: new Date('2026-10-31T18:00:00.000Z'),
        category: { name: 'Food' },
        account: { name: 'Cash' },
      },
    ]);
    prisma.transaction.count.mockResolvedValue(1);

    const res = await call(getTransactions, {
      query: { startDate: '2026-10-01', endDate: '2026-10-31', page: '1', limit: '20' },
    });

    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe(USER_ID);
    expect(where.date.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.date.lte.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(res.payload.data.transactions[0].date).toBe('2026-10-31');
    expect(res.payload.data.transactions[0].date).not.toMatch(/T/);
  });

  test('an impossible date is a 400, not a silently shifted date', async () => {
    const res = await call(getTransactions, { query: { startDate: '2026-02-31' } });
    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  test('an empty page returns an empty list and zero totals', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.count.mockResolvedValue(0);
    const res = await call(getTransactions, { query: { page: '1', limit: '20' } });
    expect(res.payload.data.transactions).toEqual([]);
    expect(res.payload.data.pagination.total).toBe(0);
  });
});

describe('task overdue boundaries', () => {
  test('due today is not overdue; yesterday is; completed is ignored', async () => {
    const today = parseDateOnly(todayDateOnly());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    prisma.financialTask.findMany.mockResolvedValue([
      { id: 'a', isCompleted: false, dueDate: today },
      { id: 'b', isCompleted: false, dueDate: yesterday },
      { id: 'c', isCompleted: true, dueDate: yesterday },
    ]);

    const res = await call(getTasks);
    expect(res.payload.data.summary.overdue).toBe(1);
    expect(res.payload.data.tasks[0].dueDate).toBe(todayDateOnly());
    expect(res.payload.data.tasks[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
