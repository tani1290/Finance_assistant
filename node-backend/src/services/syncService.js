/**
 * Local-first sync engine (server side).
 *
 * The mobile app writes to its own SQLite database first and only then queues a
 * durable operation. This module is the other half of that contract:
 *
 *   pull  — one authoritative snapshot plus explicit tombstones. It is a full
 *           snapshot on purpose. The web controllers write and hard-delete rows
 *           without touching any change log, so a timestamp-only delta would
 *           silently miss edits and deletions made in the browser.
 *   push  — applies queued operations idempotently. `(userId, opId)` is unique,
 *           so an HTTP retry or an app restart replays the first result instead
 *           of moving money twice.
 *
 * Conflict policy is optimistic concurrency on the existing `updatedAt`
 * column, which Prisma maintains on every write path (mobile sync, web CRUD and
 * the AI tools). `version` is an additive audit counter, never the sole
 * arbiter. A mismatch stores both payloads and refuses to overwrite the server
 * row; last-write-wins is never applied to money.
 */

'use strict';

const prisma = require('../config/database');
const {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
  checkSufficientFunds,
  lockAccountsForUpdate,
} = require('./transactionBalance');
const { parseAccountType } = require('../config/accountTypes');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');
const { calculateEMI } = require('../utils/financialMath');
const backupCrypto = require('./syncBackupCrypto');

const ENTITY_TYPES = Object.freeze([
  'account',
  'transaction',
  'budget',
  'goal',
  'loan',
  'investment',
]);

const OPERATIONS = Object.freeze(['CREATE', 'UPDATE', 'DELETE']);

const MAX_OPS_PER_PUSH = 200;

const TRANSACTION_TYPES = Object.freeze([
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'INVESTMENT',
  'LOAN_PAYMENT',
  'REFUND',
  'REVERSAL',
]);

const GOAL_TYPES = Object.freeze([
  'EMERGENCY_FUND',
  'VACATION',
  'HOME',
  'CAR',
  'EDUCATION',
  'RETIREMENT',
  'WEDDING',
  'INVESTMENT',
  'OTHER',
]);

const PRIORITIES = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
const GOAL_STATUSES = Object.freeze(['ACTIVE', 'COMPLETED', 'PAUSED']);
const LOAN_TYPES = Object.freeze(['HOME', 'CAR', 'PERSONAL', 'EDUCATION', 'BUSINESS', 'GOLD', 'OTHER']);
const LOAN_STATUSES = Object.freeze(['ACTIVE', 'CLOSED', 'DEFAULTED']);
const ASSET_TYPES = Object.freeze([
  'STOCK',
  'MUTUAL_FUND',
  'SIP',
  'GOLD',
  'SILVER',
  'FIXED_DEPOSIT',
  'CRYPTO',
  'BOND',
  'ETF',
  'OTHER',
]);

class SyncError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class SyncConflictError extends Error {
  constructor(reason, serverPayload) {
    super(reason);
    this.code = 'SYNC_CONFLICT';
    this.reason = reason;
    this.serverPayload = serverPayload;
  }
}

function validation(message) {
  return new SyncError(400, 'VALIDATION_ERROR', message);
}

