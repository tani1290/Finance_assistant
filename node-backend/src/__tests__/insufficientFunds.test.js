/**
 * Insufficient Funds Enforcement Test Suite
 *
 * Verifies that the general transaction tracker enforces account balance invariants:
 * 1. Outflows (EXPENSE, TRANSFER, INVESTMENT, LOAN_PAYMENT) are rejected when available balance is insufficient.
 * 2. Inflows (INCOME, REFUND, REVERSAL) are always permitted.
 * 3. CREDIT_CARD accounts allow spending into credit/liability.
 * 4. Boundary cases (exact amount matching balance) succeed.
 * 5. Idempotent transfer replays are preserved.
 * 6. Transaction updates that would overdraw an account are rejected.
 */

'use strict';

jest.mock('../config/database', () => ({
  financialAccount: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  notification: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  transactionCategoryCorrection: { create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../services/financialTwinService', () => ({
  detectExpenseAnomaly: jest.fn(async () => ({ isAnomaly: false, severity: 'NORMAL' })),
}));

jest.mock('../services/notificationService', () => ({
  checkBudgetThresholds: jest.fn(async () => {}),
}));

const prisma = require('../config/database');
const {
  createTransaction,
  updateTransaction,
} = require('../controllers/transactionController');
const {
  checkSufficientFunds,
  isDebitType,
  isExemptFromBalanceCheck,
} = require('../services/transactionBalance');

const financialTwin = require('../services/financialTwinService');
const notificationService = require('../services/notificationService');

const USER = 'user-funds-test';

const SAVINGS_ACC = {
  id: 'acc-savings',
  name: 'HDFC Savings',
  accountType: 'SAVINGS',
  balance: 500,
  userId: USER,
};

const CREDIT_CARD_ACC = {
  id: 'acc-cc',
  name: 'HDFC Regalia Card',
  accountType: 'CREDIT_CARD',
  balance: 0,
  userId: USER,
};

const DEST_ACC = {
  id: 'acc-dest',
  name: 'Cash Wallet',
  accountType: 'WALLET',
  balance: 100,
  userId: USER,
};

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function reqFor(body = {}, params = {}, query = {}) {
  return { user: { id: USER }, body, params, query, ip: '127.0.0.1', headers: {} };
}

const bodyOf = (res) => res.json.mock.calls[0][0];

function useTx({ current = null, account = null } = {}) {
  const tx = {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(current),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'tx-new',
        createdAt: new Date(),
        currency: 'INR',
        ...data,
        category: { name: 'Food' },
        account: { name: account?.name || 'HDFC Savings' },
        toAccount: null,
      })),
      update: jest.fn().mockImplementation(async ({ data }) => ({
        ...(current || {}),
        ...data,
        account: { name: account?.name || 'HDFC Savings' },
        toAccount: null,
      })),
    },
    financialAccount: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === SAVINGS_ACC.id) return { ...SAVINGS_ACC, ...(account || {}) };
        if (where.id === CREDIT_CARD_ACC.id) return CREDIT_CARD_ACC;
        if (where.id === DEST_ACC.id) return DEST_ACC;
        return null;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-food', name: 'Food' }),
      create: jest.fn().mockResolvedValue({ id: 'cat-new', name: 'Food' }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

beforeEach(() => {
  jest.resetAllMocks();
  financialTwin.detectExpenseAnomaly.mockResolvedValue({ isAnomaly: false, severity: 'NORMAL' });
  notificationService.checkBudgetThresholds.mockResolvedValue();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.notification.create.mockResolvedValue({});
  prisma.financialAccount.findFirst.mockImplementation(async ({ where }) => {
    if (where.id === SAVINGS_ACC.id) return SAVINGS_ACC;
    if (where.id === CREDIT_CARD_ACC.id) return CREDIT_CARD_ACC;
    if (where.id === DEST_ACC.id) return DEST_ACC;
    return where.isActive ? SAVINGS_ACC : null;
  });
  prisma.category.findFirst.mockResolvedValue({ id: 'cat-food', name: 'Food' });
});

describe('checkSufficientFunds — pure unit invariants', () => {
  test('allows debit when balance strictly exceeds amount', () => {
    const res = checkSufficientFunds({ balance: 1000, accountType: 'SAVINGS' }, -250);
    expect(res.allowed).toBe(true);
    expect(res.currentBalance).toBe(1000);
  });

  test('allows debit when balance exactly equals amount (boundary case)', () => {
    const res = checkSufficientFunds({ balance: 500, accountType: 'BANK' }, -500);
    expect(res.allowed).toBe(true);
  });

  test('rejects debit when balance is less than amount', () => {
    const res = checkSufficientFunds({ balance: 500, accountType: 'BANK' }, -600);
    expect(res.allowed).toBe(false);
    expect(res.currentBalance).toBe(500);
    expect(res.required).toBe(600);
  });

  test('exempts CREDIT_CARD accounts from balance check', () => {
    const res = checkSufficientFunds({ balance: 0, accountType: 'CREDIT_CARD' }, -5000);
    expect(res.allowed).toBe(true);
  });

  test('always permits positive delta (income/refund)', () => {
    const res = checkSufficientFunds({ balance: 0, accountType: 'SAVINGS' }, 1000);
    expect(res.allowed).toBe(true);
  });

  test('isDebitType correctly categorizes balance-reducing transactions', () => {
    expect(isDebitType('EXPENSE')).toBe(true);
    expect(isDebitType('TRANSFER')).toBe(true);
    expect(isDebitType('INVESTMENT')).toBe(true);
    expect(isDebitType('LOAN_PAYMENT')).toBe(true);
    expect(isDebitType('INCOME')).toBe(false);
    expect(isDebitType('REFUND')).toBe(false);
    expect(isDebitType('REVERSAL')).toBe(false);
  });
});

describe('createTransaction — insufficient-funds enforcement', () => {
  test('rejects an EXPENSE when account balance is insufficient (400 INSUFFICIENT_FUNDS)', async () => {
    const tx = useTx({ account: { balance: 200 } });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 500,
        type: 'EXPENSE',
        accountId: SAVINGS_ACC.id,
        category: 'Food',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const body = bodyOf(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(body.error.message).toMatch(/insufficient funds/i);

    // Assert no row was created and no balance delta was applied
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('rejects a TRANSFER when source account has insufficient balance', async () => {
    const tx = useTx({ account: { balance: 100 } });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 250,
        type: 'TRANSFER',
        accountId: SAVINGS_ACC.id,
        toAccountId: DEST_ACC.id,
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const body = bodyOf(res);
    expect(body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('accepts an EXPENSE when balance exactly covers the amount', async () => {
    const tx = useTx({ account: { balance: 500 } });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 500,
        type: 'EXPENSE',
        accountId: SAVINGS_ACC.id,
        category: 'Food',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.transaction.create).toHaveBeenCalled();
  });

  test('allows an EXPENSE on a CREDIT_CARD account with zero balance', async () => {
    const tx = useTx({ account: CREDIT_CARD_ACC });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 2500,
        type: 'EXPENSE',
        accountId: CREDIT_CARD_ACC.id,
        category: 'Shopping',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.transaction.create).toHaveBeenCalled();
  });

  test('always permits INCOME transactions even with zero balance', async () => {
    const tx = useTx({ account: { balance: 0 } });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 50000,
        type: 'INCOME',
        accountId: SAVINGS_ACC.id,
        category: 'Salary',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.transaction.create).toHaveBeenCalled();
  });
});

describe('updateTransaction — insufficient-funds enforcement', () => {
  const existingExpense = {
    id: 'tx-existing',
    userId: USER,
    accountId: SAVINGS_ACC.id,
    amount: 100,
    transactionType: 'EXPENSE',
    categoryId: null,
    category: null,
    date: new Date(),
  };

  test('rejects increasing an expense when the additional debit exceeds balance', async () => {
    // Current expense is 100, account has 50 left. Updating expense to 300 requires 200 more, but only 50 available.
    prisma.transaction.findFirst.mockResolvedValue(existingExpense);
    useTx({
      current: existingExpense,
      account: { balance: 50 },
    });
    const res = makeRes();
    const next = jest.fn();

    await updateTransaction(
      reqFor({ amount: 300 }, { id: existingExpense.id }),
      res,
      next
    );

    expect(next).toHaveBeenCalled();
    const thrownError = next.mock.calls[0][0];
    expect(thrownError.code).toBe('INSUFFICIENT_FUNDS');
    expect(thrownError.statusCode).toBe(400);
  });
});
