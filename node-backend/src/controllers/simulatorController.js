/**
 * FinPro — Synthetic payment simulator.
 *
 * This controller implements a deliberately fake payment rail for demos and
 * teaching. It never contacts a bank, card network or UPI provider, never
 * accepts real card/CVV/UPI-PIN/banking credentials, and never moves real
 * money. Every row it writes is marked `isSimulated` and every response says
 * so explicitly.
 *
 * Invariants:
 *   - All routes sit behind `authenticate`; every lookup is scoped by userId.
 *   - Mutations are disabled in production unless BOTH simulator flags are set.
 *   - A failed attempt never debits; a pending attempt never appears in the
 *     ledger (so analytics and budgets cannot count it as spending).
 *   - A refund/reversal is a separate, explicitly typed ledger row that credits
 *     the account and reduces net spending.
 *   - Client retries are idempotent via `(userId, idempotencyKey)`; the client
 *     can never set a balance or an authoritative status directly.
 */

'use strict';

const crypto = require('crypto');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, todayDateOnly } = require('../utils/dateOnly');
const {
  reverseEffects,
  applyEffects,
} = require('../services/transactionBalance');
const { getSimulatorConfig, DISCLAIMER } = require('../services/simulatorConfig');
const notificationService = require('../services/notificationService');
const realtimeService = require('../services/realtimeService');

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const SEED_SCOPE = 'simulator_seed';
const SEED_KEY = 'demo-v1';
const DEFAULT_CATEGORY = 'Simulator Payments';
const SEED_CATEGORY = 'Simulator Funding';

const SYNTHETIC_NOTE =
  'SYNTHETIC SIMULATOR ROW — no real money moved and no payment network was contacted.';
const SYNTHETIC_REFUND_NOTE =
  'SYNTHETIC SIMULATOR REFUND — restores the simulated debit; no real money moved.';
const SYNTHETIC_REVERSAL_NOTE =
  'SYNTHETIC SIMULATOR REVERSAL — restores the simulated debit; no real money moved.';

const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'REVERSED'];
const PAYMENT_METHODS = ['CARD', 'UPI', 'NET_BANKING', 'WALLET', 'BANK_TRANSFER'];
const SCENARIOS = ['SUCCESS', 'PENDING', 'FAILURE'];

/* ------------------------------------------------------------------ */
/* Errors and small helpers                                            */
/* ------------------------------------------------------------------ */

const httpError = (statusCode, code, message) =>
  Object.assign(new Error(message), { statusCode, code });

const sendError = (res, statusCode, code, message) =>
  res.status(statusCode).json({ success: false, error: { code, message } });

function handleError(error, res, next) {
  if (error instanceof RangeError) {
    return sendError(res, 400, 'VALIDATION_ERROR', error.message);
  }
  if (error && error.statusCode) {
    return sendError(res, error.statusCode, error.code || 'SIMULATOR_ERROR', error.message);
  }
  return next(error);
}

function normalizeIdempotencyKey(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return IDEMPOTENCY_KEY_RE.test(value) ? value : null;
}

function normalizeText(value, field, { required = false, max = 500 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be text.`);
  }
  // Strip control characters so a label can never smuggle terminal escapes or
  // newlines into a ledger description.
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!cleaned) {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return null;
  }
  if (cleaned.length > max) {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be at most ${max} characters.`);
  }
  return cleaned;
}

/**
 * Parse a positive INR amount and canonicalise it to the ledger's 2-decimal
 * minor-unit precision. Rejects values that would silently round.
 */
function parseAmount(raw, config) {
  if (raw === undefined || raw === null || raw === '') {
    throw httpError(400, 'VALIDATION_ERROR', 'amount is required.');
  }
  const text = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'amount must be a positive number with at most 2 decimal places.'
    );
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'VALIDATION_ERROR', 'amount must be a positive number.');
  }
  const minor = Math.round(amount * 100);
  if (minor <= 0 || !Number.isSafeInteger(minor)) {
    throw httpError(400, 'VALIDATION_ERROR', 'amount is outside the supported range.');
  }
  if (amount > config.maxAmount) {
    throw httpError(
      400,
      'SIMULATOR_LIMIT_EXCEEDED',
      `A simulated payment cannot exceed ${formatINR(config.maxAmount)}.`
    );
  }
  return minor / 100;
}

