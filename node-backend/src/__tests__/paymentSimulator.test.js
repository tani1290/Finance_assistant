/**
 * Synthetic payment-simulator regressions.
 *
 * The simulator is a demo rail, but its financial bookkeeping must still be
 * exact:
 *
 *   - It never contacts a bank/UPI/card network and never stores real card,
 *     CVV or UPI-PIN fields.
 *   - Failed attempts never debit. Pending attempts never create a ledger row,
 *     so they cannot appear as spending in analytics or budgets.
 *   - Success debits exactly once, refund/reversal credits exactly once and
 *     writes an explicit REFUND/REVERSAL row.
 *   - Every retry is idempotent per `(userId, idempotencyKey)`; a reused key
 *     with different details is a 409 and writes nothing.
 *   - Every read/write is scoped to the authenticated user.
 *   - Production mutations need BOTH simulator flags.
 *
 * Deterministic by construction: `../config/database` is mocked and the fake
 * `$transaction` invokes the callback with a scripted transactional client.
 */

jest.mock('../config/database', () => ({
  simulatedPayment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  transaction: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  financialAccount: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  category: { findFirst: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../services/notificationService', () => ({
  checkBudgetThresholds: jest.fn(),
}));

jest.mock('../services/realtimeService', () => ({
  publish: jest.fn(),
}));

const prisma = require('../config/database');
const notificationService = require('../services/notificationService');
const simulator = require('../controllers/simulatorController');
const {
  getSimulatorConfig,
  isSimulatorEnabled,
  requireSimulatorEnabled,
  DISCLAIMER,
} = require('../services/simulatorConfig');

const USER = 'user-simulator';
const OTHER_USER = 'user-somebody-else';
const KEY = 'sim-0123456789abcdef';
const ACCOUNT = {
  id: 'acc-1',
  userId: USER,
  name: 'Simulator Demo Account',
  balance: 1000,
  currency: 'INR',
  isActive: true,
};

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function reqFor(body = {}, params = {}, query = {}) {
  return {
    user: { id: USER },
    body,
    params,
    query,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
  };
}

const bodyOf = (res) => res.json.mock.calls[0][0];

function basePayment(overrides = {}) {
  return {
    id: 'pay-1',
    userId: USER,
    accountId: ACCOUNT.id,
    categoryId: 'cat-1',
    amount: 250,
    currency: 'INR',
    merchant: 'Demo Cafe',
    description: null,
    paymentMethod: 'CARD',
    scenario: 'SUCCESS',
    status: 'PENDING',
    idempotencyKey: KEY,
    originTransactionId: null,
    refundTransactionId: null,
    ...overrides,
  };
}

/**
 * Scripted transactional client. Every model method the controller touches is
 * present so an unexpected call fails loudly instead of silently returning
 * undefined.
 */
function scriptTx({
  existing = null,
  payment = null,
  account = ACCOUNT,
  transactionLookup = null,
  resetPayments = [],
  resetTransactions = [],
  seedRecord = null,
} = {}) {
  let createdPayment = null;
  let sequence = 0;

  const fallbackPayment = () =>
    payment || existing || basePayment({ id: 'pay-fallback' });

  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    simulatedPayment: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        // The controller only looks payments up by the composite user+key.
        if (where && where.userId_idempotencyKey) return existing;
        return payment;
      }),
      findFirst: jest.fn().mockResolvedValue(payment),
      findMany: jest.fn().mockResolvedValue(resetPayments),
      create: jest.fn().mockImplementation(async ({ data }) => {
        sequence += 1;
        createdPayment = {
          id: `pay-new-${sequence}`,
          createdAt: new Date('2026-10-24T00:00:00.000Z'),
          ...data,
        };
        return createdPayment;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const base =
          createdPayment && createdPayment.id === where.id
            ? createdPayment
            : fallbackPayment().id === where.id
              ? fallbackPayment()
              : basePayment({ id: where.id, userId: USER });
        const next = { ...base, ...data, id: where.id };
        if (createdPayment && createdPayment.id === where.id) createdPayment = next;
        return next;
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: resetPayments.length }),
    },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(seedRecord),
      create: jest.fn().mockImplementation(async ({ data }) => data),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(transactionLookup),
      findMany: jest.fn().mockResolvedValue(resetTransactions),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: `tx-new-${(sequence += 1)}`,
        createdAt: new Date('2026-10-24T00:00:00.000Z'),
        ...data,
      })),
      deleteMany: jest.fn().mockResolvedValue({ count: resetTransactions.length }),
    },
    financialAccount: {
      findFirst: jest.fn().mockResolvedValue(account),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'acc-new',
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const base = account || { id: where.id, balance: 0, currency: 'INR' };
        const delta = data.balance && (data.balance.increment ?? -data.balance.decrement ?? 0);
        return {
          ...base,
          id: where.id,
          balance: Number(base.balance || 0) + Number(delta || 0),
        };
      }),
    },
    category: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where && where.name && String(where.name).includes('Simulator Funding')) {
          return { id: 'cat-seed', userId: USER, name: 'Simulator Funding' };
        }
        if (where && where.id) return null;
        return { id: 'cat-1', userId: USER, name: 'Simulator Payments' };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'cat-new', ...data })),
    },
  };
}