function notFound(entity) {
  return new SyncError(404, 'NOT_FOUND', `${entity} was not found for this account.`);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function requireNumber(value, field, { min = null, max = null, allowZero = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw validation(`${field} must be a number.`);
  if (!allowZero && n === 0) throw validation(`${field} must not be zero.`);
  if (min !== null && n < min) throw validation(`${field} must be at least ${min}.`);
  if (max !== null && n > max) throw validation(`${field} must be at most ${max}.`);
  return n;
}

function requireString(value, field, { max = 500 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validation(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw validation(`${field} is too long.`);
  return trimmed;
}

function optionalString(value, field, { max = 2000 } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw validation(`${field} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw validation(`${field} is too long.`);
  return trimmed;
}

function requireEnum(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    throw validation(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function requireDate(value, field) {
  try {
    return parseDateOnly(value, field);
  } catch (error) {
    throw validation(error.message);
  }
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function isUniqueViolation(error) {
  return error && error.code === 'P2002';
}

/**
 * Serialise one user's sync state and acquire a transaction-scoped lock.
 *
 * The unique `(userId, opId)` index is the real idempotency guarantee. This
 * lock only removes the race window where two retries arrive at the same
 * instant and both try to apply before either commits.
 */
async function lockUserSyncState(tx, userId) {
  try {
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${'sync:' + userId}), 1, 8))::bit(32)::int)`;
    }
  } catch (_) {
    // A non-PostgreSQL or mocked client still has the unique index.
  }
}

async function ensureState(tx, userId) {
  const client = tx || prisma;
  const existing = await client.syncState.findUnique({ where: { userId } });
  if (existing) return existing;
  return client.syncState.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

// ---------------------------------------------------------------------------
// Snapshot serialisers
// ---------------------------------------------------------------------------

function serializeAccount(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution ?? null,
    accountType: row.accountType,
    accountNumberMasked: row.accountNumberMasked ?? null,
    balance: toNumber(row.balance),
    currency: row.currency || 'INR',
    isActive: row.isActive !== false,
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

function serializeTransaction(row) {
  return {
    id: row.id,
    accountId: row.accountId ?? null,
    toAccountId: row.toAccountId ?? null,
    categoryId: row.categoryId ?? null,
    categoryName: row.category?.name ?? null,
    amount: toNumber(row.amount),
    transactionType: row.transactionType,
    description: row.description ?? null,
    merchant: row.merchant ?? null,
    notes: row.notes ?? null,
    paymentMethod: row.paymentMethod ?? null,
    date: formatDateOnly(row.date),
    currency: row.currency || 'INR',
    isSimulated: row.isSimulated === true,
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

function serializeBudget(row) {
  return {
    id: row.id,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName,
    monthlyLimit: toNumber(row.monthlyLimit),
    month: row.month,
    year: row.year,
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

function serializeGoal(row) {
  return {
    id: row.id,
    name: row.name,
    goalType: row.goalType,
    targetAmount: toNumber(row.targetAmount),
    currentAmount: toNumber(row.currentAmount),
    targetDate: formatDateOnly(row.targetDate),
    monthlyContribution: toNumber(row.monthlyContribution),
    priority: row.priority,
    status: row.status,
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

function serializeLoan(row) {
  return {
    id: row.id,
    loanType: row.loanType,
    lenderName: row.lenderName ?? null,
    principalAmount: toNumber(row.principalAmount),
    interestRate: toNumber(row.interestRate),
    tenureMonths: row.tenureMonths,
    startDate: formatDateOnly(row.startDate),
    emiAmount: row.emiAmount === null || row.emiAmount === undefined ? null : toNumber(row.emiAmount),
    outstandingBalance: toNumber(row.outstandingBalance),
    status: row.status,
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

function serializeInvestment(row) {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    symbol: row.symbol,
    name: row.name ?? null,
    assetType: row.assetType,
    quantity: toNumber(row.quantity),
    averageBuyPrice: toNumber(row.averageBuyPrice),
    version: row.version ?? 0,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

async function bootstrap(userId, deviceId) {
  const state = await ensureState(null, userId);
  const device = deviceId
    ? await prisma.mobileDevice.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
        select: { deviceId: true, lastSyncAt: true, lastPulledAt: true, lastPushedAt: true, syncCursor: true },
      })
    : null;

  return {
    serverRevision: state.revision,
    lastBackupAt: iso(state.lastBackupAt),
    device,
    capabilities: {
      localFirst: true,
      backup: backupCrypto.isConfigured(),
      entities: ENTITY_TYPES,
      maxOpsPerPush: MAX_OPS_PER_PUSH,
    },
  };
}

async function pull(userId, { deviceId } = {}) {
  const state = await ensureState(null, userId);

  const [
    accounts,
    transactions,
    budgets,
    goals,
    loans,
    portfolio,
    tombstoneRows,
    categoryRows,
    conflictCount,
  ] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.budget.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.loan.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.portfolio.findUnique({ where: { userId }, include: { investments: true } }),
    prisma.syncTombstone.findMany({
      where: { userId },
      select: { entityType: true, entityId: true, deletedAt: true, revision: true },
      orderBy: { revision: 'asc' },
    }),
    prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      select: { id: true, name: true, categoryType: true, icon: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.syncConflict.count({ where: { userId, status: 'OPEN' } }),
  ]);

  const investments = portfolio?.investments || [];

  if (deviceId) {
    await prisma.mobileDevice
      .updateMany({
        where: { userId, deviceId },
        data: {
          lastSyncAt: new Date(),
          lastPulledAt: new Date(),
          syncCursor: state.revision,
        },
      })
      .catch(() => {});
  }

  return {
    serverRevision: state.revision,
    serverTime: new Date().toISOString(),
    openConflicts: conflictCount,
    snapshot: {
      accounts: accounts.map(serializeAccount),
      transactions: transactions.map(serializeTransaction),
      budgets: budgets.map(serializeBudget),
      goals: goals.map(serializeGoal),
      loans: loans.map(serializeLoan),
      portfolio: portfolio
        ? {
            id: portfolio.id,
            totalInvested: toNumber(portfolio.totalInvested),
            currentValue: toNumber(portfolio.currentValue),
            version: portfolio.version ?? 0,
            updatedAt: iso(portfolio.updatedAt),
          }
        : null,
      investments: investments.map(serializeInvestment),
      categories: categoryRows,
      tombstones: tombstoneRows.map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        deletedAt: iso(row.deletedAt),
        revision: row.revision,
      })),
    },
  };
}

async function status(userId) {
  const state = await ensureState(null, userId);
  const [lastBackup, pending, conflicts, devices] = await Promise.all([
    prisma.syncBackup.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, sizeBytes: true, serverRevision: true, format: true },
    }),
    prisma.syncOperation.count({ where: { userId, status: { in: ['PENDING', 'SYNCING'] } } }),
    prisma.syncConflict.count({ where: { userId, status: 'OPEN' } }),
    prisma.mobileDevice.findMany({
      where: { userId },
      select: { deviceId: true, platform: true, appVersion: true, lastSyncAt: true, syncCursor: true },
      orderBy: { lastSyncAt: 'desc' },
      take: 20,
    }),
  ]);

  return {
    serverRevision: state.revision,
    lastBackupAt: iso(state.lastBackupAt),
    lastBackup,
    pendingOperations: pending,
    openConflicts: conflicts,
    backupConfigured: backupCrypto.isConfigured(),
    devices,
  };
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

function assertFresh(existing, op, entityLabel) {
  if (op.force === true) return;
  if (!op.baseUpdatedAt) return;
  const base = new Date(op.baseUpdatedAt);
  if (Number.isNaN(base.getTime())) {
    throw validation('baseUpdatedAt must be an ISO timestamp.');
  }
  const server = new Date(existing.updatedAt);
  if (server.getTime() > base.getTime()) {
    throw new SyncConflictError(
      'STALE_WRITE',
      entityLabel === 'transaction'
        ? serializeTransaction(existing)
        : entityLabel === 'account'
          ? serializeAccount(existing)
          : entityLabel === 'budget'
            ? serializeBudget(existing)
            : entityLabel === 'goal'
              ? serializeGoal(existing)
              : entityLabel === 'loan'
                ? serializeLoan(existing)
                : serializeInvestment(existing)
    );
  }
}

async function findOwnedAccount(tx, userId, accountId) {
  const account = await tx.financialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound('Account');
  return account;
}

async function resolveCategory(tx, userId, data) {
  if (data.categoryId) {
    const category = await tx.category.findFirst({
      where: { id: data.categoryId, OR: [{ userId }, { userId: null }] },
    });
    if (!category) throw notFound('Category');
    return category;
  }
  const name = optionalString(data.category ?? data.categoryName, 'category', { max: 120 });
  if (!name) return null;

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

// ---------------------------------------------------------------------------
// Entity appliers
// ---------------------------------------------------------------------------

async function applyAccount(tx, userId, op) {
  const data = op.data || {};

  if (op.operation === 'CREATE') {
    const existing = await tx.financialAccount.findFirst({ where: { id: op.entityId, userId } });
    if (existing) throw new SyncConflictError('ALREADY_EXISTS', serializeAccount(existing));

    const type = parseAccountType(data.accountType);
    if (type.error) throw validation('Invalid account type.');

    const row = await tx.financialAccount.create({
      data: {
        id: op.entityId,
        userId,
        name: requireString(data.name, 'name', { max: 120 }),
        institution: optionalString(data.institution, 'institution', { max: 120 }),
        accountType: type.value,
        accountNumberMasked: optionalString(data.accountNumberMasked, 'accountNumberMasked', { max: 32 }),
        balance: requireNumber(data.balance ?? 0, 'balance'),
        currency: optionalString(data.currency, 'currency', { max: 8 }) || 'INR',
        isActive: data.isActive !== false,
        clientUpdatedAt: new Date(),
      },
    });
    return serializeAccount(row);
  }

  const existing = await tx.financialAccount.findFirst({ where: { id: op.entityId, userId } });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'account');
    const row = await tx.financialAccount.update({
      where: { id: existing.id },
      data: { isActive: false, version: { increment: 1 }, clientUpdatedAt: new Date() },
    });
    return serializeAccount(row);
  }

  assertFresh(existing, op, 'account');
  const type = data.accountType === undefined ? null : parseAccountType(data.accountType);
  if (type && type.error) throw validation('Invalid account type.');

  // A balance is ledger-derived. Accepting it on an UPDATE would let two
  // devices disagree about history, so the column is only writable at create.
  const row = await tx.financialAccount.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined && { name: requireString(data.name, 'name', { max: 120 }) }),
      ...(data.institution !== undefined && {
        institution: optionalString(data.institution, 'institution', { max: 120 }),
      }),
      ...(type && { accountType: type.value }),
      ...(data.accountNumberMasked !== undefined && {
        accountNumberMasked: optionalString(data.accountNumberMasked, 'accountNumberMasked', { max: 32 }),
      }),
      ...(data.currency !== undefined && {
        currency: optionalString(data.currency, 'currency', { max: 8 }) || 'INR',
      }),
      ...(data.isActive !== undefined && { isActive: data.isActive !== false }),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
  });
  return serializeAccount(row);
}

async function applyTransaction(tx, userId, op) {
  const data = op.data || {};

  if (op.operation === 'CREATE') {
    const duplicate = await tx.transaction.findFirst({ where: { id: op.entityId, userId } });
    if (duplicate) throw new SyncConflictError('ALREADY_EXISTS', serializeTransaction(duplicate));

    const amount = requireNumber(data.amount, 'amount', { min: 0.01 });
    const transactionType = requireEnum(data.transactionType ?? data.type, TRANSACTION_TYPES, 'transactionType', 'EXPENSE');
    if (data.toAccountId && transactionType !== 'TRANSFER') {
      throw validation('toAccountId is only valid for transfers.');
    }

    let accountId = data.accountId || null;
    if (accountId) {
      await findOwnedAccount(tx, userId, accountId);
    } else {
      const fallback = await tx.financialAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      accountId = fallback ? fallback.id : null;
    }

    let toAccountId = null;
    if (transactionType === 'TRANSFER') {
      if (!accountId) throw validation('A transfer requires a source account.');
      if (!data.toAccountId) throw validation('A transfer requires a destination account.');
      const destination = await findOwnedAccount(tx, userId, data.toAccountId);
      if (destination.id === accountId) {
        throw validation('Source and destination accounts must differ.');
      }
      toAccountId = destination.id;
    }

    const ledgerDate = requireDate(data.date, 'date') || requireDate(todayDateOnly(), 'date');
    const category = await resolveCategory(tx, userId, data);

    const effects = transactionEffects({ transactionType, amount, accountId, toAccountId });
    const locked = await lockAccountsForUpdate(
      tx,
      effects.map((effect) => effect.accountId)
    );
    const debit = effects.filter((effect) => effect.delta < 0);
    if (debit.length > 0) {
      const perAccount = new Map();
      for (const effect of debit) {
        perAccount.set(effect.accountId, (perAccount.get(effect.accountId) || 0) + effect.delta);
      }
      for (const [id, delta] of perAccount) {
        const check = checkSufficientFunds(locked.get(id), delta);
        if (!check.allowed) {
          const error = new SyncError(400, 'INSUFFICIENT_FUNDS', 'Insufficient funds in the selected account.', {
            accountId: id,
            currentBalance: check.currentBalance,
            required: check.required,
          });
          throw error;
        }
      }
    }

    const row = await tx.transaction.create({
      data: {
        id: op.entityId,
        userId,
        accountId,
        toAccountId,
        categoryId: category ? category.id : null,
        amount,
        transactionType,
        description: optionalString(data.description, 'description'),
        merchant: optionalString(data.merchant, 'merchant', { max: 200 }),
        notes: optionalString(data.notes, 'notes', { max: 4000 }),
        paymentMethod: optionalString(data.paymentMethod, 'paymentMethod', { max: 60 }),
        date: ledgerDate,
        currency: optionalString(data.currency, 'currency', { max: 8 }) || 'INR',
        clientUpdatedAt: new Date(),
      },
      include: { category: { select: { name: true } } },
    });

    await applyEffects(tx, effects);
    return serializeTransaction(row);
  }

  const existing = await tx.transaction.findFirst({
    where: { id: op.entityId, userId },
    include: { category: { select: { name: true } } },
  });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'transaction');
    await revertEffects(tx, existing);
    await tx.transaction.delete({ where: { id: existing.id } });
    return serializeTransaction(existing);
  }

  assertFresh(existing, op, 'transaction');

  const nextType = requireEnum(
    data.transactionType ?? data.type,
    TRANSACTION_TYPES,
    'transactionType',
    existing.transactionType
  );
  if ((nextType === 'TRANSFER') !== (existing.transactionType === 'TRANSFER')) {
    throw validation('A transaction cannot be converted to or from a transfer.');
  }

  const amount = data.amount !== undefined ? requireNumber(data.amount, 'amount', { min: 0.01 }) : toNumber(existing.amount);
  let accountId = existing.accountId;
  if (data.accountId !== undefined) {
    accountId = data.accountId ? (await findOwnedAccount(tx, userId, data.accountId)).id : null;
  }
  let toAccountId = existing.toAccountId;
  if (data.toAccountId !== undefined) {
    if (nextType !== 'TRANSFER') throw validation('toAccountId is only valid for transfers.');
    toAccountId = data.toAccountId ? (await findOwnedAccount(tx, userId, data.toAccountId)).id : null;
  }
  if (nextType === 'TRANSFER') {
    if (!accountId) throw validation('A transfer requires a source account.');
    if (toAccountId && toAccountId === accountId) {
      throw validation('Source and destination accounts must differ.');
    }
  }

  const category = data.category !== undefined || data.categoryName !== undefined || data.categoryId !== undefined
    ? await resolveCategory(tx, userId, data)
    : null;

  const ledgerDate = data.date !== undefined
    ? requireDate(data.date, 'date') || requireDate(todayDateOnly(), 'date')
    : existing.date;

  const nextShape = { transactionType: nextType, amount, accountId, toAccountId };
  const netEffects = transactionEffects(nextShape);

  await revertEffects(tx, existing);

  const locked = await lockAccountsForUpdate(tx, netEffects.map((effect) => effect.accountId));
  const debits = new Map();
  for (const effect of netEffects) {
    if (effect.delta < 0) debits.set(effect.accountId, (debits.get(effect.accountId) || 0) + effect.delta);
  }
  for (const [id, delta] of debits) {
    const check = checkSufficientFunds(locked.get(id), delta);
    if (!check.allowed) {
      const error = new SyncError(400, 'INSUFFICIENT_FUNDS', 'Insufficient funds in the selected account.', {
        accountId: id,
        currentBalance: check.currentBalance,
        required: check.required,
      });
      throw error;
    }
  }

  const row = await tx.transaction.update({
    where: { id: existing.id },
    data: {
      accountId,
      toAccountId,
      amount,
      transactionType: nextType,
      ...(ledgerDate && { date: ledgerDate }),
      ...(category && { categoryId: category.id }),
      ...(data.description !== undefined && { description: optionalString(data.description, 'description') }),
      ...(data.merchant !== undefined && { merchant: optionalString(data.merchant, 'merchant', { max: 200 }) }),
      ...(data.notes !== undefined && { notes: optionalString(data.notes, 'notes', { max: 4000 }) }),
      ...(data.paymentMethod !== undefined && {
        paymentMethod: optionalString(data.paymentMethod, 'paymentMethod', { max: 60 }),
      }),
      ...(data.currency !== undefined && { currency: optionalString(data.currency, 'currency', { max: 8 }) || 'INR' }),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
    include: { category: { select: { name: true } } },
  });

  await applyEffects(tx, netEffects);
  return serializeTransaction(row);
}

async function ensureBudgetCategory(tx, userId, categoryName) {
  let category = await tx.category.findFirst({
    where: { userId, name: { equals: categoryName, mode: 'insensitive' } },
  });
  if (!category) {
    category = await tx.category.create({ data: { userId, name: categoryName, categoryType: 'EXPENSE' } });
  }
  return category;
}

async function applyBudget(tx, userId, op) {
  const data = op.data || {};

  if (op.operation === 'CREATE') {
    const categoryName = requireString(data.categoryName ?? data.category, 'categoryName', { max: 120 });
    const monthlyLimit = requireNumber(data.monthlyLimit, 'monthlyLimit', { min: 0.01 });
    const month = data.month === undefined ? new Date().getMonth() + 1 : requireNumber(data.month, 'month', { min: 1, max: 12 });
    const year = data.year === undefined ? new Date().getFullYear() : requireNumber(data.year, 'year', { min: 2000, max: 2200 });
    if (!Number.isInteger(month) || !Number.isInteger(year)) {
      throw validation('month and year must be whole numbers.');
    }

    const duplicateId = await tx.budget.findFirst({ where: { id: op.entityId, userId } });
    if (duplicateId) throw new SyncConflictError('ALREADY_EXISTS', serializeBudget(duplicateId));

    const existing = await tx.budget.findFirst({
      where: { userId, categoryName: { equals: categoryName, mode: 'insensitive' }, month, year },
    });
    if (existing) {
      throw new SyncConflictError('BUDGET_PERIOD_EXISTS', serializeBudget(existing));
    }

    const category = await ensureBudgetCategory(tx, userId, categoryName);
    const row = await tx.budget.create({
      data: {
        id: op.entityId,
        userId,
        categoryId: category.id,
        categoryName,
        monthlyLimit,
        month,
        year,
        clientUpdatedAt: new Date(),
      },
    });
    return serializeBudget(row);
  }

  const existing = await tx.budget.findFirst({ where: { id: op.entityId, userId } });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'budget');
    await tx.budget.delete({ where: { id: existing.id } });
    return serializeBudget(existing);
  }

  assertFresh(existing, op, 'budget');
  const categoryName = data.categoryName ?? data.category;
  const row = await tx.budget.update({
    where: { id: existing.id },
    data: {
      ...(data.monthlyLimit !== undefined && {
        monthlyLimit: requireNumber(data.monthlyLimit, 'monthlyLimit', { min: 0.01 }),
      }),
      ...(categoryName !== undefined && {
        categoryName: requireString(categoryName, 'categoryName', { max: 120 }),
      }),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
  });
  return serializeBudget(row);
}