function normalizePaymentMethod(raw) {
  if (raw === undefined || raw === null || raw === '') return 'CARD';
  const compact = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    CARD: 'CARD',
    CREDIT_CARD: 'CARD',
    DEBIT_CARD: 'CARD',
    UPI: 'UPI',
    NETBANKING: 'NET_BANKING',
    NET_BANKING: 'NET_BANKING',
    WALLET: 'WALLET',
    BANK_TRANSFER: 'BANK_TRANSFER',
  };
  const method = aliases[compact];
  if (!method || !PAYMENT_METHODS.includes(method)) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}.`
    );
  }
  return method;
}

function normalizeScenario(raw) {
  if (raw === undefined || raw === null || raw === '') return 'SUCCESS';
  const scenario = String(raw).trim().toUpperCase();
  if (scenario === 'FAILED' || scenario === 'DECLINE' || scenario === 'DECLINED') return 'FAILURE';
  if (!SCENARIOS.includes(scenario)) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      `scenario must be one of: ${SCENARIOS.join(', ')}.`
    );
  }
  return scenario;
}

function buildPaymentFingerprint({
  accountId,
  amount,
  merchant,
  description,
  paymentMethod,
  scenario,
  categoryId,
  categoryName,
}) {
  const canonical = JSON.stringify({
    v: 1,
    accountId: accountId || null,
    amount: Number(amount).toFixed(2),
    merchant,
    description: description || '',
    paymentMethod,
    scenario,
    categoryId: categoryId || null,
    categoryName: categoryName || '',
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function buildSeedFingerprint(accountId) {
  const canonical = JSON.stringify({ v: 1, accountId: accountId || null });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Serialise every simulator mutation for one user. The unique constraints are
 * the real guarantee; this lock removes the check-then-insert race so
 * concurrent retries converge without relying on error handling.
 */
async function lockUserForSimulator(tx, userId) {
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${`simulator:${userId}`}), 1, 8))::bit(32)::int)`;
  } catch (err) {
    // Unit tests use a scripted transactional client; the unique constraints
    // still prevent duplicates when the lock cannot be taken.
    console.warn('[SIMULATOR] Could not take the per-user lock:', err.message);
  }
}

async function resolveAccount(tx, userId, accountId, { createIfMissing = false } = {}) {
  if (accountId !== undefined && accountId !== null && accountId !== '') {
    if (typeof accountId !== 'string') {
      throw httpError(400, 'VALIDATION_ERROR', 'accountId must be a string.');
    }
    const account = await tx.financialAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) throw httpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    return account;
  }

  let account = await tx.financialAccount.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!account && createIfMissing) {
    account = await tx.financialAccount.create({
      data: {
        userId,
        name: 'Simulator Demo Account',
        accountType: 'BANK',
        balance: 0,
        currency: 'INR',
      },
    });
  }

  if (!account) {
    throw httpError(
      404,
      'ACCOUNT_REQUIRED',
      'Create an account (or seed simulator funds) before making a simulated payment.'
    );
  }
  return account;
}

async function resolveCategory(tx, userId, { categoryId, categoryName }) {
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    if (typeof categoryId !== 'string') {
      throw httpError(400, 'VALIDATION_ERROR', 'categoryId must be a string.');
    }
    const category = await tx.category.findFirst({
      where: {
        id: categoryId,
        OR: [{ userId }, { userId: null }],
      },
    });
    if (!category) throw httpError(404, 'CATEGORY_NOT_FOUND', 'Category not found.');
    return category;
  }

  const name = categoryName || DEFAULT_CATEGORY;
  let category = await tx.category.findFirst({
    where: { userId, name: { equals: name, mode: 'insensitive' } },
  });
  if (!category) {
    category = await tx.category.create({
      data: { userId, name, categoryType: 'EXPENSE' },
    });
  }
  return category;
}

async function resolveSeedCategory(tx, userId) {
  let category = await tx.category.findFirst({
    where: { userId, name: { equals: SEED_CATEGORY, mode: 'insensitive' } },
  });
  if (!category) {
    category = await tx.category.create({
      data: { userId, name: SEED_CATEGORY, categoryType: 'INCOME' },
    });
  }
  return category;
}

function presentPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    status: payment.status,
    amount: Number(payment.amount),
    formattedAmount: formatINR(payment.amount),
    currency: payment.currency,
    merchant: payment.merchant,
    description: payment.description,
    paymentMethod: payment.paymentMethod,
    scenario: payment.scenario,
    accountId: payment.accountId,
    categoryId: payment.categoryId,
    failureCode: payment.failureCode,
    failureMessage: payment.failureMessage,
    originTransactionId: payment.originTransactionId,
    refundTransactionId: payment.refundTransactionId,
    idempotencyKey: payment.idempotencyKey,
    settledAt: payment.settledAt,
    refundedAt: payment.refundedAt,
    reversedAt: payment.reversedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    synthetic: true,
    disclaimer: DISCLAIMER,
  };
}

function presentTransaction(transaction) {
  if (!transaction) return null;
  return {
    id: transaction.id,
    type: transaction.transactionType,
    amount: Number(transaction.amount),
    formattedAmount: formatINR(transaction.amount),
    currency: transaction.currency,
    description: transaction.description,
    merchant: transaction.merchant,
    paymentMethod: transaction.paymentMethod,
    date: transaction.date,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    isSimulated: transaction.isSimulated,
    synthetic: true,
    disclaimer: DISCLAIMER,
  };
}

async function linkedTransaction(tx, payment) {
  if (!payment) return null;
  const ids = [payment.originTransactionId, payment.refundTransactionId].filter(Boolean);
  if (!ids.length) return null;
  return tx.transaction.findFirst({
    where: { id: { in: ids }, userId: payment.userId },
    orderBy: { createdAt: 'desc' },
  });
}

async function writeAudit(userId, action, entityId, req) {
  await prisma.auditLog
    .create({
      data: {
        userId,
        action,
        entity: 'SimulatedPayment',
        entityId: entityId || null,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })
    .catch(() => {});
}

function publish(userId, type, payload) {
  try {
    realtimeService.publish(userId, type, payload, { synthetic: true });
  } catch (err) {
    // Realtime is best-effort; the automatic `sync.changed` event still fires.
    console.warn('[SIMULATOR] Could not publish realtime event:', err.message);
  }
}

async function afterSettled(userId, transaction) {
  if (!transaction) return;
  notificationService.checkBudgetThresholds(userId, transaction).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

const getSimulatorStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const config = getSimulatorConfig();

    const [grouped, seed] = await Promise.all([
      prisma.simulatedPayment.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.idempotencyRecord.findUnique({
        where: { userId_scope_key: { userId, scope: SEED_SCOPE, key: SEED_KEY } },
      }),
    ]);

    const counts = Object.fromEntries(PAYMENT_STATUSES.map((status) => [status, 0]));
    for (const row of grouped) {
      if (counts[row.status] !== undefined) counts[row.status] = row._count._all;
    }

    return res.json({
      success: true,
      data: {
        enabled: config.enabled,
        production: config.production,
        synthetic: true,
        disclaimer: config.disclaimer,
        disabledReason: config.disabledReason,
        currency: config.currency,
        maxAmount: config.maxAmount,
        formattedMaxAmount: formatINR(config.maxAmount),
        seedAmount: config.seedAmount,
        formattedSeedAmount: formatINR(config.seedAmount),
        paymentMethods: PAYMENT_METHODS,
        scenarios: SCENARIOS,
        seedClaimed: Boolean(seed),
        counts,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

/* ------------------------------------------------------------------ */
/* Seed / reset                                                        */
/* ------------------------------------------------------------------ */

const seedSimulatorFunds = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const config = getSimulatorConfig();
    const accountId = req.body ? req.body.accountId : undefined;
    const fingerprint = buildSeedFingerprint(accountId);

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const existing = await tx.idempotencyRecord.findUnique({
        where: { userId_scope_key: { userId, scope: SEED_SCOPE, key: SEED_KEY } },
      });

      if (existing) {
        if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) {
          throw httpError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Simulator funds were already claimed into a different account. Reset the simulator or use the original account.'
          );
        }
        const original = existing.transactionId
          ? await tx.transaction.findFirst({
              where: { id: existing.transactionId, userId },
            })
          : null;
        if (!original) {
          throw httpError(
            409,
            'SEED_ALREADY_CLAIMED',
            'Simulator funds were already claimed once and that ledger row no longer exists. Resetting the simulator does not restore the claim.'
          );
        }
        const account = await tx.financialAccount.findFirst({
          where: { userId, id: original.accountId || undefined },
        });
        return { replayed: true, transaction: original, account };
      }

      const account = await resolveAccount(tx, userId, accountId, { createIfMissing: true });
      const category = await resolveSeedCategory(tx, userId);

      const updatedAccount = await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: { increment: config.seedAmount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          amount: config.seedAmount,
          transactionType: 'INCOME',
          description: `[SIMULATOR SEED] Demo funds — ${formatINR(config.seedAmount)}`,
          notes: SYNTHETIC_NOTE,
          date: parseDateOnly(todayDateOnly()),
          currency: account.currency || 'INR',
          isSimulated: true,
        },
      });

      await tx.idempotencyRecord.create({
        data: {
          userId,
          scope: SEED_SCOPE,
          key: SEED_KEY,
          transactionId: transaction.id,
          amount: config.seedAmount,
          requestFingerprint: fingerprint,
        },
      });

      return { replayed: false, transaction, account: updatedAccount };
    });

    if (!result.replayed) {
      await writeAudit(userId, 'SIMULATOR_SEED', result.transaction.id, req);
      publish(userId, 'simulator.seeded', {
        transactionId: result.transaction.id,
        amount: Number(result.transaction.amount),
      });
    }

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        message: result.replayed
          ? 'Simulator funds were already claimed. No additional funds were added.'
          : `Added ${formatINR(config.seedAmount)} of synthetic demo funds. No real money moved.`,
        replayed: result.replayed,
        accountId: result.account ? result.account.id : null,
        newBalance: result.account ? Number(result.account.balance) : null,
        formattedNewBalance: result.account ? formatINR(result.account.balance) : null,
        transaction: presentTransaction(result.transaction),
        synthetic: true,
        disclaimer: config.disclaimer,
      },
    });
  } catch (error) {
    if (error && error.code === 'P2002') {
      return sendError(
        res,
        409,
        'IDEMPOTENCY_CONFLICT',
        'Simulator funds were already claimed. Refresh the simulator status before retrying.'
      );
    }
    return handleError(error, res, next);
  }
};