/** Wire the fake `$transaction` to a scripted client. */
function useTx(tx) {
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
}

beforeEach(() => {
  jest.resetAllMocks();
  notificationService.checkBudgetThresholds.mockResolvedValue(undefined);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.$transaction.mockImplementation(async (fn) => fn(scriptTx()));
});

afterEach(() => {
  delete process.env.PAYMENT_SIMULATOR_ENABLED;
  delete process.env.PAYMENT_SIMULATOR_ALLOW_PRODUCTION;
  delete process.env.PAYMENT_SIMULATOR_MAX_AMOUNT;
  delete process.env.PAYMENT_SIMULATOR_SEED_AMOUNT;
});

/* ------------------------------------------------------------------ */
/* Environment gating                                                  */
/* ------------------------------------------------------------------ */

describe('simulator config — environment gating', () => {
  test('outside production it defaults to enabled', () => {
    const config = getSimulatorConfig({ NODE_ENV: 'development' });
    expect(config.enabled).toBe(true);
    expect(config.production).toBe(false);
    expect(config.synthetic).toBe(true);
    expect(config.disclaimer).toBe(DISCLAIMER);
  });

  test('outside production an explicit opt-out wins', () => {
    const config = getSimulatorConfig({
      NODE_ENV: 'development',
      PAYMENT_SIMULATOR_ENABLED: 'false',
    });
    expect(config.enabled).toBe(false);
    expect(config.disabledReason).toMatch(/PAYMENT_SIMULATOR_ENABLED/);
  });

  test('production is disabled by default', () => {
    const config = getSimulatorConfig({ NODE_ENV: 'production' });
    expect(config.enabled).toBe(false);
    expect(config.production).toBe(true);
  });

  test('production with only PAYMENT_SIMULATOR_ENABLED stays disabled', () => {
    const config = getSimulatorConfig({
      NODE_ENV: 'production',
      PAYMENT_SIMULATOR_ENABLED: 'true',
    });
    expect(config.enabled).toBe(false);
    expect(config.disabledReason).toMatch(/ALLOW_PRODUCTION/);
  });

  test('production with only PAYMENT_SIMULATOR_ALLOW_PRODUCTION stays disabled', () => {
    const config = getSimulatorConfig({
      NODE_ENV: 'production',
      PAYMENT_SIMULATOR_ALLOW_PRODUCTION: 'true',
    });
    expect(config.enabled).toBe(false);
  });

  test('production with both flags is explicitly enabled', () => {
    expect(
      isSimulatorEnabled({
        NODE_ENV: 'production',
        PAYMENT_SIMULATOR_ENABLED: 'true',
        PAYMENT_SIMULATOR_ALLOW_PRODUCTION: 'true',
      })
    ).toBe(true);
  });

  test('amount limits are positive, rounded and bounded', () => {
    const config = getSimulatorConfig({
      NODE_ENV: 'test',
      PAYMENT_SIMULATOR_MAX_AMOUNT: '250.555',
      PAYMENT_SIMULATOR_SEED_AMOUNT: '9999999999',
    });
    expect(config.maxAmount).toBe(250.56);
    expect(config.seedAmount).toBe(1000000);
  });

  test('invalid amount overrides fall back to the safe defaults', () => {
    const config = getSimulatorConfig({
      NODE_ENV: 'test',
      PAYMENT_SIMULATOR_MAX_AMOUNT: 'not-a-number',
      PAYMENT_SIMULATOR_SEED_AMOUNT: '-5',
    });
    expect(config.maxAmount).toBe(100000);
    expect(config.seedAmount).toBe(50000);
  });
});