async function applyGoal(tx, userId, op) {
  const data = op.data || {};

  if (op.operation === 'CREATE') {
    const duplicate = await tx.goal.findFirst({ where: { id: op.entityId, userId } });
    if (duplicate) throw new SyncConflictError('ALREADY_EXISTS', serializeGoal(duplicate));

    const row = await tx.goal.create({
      data: {
        id: op.entityId,
        userId,
        name: requireString(data.name, 'name', { max: 160 }),
        goalType: requireEnum(data.goalType, GOAL_TYPES, 'goalType', 'OTHER'),
        targetAmount: requireNumber(data.targetAmount, 'targetAmount', { min: 0.01 }),
        currentAmount: data.currentAmount === undefined ? 0 : requireNumber(data.currentAmount, 'currentAmount', { min: 0 }),
        targetDate: data.targetDate ? requireDate(data.targetDate, 'targetDate') : null,
        monthlyContribution:
          data.monthlyContribution === undefined
            ? 0
            : requireNumber(data.monthlyContribution, 'monthlyContribution', { min: 0 }),
        priority: requireEnum(data.priority, PRIORITIES, 'priority', 'MEDIUM'),
        status: requireEnum(data.status, GOAL_STATUSES, 'status', 'ACTIVE'),
        clientUpdatedAt: new Date(),
      },
    });
    return serializeGoal(row);
  }

  const existing = await tx.goal.findFirst({ where: { id: op.entityId, userId } });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'goal');
    await tx.goal.delete({ where: { id: existing.id } });
    return serializeGoal(existing);
  }

  assertFresh(existing, op, 'goal');
  const row = await tx.goal.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined && { name: requireString(data.name, 'name', { max: 160 }) }),
      ...(data.goalType !== undefined && { goalType: requireEnum(data.goalType, GOAL_TYPES, 'goalType', existing.goalType) }),
      ...(data.targetAmount !== undefined && {
        targetAmount: requireNumber(data.targetAmount, 'targetAmount', { min: 0.01 }),
      }),
      ...(data.currentAmount !== undefined && {
        currentAmount: requireNumber(data.currentAmount, 'currentAmount', { min: 0 }),
      }),
      ...(data.targetDate !== undefined && {
        targetDate: data.targetDate ? requireDate(data.targetDate, 'targetDate') : null,
      }),
      ...(data.monthlyContribution !== undefined && {
        monthlyContribution: requireNumber(data.monthlyContribution, 'monthlyContribution', { min: 0 }),
      }),
      ...(data.priority !== undefined && { priority: requireEnum(data.priority, PRIORITIES, 'priority', existing.priority) }),
      ...(data.status !== undefined && { status: requireEnum(data.status, GOAL_STATUSES, 'status', existing.status) }),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
  });
  return serializeGoal(row);
}

