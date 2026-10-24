/**
 * Phase 4 — financial and date regression coverage.
 *
 * Phase 3 fixed "income this month" (ledger instead of profile salary) and
 * date-only handling. Phase 4 locks the behaviour down against the cases that
 * are easiest to regress silently:
 *
 *  - the dashboard and the AI advisor must report the SAME month, the SAME
 *    period and the SAME income definition;
 *  - income, expenses, transfers and refunds must each be classified the same
 *    way by both surfaces;
 *  - duplicate ledger rows must not be silently deduplicated (import
 *    idempotency is the guard, not the reporting layer);
 *  - an empty reporting period must produce zeroes, never NaN;
 *  - a month window must include its last day and exclude the first day of
 *    the next month;
 *  - `YYYY-MM-DD` must survive a round trip unchanged, including leap days;
 *  - a calendar date must be resolved in the user-facing timezone;
 *  - inactive insurance policies and subscriptions must not inflate totals.
 */

jest.mock('../config/database', () => ({
  user: { findUnique: jest.fn() },
  financialAccount: { findMany: jest.fn(), aggregate: jest.fn() },
  transaction: { aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  goal: { findMany: jest.fn() },
  loan: { aggregate: jest.fn() },
  portfolio: { findUnique: jest.fn() },
  budget: { findMany: jest.fn(), count: jest.fn() },
  financialPlan: { findUnique: jest.fn() },
  notification: { count: jest.fn() },
  insurancePolicy: { findMany: jest.fn() },
  subscription: { findMany: jest.fn() },
  financialTask: { findMany: jest.fn() },
}));

jest.mock('../services/financialTwinService', () => ({
  calculateDetailedHealthScore: jest.fn(async () => ({ overallScore: 50, components: {} })),
}));

jest.mock('../services/aiService', () => {
  const actual = jest.requireActual('../services/aiService');
  return {
    ...actual,
    // The AI client must never be constructed in a unit test.
    getGeminiClient: jest.fn(),
  };
});

const prisma = require('../config/database');
const { getDashboard } = require('../controllers/dashboardController');
const { getInsurancePolicies } = require('../controllers/insuranceController');
const { getSubscriptions } = require('../controllers/subscriptionController');
const { getFinancialSnapshot } = require('../controllers/aiController');
const { getUserFinancialContext } = require('../services/aiService');
const {
  parseDateOnly,
  formatDateOnly,
  monthRange,
  monthRangeStrings,
  currentMonthRange,
  currentMonthParts,
  monthLabel,
  DEFAULT_TIME_ZONE,
} = require('../utils/dateOnly');

const USER_ID = 'user-phase4';

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

/**
 * Ledger fixtures. `date` is a calendar date, exactly as the `date` column
 * stores it.
 */
function tx(overrides = {}) {
  return {
    id: 't1',
    userId: USER_ID,
    amount: 100,
    transactionType: 'EXPENSE',
    description: 'fixture',
    date: new Date(Date.UTC(2026, 9, 15)),
    createdAt: new Date('2026-10-15T09:00:00.000Z'),
    ...overrides,
  };
}

/** Resolves the INCOME / EXPENSE aggregates the reporting layer asks for. */
function aggregateByType(ledger) {
  return jest.fn(async ({ where }) => {
    if (!where.transactionType) return { _sum: { amount: null } };
    const rows = ledger.filter(
      (t) =>
        t.transactionType === where.transactionType &&
        (!where.date || (t.date >= where.date.gte && t.date <= where.date.lte))
    );
    const total = rows.reduce((sum, t) => sum + Number(t.amount), 0);
    return { _sum: { amount: rows.length ? total : null } };
  });
}

function mockLedger(ledger) {
  prisma.transaction.aggregate.mockImplementation(aggregateByType(ledger));
  prisma.transaction.findMany.mockResolvedValue([]);
  // The reporting layer asks for spending as a groupBy over EXPENSE + the
  // synthetic REFUND/REVERSAL types so refunds can be netted.
  prisma.transaction.groupBy.mockImplementation(async ({ where, by }) => {
    const types = where.transactionType?.in
      ? where.transactionType.in
      : where.transactionType
        ? [where.transactionType]
        : null;
    const rows = ledger.filter(
      (t) =>
        (!types || types.includes(t.transactionType)) &&
        (!where.date || (t.date >= where.date.gte && t.date <= where.date.lte))
    );
    if (!by || !by.includes('transactionType')) return [];
    const totals = new Map();
    const counts = new Map();
    for (const row of rows) {
      totals.set(row.transactionType, (totals.get(row.transactionType) || 0) + Number(row.amount));
      counts.set(row.transactionType, (counts.get(row.transactionType) || 0) + 1);
    }
    return (types || Array.from(totals.keys())).map((type) => ({
      transactionType: type,
      _sum: { amount: totals.has(type) ? totals.get(type) : null },
      _count: { _all: counts.get(type) || 0 },
    }));
  });
  prisma.transaction.count.mockResolvedValue(ledger.length);
}

function mockStaticContext() {
  prisma.financialAccount.findMany.mockResolvedValue([]);
  prisma.financialAccount.aggregate.mockResolvedValue({ _sum: { balance: 50000 } });
  prisma.user.findUnique.mockResolvedValue({
    firstName: 'Phase4',
    email: 'phase4@example.com',
    financialProfile: { monthlySalary: 999999 },
  });
  prisma.goal.findMany.mockResolvedValue([]);
  prisma.loan.aggregate.mockResolvedValue({ _sum: { outstandingBalance: null, emiAmount: null } });
  prisma.portfolio.findUnique.mockResolvedValue(null);
  prisma.budget.findMany.mockResolvedValue([]);
  prisma.budget.count.mockResolvedValue(0);
  prisma.financialPlan.findUnique.mockResolvedValue({ financialHealthScore: 65, planSummary: '' });
  prisma.notification.count.mockResolvedValue(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStaticContext();
  mockLedger([]);
});

describe('dashboard and AI advisor agree on the reporting period', () => {
  test('both surfaces report the same month, bounds and income definition', async () => {
    const ledger = [
      tx({ id: 'i1', transactionType: 'INCOME', amount: 120000, date: new Date(Date.UTC(2026, 9, 1)) }),
      tx({ id: 'e1', transactionType: 'EXPENSE', amount: 30000, date: new Date(Date.UTC(2026, 9, 20)) }),
    ];
    mockLedger(ledger);

    const dash = await call(getDashboard);
    const ai = await call(getFinancialSnapshot);

    expect(dash.payload.data.incomeBasis).toBe('RECORDED_LEDGER_TRANSACTIONS');
    expect(ai.payload.data.incomeBasis).toBe('RECORDED_LEDGER_TRANSACTIONS');
    expect(ai.payload.data.period).toEqual(dash.payload.data.period);
    expect(ai.payload.data.incomeThisMonth).toBe(dash.payload.data.monthlyIncome);
    expect(ai.payload.data.expensesThisMonth).toBe(dash.payload.data.monthlyExpenses);
    expect(ai.payload.data.savingsThisMonth).toBe(dash.payload.data.monthlySavings);
    expect(ai.payload.data.period.timezone).toBe(DEFAULT_TIME_ZONE);
  });

  test('the profile salary is never used as income by either surface', async () => {
    mockLedger([
      tx({ id: 'i1', transactionType: 'INCOME', amount: 120000, date: new Date(Date.UTC(2026, 9, 1)) }),
    ]);

    const dash = await call(getDashboard);
    const ctx = await getUserFinancialContext(USER_ID);

    // The fixture profile claims ₹9,99,999 per month.
    expect(ctx.profileMonthlySalary).toBe(999999);
    expect(dash.payload.data.monthlyIncome).toBe(120000);
    expect(ctx.incomeThisMonth).toBe(120000);
  });
});

describe('ledger classification', () => {
  test('transfers are excluded from both income and expenses', async () => {
    const ledger = [
      tx({ id: 'i1', transactionType: 'INCOME', amount: 1000, date: new Date(Date.UTC(2026, 9, 2)) }),
      tx({ id: 'e1', transactionType: 'EXPENSE', amount: 250, date: new Date(Date.UTC(2026, 9, 3)) }),
      tx({ id: 't1', transactionType: 'TRANSFER', amount: 999999, date: new Date(Date.UTC(2026, 9, 4)) }),
    ];
    mockLedger(ledger);

    const dash = await call(getDashboard);
    expect(dash.payload.data.monthlyIncome).toBe(1000);
    expect(dash.payload.data.monthlyExpenses).toBe(250);

    // Both reporting queries are scoped by type, so a transfer can never be
    // summed even if the ledger contains one. Income stays an aggregate;
    // spending is a groupBy widened to REFUND/REVERSAL for netting.
    const aggregateTypes = prisma.transaction.aggregate.mock.calls
      .map(([arg]) => arg.where.transactionType)
      .filter(Boolean);
    expect(new Set(aggregateTypes)).toEqual(new Set(['INCOME']));

    const spendingFilters = prisma.transaction.groupBy.mock.calls
      .map(([arg]) => arg.where.transactionType)
      .filter(Boolean);
    expect(spendingFilters.length).toBeGreaterThan(0);
    for (const filter of spendingFilters) {
      expect(filter.in).toEqual(expect.arrayContaining(['EXPENSE']));
      expect(filter.in).not.toContain('TRANSFER');
      expect(filter.in).not.toContain('INCOME');
    }
  });

  test('a refund counts as income and never reduces expenses', async () => {
    const ledger = [
      tx({ id: 'e1', transactionType: 'EXPENSE', amount: 2000, date: new Date(Date.UTC(2026, 9, 3)) }),
      tx({
        id: 'r1',
        transactionType: 'INCOME',
        amount: 2000,
        description: 'REFUND for order 881',
        date: new Date(Date.UTC(2026, 9, 4)),
      }),
    ];
    mockLedger(ledger);

    const dash = await call(getDashboard);
    expect(dash.payload.data.monthlyIncome).toBe(2000);
    expect(dash.payload.data.monthlyExpenses).toBe(2000);
    expect(dash.payload.data.monthlySavings).toBe(0);
  });

  test('duplicate ledger rows are both counted — reporting never deduplicates', async () => {
    const ledger = [
      tx({ id: 'd1', amount: 500, date: new Date(Date.UTC(2026, 9, 5)) }),
      tx({ id: 'd2', amount: 500, date: new Date(Date.UTC(2026, 9, 5)) }),
    ];
    mockLedger(ledger);

    const dash = await call(getDashboard);
    // Duplicate suppression belongs to the import path (hash-based
    // idempotency), not to the reporting layer. Hiding a row here would make
    // a legitimate repeated expense disappear.
    expect(dash.payload.data.monthlyExpenses).toBe(1000);
  });

  test('an empty reporting period returns zeroes rather than NaN', async () => {
    const dash = await call(getDashboard);
    expect(dash.payload.data.monthlyIncome).toBe(0);
    expect(dash.payload.data.monthlyExpenses).toBe(0);
    expect(dash.payload.data.monthlySavings).toBe(0);
    expect(dash.payload.data.savingsRate).toBe(0);
    expect(Number.isNaN(dash.payload.data.monthlyIncome)).toBe(false);
  });
});

describe('month boundaries', () => {
  test('the window includes the last day of the month and excludes the next first day', async () => {
    const ledger = [
      tx({ id: 'last', transactionType: 'INCOME', amount: 1111, date: new Date(Date.UTC(2026, 9, 31)) }),
      tx({ id: 'next', transactionType: 'INCOME', amount: 2222, date: new Date(Date.UTC(2026, 10, 1)) }),
    ];
    mockLedger(ledger);

    const dash = await call(getDashboard);
    expect(dash.payload.data.monthlyIncome).toBe(1111);
    expect(dash.payload.data.period.start).toBe('2026-10-01');
    expect(dash.payload.data.period.end).toBe('2026-10-31');
  });

  test('monthRange covers the correct number of days, including leap February', () => {
    expect(monthRangeStrings(2024, 2)).toMatchObject({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthRangeStrings(2026, 2)).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRangeStrings(2026, 4)).toMatchObject({ start: '2026-04-01', end: '2026-04-30' });
    expect(monthRangeStrings(2026, 12)).toMatchObject({ start: '2026-12-01', end: '2026-12-31' });
    expect(monthRange(2024, 2).end.getUTCDate()).toBe(29);
  });

  test('a calendar month is resolved in the user timezone, not in UTC', () => {
    // 2026-10-31T19:00:00Z is already 2026-11-01 00:30 in Asia/Kolkata.
    const instant = new Date('2026-10-31T19:00:00.000Z');
    const ist = currentMonthRange(instant, 'Asia/Kolkata');
    expect(monthRangeStrings(ist.year, ist.month)).toMatchObject({
      start: '2026-11-01',
      end: '2026-11-30',
    });

    // The same instant is still October in UTC.
    const utc = currentMonthRange(instant, 'UTC');
    expect(monthRangeStrings(utc.year, utc.month)).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-31',
    });

    expect(currentMonthParts('Asia/Kolkata').month).toBeGreaterThanOrEqual(1);
    expect(monthLabel(2026, 10)).toBe('October 2026');
  });
});

