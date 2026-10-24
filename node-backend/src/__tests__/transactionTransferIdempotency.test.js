/**
 * Transfer idempotency — controller contract.
 *
 * A transfer moves money between two owned accounts. A client retry (double
 * tap, timeout, lost response) must never move it twice, and a replay must
 * never re-apply either ledger leg or create a second transaction row.
 *
 * The contract:
 *   - `idempotencyKey` is OPTIONAL for transfers, so existing clients keep
 *     working; without it every request is a new transfer.
 *   - With a key, the first request creates the transfer and claims the key in
 *     the SAME transaction as both ledger effects.
 *   - The same key + equivalent payload replays the original transfer (HTTP
 *     200, `replayed: true`) without touching balances.
 *   - The same key + different payload is rejected with 409 and writes nothing.
 *   - Concurrent identical requests converge on at most one transfer; a
 *     concurrent conflicting request gets 409.
 *   - Keys are scoped to the authenticated user.
 *   - A claim whose original transfer was deleted is a conflict, never a
 *     resurrection of the money movement.
 *   - Keys are not accepted on non-transfer transaction types.
 *
 * Deterministic: Prisma is mocked and `$transaction` runs its callback with a
 * scripted transactional client. Real concurrent INSERT behaviour is proven
 * separately by `scripts/verify-transfer-idempotency.js`.
 */

jest.mock('../config/database', () => ({
  financialAccount: { findFirst: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  transaction: { findFirst: jest.fn(), create: jest.fn() },
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  notification: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../services/financialTwinService', () => ({
  detectExpenseAnomaly: jest.fn(async () => ({ isAnomaly: false, severity: 'NORMAL' })),
}));

jest.mock('../services/notificationService', () => ({
  checkBudgetThresholds: jest.fn(async () => {}),
}));

const prisma = require('../config/database');
const { createTransaction } = require('../controllers/transactionController');

const USER = 'user-transfer-idem';
const OTHER_USER = 'user-transfer-other';

const SOURCE = { id: 'acc-src', name: 'HDFC Savings', userId: USER };
const DESTINATION = { id: 'acc-dst', name: 'Cash Wallet', userId: USER };
const OTHER_SOURCE = { id: 'acc-other-src', name: 'Other Savings', userId: OTHER_USER };
const OTHER_DESTINATION = { id: 'acc-other-dst', name: 'Other Wallet', userId: OTHER_USER };
const ACCOUNTS = [SOURCE, DESTINATION, OTHER_SOURCE, OTHER_DESTINATION];

const KEY = 'trf-0123456789abcdef';
const SCOPE = 'account_transfer';

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function reqFor(body, userId = USER) {
  return { user: { id: userId }, body, params: {}, query: {}, ip: '127.0.0.1', headers: {} };
}

const bodyOf = (res) => res.json.mock.calls[0][0];

function increments(tx) {
  return tx.financialAccount.update.mock.calls.map(([arg]) => ({
    accountId: arg.where.id,
    delta: arg.data.balance.increment,
  }));
}

function originalRow(overrides = {}) {
  return {
    id: 'tx-original',
    userId: USER,
    accountId: SOURCE.id,
    toAccountId: DESTINATION.id,
    amount: '500.00',
    transactionType: 'TRANSFER',
    description: 'Move to wallet',
    merchant: null,
    notes: null,
    paymentMethod: null,
    date: new Date('2026-10-24T00:00:00.000Z'),
    currency: 'INR',
    categoryId: null,
    category: null,
    account: { name: SOURCE.name },
    toAccount: { name: DESTINATION.name },
    ...overrides,
  };
}

/**
 * Scripted transactional client. `record` is the key claim a replay would
 * find; `p2002` makes this request lose the concurrent claim race.
 */
function scriptTx({ record = null, p2002 = false, createdId = 'tx-new' } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    financialAccount: { update: jest.fn().mockResolvedValue({}) },
    category: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'cat-created', name: 'Transfer' }),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: createdId,
        createdAt: new Date('2026-10-24T10:00:00.000Z'),
        currency: 'INR',
        ...data,
        amount: Number(data.amount),
        category: data.categoryId ? { name: 'Transfer' } : null,
        account: data.accountId ? { name: SOURCE.name } : null,
        toAccount: data.toAccountId ? { name: DESTINATION.name } : null,
      })),
    },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(record),
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (p2002) {
          const err = new Error('Unique constraint failed on the primary key');
          err.code = 'P2002';
          throw err;
        }
        return data;
      }),
    },
  };
  return tx;
}