async function applyLoan(tx, userId, op) {
  const data = op.data || {};

  if (op.operation === 'CREATE') {
    const duplicate = await tx.loan.findFirst({ where: { id: op.entityId, userId } });
    if (duplicate) throw new SyncConflictError('ALREADY_EXISTS', serializeLoan(duplicate));

    const principal = requireNumber(data.principalAmount, 'principalAmount', { min: 0.01 });
    const rate = requireNumber(data.interestRate, 'interestRate', { min: 0, max: 100 });
    const tenure = requireNumber(data.tenureMonths, 'tenureMonths', { min: 1, max: 720 });
    if (!Number.isInteger(tenure)) throw validation('tenureMonths must be a whole number.');

    const row = await tx.loan.create({
      data: {
        id: op.entityId,
        userId,
        loanType: requireEnum(data.loanType, LOAN_TYPES, 'loanType', 'PERSONAL'),
        lenderName: optionalString(data.lenderName, 'lenderName', { max: 160 }),
        principalAmount: principal,
        interestRate: rate,
        tenureMonths: tenure,
        startDate: requireDate(data.startDate, 'startDate') || requireDate(todayDateOnly(), 'startDate'),
        emiAmount: calculateEMI(principal, rate, tenure),
        outstandingBalance:
          data.outstandingBalance === undefined
            ? principal
            : requireNumber(data.outstandingBalance, 'outstandingBalance', { min: 0 }),
        status: requireEnum(data.status, LOAN_STATUSES, 'status', 'ACTIVE'),
        clientUpdatedAt: new Date(),
      },
    });
    return serializeLoan(row);
  }

  const existing = await tx.loan.findFirst({ where: { id: op.entityId, userId } });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'loan');
    await tx.loan.delete({ where: { id: existing.id } });
    return serializeLoan(existing);
  }

  assertFresh(existing, op, 'loan');
  const principal = data.principalAmount !== undefined
    ? requireNumber(data.principalAmount, 'principalAmount', { min: 0.01 })
    : toNumber(existing.principalAmount);
  const rate = data.interestRate !== undefined
    ? requireNumber(data.interestRate, 'interestRate', { min: 0, max: 100 })
    : toNumber(existing.interestRate);
  const tenure = data.tenureMonths !== undefined
    ? requireNumber(data.tenureMonths, 'tenureMonths', { min: 1, max: 720 })
    : existing.tenureMonths;
  if (!Number.isInteger(tenure)) throw validation('tenureMonths must be a whole number.');

  const row = await tx.loan.update({
    where: { id: existing.id },
    data: {
      ...(data.loanType !== undefined && {
        loanType: requireEnum(data.loanType, LOAN_TYPES, 'loanType', existing.loanType),
      }),
      ...(data.lenderName !== undefined && {
        lenderName: optionalString(data.lenderName, 'lenderName', { max: 160 }),
      }),
      ...(data.principalAmount !== undefined && { principalAmount: principal }),
      ...(data.interestRate !== undefined && { interestRate: rate }),
      ...(data.tenureMonths !== undefined && { tenureMonths: tenure }),
      ...(data.outstandingBalance !== undefined && {
        outstandingBalance: requireNumber(data.outstandingBalance, 'outstandingBalance', { min: 0 }),
      }),
      ...(data.status !== undefined && { status: requireEnum(data.status, LOAN_STATUSES, 'status', existing.status) }),
      emiAmount: calculateEMI(principal, rate, tenure),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
  });
  return serializeLoan(row);
}

async function recalcPortfolioTotals(tx, portfolioId) {
  const holdings = await tx.investment.findMany({ where: { portfolioId } });
  const totalInvested = holdings.reduce(
    (sum, holding) => sum + toNumber(holding.quantity) * toNumber(holding.averageBuyPrice),
    0
  );
  await tx.portfolio.update({
    where: { id: portfolioId },
    data: { totalInvested, version: { increment: 1 } },
  });
  return totalInvested;
}

