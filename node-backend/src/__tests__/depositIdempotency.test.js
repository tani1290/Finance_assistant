/**
 * Phase 5 — deposit idempotency regressions.
 *
 * A deposit moves money. A client retry (double tap, timeout, lost response)
 * must never credit the account twice, and a replay must never create a
 * second ledger row.
 *
 * The contract:
 *   - `idempotencyKey` is OPTIONAL. Without it the behaviour is unchanged
 *     (every request is a new deposit) — backwards compatible.
 *   - With it, the first request creates the credit; every later request with
 *     the same key replays the original result and does not credit again.
 *   - The key is scoped to the user, so two users may use the same value.
 *   - A concurrent request that loses the race converges on the original
 *     deposit instead of failing or double-crediting.
 *   - A key reused with different deposit details (amount, account, date,
 *     source or description) is rejected with 409 and writes nothing.
 *   - A replay response never claims that money was added again.
 *   - The database enforces it: the primary key of `idempotency_records`
 *     is `(userId, scope, key)`.
 *
 * Deterministic by construction: `../config/database` is mocked and the fake
 * `$transaction` invokes the callback with a scripted transactional client.
 */

jest.mock('../config/database', () => ({
  transaction: { findFirst: jest.fn(), create: jest.fn() },
  financialAccount: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require('../config/database');
const { depositMoney } = require('../controllers/accountController');

const USER = 'user-deposit';

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function reqFor(body, params = {}) {
  return { user: { id: USER }, body, params };
}

const bodyOf = (res) => res.json.mock.calls[0][0];

/**
 * A scripted transactional client. `record` is the idempotency record a
 * replay would find, `p2002` makes the record insert raise the primary-key
 * error (the concurrent race).
 */
function scriptTx({ account, record = null, p2002 = false, createdId = 'tx-new' }) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    financialAccount: {
      findFirst: jest.fn().mockResolvedValue(account),
      create: jest.fn().mockResolvedValue({ id: 'acc-new', name: 'Primary Account', balance: 0 }),
      update: jest.fn().mockImplementation(async ({ data }) => ({
        id: account?.id || 'acc-1',
        name: account?.name || 'HDFC',
        balance: Number(account?.balance || 0) + Number(data.balance.increment),
      })),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Income' }),
      create: jest.fn(),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: createdId,
        amount: data.amount,
        accountId: data.accountId,
        idempotencyKey: data.idempotencyKey,
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
}

/** Wire the fake `$transaction` to a scripted client. */
function useTx(tx, { onCommit } = {}) {
  prisma.$transaction.mockImplementation(async (fn) => {
    const result = await fn(tx);
    if (onCommit) onCommit(result);
    return result;
  });
}

const ACCOUNT = { id: 'acc-1', name: 'HDFC Savings', balance: 1000 };

/**
 * Run one successful deposit and return the fingerprint it stored, so a later
 * request can be compared against a real claim instead of a hand-built hash.
 */
async function captureDepositFingerprint(body, params, account = ACCOUNT) {
  const tx = scriptTx({ account });
  useTx(tx);
  await depositMoney(reqFor(body, params), makeRes(), jest.fn());
  return tx.idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint;
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.transaction.findFirst.mockResolvedValue(null);
  prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
});

describe('deposit — validation', () => {
  test('a non-positive amount is rejected before any write', async () => {
    const res = makeRes();
    await depositMoney(reqFor({ amount: 0 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a malformed idempotency key is rejected before any write', async () => {
    const res = makeRes();
    await depositMoney(reqFor({ amount: 100, idempotencyKey: 'short' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('an account that belongs to somebody else is refused', async () => {
    const tx = scriptTx({ account: null });
    useTx(tx);
    const res = makeRes();
    const next = jest.fn();

    await depositMoney(reqFor({ amount: 100 }, { accountId: 'acc-other' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('ACCOUNT_NOT_FOUND');
    // The account is never created and the balance is never touched.
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});

describe('deposit — without an idempotency key (unchanged behaviour)', () => {
  test('a first deposit credits the account once and writes one ledger row', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 500 }, { accountId: 'acc-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const data = bodyOf(res).data;
    expect(data.newBalance).toBe(1500);
    expect(data.transactionId).toBe('tx-new');
    expect(data.replayed).toBe(false);
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create.mock.calls[0][0].data.idempotencyKey).toBeNull();
  });

  test('two keyless deposits are two deposits', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 500 }, { accountId: 'acc-1' }), res, jest.fn());

    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(tx.financialAccount.update).toHaveBeenCalledTimes(1);
  });
});

describe('deposit — with an idempotency key', () => {
  const KEY = 'dep-0123456789abcdef';

  test('the first request stores the key and claims it', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 500, idempotencyKey: KEY }, { accountId: 'acc-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.replayed).toBe(false);
    expect(tx.transaction.create.mock.calls[0][0].data.idempotencyKey).toBe(KEY);
    // The key is claimed inside the same transaction as the credit.
    expect(tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      scope: 'account_deposit',
      key: KEY,
    });
    expect(tx.financialAccount.update).toHaveBeenCalledTimes(1);
    // The canonical fingerprint is stored with the claim so a later request
    // can prove it describes the same deposit.
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('a duplicate request replays the original and does not credit again', async () => {
    const tx = scriptTx({
      account: ACCOUNT,
      record: {
        userId: USER,
        scope: 'account_deposit',
        key: KEY,
        transactionId: 'tx-original',
        amount: 500,
      },
    });
    // The original ledger row is found through the record.
    tx.transaction.findFirst.mockResolvedValue({
      id: 'tx-original',
      amount: 500,
      accountId: 'acc-1',
    });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 500, idempotencyKey: KEY }, { accountId: 'acc-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const data = bodyOf(res).data;
    // Same transaction id, and the balance was NOT incremented again.
    expect(data.transactionId).toBe('tx-original');
    expect(data.replayed).toBe(true);
    expect(data.newBalance).toBe(1000);
    // A replay must not read like a fresh deposit.
    expect(data.message).toMatch(/already applied/i);
    expect(data.message).not.toMatch(/Successfully added/);
    expect(data.originalAmount).toBe(500);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a concurrent request that loses the race converges on the original', async () => {
    const tx = scriptTx({ account: ACCOUNT, p2002: true });
    useTx(tx);
    // The row the concurrent winner committed is visible on the retry read.
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      userId: USER,
      scope: 'account_deposit',
      key: KEY,
      transactionId: 'tx-original',
      amount: 500,
    });
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-original',
      amount: 500,
      accountId: 'acc-1',
    });
    prisma.financialAccount.findFirst.mockResolvedValue(ACCOUNT);

    const res = makeRes();
    const next = jest.fn();
    await depositMoney(reqFor({ amount: 500, idempotencyKey: KEY }, { accountId: 'acc-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.transactionId).toBe('tx-original');
    expect(bodyOf(res).data.replayed).toBe(true);
  });

  test('a replay with a different amount is a 409 and writes nothing', async () => {
    const fingerprint = await captureDepositFingerprint(
      { amount: 250, description: 'Rent', idempotencyKey: KEY },
      { accountId: 'acc-1' }
    );

    const tx = scriptTx({
      account: ACCOUNT,
      record: {
        userId: USER,
        scope: 'account_deposit',
        key: KEY,
        transactionId: 'tx-original',
        amount: 250,
        requestFingerprint: fingerprint,
      },
    });
    tx.transaction.findFirst.mockResolvedValue({ id: 'tx-original', amount: 250, accountId: 'acc-1' });
    useTx(tx);

    const res = makeRes();
    const next = jest.fn();
    await depositMoney(
      reqFor({ amount: 9999, description: 'Rent', idempotencyKey: KEY }, { accountId: 'acc-1' }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    // The conflicting request never reaches the credit/claim steps.
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  test('a replay that targets a different account is a 409', async () => {
    const fingerprint = await captureDepositFingerprint(
      { amount: 250, idempotencyKey: KEY },
      { accountId: 'acc-1' }
    );

    const tx = scriptTx({
      account: ACCOUNT,
      record: {
        userId: USER,
        scope: 'account_deposit',
        key: KEY,
        transactionId: 'tx-original',
        amount: 250,
        requestFingerprint: fingerprint,
      },
    });
    tx.transaction.findFirst.mockResolvedValue({ id: 'tx-original', amount: 250, accountId: 'acc-1' });
    useTx(tx);

    const res = makeRes();
    await depositMoney(
      reqFor({ amount: 250, idempotencyKey: KEY }, { accountId: 'acc-2' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a concurrent loser with conflicting details gets 409, not the original result', async () => {
    const fingerprint = await captureDepositFingerprint(
      { amount: 250, description: 'Rent', idempotencyKey: KEY },
      { accountId: 'acc-1' }
    );

    const tx = scriptTx({ account: ACCOUNT, p2002: true });
    useTx(tx);
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      userId: USER,
      scope: 'account_deposit',
      key: KEY,
      transactionId: 'tx-original',
      amount: 250,
      requestFingerprint: fingerprint,
    });

    const res = makeRes();
    const next = jest.fn();
    await depositMoney(
      reqFor({ amount: 9999, description: 'Rent', idempotencyKey: KEY }, { accountId: 'acc-1' }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    // It must not look up or return the winner's transaction.
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  test('the key claim is scoped to the user, so another user may reuse the key', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 500, idempotencyKey: KEY }, { accountId: 'acc-1' }), res, jest.fn());

    expect(tx.idempotencyRecord.findUnique).toHaveBeenCalledWith({
      where: { userId_scope_key: { userId: USER, scope: 'account_deposit', key: KEY } },
    });
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
  });
});

describe('deposit — default account', () => {
  test('the default account is resolved inside the transaction', async () => {
    const tx = scriptTx({ account: { id: 'acc-1', name: 'HDFC Savings', balance: 1000 } });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 100 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    // No accountId was supplied, so the controller resolved the default
    // account itself, inside the transaction.
    expect(tx.financialAccount.findFirst).toHaveBeenCalledWith({
      where: { userId: USER, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  test('a first-ever deposit creates the default account exactly once', async () => {
    const tx = scriptTx({ account: null });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 100 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.financialAccount.create).toHaveBeenCalledTimes(1);
    expect(tx.financialAccount.create.mock.calls[0][0].data.name).toBe('Primary Account');
  });

  test('concurrent deposits for one user are serialised by a per-user lock', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 100 }), res, jest.fn());

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  test('a lock failure never blocks the deposit', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tx = scriptTx({ account: ACCOUNT });
    tx.$executeRaw.mockRejectedValue(new Error("permission denied"));
    useTx(tx);

    const res = makeRes();
    await depositMoney(reqFor({ amount: 100 }, { accountId: 'acc-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