describe('date-only round trips', () => {
  test('a calendar date survives parse -> serialize unchanged', () => {
    const dates = [
      '2026-01-01',
      '2026-10-31',
      '2024-02-29',
      '2026-02-28',
      '2026-12-31',
      '2026-06-15',
    ];
    for (const value of dates) {
      const parsed = parseDateOnly(value);
      expect(parsed.toISOString()).toBe(`${value}T00:00:00.000Z`);
      expect(formatDateOnly(parsed)).toBe(value);
      expect(formatDateOnly(parsed)).not.toMatch(/T/);
    }
  });

  test('a Date that is not UTC midnight is serialized by its UTC calendar day', () => {
    expect(formatDateOnly(new Date('2026-10-31T18:00:00.000Z'))).toBe('2026-10-31');
    expect(formatDateOnly(new Date('2026-10-31T23:59:59.999Z'))).toBe('2026-10-31');
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly('')).toBeNull();
  });

  test('leap days and impossible dates are handled explicitly', () => {
    expect(() => parseDateOnly('2024-02-29')).not.toThrow();
    expect(() => parseDateOnly('2026-02-29')).toThrow(RangeError);
    expect(() => parseDateOnly('2026-02-30')).toThrow(RangeError);
    expect(() => parseDateOnly('2026-13-01')).toThrow(RangeError);
    expect(() => parseDateOnly('2026-00-10')).toThrow(RangeError);
    expect(() => parseDateOnly('not-a-date')).toThrow(RangeError);
  });
});