const resetSimulator = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const payments = await tx.simulatedPayment.findMany({
        where: { userId },
        select: { originTransactionId: true, refundTransactionId: true },
      });

      const transactionIds = [
        ...new Set(
          payments
            .flatMap((payment) => [payment.originTransactionId, payment.refundTransactionId])
            .filter(Boolean)
        ),
      ];

      let transactions = [];
      if (transactionIds.length) {
        transactions = await tx.transaction.findMany({
          where: {
            userId,
            id: { in: transactionIds },
            isSimulated: true,
          },
        });
      }

      // Unwind every simulated ledger effect before deleting the rows, so the
      // account returns to its seed balance instead of keeping spent money.
      for (const transaction of transactions) {
        await applyEffects(tx, reverseEffects(transaction));
      }

      const deletedTransactions = transactionIds.length
        ? await tx.transaction.deleteMany({
            where: {
              userId,
              id: { in: transactionIds },
              isSimulated: true,
            },
          })
        : { count: 0 };

      const deletedPayments = await tx.simulatedPayment.deleteMany({ where: { userId } });

      return {
        deletedPayments: deletedPayments.count,
        deletedTransactions: deletedTransactions.count,
      };
    });

    await writeAudit(userId, 'SIMULATOR_RESET', null, req);
    publish(userId, 'simulator.reset', result);

    return res.json({
      success: true,
      data: {
        message:
          'Simulator payments and their refund/reversal rows were removed and their ledger effects undone. Demo seed funding was left intact.',
        ...result,
        seedUnaffected: true,
        synthetic: true,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

/* ------------------------------------------------------------------ */
/* List / read                                                         */
/* ------------------------------------------------------------------ */

const listSimulatedPayments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const rawStatus = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (rawStatus && !PAYMENT_STATUSES.includes(rawStatus)) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `status must be one of: ${PAYMENT_STATUSES.join(', ')}.`
      );
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const where = { userId, ...(rawStatus ? { status: rawStatus } : {}) };
    const [payments, total] = await Promise.all([
      prisma.simulatedPayment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.simulatedPayment.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        payments: payments.map(presentPayment),
        pagination: { total, limit, offset, hasMore: offset + payments.length < total },
        synthetic: true,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const getSimulatedPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const payment = await prisma.simulatedPayment.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!payment) {
      return sendError(res, 404, 'SIMULATED_PAYMENT_NOT_FOUND', 'Simulated payment not found.');
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        id: {
          in: [payment.originTransactionId, payment.refundTransactionId].filter(Boolean),
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({
      success: true,
      data: {
        payment: presentPayment(payment),
        transactions: transactions.map(presentTransaction),
        synthetic: true,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const createSimulatedPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const config = getSimulatorConfig();
    const body = req.body || {};

    const key = normalizeIdempotencyKey(body.idempotencyKey);
    if (!key) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'idempotencyKey is required: 8-128 characters of letters, digits, dot, dash, underscore or colon.'
      );
    }

    const amount = parseAmount(body.amount, config);
    const merchant = normalizeText(body.merchant, 'merchant', { required: true, max: 120 });
    const description = normalizeText(body.description, 'description', { max: 500 });
    const paymentMethod = normalizePaymentMethod(body.paymentMethod);
    const scenario = normalizeScenario(body.scenario);
    const accountId = body.accountId || null;
    const categoryId = body.categoryId || null;
    const categoryName = normalizeText(body.category, 'category', { max: 80 });

    if (scenario === 'FAILURE') {
      // A failure scenario must not even resolve an account: no money is
      // involved and a missing account should not masquerade as a decline.
      // The account is still resolved for storage so the attempt is auditable.
    }

    const fingerprint = buildPaymentFingerprint({
      accountId,
      amount,
      merchant,
      description,
      paymentMethod,
      scenario,
      categoryId,
      categoryName,
    });

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const existing = await tx.simulatedPayment.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      });

      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw httpError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This idempotencyKey was already used for a different simulated payment. Use a new key for a new payment.'
          );
        }
        return {
          payment: existing,
          transaction: await linkedTransaction(tx, existing),
          replayed: true,
        };
      }

      const account = await resolveAccount(tx, userId, accountId, { createIfMissing: true });
      const category = await resolveCategory(tx, userId, { categoryId, categoryName });

      let payment = await tx.simulatedPayment.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          amount,
          currency: account.currency || 'INR',
          merchant,
          description,
          paymentMethod,
          scenario,
          status: 'PENDING',
          idempotencyKey: key,
          requestFingerprint: fingerprint,
        },
      });

      if (scenario === 'FAILURE') {
        payment = await tx.simulatedPayment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureCode: 'SIMULATED_DECLINE',
            failureMessage: 'Declined by the synthetic simulator scenario. No money moved.',
          },
        });
        return { payment, transaction: null, replayed: false };
      }

      if (scenario === 'PENDING') {
        return { payment, transaction: null, replayed: false };
      }

      // scenario === 'SUCCESS': settle atomically.
      const available = Number(account.balance);
      if (!Number.isFinite(available) || available < amount) {
        payment = await tx.simulatedPayment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureCode: 'INSUFFICIENT_FUNDS',
            failureMessage: 'The synthetic account balance is insufficient. No money moved.',
          },
        });
        return { payment, transaction: null, replayed: false };
      }

      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          amount,
          transactionType: 'EXPENSE',
          description: description || `[SIMULATED] ${merchant}`,
          merchant,
          notes: SYNTHETIC_NOTE,
          paymentMethod,
          date: parseDateOnly(todayDateOnly()),
          currency: account.currency || 'INR',
          isSimulated: true,
        },
      });

      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: amount } },
      });

      payment = await tx.simulatedPayment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          settledAt: new Date(),
          originTransactionId: transaction.id,
        },
      });

      return { payment, transaction, replayed: false };
    });

    if (!result.replayed) {
      await writeAudit(userId, 'SIMULATOR_PAYMENT_CREATE', result.payment.id, req);
      publish(userId, 'simulator.payment.created', {
        paymentId: result.payment.id,
        status: result.payment.status,
        amount: Number(result.payment.amount),
      });
      if (result.transaction) await afterSettled(userId, result.transaction);
    }

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        message: result.replayed
          ? 'This simulated payment was already created. No new effect was applied.'
          : result.payment.status === 'FAILED'
            ? 'The simulated payment failed. No money moved.'
            : result.payment.status === 'PENDING'
              ? 'The simulated payment is pending. Confirm or fail it explicitly.'
              : 'Simulated payment settled. No real money moved.',
        replayed: result.replayed,
        payment: presentPayment(result.payment),
        transaction: presentTransaction(result.transaction),
        synthetic: true,
        disclaimer: config.disclaimer,
      },
    });
  } catch (error) {
    if (error && error.code === 'P2002') {
      return sendError(
        res,
        409,
        'IDEMPOTENCY_CONFLICT',
        'A concurrent request already used this idempotencyKey. Retry once to replay it.'
      );
    }
    return handleError(error, res, next);
  }
};