describe('simulator route gate', () => {
  test('a disabled simulator refuses mutations with 403 SIMULATOR_DISABLED', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    const next = jest.fn();

    requireSimulatorEnabled(reqFor(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(bodyOf(res).error.code).toBe('SIMULATOR_DISABLED');
  });

  test('an enabled simulator passes the request through', () => {
    process.env.NODE_ENV = 'test';
    const res = makeRes();
    const next = jest.fn();

    requireSimulatorEnabled(reqFor(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Create — validation                                                 */
/* ------------------------------------------------------------------ */

describe('create — validation', () => {
  test('requires an idempotency key', async () => {
    const res = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100, merchant: 'Demo' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['short', 'too short'],
    ['has spaces in the key', 'illegal characters'],
  ])('rejects a malformed idempotency key (%s)', async (key) => {
    const res = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100, merchant: 'Demo', idempotencyKey: key }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    [0],
    [-5],
    ['abc'],
    ['10.999'],
  ])('rejects an invalid amount (%s)', async (amount) => {
    const res = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount, merchant: 'Demo', idempotencyKey: KEY }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an amount above the configured limit', async () => {
    const res = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100001, merchant: 'Demo', idempotencyKey: KEY }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('SIMULATOR_LIMIT_EXCEEDED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('requires a merchant', async () => {
    const res = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100, idempotencyKey: KEY }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.message).toMatch(/merchant/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an unknown payment method or scenario', async () => {
    const methodRes = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100, merchant: 'Demo', idempotencyKey: KEY, paymentMethod: 'BITCOIN' }),
      methodRes,
      jest.fn()
    );
    expect(methodRes.status).toHaveBeenCalledWith(400);
    expect(bodyOf(methodRes).error.message).toMatch(/paymentMethod/);

    const scenarioRes = makeRes();
    await simulator.createSimulatedPayment(
      reqFor({ amount: 100, merchant: 'Demo', idempotencyKey: KEY, scenario: 'MAYBE' }),
      scenarioRes,
      jest.fn()
    );
    expect(scenarioRes.status).toHaveBeenCalledWith(400);
    expect(bodyOf(scenarioRes).error.message).toMatch(/scenario/);
  });
});

/* ------------------------------------------------------------------ */
/* Create — scenarios                                                  */
/* ------------------------------------------------------------------ */

describe('create — success scenario', () => {
  test('settles atomically, debits once and marks the ledger row simulated', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 250,
        merchant: 'Demo Cafe',
        idempotencyKey: KEY,
        accountId: ACCOUNT.id,
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const data = bodyOf(res).data;
    expect(data.replayed).toBe(false);
    expect(data.payment.status).toBe('SUCCESS');
    expect(data.payment.synthetic).toBe(true);
    expect(data.transaction.type).toBe('EXPENSE');
    expect(data.transaction.isSimulated).toBe(true);
    expect(data.disclaimer).toBe(DISCLAIMER);

    expect(tx.financialAccount.update).toHaveBeenCalledTimes(1);
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { decrement: 250 },
    });
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    const ledger = tx.transaction.create.mock.calls[0][0].data;
    expect(ledger).toMatchObject({
      userId: USER,
      accountId: ACCOUNT.id,
      amount: 250,
      transactionType: 'EXPENSE',
      merchant: 'Demo Cafe',
      isSimulated: true,
    });
    expect(ledger.notes).toMatch(/SYNTHETIC/);
    expect(tx.simulatedPayment.update.mock.calls[0][0].data.status).toBe('SUCCESS');
    expect(tx.simulatedPayment.update.mock.calls[0][0].data.originTransactionId).toBeTruthy();
  });

  test('the client cannot set the status or a balance directly', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 100,
        merchant: 'Demo',
        idempotencyKey: KEY,
        accountId: ACCOUNT.id,
        status: 'SUCCESS',
        balance: 999999,
        settledAt: '2000-01-01T00:00:00.000Z',
      }),
      res,
      jest.fn()
    );

    const created = tx.simulatedPayment.create.mock.calls[0][0].data;
    expect(created.status).toBe('PENDING');
    expect(created).not.toHaveProperty('balance');
    expect(created.settledAt).toBeUndefined();
    // The account is only ever moved by the controller's decrement.
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { decrement: 100 },
    });
  });

  test('stores no card number, CVV or UPI PIN fields', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 100,
        merchant: 'Demo',
        idempotencyKey: KEY,
        accountId: ACCOUNT.id,
        cardNumber: '4111111111111111',
        cvv: '123',
        upiPin: '9999',
      }),
      res,
      jest.fn()
    );

    const serialized = JSON.stringify(tx.simulatedPayment.create.mock.calls[0][0].data);
    expect(serialized).not.toMatch(/4111111111111111/);
    expect(serialized).not.toMatch(/"cvv"/);
    expect(serialized).not.toMatch(/"upiPin"/);
  });
});