async function ensurePortfolio(tx, userId) {
  const existing = await tx.portfolio.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.portfolio.create({ data: { userId, totalInvested: 0, currentValue: 0 } });
}

async function applyInvestment(tx, userId, op) {
  const data = op.data || {};
  const portfolio = await ensurePortfolio(tx, userId);

  if (op.operation === 'CREATE') {
    const duplicate = await tx.investment.findFirst({ where: { id: op.entityId, portfolioId: portfolio.id } });
    if (duplicate) throw new SyncConflictError('ALREADY_EXISTS', serializeInvestment(duplicate));

    const symbol = requireString(data.symbol, 'symbol', { max: 32 }).toUpperCase();
    const sameSymbol = await tx.investment.findFirst({ where: { portfolioId: portfolio.id, symbol } });
    if (sameSymbol) throw new SyncConflictError('SYMBOL_EXISTS', serializeInvestment(sameSymbol));

    const row = await tx.investment.create({
      data: {
        id: op.entityId,
        portfolioId: portfolio.id,
        symbol,
        name: optionalString(data.name, 'name', { max: 160 }) || symbol,
        assetType: requireEnum(data.assetType, ASSET_TYPES, 'assetType', 'STOCK'),
        quantity: requireNumber(data.quantity, 'quantity', { min: 0.000001 }),
        averageBuyPrice: requireNumber(data.averageBuyPrice, 'averageBuyPrice', { min: 0.01 }),
        clientUpdatedAt: new Date(),
      },
    });
    await recalcPortfolioTotals(tx, portfolio.id);
    return serializeInvestment(row);
  }

  const existing = await tx.investment.findFirst({
    where: { id: op.entityId, portfolioId: portfolio.id },
  });
  if (!existing) throw new SyncConflictError('DELETED_ON_SERVER', null);

  if (op.operation === 'DELETE') {
    assertFresh(existing, op, 'investment');
    await tx.investment.delete({ where: { id: existing.id } });
    await recalcPortfolioTotals(tx, portfolio.id);
    return serializeInvestment(existing);
  }

  assertFresh(existing, op, 'investment');
  const row = await tx.investment.update({
    where: { id: existing.id },
    data: {
      ...(data.quantity !== undefined && {
        quantity: requireNumber(data.quantity, 'quantity', { min: 0.000001 }),
      }),
      ...(data.averageBuyPrice !== undefined && {
        averageBuyPrice: requireNumber(data.averageBuyPrice, 'averageBuyPrice', { min: 0.01 }),
      }),
      ...(data.name !== undefined && { name: optionalString(data.name, 'name', { max: 160 }) }),
      ...(data.assetType !== undefined && {
        assetType: requireEnum(data.assetType, ASSET_TYPES, 'assetType', existing.assetType),
      }),
      version: { increment: 1 },
      clientUpdatedAt: new Date(),
    },
  });
  await recalcPortfolioTotals(tx, portfolio.id);
  return serializeInvestment(row);
}

const APPLIERS = {
  account: applyAccount,
  transaction: applyTransaction,
  budget: applyBudget,
  goal: applyGoal,
  loan: applyLoan,
  investment: applyInvestment,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateOperationShape(op) {
  if (!op || typeof op !== 'object') throw validation('Every operation must be an object.');
  if (typeof op.opId !== 'string' || !op.opId.trim()) throw validation('opId is required.');
  if (op.opId.length > 128) throw validation('opId is too long.');
  if (typeof op.entityType !== 'string' || !ENTITY_TYPES.includes(op.entityType)) {
    throw validation(`entityType must be one of: ${ENTITY_TYPES.join(', ')}.`);
  }
  if (typeof op.entityId !== 'string' || !UUID_RE.test(op.entityId)) {
    throw validation('entityId must be a UUID generated on the device.');
  }
  const operation = String(op.operation || '').toUpperCase();
  if (!OPERATIONS.includes(operation)) {
    throw validation(`operation must be one of: ${OPERATIONS.join(', ')}.`);
  }
  return { ...op, operation };
}

/**
 * Record a durable failure. Called after the applying transaction rolled back,
 * so the claim row can be created here without colliding.
 */
async function recordFailure(userId, op, deviceId, error) {
  const retryable = !(error instanceof SyncError) && error.code !== 'SYNC_CONFLICT';
  const status = 'FAILED';
  try {
    await prisma.syncOperation.upsert({
      where: { userId_opId: { userId, opId: op.opId } },
      update: {
        status,
        attempts: { increment: 1 },
        lastError: String(error.message || error).slice(0, 900),
      },
      create: {
        userId,
        deviceId,
        opId: op.opId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        payload: safeJson(op.data),
        baseUpdatedAt: op.baseUpdatedAt ? new Date(op.baseUpdatedAt) : null,
        baseVersion: Number.isInteger(op.baseVersion) ? op.baseVersion : null,
        status,
        attempts: 1,
        lastError: String(error.message || error).slice(0, 900),
      },
    });
  } catch (recordError) {
    // Recording must never mask the original failure.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[SYNC] Could not persist operation failure:', recordError.message);
    }
  }
  return {
    opId: op.opId,
    entityType: op.entityType,
    entityId: op.entityId,
    operation: op.operation,
    status,
    retryable,
    error: {
      code: error.code || 'SYNC_OPERATION_FAILED',
      message: error.message || 'The operation could not be applied.',
      details: error.details || null,
    },
  };
}

async function recordConflict(userId, op, deviceId, conflict) {
  const localPayload = safeJson(op.data);
  const serverPayload = safeJson(conflict.serverPayload);
  const result = {
    opId: op.opId,
    entityType: op.entityType,
    entityId: op.entityId,
    operation: op.operation,
    status: 'CONFLICT',
    retryable: false,
    conflict: {
      reason: conflict.reason,
      localPayload,
      serverPayload,
    },
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.syncOperation.upsert({
        where: { userId_opId: { userId, opId: op.opId } },
        update: { status: 'CONFLICT', lastError: conflict.reason },
        create: {
          userId,
          deviceId,
          opId: op.opId,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          payload: localPayload,
          baseUpdatedAt: op.baseUpdatedAt ? new Date(op.baseUpdatedAt) : null,
          baseVersion: Number.isInteger(op.baseVersion) ? op.baseVersion : null,
          status: 'CONFLICT',
          lastError: conflict.reason,
        },
      });
      await tx.syncConflict.create({
        data: {
          userId,
          entityType: op.entityType,
          entityId: op.entityId,
          opId: op.opId,
          deviceId,
          reason: conflict.reason,
          localPayload,
          serverPayload,
          status: 'OPEN',
        },
      });
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[SYNC] Could not persist conflict:', error.message);
    }
    result.retryable = true;
  }

  return result;
}

/**
 * Apply one operation in its own transaction.
 *
 * One transaction per operation (rather than one for the whole batch) is
 * deliberate: a malformed or conflicting op must not roll back good work the
 * user already recorded. The client queue is durable, so partial progress is
 * always resumable.
 */
