/**
 * Concurrency & Financial Integrity Integration Test
 * Runs against real local PostgreSQL instance to verify atomic serialization,
 * row locking, deadlock avoidance, and balance invariants under concurrent load.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { formatINR } = require('../utils/inr');

let prisma;
let isDbAvailable = false;

beforeAll(async () => {
  try {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/finance_jinay',
        },
      },
    });
    await prisma.$connect();
    // Verify connection
    await prisma.$queryRaw`SELECT 1`;
    isDbAvailable = true;
  } catch (err) {
    console.warn('[Integration] Local PostgreSQL not available, skipping live concurrency tests:', err.message);
    isDbAvailable = false;
  }
});

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
});

describe('PostgreSQL Real Concurrency & Financial Integrity', () => {
  let testUser = null;
  let testAccount = null;
  let testDestAccount = null;
  let testCreditAccount = null;

  beforeEach(async () => {
    if (!isDbAvailable) return;

    // Clean up any old test data
    await prisma.transaction.deleteMany({ where: { user: { email: 'concurrency_test@finpro.local' } } });
    await prisma.financialAccount.deleteMany({ where: { user: { email: 'concurrency_test@finpro.local' } } });
    await prisma.category.deleteMany({ where: { user: { email: 'concurrency_test@finpro.local' } } });
    await prisma.user.deleteMany({ where: { email: 'concurrency_test@finpro.local' } });

    // Create fresh isolated user
    testUser = await prisma.user.create({
      data: {
        email: 'concurrency_test@finpro.local',
        username: 'concurrency_user_' + Date.now(),
        password: '$2a$12$FakeHashedPasswordForTestOnly9999999999999999',
        firstName: 'Concurrency',
        lastName: 'Tester',
      },
    });

    // Create test accounts
    testAccount = await prisma.financialAccount.create({
      data: {
        userId: testUser.id,
        name: 'Test Primary Account',
        accountType: 'SAVINGS',
        balance: 1000.00,
        currency: 'INR',
      },
    });

    testDestAccount = await prisma.financialAccount.create({
      data: {
        userId: testUser.id,
        name: 'Test Secondary Account',
        accountType: 'SAVINGS',
        balance: 500.00,
        currency: 'INR',
      },
    });

    testCreditAccount = await prisma.financialAccount.create({
      data: {
        userId: testUser.id,
        name: 'Test Credit Card',
        accountType: 'CREDIT_CARD',
        balance: 0.00,
        currency: 'INR',
      },
    });
  });

  afterEach(async () => {
    if (!isDbAvailable || !testUser) return;
    try {
      await prisma.transaction.deleteMany({ where: { userId: testUser.id } });
      await prisma.financialAccount.deleteMany({ where: { userId: testUser.id } });
      await prisma.category.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.deleteMany({ where: { id: testUser.id } });
    } catch (_) {}
  });

  test('prevents double-spending: two simultaneous unkeyed debits (₹700 and ₹600 against ₹1,000) allow only one', async () => {
    if (!isDbAvailable) return;

    // Direct invocation of transaction logic using real controller
    const { createTransaction } = require('../controllers/transactionController');

    const runDebit = (amount) => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount,
            type: 'EXPENSE',
            accountId: testAccount.id,
            description: `Concurrent debit ${amount}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          console.error('[TEST ERROR]', err);
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    // Fire both requests simultaneously
    const [resultA, resultB] = await Promise.all([
      runDebit(700),
      runDebit(600),
    ]);

    const statuses = [resultA.statusCode, resultB.statusCode].sort();

    // Exactly one must succeed (201) and one must be rejected (400 INSUFFICIENT_FUNDS)
    expect(statuses).toEqual([201, 400]);

    // Check final account balance in real PostgreSQL
    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });

    const finalBalance = Number(freshAccount.balance);
    // If ₹700 won, balance is ₹300. If ₹600 won, balance is ₹400.
    // In NO case can balance be negative (e.g. -₹300)!
    expect([300, 400]).toContain(finalBalance);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
  });

  test('two simultaneous requests whose combined debit equals the balance (₹600 + ₹400 against ₹1,000) both succeed', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    const runDebit = (amount) => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount,
            type: 'EXPENSE',
            accountId: testAccount.id,
            description: `Exact balance debit ${amount}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          console.error('[TEST ERROR]', err);
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    const [resA, resB] = await Promise.all([
      runDebit(600),
      runDebit(400),
    ]);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });

    expect(Number(freshAccount.balance)).toBe(0);
  });

  test('concurrent opposing transfers avoid deadlocks due to sorted row locking', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    const runTransfer = (fromId, toId, amount) => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount,
            type: 'TRANSFER',
            accountId: fromId,
            toAccountId: toId,
            description: `Transfer ${amount}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          console.error('[TEST ERROR]', err);
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    // Account A -> B: 200, Account B -> A: 100
    const [resA, resB] = await Promise.all([
      runTransfer(testAccount.id, testDestAccount.id, 200),
      runTransfer(testDestAccount.id, testAccount.id, 100),
    ]);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const freshA = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
    const freshB = await prisma.financialAccount.findUnique({ where: { id: testDestAccount.id } });

    // Acc A started at 1000 - 200 + 100 = 900
    expect(Number(freshA.balance)).toBe(900);
    // Acc B started at 500 + 200 - 100 = 600
    expect(Number(freshB.balance)).toBe(600);
  });

  test('credit-card account is exempt from insufficient-funds checks', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    const runDebit = (amount) => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount,
            type: 'EXPENSE',
            accountId: testCreditAccount.id,
            description: `Credit card spend ${amount}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          console.error('[TEST ERROR]', err);
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    const res = await runDebit(2500);
    expect(res.statusCode).toBe(201);

    const freshCard = await prisma.financialAccount.findUnique({
      where: { id: testCreditAccount.id },
    });
    expect(Number(freshCard.balance)).toBe(-2500);
  });

  test('legitimate incoming transactions (INCOME) are never rejected by balance checks', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    const runIncome = (amount) => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount,
            type: 'INCOME',
            accountId: testAccount.id,
            description: `Salary credit ${amount}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          console.error('[TEST ERROR]', err);
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    const res = await runIncome(50000);
    expect(res.statusCode).toBe(201);

    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });
    expect(Number(freshAccount.balance)).toBe(51000);
  });

  test('transaction updates that increase debit beyond available funds are rejected', async () => {
    if (!isDbAvailable) return;

    const { updateTransaction } = require('../controllers/transactionController');

    // Create an initial expense of ₹100
    const txRow = await prisma.transaction.create({
      data: {
        userId: testUser.id,
        accountId: testAccount.id,
        amount: 100,
        transactionType: 'EXPENSE',
        date: new Date(),
        currency: 'INR',
      },
    });

    // Account has balance 1000 - 100 = 900
    await prisma.financialAccount.update({
      where: { id: testAccount.id },
      data: { balance: 900 },
    });

    // Attempt to update transaction amount from ₹100 to ₹1,500 (requires net debit of ₹1,400, but only ₹900 available)
    const req = {
      params: { id: txRow.id },
      user: { id: testUser.id },
      headers: {},
      body: { amount: 1500 },
    };

    let updateRes = null;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        updateRes = { statusCode: this.statusCode, body: data };
      },
    };

    await updateTransaction(req, res, (err) => {
      updateRes = { statusCode: err?.statusCode || 500, error: err };
    });

    expect(updateRes.statusCode).toBe(400);
    expect(updateRes.error?.code).toBe('INSUFFICIENT_FUNDS');

    // Verify account balance was NOT modified
    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });
    expect(Number(freshAccount.balance)).toBe(900);
  });

  test('transfer idempotency replaying identical request returns replayed: true without moving extra money', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    const key = 'idem-transfer-' + Date.now();
    const runKeyedTransfer = () => {
      return new Promise((resolve) => {
        const req = {
          user: { id: testUser.id },
          headers: {},
          body: {
            amount: 250,
            type: 'TRANSFER',
            accountId: testAccount.id,
            toAccountId: testDestAccount.id,
            idempotencyKey: key,
          },
        };
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            resolve({ statusCode: this.statusCode, body: data });
          },
        };
        createTransaction(req, res, (err) => {
          resolve({ statusCode: err?.statusCode || 500, error: err });
        });
      });
    };

    const first = await runKeyedTransfer();
    expect(first.statusCode).toBe(201);
    expect(first.body.data.replayed).toBe(false);

    // Replay with identical key
    const replay = await runKeyedTransfer();
    expect(replay.statusCode).toBe(200);
    expect(replay.body.data.replayed).toBe(true);

    // Verify balance was debited ONLY ONCE (1000 - 250 = 750)
    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });
    expect(Number(freshAccount.balance)).toBe(750);
  });

  test('rollback when one leg of a transfer fails: source balance is completely restored', async () => {
    if (!isDbAvailable) return;

    const { createTransaction } = require('../controllers/transactionController');

    // Attempt transfer with non-existent destination
    const req = {
      user: { id: testUser.id },
      headers: {},
      body: {
        amount: 300,
        type: 'TRANSFER',
        accountId: testAccount.id,
        toAccountId: 'non-existent-account-id-999',
      },
    };

    let transferRes = null;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        transferRes = { statusCode: this.statusCode, body: data };
      },
    };

    await createTransaction(req, res, (err) => {
      transferRes = { statusCode: err?.statusCode || 500, error: err };
    });

    expect(transferRes.statusCode).toBe(404);

    // Check that source account balance was NOT modified
    const freshAccount = await prisma.financialAccount.findUnique({
      where: { id: testAccount.id },
    });
    expect(Number(freshAccount.balance)).toBe(1000);
  });
});
