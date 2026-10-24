/**
 * Transfers, ledger effects and pagination — controller contract.
 *
 * A transfer is the only transaction that touches two accounts. Getting it
 * wrong corrupts balances in a way that is hard to notice, so these tests pin
 * the invariants:
 *
 *   - creating a transfer debits the source and credits the destination in
 *     one atomic write, and stores `toAccountId`;
 *   - the source and destination must be distinct and both owned by the user;
 *   - `toAccountId` is rejected on non-transfers;
 *   - PATCH cannot convert a row to or from a transfer;
 *   - PATCH replaces the old ledger effect instead of stacking a second one;
 *   - DELETE reverses every leg, including legacy transfers with no
 *     destination (which only ever had a source debit);
 *   - list pagination rejects out-of-range values instead of coercing them;
 *   - the list `type` filter is validated against the supported enum.
 *
 * Deterministic: Prisma is mocked and `$transaction` runs its callback with a
 * scripted transactional client. No database or network is touched.
 */

jest.mock('../config/database', () => ({
  financialAccount: { findFirst: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
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
  deleteTransaction,
  getTransactions,
} = require('../controllers/transactionController');
const {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
} = require('../services/transactionBalance');

const USER = 'user-transfer';

const SOURCE = { id: 'acc-src', name: 'HDFC Savings', userId: USER };
const DESTINATION = { id: 'acc-dst', name: 'Cash Wallet', userId: USER };
const THIRD = { id: 'acc-third', name: 'Cash in Hand', userId: USER };
const ACCOUNTS = {
  [SOURCE.id]: SOURCE,
  [DESTINATION.id]: DESTINATION,
  [THIRD.id]: THIRD,
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

/** Every balance write, flattened for easy assertions. */
function increments(tx) {
  return tx.financialAccount.update.mock.calls.map(([arg]) => ({
    accountId: arg.where.id,
    delta: arg.data.balance.increment,
  }));
}

/**
 * Wire `$transaction` to a scripted client. The client's `update` records each
 * increment and returns the merged row so the controller can serialise a
 * realistic response.
 */
function useTx({ current = null, createId = 'tx-new' } = {}) {
  const tx = {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(current),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: createId,
        createdAt: new Date('2026-10-24T10:00:00.000Z'),
        currency: 'INR',
        ...data,
        category: data.categoryId ? { name: 'Transfer' } : null,
        account: data.accountId ? { name: 'HDFC Savings' } : null,
        toAccount: data.toAccountId ? { name: 'Cash Wallet' } : null,
      })),
      update: jest.fn().mockImplementation(async ({ data }) => ({
        ...(current || {}),
        ...data,
        category: current?.category || null,
        account: { name: 'HDFC Savings' },
        toAccount: (data.toAccountId === undefined ? current?.toAccountId : data.toAccountId)
          ? { name: 'Cash Wallet' }
          : null,
      })),
      delete: jest.fn().mockResolvedValue({}),
    },
    financialAccount: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

/** Owned account lookup; an account not in the fixture belongs to someone else. */
function mockOwnedAccounts() {
  prisma.financialAccount.findFirst.mockImplementation(async ({ where }) => {
    if (where.id) return ACCOUNTS[where.id] || null;
    return where.isActive ? SOURCE : null;
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.notification.create.mockResolvedValue({});
  prisma.category.findFirst.mockResolvedValue({ id: 'cat-transfer', name: 'Transfer' });
  mockOwnedAccounts();
});

describe('transactionEffects — ledger maths', () => {
  test('a transfer debits the source and credits the destination', () => {
    expect(
      transactionEffects({
        transactionType: 'TRANSFER',
        amount: 250,
        accountId: SOURCE.id,
        toAccountId: DESTINATION.id,
      })
    ).toEqual([
      { accountId: SOURCE.id, delta: -250 },
      { accountId: DESTINATION.id, delta: 250 },
    ]);
  });

  test('a legacy transfer without a destination only debits the source', () => {
    expect(
      transactionEffects({
        transactionType: 'TRANSFER',
        amount: 250,
        accountId: SOURCE.id,
        toAccountId: null,
      })
    ).toEqual([{ accountId: SOURCE.id, delta: -250 }]);
  });

  test('income credits and every outflow debits the source', () => {
    expect(transactionEffects({ transactionType: 'INCOME', amount: 100, accountId: SOURCE.id })).toEqual([
      { accountId: SOURCE.id, delta: 100 },
    ]);
    for (const transactionType of ['EXPENSE', 'INVESTMENT', 'LOAN_PAYMENT']) {
      expect(transactionEffects({ transactionType, amount: 100, accountId: SOURCE.id })).toEqual([
        { accountId: SOURCE.id, delta: -100 },
      ]);
    }
  });

  test('an unassigned or zero-amount row has no ledger effect', () => {
    expect(transactionEffects({ transactionType: 'EXPENSE', amount: 100, accountId: null })).toEqual([]);
    expect(transactionEffects({ transactionType: 'EXPENSE', amount: 0, accountId: SOURCE.id })).toEqual([]);
  });

  test('reversal is the exact inverse, including both transfer legs', () => {
    const row = {
      transactionType: 'TRANSFER',
      amount: '125.50',
      accountId: SOURCE.id,
      toAccountId: DESTINATION.id,
    };
    expect(reverseEffects(row)).toEqual([
      { accountId: SOURCE.id, delta: 125.5 },
      { accountId: DESTINATION.id, delta: -125.5 },
    ]);
  });

  test('applyEffects aggregates per account and skips net-zero writes', async () => {
    const tx = { financialAccount: { update: jest.fn().mockResolvedValue({}) } };
    await applyEffects(tx, [
      { accountId: SOURCE.id, delta: -100 },
      { accountId: DESTINATION.id, delta: 100 },
      { accountId: SOURCE.id, delta: 100 },
      { accountId: DESTINATION.id, delta: -100 },
    ]);

    // Reversing and re-applying the same transfer nets to zero: no writes.
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('revertEffects applies the inverse once per account', async () => {
    const tx = { financialAccount: { update: jest.fn().mockResolvedValue({}) } };
    await revertEffects(tx, {
      transactionType: 'TRANSFER',
      amount: 100,
      accountId: SOURCE.id,
      toAccountId: DESTINATION.id,
    });
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: 100 },
      { accountId: DESTINATION.id, delta: -100 },
    ]);
  });
});

describe('createTransaction — transfer', () => {
  test('records both legs, stores the destination and reports it', async () => {
    const tx = useTx({ createId: 'tx-transfer' });
    const res = makeRes();

    await createTransaction(
      reqFor({
        amount: 500,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: DESTINATION.id,
        description: 'Move to wallet',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: SOURCE.id,
          toAccountId: DESTINATION.id,
          transactionType: 'TRANSFER',
          amount: 500,
        }),
      })
    );
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: -500 },
      { accountId: DESTINATION.id, delta: 500 },
    ]);
    expect(bodyOf(res).data.toAccount).toBe('Cash Wallet');
    expect(bodyOf(res).data.message).toContain('Cash Wallet');
  });

  test('rejects a destination on a non-transfer before writing anything', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 100, type: 'EXPENSE', accountId: SOURCE.id, toAccountId: DESTINATION.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a transfer with no destination', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 100, type: 'TRANSFER', accountId: SOURCE.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/destination/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a transfer to the same account', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 100, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: SOURCE.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/must differ/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("rejects a destination owned by another user", async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({
        amount: 100,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: 'acc-someone-else',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('NOT_FOUND');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a source account owned by another user', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 100, type: 'TRANSFER', accountId: 'acc-someone-else', toAccountId: DESTINATION.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.message).toMatch(/account not found/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a transfer when the user has no account at all', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue(null);
    const res = makeRes();
    await createTransaction(reqFor({ amount: 100, type: 'TRANSFER' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/source account/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('defaults the source to the oldest active account when omitted', async () => {
    const tx = useTx();
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 75, type: 'TRANSFER', toAccountId: DESTINATION.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.transaction.create.mock.calls[0][0].data.accountId).toBe(SOURCE.id);
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: -75 },
      { accountId: DESTINATION.id, delta: 75 },
    ]);
  });
});

describe('updateTransaction — ledger replacement', () => {
  const existingTransfer = {
    id: 'tx-transfer',
    userId: USER,
    accountId: SOURCE.id,
    toAccountId: DESTINATION.id,
    amount: 100,
    transactionType: 'TRANSFER',
    categoryId: null,
    category: null,
    date: new Date(Date.UTC(2026, 9, 24)),
  };

  test('changing the amount reverses the old legs before applying the new ones', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const tx = useTx({ current: existingTransfer });
    const res = makeRes();

    await updateTransaction(reqFor({ amount: 250 }, { id: 'tx-transfer' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    // source: +100 (reversal) -250 (new) = -150
    // destination: -100 (reversal) +250 (new) = +150
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: -150 },
      { accountId: DESTINATION.id, delta: 150 },
    ]);
  });

  test('changing the destination moves the credit without touching the source', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const tx = useTx({ current: existingTransfer });
    const res = makeRes();

    await updateTransaction(
      reqFor({ toAccountId: THIRD.id }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    // source: +100 -100 = 0 (skipped), old destination -100, new +100
    expect(increments(tx)).toEqual([
      { accountId: DESTINATION.id, delta: -100 },
      { accountId: THIRD.id, delta: 100 },
    ]);
  });

  test('changing the source moves the debit and keeps the destination credit', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const tx = useTx({ current: existingTransfer });
    const res = makeRes();

    await updateTransaction(
      reqFor({ accountId: THIRD.id }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    // old source +100, new source -100, destination nets to zero.
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: 100 },
      { accountId: THIRD.id, delta: -100 },
    ]);
  });

  test('rejects converting a transfer into another type', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const res = makeRes();
    await updateTransaction(
      reqFor({ type: 'EXPENSE' }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/converted/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects converting a non-transfer into a transfer', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      ...existingTransfer,
      transactionType: 'EXPENSE',
      toAccountId: null,
    });
    const res = makeRes();
    await updateTransaction(
      reqFor({ type: 'TRANSFER', toAccountId: DESTINATION.id }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/converted/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a destination equal to the stored source', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const res = makeRes();
    await updateTransaction(
      reqFor({ toAccountId: SOURCE.id }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/must differ/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a destination owned by another user', async () => {
    prisma.transaction.findFirst.mockResolvedValue(existingTransfer);
    const res = makeRes();
    await updateTransaction(
      reqFor({ toAccountId: 'acc-someone-else' }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('NOT_FOUND');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is scoped to the authenticated user', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);
    const res = makeRes();
    await updateTransaction(reqFor({ amount: 200 }, { id: 'tx-other' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.transaction.findFirst.mock.calls[0][0].where).toEqual({
      id: 'tx-other',
      userId: USER,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('moving an expense between accounts reverses the old debit', async () => {
    const expense = {
      ...existingTransfer,
      transactionType: 'EXPENSE',
      toAccountId: null,
    };
    prisma.transaction.findFirst.mockResolvedValue(expense);
    const tx = useTx({ current: expense });
    const res = makeRes();

    await updateTransaction(
      reqFor({ accountId: THIRD.id }, { id: 'tx-transfer' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: 100 },
      { accountId: THIRD.id, delta: -100 },
    ]);
  });
});

describe('deleteTransaction — reversal', () => {
  test('reverses both legs of a transfer', async () => {
    const existing = {
      id: 'tx-transfer',
      userId: USER,
      accountId: SOURCE.id,
      toAccountId: DESTINATION.id,
      amount: 100,
      transactionType: 'TRANSFER',
    };
    prisma.transaction.findFirst.mockResolvedValue(existing);
    const tx = useTx();
    const res = makeRes();

    await deleteTransaction(reqFor({}, { id: 'tx-transfer' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: 100 },
      { accountId: DESTINATION.id, delta: -100 },
    ]);
    expect(tx.transaction.delete).toHaveBeenCalledWith({ where: { id: 'tx-transfer' } });
  });

  test('a legacy destination-less transfer only refunds the source', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-legacy',
      userId: USER,
      accountId: SOURCE.id,
      toAccountId: null,
      amount: 100,
      transactionType: 'TRANSFER',
    });
    const tx = useTx();
    const res = makeRes();

    await deleteTransaction(reqFor({}, { id: 'tx-legacy' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(increments(tx)).toEqual([{ accountId: SOURCE.id, delta: 100 }]);
  });

  test("cannot delete another user's transaction", async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);
    const res = makeRes();
    await deleteTransaction(reqFor({}, { id: 'tx-other' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('getTransactions — pagination and filters', () => {
  beforeEach(() => {
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.count.mockResolvedValue(0);
  });

  test.each([
    ['page', 'abc'],
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
    ['page', ''],
    ['limit', '0'],
    ['limit', '101'],
    ['limit', 'abc'],
    ['limit', ''],
  ])('rejects %s=%p', async (key, value) => {
    const res = makeRes();
    await getTransactions(reqFor({}, {}, { [key]: value }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  test('applies bounded defaults and includes the destination relation', async () => {
    const res = makeRes();
    await getTransactions(reqFor(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        include: expect.objectContaining({ toAccount: { select: { name: true } } }),
      })
    );
    expect(bodyOf(res).data.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  test('accepts the maximum limit and computes the skip', async () => {
    const res = makeRes();
    await getTransactions(reqFor({}, {}, { page: '3', limit: '100' }), res, jest.fn());

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 200, take: 100 })
    );
  });

  test('rejects an unsupported type filter', async () => {
    const res = makeRes();
    await getTransactions(reqFor({}, {}, { type: 'REFUND' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  test('normalises a lowercase type filter', async () => {
    const res = makeRes();
    await getTransactions(reqFor({}, {}, { type: 'transfer' }), res, jest.fn());

    expect(prisma.transaction.findMany.mock.calls[0][0].where.transactionType).toBe('TRANSFER');
  });

  test('serialises the destination name and keeps it null for non-transfers', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        amount: '100',
        transactionType: 'TRANSFER',
        category: { name: 'Transfer' },
        account: { name: 'HDFC Savings' },
        toAccount: { name: 'Cash Wallet' },
        description: 'move',
        merchant: '',
        date: new Date(Date.UTC(2026, 9, 24)),
        currency: 'INR',
        createdAt: new Date('2026-10-24T10:00:00.000Z'),
      },
      {
        id: 't2',
        amount: '50',
        transactionType: 'EXPENSE',
        category: null,
        account: { name: 'HDFC Savings' },
        toAccount: null,
        description: '',
        merchant: 'Cafe',
        date: new Date(Date.UTC(2026, 9, 23)),
        currency: 'INR',
        createdAt: new Date('2026-10-23T10:00:00.000Z'),
      },
    ]);
    const res = makeRes();

    await getTransactions(reqFor(), res, jest.fn());

    const [transfer, expense] = bodyOf(res).data.transactions;
    expect(transfer.toAccount).toBe('Cash Wallet');
    expect(transfer.date).toBe('2026-10-24');
    expect(expense.toAccount).toBeNull();
  });

  test('scopes every query to the authenticated user', async () => {
    const res = makeRes();
    await getTransactions(reqFor(), res, jest.fn());

    expect(prisma.transaction.findMany.mock.calls[0][0].where.userId).toBe(USER);
    expect(prisma.transaction.count.mock.calls[0][0].where.userId).toBe(USER);
  });
});