async function applyOne(userId, deviceId, op, revision) {
  return prisma.$transaction(async (tx) => {
    await lockUserSyncState(tx, userId);

    const existing = await tx.syncOperation.findUnique({
      where: { userId_opId: { userId, opId: op.opId } },
    });
    if (existing) {
      // A previous attempt already finished. Replay its recorded result.
      return {
        opId: op.opId,
        entityType: existing.entityType,
        entityId: existing.entityId,
        operation: existing.operation,
        status: existing.status,
        replayed: true,
        result: existing.result,
        error: existing.lastError ? { code: 'SYNC_OPERATION_FAILED', message: existing.lastError } : null,
        conflict: existing.status === 'CONFLICT' ? { reason: existing.lastError } : undefined,
      };
    }

    await tx.syncOperation.create({
      data: {
        userId,
        deviceId,
        opId: op.opId,
        entityId: op.entityId,
        entityType: op.entityType,
        operation: op.operation,
        payload: safeJson(op.data),
        baseUpdatedAt: op.baseUpdatedAt ? new Date(op.baseUpdatedAt) : null,
        baseVersion: Number.isInteger(op.baseVersion) ? op.baseVersion : null,
        status: 'SYNCING',
        attempts: 1,
      },
    });

    const applier = APPLIERS[op.entityType];
    const result = await applier(tx, userId, op);

    if (op.operation === 'DELETE') {
      await tx.syncTombstone.upsert({
        where: {
          userId_entityType_entityId: {
            userId,
            entityType: op.entityType,
            entityId: op.entityId,
          },
        },
        update: { deletedAt: new Date(), revision, snapshot: safeJson(result) },
        create: {
          userId,
          entityType: op.entityType,
          entityId: op.entityId,
          deletedAt: new Date(),
          deletedBy: 'mobile',
          revision,
          snapshot: safeJson(result),
        },
      });
    } else if (op.entityType === 'account' && op.data && op.data.isActive === false) {
      // Archiving an account is a reversible delete from the device's point of
      // view. The tombstone tells a later pull to stop showing it.
      await tx.syncTombstone.upsert({
        where: {
          userId_entityType_entityId: { userId, entityType: 'account', entityId: op.entityId },
        },
        update: { deletedAt: new Date(), revision, snapshot: safeJson(result) },
        create: {
          userId,
          entityType: 'account',
          entityId: op.entityId,
          deletedAt: new Date(),
          deletedBy: 'mobile',
          revision,
          snapshot: safeJson(result),
        },
      });
    }

    const state = await tx.syncState.update({
      where: { userId },
      data: { revision: { increment: 1 } },
    });

    await tx.syncOperation.update({
      where: { userId_opId: { userId, opId: op.opId } },
      data: { status: 'SYNCED', appliedRevision: state.revision, result: safeJson(result), lastError: null },
    });

    await tx.mobileDevice
      .updateMany({
        where: { userId, deviceId },
        data: { lastSyncAt: new Date(), lastPushedAt: new Date(), syncCursor: state.revision },
      })
      .catch(() => {});

    return {
      opId: op.opId,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      status: 'SYNCED',
      replayed: false,
      revision: state.revision,
      result,
    };
  });
}

/**
 * Push a batch of device operations.
 *
 * Never throws for a per-operation failure: the response reports each status so
 * the client can keep the failed item queued and retry with backoff.
 */