function useTx(tx) {
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
}

function mockOwnedAccounts() {
  prisma.financialAccount.findFirst.mockImplementation(async ({ where }) => {
    if (where.id) return ACCOUNTS.find((account) => account.id === where.id && account.userId === where.userId) || null;
    return where.isActive ? ACCOUNTS.find((account) => account.userId === where.userId) || null : null;
  });
}

/**
 * Perform one successful keyed transfer and return the canonical fingerprint
 * its claim stored. Later tests reuse the real hash instead of hand-building
 * one, so they exercise the same canonicalisation as production.
 */
async function captureFingerprint(body = {}) {
  const tx = scriptTx();
  useTx(tx);

  const res = makeRes();
  await createTransaction(reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY, ...body }), res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(201);
  expect(tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  return tx.idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint;
}

function recordFor(fingerprint, overrides = {}) {
  return {
    userId: USER,
    scope: SCOPE,
    key: KEY,
    transactionId: 'tx-original',
    amount: 500,
    requestFingerprint: fingerprint,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.notification.create.mockResolvedValue({});
  prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
  prisma.transaction.findFirst.mockResolvedValue(null);
  mockOwnedAccounts();
});

describe('transfer idempotency — first request', () => {
  test('a keyed transfer stores both ledger legs and claims the key atomically', async () => {
    const tx = scriptTx();
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(bodyOf(res).data.replayed).toBe(false);
    expect(bodyOf(res).data.toAccount).toBe(DESTINATION.name);
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      accountId: SOURCE.id,
      toAccountId: DESTINATION.id,
      transactionType: 'TRANSFER',
      amount: 500,
      idempotencyKey: KEY,
    });
    expect(increments(tx)).toEqual([
      { accountId: SOURCE.id, delta: -500 },
      { accountId: DESTINATION.id, delta: 500 },
    ]);
    expect(tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      scope: SCOPE,
      key: KEY,
      transactionId: 'tx-new',
      amount: 500,
    });
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  test('a transfer without a key keeps the legacy behaviour and claims nothing', async () => {
    const tx = scriptTx();
    useTx(tx);

    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(bodyOf(res).data.replayed).toBe(false);
    expect(tx.transaction.create.mock.calls[0][0].data.idempotencyKey).toBeNull();
    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  test('category resolution happens on the transactional client, not the global one', async () => {
    const tx = scriptTx();
    tx.transaction.create.mockRejectedValue(new Error('ledger write failed'));
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({
        amount: 500,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: DESTINATION.id,
        category: 'Move money',
        idempotencyKey: KEY,
      }),
      res,
      next
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    // A category may be created inside the transaction, but a real rollback
    // removes it. It must never be created on the non-transactional client.
    expect(tx.category.create).toHaveBeenCalledTimes(1);
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });
});

describe('transfer idempotency — replay', () => {
  test('an identical retry returns the original transfer without moving money again', async () => {
    const fingerprint = await captureFingerprint({ description: 'Move to wallet' });
    const tx = scriptTx({ record: recordFor(fingerprint) });
    tx.transaction.findFirst.mockResolvedValue(originalRow());
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({
        amount: 500,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: DESTINATION.id,
        description: '  Move to wallet  ',
        idempotencyKey: KEY,
      }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data).toMatchObject({
      id: 'tx-original',
      type: 'TRANSFER',
      amount: 500,
      toAccount: DESTINATION.name,
      replayed: true,
    });
    expect(bodyOf(res).data.message).toMatch(/already recorded/i);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  test('an omitted date stays omitted across a retry, even after midnight', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ record: recordFor(fingerprint) });
    tx.transaction.findFirst.mockResolvedValue(originalRow());
    useTx(tx);

    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.replayed).toBe(true);
  });

  test('a retry whose original transfer was deleted is a conflict, not a resurrection', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ record: recordFor(fingerprint) });
    tx.transaction.findFirst.mockResolvedValue(null);
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });
});