describe('create — failure and pending scenarios', () => {
  test('a FAILURE scenario never debits and writes no ledger row', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 250,
        merchant: 'Demo',
        idempotencyKey: KEY,
        scenario: 'FAILURE',
        accountId: ACCOUNT.id,
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('FAILED');
    expect(data.payment.failureCode).toBe('SIMULATED_DECLINE');
    expect(data.transaction).toBeNull();
    expect(data.message).toMatch(/failed/i);
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('an insufficient synthetic balance records FAILED and never debits', async () => {
    const tx = scriptTx({ account: { ...ACCOUNT, balance: 100 } });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      res,
      jest.fn()
    );

    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('FAILED');
    expect(data.payment.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(data.transaction).toBeNull();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('a PENDING scenario creates no ledger row until confirmed', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 250,
        merchant: 'Demo',
        idempotencyKey: KEY,
        scenario: 'PENDING',
        accountId: ACCOUNT.id,
      }),
      res,
      jest.fn()
    );

    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('PENDING');
    expect(data.transaction).toBeNull();
    expect(data.message).toMatch(/pending/i);
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Create — idempotency and ownership                                  */
/* ------------------------------------------------------------------ */

describe('create — idempotency', () => {
  test('stores the key scoped to the authenticated user', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      res,
      jest.fn()
    );

    expect(tx.simulatedPayment.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: USER, idempotencyKey: KEY } },
    });
    expect(tx.simulatedPayment.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      idempotencyKey: KEY,
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test('a matching retry replays the original and applies no new effect', async () => {
    const firstTx = scriptTx({ account: ACCOUNT });
    useTx(firstTx);
    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      makeRes(),
      jest.fn()
    );
    const fingerprint =
      firstTx.simulatedPayment.create.mock.calls[0][0].data.requestFingerprint;

    const original = basePayment({
      id: 'pay-orig',
      status: 'SUCCESS',
      requestFingerprint: fingerprint,
      originTransactionId: 'tx-orig',
    });
    const tx = scriptTx({
      existing: original,
      transactionLookup: {
        id: 'tx-orig',
        transactionType: 'EXPENSE',
        amount: 250,
        accountId: ACCOUNT.id,
        isSimulated: true,
      },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const data = bodyOf(res).data;
    expect(data.replayed).toBe(true);
    expect(data.payment.id).toBe('pay-orig');
    expect(data.transaction.id).toBe('tx-orig');
    expect(data.message).toMatch(/already created/i);
    expect(tx.simulatedPayment.create).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a reused key with different details is a 409 and writes nothing', async () => {
    const original = basePayment({
      id: 'pay-orig',
      status: 'SUCCESS',
      requestFingerprint: 'a'.repeat(64),
    });
    const tx = scriptTx({ existing: original });
    useTx(tx);
    const res = makeRes();
    const next = jest.fn();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 999, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(tx.simulatedPayment.create).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a unique-constraint race becomes a retryable 409', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    tx.simulatedPayment.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );
    useTx(tx);
    const res = makeRes();
    const next = jest.fn();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: ACCOUNT.id }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('create — ownership', () => {
  test('an account belonging to another user is not found', async () => {
    const tx = scriptTx({ account: null });
    useTx(tx);
    const res = makeRes();
    const next = jest.fn();

    await simulator.createSimulatedPayment(
      reqFor({ amount: 250, merchant: 'Demo', idempotencyKey: KEY, accountId: 'acc-other' }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('ACCOUNT_NOT_FOUND');
    // The lookup is scoped by userId and id, not just id.
    expect(tx.financialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-other', userId: USER },
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a category belonging to another user is not found', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    tx.category.findFirst.mockResolvedValueOnce(null);
    useTx(tx);
    const res = makeRes();

    await simulator.createSimulatedPayment(
      reqFor({
        amount: 250,
        merchant: 'Demo',
        idempotencyKey: KEY,
        accountId: ACCOUNT.id,
        categoryId: 'cat-other',
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('CATEGORY_NOT_FOUND');
    expect(tx.simulatedPayment.create).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Confirm / fail                                                      */
/* ------------------------------------------------------------------ */

describe('confirm — pending settlement', () => {
  test('a pending payment settles once and debits once', async () => {
    const pending = basePayment({ id: 'pay-pending', status: 'PENDING' });
    const tx = scriptTx({ payment: pending, account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.confirmSimulatedPayment(
      reqFor({}, { id: pending.id }),
      res,
      jest.fn()
    );

    // A successful confirm uses the default 200 via res.json (no explicit status).
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('SUCCESS');
    expect(data.transaction.type).toBe('EXPENSE');
    expect(data.replayed).toBe(false);
    expect(tx.simulatedPayment.findFirst).toHaveBeenCalledWith({
      where: { id: pending.id, userId: USER },
    });
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { decrement: 250 },
    });
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
  });

  test('confirming an already-settled payment replays without debiting again', async () => {
    const settled = basePayment({
      id: 'pay-settled',
      status: 'SUCCESS',
      originTransactionId: 'tx-orig',
    });
    const tx = scriptTx({
      payment: settled,
      transactionLookup: { id: 'tx-orig', transactionType: 'EXPENSE', amount: 250 },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.confirmSimulatedPayment(
      reqFor({}, { id: settled.id }),
      res,
      jest.fn()
    );

    expect(bodyOf(res).data.replayed).toBe(true);
    expect(bodyOf(res).data.message).toMatch(/already settled/i);
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test.each(['FAILED', 'REFUNDED', 'REVERSED'])(
    'confirming a %s payment is a 409',
    async (status) => {
      const tx = scriptTx({ payment: basePayment({ status }), account: ACCOUNT });
      useTx(tx);
      const res = makeRes();

      await simulator.confirmSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(bodyOf(res).error.code).toBe('INVALID_STATE');
      expect(tx.transaction.create).not.toHaveBeenCalled();
    }
  );

  test('settlement with insufficient funds fails without debiting', async () => {
    const pending = basePayment({ id: 'pay-pending', status: 'PENDING' });
    const tx = scriptTx({ payment: pending, account: { ...ACCOUNT, balance: 10 } });
    useTx(tx);
    const res = makeRes();

    await simulator.confirmSimulatedPayment(
      reqFor({}, { id: pending.id }),
      res,
      jest.fn()
    );

    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('FAILED');
    expect(data.payment.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(data.transaction).toBeNull();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('a payment belonging to another user is not found', async () => {
    const tx = scriptTx({ payment: null });
    useTx(tx);
    const res = makeRes();

    await simulator.confirmSimulatedPayment(reqFor({}, { id: 'pay-other' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).error.code).toBe('SIMULATED_PAYMENT_NOT_FOUND');
    expect(tx.simulatedPayment.findFirst).toHaveBeenCalledWith({
      where: { id: 'pay-other', userId: USER },
    });
  });
});

describe('fail — pending cancellation', () => {
  test('marking a pending payment failed never debits', async () => {
    const tx = scriptTx({ payment: basePayment({ status: 'PENDING' }), account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.failSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(bodyOf(res).data.payment.status).toBe('FAILED');
    expect(bodyOf(res).data.transaction).toBeNull();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('failing an already-failed payment replays', async () => {
    const tx = scriptTx({ payment: basePayment({ status: 'FAILED' }) });
    useTx(tx);
    const res = makeRes();

    await simulator.failSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(bodyOf(res).data.replayed).toBe(true);
    expect(tx.simulatedPayment.update).not.toHaveBeenCalled();
  });

  test.each(['SUCCESS', 'REFUNDED', 'REVERSED'])(
    'failing a %s payment is a 409',
    async (status) => {
      const tx = scriptTx({ payment: basePayment({ status }) });
      useTx(tx);
      const res = makeRes();

      await simulator.failSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(bodyOf(res).error.code).toBe('INVALID_STATE');
    }
  );
});

/* ------------------------------------------------------------------ */
/* Refund / reversal                                                   */
/* ------------------------------------------------------------------ */

describe('refund — settled payment', () => {
  test('credits the account once with an explicit REFUND row', async () => {
    const settled = basePayment({
      id: 'pay-settled',
      status: 'SUCCESS',
      originTransactionId: 'tx-orig',
    });
    const tx = scriptTx({ payment: settled });
    useTx(tx);
    const res = makeRes();

    await simulator.refundSimulatedPayment(reqFor({}, { id: settled.id }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const data = bodyOf(res).data;
    expect(data.payment.status).toBe('REFUNDED');
    expect(data.transaction.type).toBe('REFUND');
    expect(data.transaction.isSimulated).toBe(true);
    expect(data.message).toMatch(/refunded/i);
    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      transactionType: 'REFUND',
      amount: 250,
      accountId: ACCOUNT.id,
      isSimulated: true,
    });
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { increment: 250 },
    });
    expect(tx.simulatedPayment.update.mock.calls[0][0].data.status).toBe('REFUNDED');
    expect(tx.simulatedPayment.update.mock.calls[0][0].data.refundTransactionId).toBeTruthy();
  });

  test('a second refund replays and does not credit twice', async () => {
    const refunded = basePayment({
      id: 'pay-refunded',
      status: 'REFUNDED',
      originTransactionId: 'tx-orig',
      refundTransactionId: 'tx-refund',
    });
    const tx = scriptTx({
      payment: refunded,
      transactionLookup: { id: 'tx-refund', transactionType: 'REFUND', amount: 250 },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.refundSimulatedPayment(reqFor({}, { id: refunded.id }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.replayed).toBe(true);
    expect(bodyOf(res).data.transaction.id).toBe('tx-refund');
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('refunding a reversed payment is a 409', async () => {
    const tx = scriptTx({ payment: basePayment({ status: 'REVERSED' }) });
    useTx(tx);
    const res = makeRes();

    await simulator.refundSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('INVALID_STATE');
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test.each(['PENDING', 'FAILED'])('refunding a %s payment is a 409', async (status) => {
    const tx = scriptTx({ payment: basePayment({ status }) });
    useTx(tx);
    const res = makeRes();

    await simulator.refundSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('INVALID_STATE');
  });
});

describe('reverse — settled payment', () => {
  test('credits the account once with an explicit REVERSAL row', async () => {
    const settled = basePayment({
      id: 'pay-settled',
      status: 'SUCCESS',
      originTransactionId: 'tx-orig',
    });
    const tx = scriptTx({ payment: settled });
    useTx(tx);
    const res = makeRes();

    await simulator.reverseSimulatedPayment(reqFor({}, { id: settled.id }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(bodyOf(res).data.payment.status).toBe('REVERSED');
    expect(bodyOf(res).data.transaction.type).toBe('REVERSAL');
    expect(tx.transaction.create.mock.calls[0][0].data.transactionType).toBe('REVERSAL');
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { increment: 250 },
    });
  });

  test('a second reversal replays without crediting twice', async () => {
    const reversed = basePayment({
      id: 'pay-reversed',
      status: 'REVERSED',
      refundTransactionId: 'tx-reversal',
    });
    const tx = scriptTx({
      payment: reversed,
      transactionLookup: { id: 'tx-reversal', transactionType: 'REVERSAL', amount: 250 },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.reverseSimulatedPayment(reqFor({}, { id: reversed.id }), res, jest.fn());

    expect(bodyOf(res).data.replayed).toBe(true);
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('reversing a refunded payment is a 409', async () => {
    const tx = scriptTx({ payment: basePayment({ status: 'REFUNDED' }) });
    useTx(tx);
    const res = makeRes();

    await simulator.reverseSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('INVALID_STATE');
  });
});

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

describe('seed — synthetic demo funding', () => {
  test('the first claim adds server-controlled funds exactly once', async () => {
    const tx = scriptTx({ account: ACCOUNT });
    useTx(tx);
    const res = makeRes();

    await simulator.seedSimulatorFunds(reqFor({}), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const data = bodyOf(res).data;
    expect(data.replayed).toBe(false);
    expect(data.message).toMatch(/synthetic demo funds/i);
    expect(data.transaction.type).toBe('INCOME');
    expect(data.transaction.isSimulated).toBe(true);
    expect(data.synthetic).toBe(true);

    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      transactionType: 'INCOME',
      amount: 50000,
      isSimulated: true,
    });
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { increment: 50000 },
    });
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      scope: 'simulator_seed',
      key: 'demo-v1',
      amount: 50000,
    });
    expect(tx.idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint).toMatch(
      /^[a-f0-9]{64}$/
    );
  });

  test('a retry replays the original claim without adding funds again', async () => {
    const tx = scriptTx({
      account: ACCOUNT,
      seedRecord: {
        userId: USER,
        scope: 'simulator_seed',
        key: 'demo-v1',
        transactionId: 'tx-seed',
        amount: 50000,
      },
      transactionLookup: {
        id: 'tx-seed',
        transactionType: 'INCOME',
        amount: 50000,
        accountId: ACCOUNT.id,
        isSimulated: true,
      },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.seedSimulatorFunds(reqFor({}), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res).data.replayed).toBe(true);
    expect(bodyOf(res).data.message).toMatch(/already claimed/i);
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  test('a claim into a different account is rejected', async () => {
    const tx = scriptTx({
      account: ACCOUNT,
      seedRecord: {
        userId: USER,
        scope: 'simulator_seed',
        key: 'demo-v1',
        transactionId: 'tx-seed',
        requestFingerprint: 'a'.repeat(64),
      },
    });
    useTx(tx);
    const res = makeRes();

    await simulator.seedSimulatorFunds(reqFor({ accountId: 'acc-2' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });

  test('a claim whose ledger row was deleted is not recreated', async () => {
    const tx = scriptTx({
      account: ACCOUNT,
      seedRecord: {
        userId: USER,
        scope: 'simulator_seed',
        key: 'demo-v1',
        transactionId: 'tx-missing',
      },
      transactionLookup: null,
    });
    useTx(tx);
    const res = makeRes();

    await simulator.seedSimulatorFunds(reqFor({}), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(bodyOf(res).error.code).toBe('SEED_ALREADY_CLAIMED');
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

describe('reset — simulator cleanup', () => {
  test('reverses simulated ledger effects and deletes only simulator rows', async () => {
    const payments = [
      { originTransactionId: 'tx-expense', refundTransactionId: 'tx-refund' },
      { originTransactionId: 'tx-expense-2', refundTransactionId: null },
    ];
    const transactions = [
      {
        id: 'tx-expense',
        transactionType: 'EXPENSE',
        amount: 250,
        accountId: ACCOUNT.id,
        isSimulated: true,
      },
      {
        id: 'tx-expense-2',
        transactionType: 'EXPENSE',
        amount: 100,
        accountId: ACCOUNT.id,
        isSimulated: true,
      },
    ];
    const tx = scriptTx({ resetPayments: payments, resetTransactions: transactions });
    useTx(tx);
    const res = makeRes();

    await simulator.resetSimulator(reqFor({}), res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(500);
    const data = bodyOf(res).data;
    expect(data.deletedPayments).toBe(2);
    expect(data.deletedTransactions).toBe(2);
    expect(data.seedUnaffected).toBe(true);
    expect(data.message).toMatch(/seed funding was left intact/i);

    // Every simulated ledger row is unwound individually: +250 then +100.
    expect(tx.financialAccount.update).toHaveBeenCalledTimes(2);
    expect(tx.financialAccount.update.mock.calls[0][0].data).toEqual({
      balance: { increment: 250 },
    });
    expect(tx.financialAccount.update.mock.calls[1][0].data).toEqual({
      balance: { increment: 100 },
    });
    expect(tx.transaction.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER,
        id: { in: ['tx-expense', 'tx-refund', 'tx-expense-2'] },
        isSimulated: true,
      },
    });
    expect(tx.simulatedPayment.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    // The seed claim must survive a reset.
    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(tx.transaction.deleteMany.mock.calls[0][0].where.isSimulated).toBe(true);
  });

  test('reset with no simulator payments is a no-op', async () => {
    const tx = scriptTx({ resetPayments: [], resetTransactions: [] });
    useTx(tx);
    const res = makeRes();

    await simulator.resetSimulator(reqFor({}), res, jest.fn());

    expect(bodyOf(res).data.deletedPayments).toBe(0);
    expect(bodyOf(res).data.deletedTransactions).toBe(0);
    expect(tx.transaction.findMany).not.toHaveBeenCalled();
    expect(tx.financialAccount.update).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Status / list / get                                                 */
/* ------------------------------------------------------------------ */

describe('status and reads', () => {
  test('status exposes the synthetic contract and per-status counts', async () => {
    prisma.simulatedPayment.groupBy.mockResolvedValue([
      { status: 'SUCCESS', _count: { _all: 2 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    const res = makeRes();

    await simulator.getSimulatorStatus(reqFor(), res, jest.fn());

    const data = bodyOf(res).data;
    expect(data.synthetic).toBe(true);
    expect(data.disclaimer).toBe(DISCLAIMER);
    expect(data.counts).toEqual({ PENDING: 0, SUCCESS: 2, FAILED: 1, REFUNDED: 0, REVERSED: 0 });
    expect(data.seedClaimed).toBe(false);
    expect(data.paymentMethods).toContain('UPI');
    expect(data.scenarios).toEqual(['SUCCESS', 'PENDING', 'FAILURE']);
  });

  test('list scopes every query to the authenticated user', async () => {
    prisma.simulatedPayment.findMany.mockResolvedValue([basePayment()]);
    prisma.simulatedPayment.count.mockResolvedValue(1);
    const res = makeRes();

    await simulator.listSimulatedPayments(reqFor({}, {}, { status: 'success' }), res, jest.fn());

    expect(prisma.simulatedPayment.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      status: 'SUCCESS',
    });
    expect(prisma.simulatedPayment.count.mock.calls[0][0].where).toEqual({
      userId: USER,
      status: 'SUCCESS',
    });
    const data = bodyOf(res).data;
    expect(data.payments).toHaveLength(1);
    expect(data.synthetic).toBe(true);
    expect(data.pagination.total).toBe(1);
  });

  test('list rejects an unknown status before querying', async () => {
    const res = makeRes();
    await simulator.listSimulatedPayments(reqFor({}, {}, { status: 'WHATEVER' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.simulatedPayment.findMany).not.toHaveBeenCalled();
  });

  test('get is scoped to the owner', async () => {
    prisma.simulatedPayment.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await simulator.getSimulatedPayment(reqFor({}, { id: 'pay-other' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.simulatedPayment.findFirst).toHaveBeenCalledWith({
      where: { id: 'pay-other', userId: USER },
    });
  });

  test('get returns linked ledger rows for the owner only', async () => {
    prisma.simulatedPayment.findFirst.mockResolvedValue(
      basePayment({ id: 'pay-1', originTransactionId: 'tx-1' })
    );
    prisma.transaction.findMany.mockResolvedValue([
      { id: 'tx-1', transactionType: 'EXPENSE', amount: 250, isSimulated: true },
    ]);
    const res = makeRes();

    await simulator.getSimulatedPayment(reqFor({}, { id: 'pay-1' }), res, jest.fn());

    expect(prisma.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      id: { in: ['tx-1'] },
    });
    expect(bodyOf(res).data.payments).toBeUndefined();
    expect(bodyOf(res).data.transactions).toHaveLength(1);
    expect(bodyOf(res).data.transaction).toBeUndefined();
  });
});