describe('protection products', () => {
  test('inactive insurance policies contribute nothing to coverage or premium', async () => {
    prisma.insurancePolicy.findMany.mockResolvedValue([
      {
        id: 'p1',
        isActive: false,
        coverageAmount: '9000000',
        premium: '9000',
        premiumCycle: 'MONTHLY',
        renewalDate: new Date(Date.UTC(2027, 5, 1)),
      },
    ]);

    const res = await call(getInsurancePolicies);
    const { summary } = res.payload.data;
    expect(summary.totalPolicies).toBe(1);
    expect(summary.activePolicies).toBe(0);
    expect(summary.inactivePolicies).toBe(1);
    expect(summary.totalCoverage).toBe(0);
    expect(summary.annualPremium).toBe(0);
  });

  test('inactive subscriptions contribute nothing to recurring spend', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { id: 's1', isActive: false, cost: '500', billingCycle: 'MONTHLY', nextBillingDate: new Date(Date.UTC(2026, 11, 2)) },
    ]);

    const res = await call(getSubscriptions);
    const { summary } = res.payload.data;
    expect(summary.totalSubscriptions).toBe(1);
    expect(summary.activeSubscriptions).toBe(0);
    expect(summary.inactiveSubscriptions).toBe(1);
    expect(summary.monthlyTotal).toBe(0);
    expect(summary.annualTotal).toBe(0);
  });
});