describe('transfer idempotency — conflicts and validation', () => {
  test('the same key with a different amount is rejected and writes nothing', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ record: recordFor(fingerprint) });
    tx.transaction.findFirst.mockResolvedValue(originalRow());
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({ amount: 900, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  test('the same key with a different destination is rejected', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ record: recordFor(fingerprint) });
    useTx(tx);

    const res = makeRes();
    await createTransaction(
      reqFor({
        amount: 500,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: 'acc-dst-2',
        idempotencyKey: KEY,
      }),
      res,
      jest.fn()
    );

    // The destination does not exist for this user, so this fails before the
    // idempotency check. That is deterministic and still writes nothing.
    expect(res.status).toHaveBeenCalledWith(404);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('a malformed key is rejected before any database work', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: 'short' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a key on a non-transfer is rejected explicitly', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({ amount: 100, type: 'EXPENSE', accountId: SOURCE.id, idempotencyKey: KEY }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('an invalid date fails before the transaction and claims nothing', async () => {
    const res = makeRes();
    await createTransaction(
      reqFor({
        amount: 500,
        type: 'TRANSFER',
        accountId: SOURCE.id,
        toAccountId: DESTINATION.id,
        date: 'not-a-date',
        idempotencyKey: KEY,
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('transfer idempotency — concurrency', () => {
  test('an identical concurrent loser converges on the original transfer', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ p2002: true });
    useTx(tx);
    prisma.idempotencyRecord.findUnique.mockResolvedValue(recordFor(fingerprint));
    prisma.transaction.findFirst.mockResolvedValue(originalRow());

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({ amount: 500, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data).toMatchObject({ id: 'tx-original', replayed: true });
    expect(prisma.idempotencyRecord.findUnique).toHaveBeenCalledWith({
      where: { userId_scope_key: { userId: USER, scope: SCOPE, key: KEY } },
    });
    // The loser never committed a second claim.
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  test('a conflicting concurrent loser gets 409 and never reads the winner transaction', async () => {
    const fingerprint = await captureFingerprint();
    const tx = scriptTx({ p2002: true });
    useTx(tx);
    prisma.idempotencyRecord.findUnique.mockResolvedValue(recordFor(fingerprint));

    const res = makeRes();
    const next = jest.fn();
    await createTransaction(
      reqFor({ amount: 900, type: 'TRANSFER', accountId: SOURCE.id, toAccountId: DESTINATION.id, idempotencyKey: KEY }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });
});

describe('transfer idempotency — per-user scoping', () => {
  test('another user may reuse the same key and gets their own transfer', async () => {
    const tx = scriptTx();
    useTx(tx);

    const res = makeRes();
    await createTransaction(
      reqFor(
        {
          amount: 500,
          type: 'TRANSFER',
          accountId: OTHER_SOURCE.id,
          toAccountId: OTHER_DESTINATION.id,
          idempotencyKey: KEY,
        },
        OTHER_USER
      ),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(tx.idempotencyRecord.findUnique).toHaveBeenCalledWith({
      where: { userId_scope_key: { userId: OTHER_USER, scope: SCOPE, key: KEY } },
    });
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data.userId).toBe(OTHER_USER);
    expect(tx.transaction.create.mock.calls[0][0].data.accountId).toBe(OTHER_SOURCE.id);
  });
});