/* ------------------------------------------------------------------ */
/* State transitions                                                   */
/* ------------------------------------------------------------------ */

const confirmSimulatedPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const paymentId = req.params.id;
    const config = getSimulatorConfig();

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const payment = await tx.simulatedPayment.findFirst({
        where: { id: paymentId, userId },
      });
      if (!payment) {
        throw httpError(404, 'SIMULATED_PAYMENT_NOT_FOUND', 'Simulated payment not found.');
      }

      if (payment.status === 'SUCCESS') {
        return {
          payment,
          transaction: await linkedTransaction(tx, payment),
          replayed: true,
        };
      }
      if (payment.status !== 'PENDING') {
        throw httpError(
          409,
          'INVALID_STATE',
          `A ${payment.status} payment cannot be confirmed.`
        );
      }

      const account = await tx.financialAccount.findFirst({
        where: { id: payment.accountId, userId },
      });
      if (!account) {
        throw httpError(404, 'ACCOUNT_NOT_FOUND', 'The simulated payment account no longer exists.');
      }

      const available = Number(account.balance);
      const amount = Number(payment.amount);
      if (!Number.isFinite(available) || available < amount) {
        const failed = await tx.simulatedPayment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureCode: 'INSUFFICIENT_FUNDS',
            failureMessage: 'The synthetic account balance is insufficient. No money moved.',
          },
        });
        return { payment: failed, transaction: null, replayed: false, failed: true };
      }

      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: payment.accountId,
          categoryId: payment.categoryId,
          amount,
          transactionType: 'EXPENSE',
          description:
            payment.description || `[SIMULATED] ${payment.merchant} (confirmed pending payment)`,
          merchant: payment.merchant,
          notes: SYNTHETIC_NOTE,
          paymentMethod: payment.paymentMethod,
          date: parseDateOnly(todayDateOnly()),
          currency: payment.currency || 'INR',
          isSimulated: true,
        },
      });

      await tx.financialAccount.update({
        where: { id: payment.accountId },
        data: { balance: { decrement: amount } },
      });

      const settled = await tx.simulatedPayment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          settledAt: new Date(),
          originTransactionId: transaction.id,
        },
      });

      return { payment: settled, transaction, replayed: false, failed: false };
    });

    if (!result.replayed) {
      await writeAudit(userId, 'SIMULATOR_PAYMENT_CONFIRM', result.payment.id, req);
      publish(userId, 'simulator.payment.confirmed', {
        paymentId: result.payment.id,
        status: result.payment.status,
      });
      if (result.transaction) await afterSettled(userId, result.transaction);
    }

    return res.json({
      success: true,
      data: {
        message: result.replayed
          ? 'This simulated payment was already settled. No new effect was applied.'
          : result.failed
            ? 'The pending simulated payment failed settlement because the synthetic balance was insufficient. No money moved.'
            : 'Pending simulated payment settled. No real money moved.',
        replayed: Boolean(result.replayed),
        payment: presentPayment(result.payment),
        transaction: presentTransaction(result.transaction),
        synthetic: true,
        disclaimer: config.disclaimer,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const failSimulatedPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const paymentId = req.params.id;
    const config = getSimulatorConfig();

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const payment = await tx.simulatedPayment.findFirst({
        where: { id: paymentId, userId },
      });
      if (!payment) {
        throw httpError(404, 'SIMULATED_PAYMENT_NOT_FOUND', 'Simulated payment not found.');
      }

      if (payment.status === 'FAILED') {
        return { payment, replayed: true };
      }
      if (payment.status !== 'PENDING') {
        throw httpError(
          409,
          'INVALID_STATE',
          `A ${payment.status} payment cannot be marked failed. Use the refund or reversal flow for settled payments.`
        );
      }

      const failed = await tx.simulatedPayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: 'SIMULATED_DECLINE',
          failureMessage: 'Failed on request in the synthetic simulator. No money moved.',
        },
      });
      return { payment: failed, replayed: false };
    });

    if (!result.replayed) {
      await writeAudit(userId, 'SIMULATOR_PAYMENT_FAIL', result.payment.id, req);
      publish(userId, 'simulator.payment.failed', {
        paymentId: result.payment.id,
        status: result.payment.status,
      });
    }

    return res.json({
      success: true,
      data: {
        message: result.replayed
          ? 'This simulated payment was already failed. No new effect was applied.'
          : 'Simulated payment marked failed. No money moved.',
        replayed: Boolean(result.replayed),
        payment: presentPayment(result.payment),
        transaction: null,
        synthetic: true,
        disclaimer: config.disclaimer,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

async function reverseSettledPayment({ req, res, next, kind }) {
  try {
    const userId = req.user.id;
    const paymentId = req.params.id;
    const config = getSimulatorConfig();
    const isRefund = kind === 'REFUND';

    const result = await prisma.$transaction(async (tx) => {
      await lockUserForSimulator(tx, userId);

      const payment = await tx.simulatedPayment.findFirst({
        where: { id: paymentId, userId },
      });
      if (!payment) {
        throw httpError(404, 'SIMULATED_PAYMENT_NOT_FOUND', 'Simulated payment not found.');
      }

      const alreadyDone = isRefund ? 'REFUNDED' : 'REVERSED';
      const otherDone = isRefund ? 'REVERSED' : 'REFUNDED';

      if (payment.status === alreadyDone) {
        return {
          payment,
          transaction: await linkedTransaction(tx, payment),
          replayed: true,
        };
      }
      if (payment.status === otherDone) {
        throw httpError(
          409,
          'INVALID_STATE',
          `A ${payment.status} payment cannot be ${isRefund ? 'refunded' : 'reversed'}.`
        );
      }
      if (payment.status !== 'SUCCESS') {
        throw httpError(
          409,
          'INVALID_STATE',
          `A ${payment.status} payment cannot be ${isRefund ? 'refunded' : 'reversed'}; only settled payments can be.`
        );
      }

      const amount = Number(payment.amount);
      const transaction = await tx.transaction.create({
        data: {
          userId,
          accountId: payment.accountId,
          categoryId: payment.categoryId,
          amount,
          transactionType: isRefund ? 'REFUND' : 'REVERSAL',
          description: `${isRefund ? 'Refund' : 'Reversal'} of simulated payment: ${payment.merchant}`,
          merchant: payment.merchant,
          notes: isRefund ? SYNTHETIC_REFUND_NOTE : SYNTHETIC_REVERSAL_NOTE,
          paymentMethod: payment.paymentMethod,
          date: parseDateOnly(todayDateOnly()),
          currency: payment.currency || 'INR',
          isSimulated: true,
        },
      });

      await tx.financialAccount.update({
        where: { id: payment.accountId },
        data: { balance: { increment: amount } },
      });

      const updated = await tx.simulatedPayment.update({
        where: { id: payment.id },
        data: isRefund
          ? {
              status: 'REFUNDED',
              refundedAt: new Date(),
              refundTransactionId: transaction.id,
            }
          : {
              status: 'REVERSED',
              reversedAt: new Date(),
              refundTransactionId: transaction.id,
            },
      });

      return { payment: updated, transaction, replayed: false };
    });

    if (!result.replayed) {
      await writeAudit(
        userId,
        isRefund ? 'SIMULATOR_PAYMENT_REFUND' : 'SIMULATOR_PAYMENT_REVERSE',
        result.payment.id,
        req
      );
      publish(userId, isRefund ? 'simulator.payment.refunded' : 'simulator.payment.reversed', {
        paymentId: result.payment.id,
        status: result.payment.status,
        amount: Number(result.payment.amount),
      });
    }

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        message: result.replayed
          ? `This simulated payment was already ${isRefund ? 'refunded' : 'reversed'}. No new effect was applied.`
          : `Simulated payment fully ${isRefund ? 'refunded' : 'reversed'}. The synthetic balance was credited and net spending was reduced. No real money moved.`,
        replayed: Boolean(result.replayed),
        payment: presentPayment(result.payment),
        transaction: presentTransaction(result.transaction),
        synthetic: true,
        disclaimer: config.disclaimer,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
}

const refundSimulatedPayment = (req, res, next) =>
  reverseSettledPayment({ req, res, next, kind: 'REFUND' });

const reverseSimulatedPayment = (req, res, next) =>
  reverseSettledPayment({ req, res, next, kind: 'REVERSAL' });

module.exports = {
  getSimulatorStatus,
  seedSimulatorFunds,
  resetSimulator,
  listSimulatedPayments,
  getSimulatedPayment,
  createSimulatedPayment,
  confirmSimulatedPayment,
  failSimulatedPayment,
  refundSimulatedPayment,
  reverseSimulatedPayment,
};