async function push(userId, { deviceId, operations } = {}) {
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    throw validation('deviceId is required.');
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw validation('operations must be a non-empty array.');
  }
  if (operations.length > MAX_OPS_PER_PUSH) {
    throw new SyncError(413, 'BATCH_TOO_LARGE', `A push may contain at most ${MAX_OPS_PER_PUSH} operations.`);
  }

  await ensureState(null, userId);

  const results = [];
  let revision = (await ensureState(null, userId)).revision;

  for (const raw of operations) {
    let op;
    try {
      op = validateOperationShape(raw);
    } catch (error) {
      results.push({
        opId: raw && raw.opId ? String(raw.opId) : null,
        status: 'FAILED',
        retryable: false,
        error: { code: error.code || 'VALIDATION_ERROR', message: error.message },
      });
      continue;
    }

    // Idempotent replay without opening a transaction for the common case.
    try {
      const prior = await prisma.syncOperation.findUnique({
        where: { userId_opId: { userId, opId: op.opId } },
      });
      if (prior) {
        results.push({
          opId: op.opId,
          entityType: prior.entityType,
          entityId: prior.entityId,
          operation: prior.operation,
          status: prior.status,
          replayed: true,
          revision: prior.appliedRevision,
          result: prior.result,
          ...(prior.status === 'CONFLICT'
            ? { conflict: { reason: prior.lastError } }
            : {}),
          ...(prior.status === 'FAILED'
            ? { retryable: true, error: { code: 'SYNC_OPERATION_FAILED', message: prior.lastError } }
            : {}),
        });
        continue;
      }
    } catch (_) {
      // Fall through to the transactional claim.
    }

    try {
      revision += 1;
      const applied = await applyOne(userId, deviceId, op, revision);
      revision = applied.revision ?? revision;
      results.push(applied);
    } catch (error) {
      if (error instanceof SyncConflictError) {
        results.push(await recordConflict(userId, op, deviceId, error));
      } else {
        results.push(await recordFailure(userId, op, deviceId, error));
      }
    }
  }

  const state = await ensureState(null, userId);

  return {
    serverRevision: state.revision,
    serverTime: new Date().toISOString(),
    applied: results.filter((r) => r.status === 'SYNCED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    conflicts: results.filter((r) => r.status === 'CONFLICT').length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

async function listConflicts(userId, { status: statusFilter = 'OPEN', limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  return prisma.syncConflict.findMany({
    where: { userId, ...(statusFilter && statusFilter !== 'ALL' ? { status: statusFilter } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/**
 * Resolve one open conflict.
 *
 * LOCAL re-applies the stored device payload with `force`, which is the only
 * place last-write-wins is allowed and only after the user explicitly chose it.
 * SERVER accepts the server row and discards the local edit.
 */
async function resolveConflict(userId, { conflictId, resolution, deviceId = 'conflict-resolution' } = {}) {
  if (!['LOCAL', 'SERVER'].includes(String(resolution || '').toUpperCase())) {
    throw validation('resolution must be LOCAL or SERVER.');
  }
  const choice = String(resolution).toUpperCase();

  const conflict = await prisma.syncConflict.findFirst({
    where: { id: conflictId, userId },
  });
  if (!conflict) throw notFound('Conflict');
  if (conflict.status !== 'OPEN') {
    throw new SyncError(409, 'CONFLICT_ALREADY_RESOLVED', 'This conflict is already resolved.');
  }

  if (choice === 'SERVER') {
    const updated = await prisma.syncConflict.update({
      where: { id: conflict.id },
      data: { status: 'RESOLVED_SERVER', resolution: 'SERVER', resolvedAt: new Date() },
    });
    return { resolution: 'SERVER', conflict: updated, serverPayload: conflict.serverPayload };
  }

  const opId = `resolve:${conflict.id}`;
  const baseUpdatedAt = conflict.serverPayload ? conflict.serverPayload.updatedAt : null;

  const results = await push(userId, {
    deviceId,
    operations: [
      {
        opId,
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        operation: conflict.localPayload && conflict.localPayload.__deleted ? 'DELETE' : 'UPDATE',
        data: conflict.localPayload || {},
        force: true,
        baseUpdatedAt,
      },
    ],
  });

  const outcome = results.results[0];
  if (!outcome || outcome.status !== 'SYNCED') {
    return { resolution: 'LOCAL', conflict, outcome };
  }

  const updated = await prisma.syncConflict.update({
    where: { id: conflict.id },
    data: { status: 'RESOLVED_LOCAL', resolution: 'LOCAL', resolvedAt: new Date() },
  });
  return { resolution: 'LOCAL', conflict: updated, outcome };
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

function describeBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    format: row.format,
    createdAt: iso(row.createdAt),
    sizeBytes: row.sizeBytes,
    recordCounts: row.recordCounts,
    serverRevision: row.serverRevision,
    deviceId: row.deviceId,
  };
}

async function createBackup(userId, { deviceId = null } = {}) {
  const snapshot = await pull(userId, {});
  const envelope = backupCrypto.encryptBackup(userId, snapshot);

  const counts = {
    accounts: snapshot.snapshot.accounts.length,
    transactions: snapshot.snapshot.transactions.length,
    budgets: snapshot.snapshot.budgets.length,
    goals: snapshot.snapshot.goals.length,
    loans: snapshot.snapshot.loans.length,
    investments: snapshot.snapshot.investments.length,
  };

  const row = await prisma.syncBackup.create({
    data: {
      userId,
      deviceId,
      format: envelope.format,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      salt: envelope.salt,
      checksum: envelope.checksum,
      sizeBytes: envelope.sizeBytes,
      recordCounts: counts,
      serverRevision: snapshot.serverRevision,
    },
  });

  await prisma.syncState.upsert({
    where: { userId },
    update: { lastBackupAt: new Date() },
    create: { userId, lastBackupAt: new Date() },
  });

  return { backup: describeBackup(row), recordCounts: counts };
}

async function listBackups(userId, { limit = 20 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = await prisma.syncBackup.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      format: true,
      createdAt: true,
      sizeBytes: true,
      recordCounts: true,
      serverRevision: true,
      deviceId: true,
    },
  });
  return rows.map(describeBackup);
}

/**
 * How many server rows were modified after the backup was taken?
 *
 * Restoring over newer data is destructive, so the caller must say so
 * explicitly. This check is intentionally conservative: any row newer than the
 * backup timestamp blocks a silent restore.
 */
async function countRowsNewerThan(userId, cutoff) {
  const where = { userId, updatedAt: { gt: cutoff } };
  const [accounts, transactions, budgets, goals, loans, portfolio] = await Promise.all([
    prisma.financialAccount.count({ where }),
    prisma.transaction.count({ where }),
    prisma.budget.count({ where }),
    prisma.goal.count({ where }),
    prisma.loan.count({ where }),
    prisma.portfolio.count({ where: { userId, updatedAt: { gt: cutoff } } }),
  ]);
  return accounts + transactions + budgets + goals + loans + portfolio;
}

async function nextRevision(tx, userId) {
  const state = await tx.syncState.update({
    where: { userId },
    data: { revision: { increment: 1 } },
  });
  return state.revision;
}

/**
 * Restore a backup.
 *
 * Modes:
 *   replace — mirror the backup. Rows created after the backup are removed and
 *             balances are restored exactly. A safety backup is always taken
 *             first, so a mistaken restore is itself recoverable.
 *   merge   — create only the rows that are missing. Never overwrites a row the
 *             server already has, and never removes anything.
 */
async function restoreBackup(userId, backupId, { mode = 'replace', confirm = false, deviceId = null } = {}) {
  const normalizedMode = String(mode || 'replace').toLowerCase();
  if (!['replace', 'merge'].includes(normalizedMode)) {
    throw validation('mode must be "replace" or "merge".');
  }

  const row = await prisma.syncBackup.findFirst({ where: { id: backupId, userId } });
  if (!row) throw notFound('Backup');

  const payload = backupCrypto.decryptBackup(userId, row);
  const snapshot = payload.snapshot || payload;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new SyncError(422, 'SYNC_BACKUP_CORRUPT', 'This backup does not contain a usable snapshot.');
  }

  const newer = await countRowsNewerThan(userId, row.createdAt);
  if (newer > 0 && !confirm) {
    throw new SyncError(
      409,
      'RESTORE_CONFIRM_REQUIRED',
      'This account has data newer than the backup. Confirm the restore to continue.',
      { newerRows: newer, backupCreatedAt: iso(row.createdAt) }
    );
  }

  const safety = await createBackup(userId, { deviceId });

  const summary = {
    accounts: 0,
    transactions: 0,
    budgets: 0,
    goals: 0,
    loans: 0,
    investments: 0,
    removed: 0,
  };

  await prisma.$transaction(async (tx) => {
    await lockUserSyncState(tx, userId);

    const backupAccounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const backupTransactions = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
    const backupBudgets = Array.isArray(snapshot.budgets) ? snapshot.budgets : [];
    const backupGoals = Array.isArray(snapshot.goals) ? snapshot.goals : [];
    const backupLoans = Array.isArray(snapshot.loans) ? snapshot.loans : [];
    const backupInvestments = Array.isArray(snapshot.investments) ? snapshot.investments : [];

    const backupIds = {
      account: new Set(backupAccounts.map((item) => item.id)),
      transaction: new Set(backupTransactions.map((item) => item.id)),
      budget: new Set(backupBudgets.map((item) => item.id)),
      goal: new Set(backupGoals.map((item) => item.id)),
      loan: new Set(backupLoans.map((item) => item.id)),
      investment: new Set(backupInvestments.map((item) => item.id)),
    };

    if (normalizedMode === 'replace') {
      // Remove rows that did not exist when the backup was taken.
      const currentTransactions = await tx.transaction.findMany({ where: { userId } });
      for (const current of currentTransactions) {
        if (!backupIds.transaction.has(current.id)) {
          await revertEffects(tx, current);
          await tx.transaction.delete({ where: { id: current.id } });
          summary.removed += 1;
        }
      }

      const deleteIfAbsent = async (model, entityType, set) => {
        const rows = await tx[model].findMany({ where: { userId } });
        for (const item of rows) {
          if (!set.has(item.id)) {
            await tx[model].delete({ where: { id: item.id } });
            summary.removed += 1;
          }
        }
      };

      await deleteIfAbsent('budget', 'budget', backupIds.budget);
      await deleteIfAbsent('goal', 'goal', backupIds.goal);
      await deleteIfAbsent('loan', 'loan', backupIds.loan);

      const portfolio = await tx.portfolio.findUnique({ where: { userId } });
      if (portfolio) {
        const holdings = await tx.investment.findMany({ where: { portfolioId: portfolio.id } });
        for (const holding of holdings) {
          if (!backupIds.investment.has(holding.id)) {
            await tx.investment.delete({ where: { id: holding.id } });
            summary.removed += 1;
          }
        }
      }

      const currentAccounts = await tx.financialAccount.findMany({ where: { userId } });
      for (const account of currentAccounts) {
        if (!backupIds.account.has(account.id)) {
          // Accounts are never hard-deleted: transactions may still reference
          // them and the ledger would lose its history.
          await tx.financialAccount.update({ where: { id: account.id }, data: { isActive: false } });
          summary.removed += 1;
        }
      }
    }

    // Upsert accounts first so transactions can reference them.
    for (const account of backupAccounts) {
      const type = parseAccountType(account.accountType);
      if (type.error) continue;
      const data = {
        name: String(account.name || 'Account').slice(0, 120),
        institution: account.institution ?? null,
        accountType: type.value,
        accountNumberMasked: account.accountNumberMasked ?? null,
        balance: requireNumber(account.balance ?? 0, 'balance'),
        currency: account.currency || 'INR',
        isActive: account.isActive !== false,
        clientUpdatedAt: new Date(),
      };
      const exists = await tx.financialAccount.findFirst({ where: { id: account.id, userId } });
      if (exists) {
        if (normalizedMode === 'replace') {
          await tx.financialAccount.update({ where: { id: account.id }, data: { ...data, version: { increment: 1 } } });
          summary.accounts += 1;
        }
      } else {
        await tx.financialAccount.create({ data: { id: account.id, userId, ...data } });
        summary.accounts += 1;
      }
    }

    for (const transaction of backupTransactions) {
      const exists = await tx.transaction.findFirst({ where: { id: transaction.id, userId } });
      if (exists) {
        if (normalizedMode === 'replace') {
          // Balance effects must be neutralised before the row is replaced,
          // otherwise the ledger double-counts the backup row.
          await revertEffects(tx, exists);
          const row2 = await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              accountId: transaction.accountId ?? null,
              toAccountId: transaction.toAccountId ?? null,
              categoryId: transaction.categoryId ?? null,
              amount: transaction.amount,
              transactionType: transaction.transactionType,
              description: transaction.description ?? null,
              merchant: transaction.merchant ?? null,
              notes: transaction.notes ?? null,
              paymentMethod: transaction.paymentMethod ?? null,
              date: requireDate(transaction.date, 'date'),
              currency: transaction.currency || 'INR',
              version: { increment: 1 },
              clientUpdatedAt: new Date(),
            },
          });
          await applyEffects(tx, transactionEffects(row2));
          summary.transactions += 1;
        }
      } else {
        const created = await tx.transaction.create({
          data: {
            id: transaction.id,
            userId,
            accountId: transaction.accountId ?? null,
            toAccountId: transaction.toAccountId ?? null,
            categoryId: transaction.categoryId ?? null,
            amount: transaction.amount,
            transactionType: transaction.transactionType,
            description: transaction.description ?? null,
            merchant: transaction.merchant ?? null,
            notes: transaction.notes ?? null,
            paymentMethod: transaction.paymentMethod ?? null,
            date: requireDate(transaction.date, 'date'),
            currency: transaction.currency || 'INR',
            clientUpdatedAt: new Date(),
          },
        });
        await applyEffects(tx, transactionEffects(created));
        summary.transactions += 1;
      }
    }

    for (const budget of backupBudgets) {
      const exists = await tx.budget.findFirst({ where: { id: budget.id, userId } });
      if (!exists) {
        await tx.budget.create({
          data: {
            id: budget.id,
            userId,
            categoryId: budget.categoryId ?? null,
            categoryName: budget.categoryName,
            monthlyLimit: budget.monthlyLimit,
            month: budget.month,
            year: budget.year,
            clientUpdatedAt: new Date(),
          },
        });
        summary.budgets += 1;
      } else if (normalizedMode === 'replace') {
        await tx.budget.update({
          where: { id: budget.id },
          data: {
            categoryId: budget.categoryId ?? null,
            categoryName: budget.categoryName,
            monthlyLimit: budget.monthlyLimit,
            month: budget.month,
            year: budget.year,
            version: { increment: 1 },
            clientUpdatedAt: new Date(),
          },
        });
        summary.budgets += 1;
      }
    }

    for (const goal of backupGoals) {
      const exists = await tx.goal.findFirst({ where: { id: goal.id, userId } });
      if (!exists) {
        await tx.goal.create({
          data: {
            id: goal.id,
            userId,
            name: goal.name,
            goalType: goal.goalType,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            targetDate: goal.targetDate ? requireDate(goal.targetDate, 'targetDate') : null,
            monthlyContribution: goal.monthlyContribution ?? 0,
            priority: goal.priority,
            status: goal.status,
            clientUpdatedAt: new Date(),
          },
        });
        summary.goals += 1;
      } else if (normalizedMode === 'replace') {
        await tx.goal.update({
          where: { id: goal.id },
          data: {
            name: goal.name,
            goalType: goal.goalType,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            targetDate: goal.targetDate ? requireDate(goal.targetDate, 'targetDate') : null,
            monthlyContribution: goal.monthlyContribution ?? 0,
            priority: goal.priority,
            status: goal.status,
            version: { increment: 1 },
            clientUpdatedAt: new Date(),
          },
        });
        summary.goals += 1;
      }
    }

    for (const loan of backupLoans) {
      const exists = await tx.loan.findFirst({ where: { id: loan.id, userId } });
      if (!exists) {
        await tx.loan.create({
          data: {
            id: loan.id,
            userId,
            loanType: loan.loanType,
            lenderName: loan.lenderName ?? null,
            principalAmount: loan.principalAmount,
            interestRate: loan.interestRate,
            tenureMonths: loan.tenureMonths,
            startDate: requireDate(loan.startDate, 'startDate'),
            emiAmount: loan.emiAmount,
            outstandingBalance: loan.outstandingBalance,
            status: loan.status,
            clientUpdatedAt: new Date(),
          },
        });
        summary.loans += 1;
      } else if (normalizedMode === 'replace') {
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            loanType: loan.loanType,
            lenderName: loan.lenderName ?? null,
            principalAmount: loan.principalAmount,
            interestRate: loan.interestRate,
            tenureMonths: loan.tenureMonths,
            startDate: requireDate(loan.startDate, 'startDate'),
            emiAmount: loan.emiAmount,
            outstandingBalance: loan.outstandingBalance,
            status: loan.status,
            version: { increment: 1 },
            clientUpdatedAt: new Date(),
          },
        });
        summary.loans += 1;
      }
    }

    const portfolio = await ensurePortfolio(tx, userId);
    for (const investment of backupInvestments) {
      const exists = await tx.investment.findFirst({ where: { id: investment.id, portfolioId: portfolio.id } });
      if (!exists) {
        await tx.investment.create({
          data: {
            id: investment.id,
            portfolioId: portfolio.id,
            symbol: investment.symbol,
            name: investment.name ?? investment.symbol,
            assetType: investment.assetType,
            quantity: investment.quantity,
            averageBuyPrice: investment.averageBuyPrice,
            clientUpdatedAt: new Date(),
          },
        });
        summary.investments += 1;
      } else if (normalizedMode === 'replace') {
        await tx.investment.update({
          where: { id: investment.id },
          data: {
            symbol: investment.symbol,
            name: investment.name ?? investment.symbol,
            assetType: investment.assetType,
            quantity: investment.quantity,
            averageBuyPrice: investment.averageBuyPrice,
            version: { increment: 1 },
            clientUpdatedAt: new Date(),
          },
        });
        summary.investments += 1;
      }
    }
    await recalcPortfolioTotals(tx, portfolio.id);

    // Tombstones from before the restore no longer describe reality.
    await tx.syncTombstone.deleteMany({ where: { userId } });
    const revision = await nextRevision(tx, userId);
    summary.revision = revision;
  });

  return {
    mode: normalizedMode,
    restoredFrom: describeBackup(row),
    safetyBackup: safety.backup,
    summary,
    serverRevision: (await ensureState(null, userId)).revision,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function listAudit(userId, { limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [operations, conflicts, tombstones] = await Promise.all([
    prisma.syncOperation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        opId: true,
        deviceId: true,
        entityType: true,
        entityId: true,
        operation: true,
        status: true,
        attempts: true,
        lastError: true,
        appliedRevision: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.syncConflict.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        reason: true,
        status: true,
        resolution: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
    prisma.syncTombstone.findMany({
      where: { userId },
      orderBy: { revision: 'desc' },
      take,
      select: { entityType: true, entityId: true, deletedAt: true, deletedBy: true, revision: true },
    }),
  ]);

  return { operations, conflicts, tombstones };
}

module.exports = {
  ENTITY_TYPES,
  OPERATIONS,
  SyncError,
  SyncConflictError,
  bootstrap,
  pull,
  push,
  status,
  listConflicts,
  resolveConflict,
  createBackup,
  listBackups,
  restoreBackup,
  listAudit,
};
