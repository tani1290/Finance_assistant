/**
 * Phase 5 — Import idempotency regression tests.
 *
 * Replaying a confirmation (mobile double-tap, network retry after a successful
 * write) must never create a second expense or move an account balance twice.
 * This suite locks in the guards added to `confirmReceipt` and
 * `confirmBankStatementImport`.
 *
 * Deterministic by construction: `../config/database` is mocked, so no database
 * is required and the fake `$transaction` simply invokes its callback with a
 * scripted transactional client.
 */

jest.mock('../config/database', () => ({
  receiptScan: { findFirst: jest.fn(), findMany: jest.fn() },
  transaction: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  financialAccount: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require('../config/database');
const { confirmReceipt, confirmBankStatementImport } = require('../controllers/ocrImportController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const reqFor = (body) => ({ user: { id: 'user-1' }, body });

const bodyOf = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('confirmReceipt — replay safety', () => {
  it('returns the original transaction for an already-CONFIRMED scan without creating a second expense', async () => {
    prisma.receiptScan.findFirst.mockResolvedValue({ id: 'scan-1', status: 'CONFIRMED', transactionId: 'tx-1' });
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-1', amount: 250 });

    const res = makeRes();
    const next = jest.fn();
    await confirmReceipt(reqFor({ scanId: 'scan-1', amount: 250 }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.alreadyConfirmed).toBe(true);
    expect(bodyOf(res).data.transaction.id).toBe('tx-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('converges on the existing expense when a concurrent request wins the claim race', async () => {
    prisma.receiptScan.findFirst
      .mockResolvedValueOnce({ id: 'scan-2', status: 'PENDING_CONFIRMATION', transactionId: null })
      .mockResolvedValueOnce({ id: 'scan-2', status: 'CONFIRMED', transactionId: 'tx-2' });
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });
    prisma.category.findFirst.mockResolvedValue({ id: 'cat-1', name: 'Food & Dining' });
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-2', amount: 250 });

    prisma.$transaction.mockImplementation(async (fn) => fn({
      receiptScan: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      transaction: { create: jest.fn() },
      financialAccount: { update: jest.fn() },
    }));

    const res = makeRes();
    const next = jest.fn();
    await confirmReceipt(reqFor({ scanId: 'scan-2', amount: 250 }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.alreadyConfirmed).toBe(true);
  });

  it('claims the scan and records exactly one expense on a fresh confirmation', async () => {
    prisma.receiptScan.findFirst.mockResolvedValue({ id: 'scan-3', status: 'PENDING_CONFIRMATION', transactionId: null });
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });
    prisma.category.findFirst.mockResolvedValue({ id: 'cat-1', name: 'Food & Dining' });

    const create = jest.fn().mockResolvedValue({ id: 'tx-3', amount: 250 });
    const updateAccount = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 }) // atomic claim
      .mockResolvedValueOnce({ count: 1 }); // set transactionId

    prisma.$transaction.mockImplementation(async (fn) => fn({
      receiptScan: { updateMany },
      transaction: { create },
      financialAccount: { update: updateAccount },
    }));

    const res = makeRes();
    const next = jest.fn();
    await confirmReceipt(reqFor({ scanId: 'scan-3', amount: 250, merchant: 'Cafe' }), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateAccount).toHaveBeenCalledTimes(1);
    expect(bodyOf(res).data.transaction.id).toBe('tx-3');
  });
});

describe('confirmBankStatementImport — retry safety', () => {
  it('skips rows already committed on retry and does not move the balance again', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });

    const updateAccount = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn) => fn({
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'tx-1', amount: 100, date: new Date('2026-08-10'), description: 'Grocery', transactionType: 'EXPENSE' },
        ]),
        create: jest.fn(),
      },
      category: { findFirst: jest.fn(), create: jest.fn() },
      financialAccount: { update: updateAccount },
    }));

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [{ amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' }],
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(bodyOf(res).data.importedCount).toBe(0);
    expect(bodyOf(res).data.skippedDuplicateCount).toBe(1);
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('imports fresh rows once and skips an identical row repeated in the same payload', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });

    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'tx-new',
      amount: data.amount,
      date: data.date,
      description: data.description,
      transactionType: data.transactionType,
    }));
    const updateAccount = jest.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (fn) => fn({
      transaction: { findMany: jest.fn().mockResolvedValue([]), create },
      category: { findFirst: jest.fn(), create: jest.fn() },
      financialAccount: { update: updateAccount },
    }));

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [
        { amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' },
        { amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' },
      ],
    }), res, next);

    const data = bodyOf(res).data;
    expect(data.importedCount).toBe(1);
    expect(data.skippedDuplicateCount).toBe(1);
    expect(data.netBalanceImpact).toBe(-100);
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateAccount).toHaveBeenCalledTimes(1);
  });

  it('runs under Serializable isolation and retries a serialization conflict', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });

    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'tx-new',
      amount: data.amount,
      date: data.date,
      description: data.description,
      transactionType: data.transactionType,
    }));
    const updateAccount = jest.fn().mockResolvedValue({});
    const conflict = Object.assign(
      new Error('could not serialize access due to concurrent update'),
      { code: 'P2034' }
    );

    // Attempt 1 loses a concurrent-confirmation race and is aborted by Postgres;
    // attempt 2 sees a clean slate and imports normally.
    prisma.$transaction
      .mockImplementationOnce(async () => { throw conflict; })
      .mockImplementationOnce(async (fn) => fn({
        transaction: { findMany: jest.fn().mockResolvedValue([]), create },
        category: { findFirst: jest.fn(), create: jest.fn() },
        financialAccount: { update: updateAccount },
      }));

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [{ amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' }],
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    for (const call of prisma.$transaction.mock.calls) {
      expect(call[1]).toMatchObject({ isolationLevel: 'Serializable' });
    }
    expect(bodyOf(res).data.importedCount).toBe(1);
    expect(bodyOf(res).data.netBalanceImpact).toBe(-100);
    expect(updateAccount).toHaveBeenCalledTimes(1);
  });

  it('converges the losing concurrent confirmation to a reported no-op (no double balance move)', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });
    const updateAccount = jest.fn().mockResolvedValue({});
    const conflict = Object.assign(
      new Error('could not serialize access due to concurrent update'),
      { code: 'P2034' }
    );

    // Attempt 1 lost the race; on retry the winning row is already committed, so
    // the payload must be recognised as an exact duplicate and skipped.
    prisma.$transaction
      .mockImplementationOnce(async () => { throw conflict; })
      .mockImplementationOnce(async (fn) => fn({
        transaction: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'tx-winner', amount: 100, date: new Date('2026-08-10'), description: 'Grocery', transactionType: 'EXPENSE' },
          ]),
          create: jest.fn(),
        },
        category: { findFirst: jest.fn(), create: jest.fn() },
        financialAccount: { update: updateAccount },
      }));

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [{ amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' }],
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(bodyOf(res).data.importedCount).toBe(0);
    expect(bodyOf(res).data.skippedDuplicateCount).toBe(1);
    expect(bodyOf(res).data.netBalanceImpact).toBe(0);
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('gives up after the bounded retry budget when conflicts persist', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });
    const conflict = Object.assign(
      new Error('could not serialize access due to concurrent update'),
      { code: 'P2034' }
    );
    prisma.$transaction.mockImplementation(async () => { throw conflict; });

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [{ amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' }],
    }), res, next);

    expect(res.status).not.toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry a non-conflict database error', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1', name: 'Primary' });
    const boom = Object.assign(new Error('relation "Transaction" does not exist'), { code: 'P2021' });
    prisma.$transaction.mockImplementation(async () => { throw boom; });

    const res = makeRes();
    const next = jest.fn();
    await confirmBankStatementImport(reqFor({
      rows: [{ amount: 100, type: 'EXPENSE', description: 'Grocery', date: '2026-08-10' }],
    }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
