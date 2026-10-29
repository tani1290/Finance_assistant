const crypto = require('crypto');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');
const financialTwin = require('../services/financialTwinService');
const notificationService = require('../services/notificationService');
const {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
  isDebitType,
  checkSufficientFunds,
  lockAccountsForUpdate,
} = require('../services/transactionBalance');

/**
 * Transactions Controller with Anomaly Detection & ML Categorization
 * Owner: Jinay Golecha (jinay_golecha)
 */

const VALID_TRANSACTION_TYPES = [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'INVESTMENT',
  'LOAN_PAYMENT',
];

/**
 * Parse an integer query parameter inside explicit bounds.
 * Returns `null` when the value is present but invalid, so the caller can
 * answer with a 400 instead of letting Prisma receive NaN or an unbounded
 * `take`.
 */
const parseBoundedInt = (value, fallback, min, max) => {
  if (value === undefined || value === null || value === '') {
    return value === '' ? null : fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
};

/**
 * Resolve the destination of a transfer and enforce the invariants:
 * provided, distinct from the source, and owned by the same user.
 * Returns `{ account }` or `{ status, message }`.
 */
const resolveTransferDestination = async (userId, toAccountId, sourceAccountId) => {
  if (!toAccountId || typeof toAccountId !== 'string') {
    return { status: 400, message: 'A transfer requires a destination account.' };
  }
  if (sourceAccountId && toAccountId === sourceAccountId) {
    return { status: 400, message: 'Source and destination accounts must differ.' };
  }
  const account = await prisma.financialAccount.findFirst({
    where: { id: toAccountId, userId },
  });
  if (!account) {
    return { status: 404, message: 'Destination account not found.' };
  }
  return { account };
};

const TRANSFER_IDEMPOTENCY_SCOPE = 'account_transfer';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Normalise an optional transfer idempotency key.
 *
 * The key is optional so existing clients keep working. When supplied it must
 * be a stable, client-generated token that is reused only for retries of the
 * same logical transfer.
 */
function normalizeTransferIdempotencyKey(raw) {
  if (raw === undefined || raw === null || raw === '') return { key: null, invalid: false };
  if (typeof raw !== 'string') return { key: null, invalid: true };
  const value = raw.trim();
  if (!value) return { key: null, invalid: false };
  if (!IDEMPOTENCY_KEY_RE.test(value)) return { key: null, invalid: true };
  return { key: value, invalid: false };
}

const trimmedOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

/**
 * What makes two transfer requests the same?
 *
 * Every field that is persisted on the transfer row is part of the canonical
 * payload. `date` is the *requested* date (null when omitted), not the resolved
 * "today", so a retry after midnight still matches its original request.
 * Amounts are canonicalised to the ledger's two-decimal precision.
 *
 * The source/destination are the RESOLVED account ids. That means a retry that
 * omits the source but resolves to the same default account is treated as the
 * same transfer.
 */
function buildTransferFingerprint({
  accountId,
  toAccountId,
  amount,
  category,
  description,
  merchant,
  notes,
  paymentMethod,
  date,
}) {
  const canonical = JSON.stringify({
    v: 1,
    type: 'TRANSFER',
    accountId: accountId || null,
    toAccountId: toAccountId || null,
    amount: Number(amount).toFixed(2),
    category: trimmedOrNull(category),
    description: trimmedOrNull(description),
    merchant: trimmedOrNull(merchant),
    notes: trimmedOrNull(notes),
    paymentMethod: paymentMethod ? String(paymentMethod) : null,
    date: date ? formatDateOnly(date) : null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compare a stored key claim with this request. New claims always carry a
 * fingerprint; the amount fallback only exists for defensive compatibility.
 */
function transferRecordMatchesRequest(record, fingerprint, amountNum) {
  if (!record) return false;
  if (record.requestFingerprint) return record.requestFingerprint === fingerprint;
  return record.amount !== null && record.amount !== undefined && Number(record.amount) === amountNum;
}

function transferConflictError() {
  const error = new Error(
    'This idempotencyKey was already used for a different transfer. Use a new key for a new transfer.'
  );
  error.statusCode = 409;
  error.code = 'IDEMPOTENCY_CONFLICT';
  return error;
}

function sendTransferConflict(res) {
  const error = transferConflictError();
  return res.status(error.statusCode).json({
    success: false,
    error: { code: error.code, message: error.message },
  });
}

/**
 * Look up a previously claimed key and load the transfer it created.
 *
 * A matching claim is a replay. A claim that no longer points at a live,
 * owned transfer is NOT recreated: the user deleted the original, and
 * resurrecting money movement from an old retry would be surprising. The
 * client must generate a fresh key for a genuinely new transfer.
 */
async function findTransferReplay(client, { userId, key, fingerprint, amountNum }) {
  const record = await client.idempotencyRecord.findUnique({
    where: {
      userId_scope_key: {
        userId,
        scope: TRANSFER_IDEMPOTENCY_SCOPE,
        key,
      },
    },
  });

  if (!record) return null;
  if (!transferRecordMatchesRequest(record, fingerprint, amountNum)) {
    throw transferConflictError();
  }

  const original = record.transactionId
    ? await client.transaction.findFirst({
        where: { id: record.transactionId, userId },
        include: {
          category: { select: { name: true } },
          account: { select: { name: true } },
          toAccount: { select: { name: true } },
        },
      })
    : null;

  if (!original) throw transferConflictError();

  return {
    transaction: original,
    categoryRecord: original.category || null,
    replayed: true,
  };
}

/**
 * Serialise keyed transfers for one user inside the current transaction.
 *
 * The `(userId, scope, key)` primary key is the real guarantee; the advisory
 * lock only removes the check-then-insert race window so identical concurrent
 * retries converge deterministically. It is acquired only for keyed requests,
 * so legacy keyless transfers are unaffected.
 */
async function lockUserForTransfer(tx, userId) {
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${`transfer:${userId}`}), 1, 8))::bit(32)::int)`;
  } catch (err) {
    // The unique index still prevents a double transfer if the lock cannot be
    // taken (for example on a mocked client in unit tests).
    console.warn('[TRANSFER] Could not take the per-user idempotency lock:', err.message);
  }
}

/**
 * Advisory lock on an account row to prevent concurrent debit race conditions
 * (double spending) across transactions.
 */
async function lockAccountForMutation(tx, accountId) {
  if (!accountId) return;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${`account:${accountId}`}), 1, 8))::bit(32)::int)`;
  } catch (_) {
    // Fallback safely for mocked clients in unit tests
  }
}

/**
 * Resolve/create a category as part of the caller's transaction. Keeping this
 * inside the transaction means a rejected or rolled-back transfer cannot leave
 * a stray category behind.
 */
async function resolveTransactionCategory(tx, userId, categoryName, transactionType) {
  if (!categoryName) return null;
  let category = await tx.category.findFirst({
    where: { userId, name: { equals: categoryName, mode: 'insensitive' } },
  });
  if (!category) {
    category = await tx.category.create({
      data: {
        userId,
        name: categoryName,
        categoryType:
          transactionType === 'TRANSFER'
            ? 'TRANSFER'
            : transactionType === 'INCOME'
              ? 'INCOME'
              : 'EXPENSE',
      },
    });
  }
  return category;
}

/**
 * GET /api/v1/transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, category, startDate, endDate, search } = req.query;

    // Pagination is part of the public contract: reject bad values instead of
    // silently coercing them or passing NaN to Prisma.
    const page = parseBoundedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = parseBoundedInt(req.query.limit, 20, 1, 100);
    if (page === null || limit === null) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'page must be an integer >= 1 and limit must be an integer between 1 and 100.',
        },
      });
    }

    const where = { userId };
    if (type) {
      const normalisedType = String(type).toUpperCase();
      if (!VALID_TRANSACTION_TYPES.includes(normalisedType)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Type must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}`,
          },
        });
      }
      where.transactionType = normalisedType;
    }
    if (category) where.category = { name: { contains: category, mode: 'insensitive' } };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = parseDateOnly(startDate, 'startDate');
      if (endDate) where.date.lte = parseDateOnly(endDate, 'endDate');
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { merchant: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          category: { select: { name: true } },
          account: { select: { name: true } },
          toAccount: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transactions: transactions.map((t) => ({
          id: t.id,
          amount: parseFloat(t.amount),
          formattedAmount: formatINR(t.amount),
          type: t.transactionType,
          category: t.category?.name || 'Uncategorized',
          account: t.account?.name || 'Unknown',
          toAccount: t.toAccount?.name || null,
          description: t.description || '',
          merchant: t.merchant || '',
          date: formatDateOnly(t.date),
          currency: t.currency,
          createdAt: t.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * POST /api/v1/transactions
 */
const createTransaction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      amount,
      category: categoryName,
      accountId,
      toAccountId,
      description,
      merchant,
      date,
      notes,
      paymentMethod,
    } = req.body;

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
      });
    }

    const transactionType = ((req.body.type || req.body.transactionType || 'EXPENSE')).toUpperCase();
    if (!VALID_TRANSACTION_TYPES.includes(transactionType)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Type must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}` },
      });
    }

    // A destination is meaningful only for a TRANSFER. Rejecting it on other
    // types prevents a client from silently creating a one-sided movement.
    if (transactionType !== 'TRANSFER' && toAccountId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'toAccountId is only valid for transfers.' },
      });
    }

    // Find or resolve the source account
    let targetAccountId = accountId || null;
    let resolvedSourceAccount = null;
    if (targetAccountId) {
      const account = await prisma.financialAccount.findFirst({
        where: { id: targetAccountId, userId },
      });
      if (!account) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Account not found.' },
        });
      }
      resolvedSourceAccount = account;
    } else {
      const defaultAcc = await prisma.financialAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (defaultAcc) {
        targetAccountId = defaultAcc.id;
        resolvedSourceAccount = defaultAcc;
      }
    }

    // Transfers must move money between two distinct, owned accounts.
    let destinationAccountId = null;
    if (transactionType === 'TRANSFER') {
      if (!targetAccountId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'A transfer requires a source account.' },
        });
      }
      const destination = await resolveTransferDestination(userId, toAccountId, targetAccountId);
      if (destination.status) {
        return res.status(destination.status).json({
          success: false,
          error: {
            code: destination.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
            message: destination.message,
          },
        });
      }
      destinationAccountId = destination.account.id;
    }

    // Parse the requested date before starting the transaction: an invalid
    // date must fail with 400 and leave no partial write behind.
    const requestedDate = date ? parseDateOnly(date, 'date') : null;
    const ledgerDate = requestedDate || parseDateOnly(todayDateOnly());

    const keyResult = normalizeTransferIdempotencyKey(req.body.idempotencyKey);
    if (keyResult.invalid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'idempotencyKey must be 8-128 characters of letters, numbers, ".", "_", ":" or "-".',
        },
      });
    }
    if (keyResult.key && transactionType !== 'TRANSFER') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'idempotencyKey is only supported for transfers.',
        },
      });
    }

    const idempotencyKey = keyResult.key;
    const fingerprint = idempotencyKey
      ? buildTransferFingerprint({
          accountId: targetAccountId,
          toAccountId: destinationAccountId,
          amount: amountNum,
          category: categoryName,
          description,
          merchant,
          notes,
          paymentMethod,
          date: requestedDate,
        })
      : null;

    const buildResponse = (transaction, anomalyResult, replayed) => ({
      success: true,
      data: {
        id: transaction.id,
        amount: parseFloat(transaction.amount),
        formattedAmount: formatINR(transaction.amount),
        type: transaction.transactionType,
        category: transaction.category?.name || 'Uncategorized',
        account: transaction.account?.name || 'Primary Account',
        toAccount: transaction.toAccount?.name || null,
        date: formatDateOnly(transaction.date),
        anomalyStatus: anomalyResult.severity,
        anomalyReason: anomalyResult.reason,
        replayed,
        message: replayed
          ? transaction.transactionType === 'TRANSFER'
            ? 'This transfer was already recorded. No new money was moved.'
            : 'This transaction was already recorded. No new entry was created.'
          : transaction.transactionType === 'TRANSFER'
            ? `Transfer to ${transaction.toAccount?.name || 'account'} recorded.`
            : 'Transaction created successfully!',
      },
    });

    let outcome;
    try {
      outcome = await prisma.$transaction(async (tx) => {
        // Keyed requests are serialised per user inside the transaction. The
        // unique claim is still the hard guarantee; the lock just makes
        // concurrent retries converge without a P2002 detour.
        if (idempotencyKey) {
          await lockUserForTransfer(tx, userId);
          const replay = await findTransferReplay(tx, {
            userId,
            key: idempotencyKey,
            fingerprint,
            amountNum,
          });
          if (replay) return replay;
        }

        // Concurrency-safe row locking and insufficient-funds enforcement on the debit leg
        const accountsToLock = transactionType === 'TRANSFER'
          ? [targetAccountId, destinationAccountId]
          : (targetAccountId ? [targetAccountId] : []);
        const lockedAccounts = await lockAccountsForUpdate(tx, accountsToLock);

        if (targetAccountId && isDebitType(transactionType)) {
          const accountToCheck = lockedAccounts.get(targetAccountId) || resolvedSourceAccount;
          const fundsCheck = checkSufficientFunds(accountToCheck, -amountNum);
          if (!fundsCheck.allowed) {
            return {
              error: {
                status: 400,
                code: 'INSUFFICIENT_FUNDS',
                message: `Insufficient funds in ${accountToCheck?.name || 'account'}. Available balance: ${formatINR(fundsCheck.currentBalance)}, required: ${formatINR(fundsCheck.required)}.`,
              },
            };
          }
        }

        // Category resolution is inside the transaction so a rejected or
        // rolled-back transfer cannot leave a stray category behind.
        const categoryRecord = await resolveTransactionCategory(tx, userId, categoryName, transactionType);

        const transaction = await tx.transaction.create({
          data: {
            userId,
            accountId: targetAccountId || null,
            toAccountId: destinationAccountId,
            categoryId: categoryRecord?.id || null,
            amount: amountNum,
            transactionType,
            description: trimmedOrNull(description),
            merchant: trimmedOrNull(merchant),
            notes: trimmedOrNull(notes),
            paymentMethod: paymentMethod || null,
            date: ledgerDate,
            currency: 'INR',
            idempotencyKey: idempotencyKey || null,
          },
          include: {
            category: { select: { name: true } },
            account: { select: { name: true } },
            toAccount: { select: { name: true } },
          },
        });

        // Exactly one debit + one credit for a transfer, one delta otherwise.
        await applyEffects(
          tx,
          transactionEffects({
            transactionType,
            amount: amountNum,
            accountId: targetAccountId,
            toAccountId: destinationAccountId,
          })
        );

        if (idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              userId,
              scope: TRANSFER_IDEMPOTENCY_SCOPE,
              key: idempotencyKey,
              transactionId: transaction.id,
              amount: amountNum,
              requestFingerprint: fingerprint,
            },
          });
        }

        return { transaction, categoryRecord, replayed: false };
      });
    } catch (error) {
      if (error instanceof RangeError) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
      }
      if (error.statusCode === 409 && error.code === 'IDEMPOTENCY_CONFLICT') {
        return sendTransferConflict(res);
      }

      // A concurrent request may have claimed the key first. Re-read the
      // winning claim and either replay its transfer or report a conflict.
      if (error.code === 'P2002' && idempotencyKey) {
        let replay = null;
        try {
          replay = await findTransferReplay(prisma, {
            userId,
            key: idempotencyKey,
            fingerprint,
            amountNum,
          });
        } catch (lookupError) {
          if (lookupError.statusCode === 409) return sendTransferConflict(res);
          throw lookupError;
        }
        if (replay) outcome = replay;
        else return sendTransferConflict(res);
      } else {
        throw error;
      }
    }

    if (outcome && outcome.error) {
      return res.status(outcome.error.status || 400).json({
        success: false,
        error: {
          code: outcome.error.code,
          message: outcome.error.message,
        },
      });
    }

    const { transaction, categoryRecord } = outcome;

    // Statistical Anomaly Detection (new entries only; a replay must not
    // generate notifications or budget alerts a second time).
    let anomalyResult = { isAnomaly: false, severity: 'NORMAL' };
    if (!outcome.replayed && transaction.transactionType === 'EXPENSE') {
      anomalyResult = await financialTwin.detectExpenseAnomaly(userId, {
        id: transaction.id,
        amount: amountNum,
        categoryId: categoryRecord?.name || 'General',
        merchant: merchant || description,
      });

      if (anomalyResult.isAnomaly) {
        await prisma.notification.create({
          data: {
            userId,
            title: anomalyResult.severity === 'HIGHLY_UNUSUAL' ? '⚠️ High-Value Anomaly Detected' : 'Unusual Expense Detected',
            message: anomalyResult.reason,
            type: anomalyResult.severity === 'HIGHLY_UNUSUAL' ? 'ALERT' : 'WARNING',
          },
        }).catch(() => {});
      }

      // Check budget thresholds and alert user if >= 90% or >= 100%
      notificationService.checkBudgetThresholds(userId, transaction).catch(() => {});
    }

    // Audit only the request that actually created the row.
    if (!outcome.replayed) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'TRANSACTION_CREATE',
          entity: 'Transaction',
          entityId: transaction.id,
          ipAddress: req.ip || null,
          userAgent: req.headers?.['user-agent'] || null,
        },
      }).catch(() => {});
    }

    return res.status(outcome.replayed ? 200 : 201).json(buildResponse(transaction, anomalyResult, outcome.replayed));
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    if (error.statusCode === 409 && error.code === 'IDEMPOTENCY_CONFLICT') {
      return sendTransferConflict(res);
    }
    next(error);
  }
};

/**
 * GET /api/v1/transactions/:id
 */
const getTransaction = async (req, res, next) => {
  try {
    const t = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { category: true, account: true, toAccount: true },
    });

    if (!t) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...t, date: formatDateOnly(t.date), formattedAmount: formatINR(t.amount) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/transactions/:id
 */
const updateTransaction = async (req, res, next) => {
  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { category: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    const {
      amount,
      description,
      merchant,
      notes,
      category: newCategoryName,
      accountId,
      toAccountId,
      date,
      paymentMethod,
    } = req.body;

    const nextType = String(
      req.body.type || req.body.transactionType || existing.transactionType
    ).toUpperCase();
    if (!VALID_TRANSACTION_TYPES.includes(nextType)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Type must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}`,
        },
      });
    }

    // A transfer is a balanced two-leg movement. Converting an existing row
    // into or out of one would need a ledger rewrite that a PATCH cannot
    // express safely, so require delete + create instead.
    if ((nextType === 'TRANSFER') !== (existing.transactionType === 'TRANSFER')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A transaction cannot be converted to or from a transfer.',
        },
      });
    }

    const oldAmountNum = parseFloat(existing.amount);
    let newAmountNum = oldAmountNum;
    if (amount !== undefined) {
      newAmountNum = parseFloat(amount);
      if (!Number.isFinite(newAmountNum) || newAmountNum <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
        });
      }
    }

    // Resolve the source account, if it is being changed.
    let nextAccountId = existing.accountId;
    if (accountId !== undefined) {
      if (accountId === null || accountId === '') {
        nextAccountId = null;
      } else {
        const owned = await prisma.financialAccount.findFirst({
          where: { id: accountId, userId: req.user.id },
        });
        if (!owned) {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Account not found.' },
          });
        }
        nextAccountId = owned.id;
      }
    }

    // Resolve the destination only when supplied; otherwise keep the stored
    // value so legacy destination-less transfers keep their behaviour.
    let nextToAccountId = existing.toAccountId;
    if (toAccountId !== undefined) {
      if (toAccountId === null || toAccountId === '') {
        nextToAccountId = null;
      } else {
        if (nextType !== 'TRANSFER') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'toAccountId is only valid for transfers.' },
          });
        }
        const destination = await resolveTransferDestination(
          req.user.id,
          toAccountId,
          nextAccountId
        );
        if (destination.status) {
          return res.status(destination.status).json({
            success: false,
            error: {
              code: destination.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
              message: destination.message,
            },
          });
        }
        nextToAccountId = destination.account.id;
      }
    }

    if (nextType === 'TRANSFER') {
      if (!nextAccountId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'A transfer requires a source account.' },
        });
      }
      if (nextToAccountId && nextAccountId === nextToAccountId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Source and destination accounts must differ.' },
        });
      }
    }

    // Resolve or create the category only after every other check passes, so
    // a rejected request never leaves a stray category behind.
    let categoryId = existing.categoryId;
    if (newCategoryName) {
      let cat = await prisma.category.findFirst({
        where: { userId: req.user.id, name: { equals: newCategoryName, mode: 'insensitive' } },
      });
      if (!cat) {
        cat = await prisma.category.create({
          data: {
            userId: req.user.id,
            name: newCategoryName,
            categoryType:
              nextType === 'TRANSFER'
                ? 'TRANSFER'
                : nextType === 'INCOME'
                  ? 'INCOME'
                  : 'EXPENSE',
          },
        });
      }
      categoryId = cat.id;
    }

    // ML Feedback Learning: if the user changed the category, store correction.
    if (
      newCategoryName &&
      existing.category?.name &&
      newCategoryName.toLowerCase() !== existing.category.name.toLowerCase()
    ) {
      await prisma.transactionCategoryCorrection.create({
        data: {
          userId: req.user.id,
          merchant: merchant || existing.merchant,
          description: description || existing.description,
          originalCategory: existing.category.name,
          correctedCategory: newCategoryName,
        },
      }).catch(() => {});
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction so a concurrent delete/update cannot
      // make us reverse effects that no longer match the stored row.
      const current = await tx.transaction.findFirst({
        where: { id: req.params.id, userId: req.user.id },
      });
      if (!current) {
        const notFound = new Error('Transaction not found.');
        notFound.statusCode = 404;
        throw notFound;
      }

      const t = await tx.transaction.update({
        where: { id: current.id },
        data: {
          ...(amount !== undefined && { amount: newAmountNum }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(merchant !== undefined && { merchant: merchant?.trim() || null }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          ...(paymentMethod !== undefined && { paymentMethod: paymentMethod || null }),
          ...(date !== undefined && { date: parseDateOnly(date, 'date') }),
          ...(accountId !== undefined && { accountId: nextAccountId }),
          ...(toAccountId !== undefined && { toAccountId: nextToAccountId }),
          ...(categoryId !== undefined && { categoryId }),
        },
        include: { category: true, account: true, toAccount: true },
      });

      // Replace the old ledger effect with the new one atomically. This is
      // correct for amount edits, account moves and destination changes, and
      // nets to zero when only descriptive fields changed.
      const combinedEffects = [
        ...reverseEffects(current),
        ...transactionEffects({
          transactionType: t.transactionType,
          amount: t.amount,
          accountId: t.accountId,
          toAccountId: t.toAccountId,
        }),
      ];

      // Insufficient funds enforcement on any net debit with concurrency row locking
      const totals = new Map();
      const accountsToLock = [];
      for (const effect of combinedEffects) {
        if (!effect || !effect.accountId) continue;
        const d = Number(effect.delta) || 0;
        totals.set(effect.accountId, (totals.get(effect.accountId) || 0) + d);
        accountsToLock.push(effect.accountId);
      }

      const lockedAccounts = await lockAccountsForUpdate(tx, accountsToLock);

      for (const [accId, delta] of totals) {
        if (delta < 0) {
          const accRow = lockedAccounts.get(accId);
          const check = checkSufficientFunds(accRow, delta);
          if (!check.allowed) {
            const err = new Error(
              `Insufficient funds in ${accRow?.name || 'account'} for this update. Available balance: ${formatINR(check.currentBalance)}, required deduction: ${formatINR(check.required)}.`
            );
            err.statusCode = 400;
            err.code = 'INSUFFICIENT_FUNDS';
            throw err;
          }
        }
      }

      await applyEffects(tx, combinedEffects);

      return t;
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        date: formatDateOnly(updated.date),
        formattedAmount: formatINR(updated.amount),
        account: updated.account?.name || null,
        toAccount: updated.toAccount?.name || null,
        message: 'Transaction updated successfully.',
      },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    if (error instanceof RangeError) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
};

/**
 * DELETE /api/v1/transactions/:id
 */
const deleteTransaction = async (req, res, next) => {
  try {
    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found.' },
      });
    }

    await prisma.$transaction(async (tx) => {
      // Reverse every balance leg of the stored row. A legacy transfer with no
      // destination only had a source debit, so `revertEffects` restores
      // exactly what was originally applied.
      await revertEffects(tx, existing);

      await tx.transaction.delete({ where: { id: req.params.id } });
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TRANSACTION_DELETE',
        entity: 'Transaction',
        entityId: req.params.id,
        ipAddress: req.ip || null,
        userAgent: req.headers?.['user-agent'] || null,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: { message: 'Transaction deleted successfully and balance updated.' },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/transactions/voice
 */
/**
 * POST /api/v1/transactions/parse-text
 * Extracts financial transaction details from bank SMS or natural text
 */
const parseTextEntry = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'SMS or transaction text is required.' },
      });
    }

    const parsed = parseFinancialText(text);

    return res.status(200).json({
      success: true,
      data: {
        parsed,
        formattedAmount: formatINR(parsed.amount),
        message: 'Transaction details detected. Please review and confirm to save.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/transactions/voice
 */
const parseVoiceEntry = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Voice text is required.' },
      });
    }

    const parsed = parseFinancialText(text);

    return res.status(200).json({
      success: true,
      data: {
        parsed,
        formattedAmount: formatINR(parsed.amount),
        message: 'Voice entry parsed successfully. Please confirm to save.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Comprehensive parser for Bank SMS & Natural Language
 * Detects: amount, credit/debit type, date, merchant/description, category, payment method
 */
const parseFinancialText = (rawText) => {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. Amount Extraction
  // Patterns: "INR 1,500.00", "Rs. 12,300", "Rs 450", "₹5,000", "spent 500"
  let amount = 0;
  const currencyAmountMatch = text.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹|rupees)/i) ||
    text.match(/(?:debited(?:\s+with|\s+by)?|credited(?:\s+with|\s+by)?|spent|paid|received|amount:?)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/\b(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)\b/);

  if (currencyAmountMatch) {
    const rawAmt = (currencyAmountMatch[1] || currencyAmountMatch[2] || '').replace(/,/g, '');
    const parsedAmt = parseFloat(rawAmt);
    if (!isNaN(parsedAmt) && parsedAmt > 0) {
      amount = parsedAmt;
    }
  }

  // 2. Credit / Debit Transaction Type Detection
  let type = 'EXPENSE';
  const isCredit = /\b(credited|credit|received|earned|salary|stipend|deposited|refund|cashback|bonus|income)\b/i.test(lower);
  const isDebit = /\b(debited|debit|spent|paid|withdrawn|charged|purchase|sent|payment to|payment of)\b/i.test(lower);
  const isTransfer = /\b(transferred to|transfer to)\b/i.test(lower);

  if (isTransfer) {
    type = 'TRANSFER';
  } else if (isCredit && !isDebit) {
    type = 'INCOME';
  } else if (isDebit) {
    type = 'EXPENSE';
  } else if (isCredit) {
    type = 'INCOME';
  }

  // 3. Date Detection
  // Handles: "10-Sep-2026", "01-Sep-26", "09/09/2026", "15 Oct 2026", "on 12-09-2026"
  let date = todayDateOnly();
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  const dateMatch = text.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3,9}|\d{1,2})[-/ ](\d{2,4})\b/);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    let monthPart = dateMatch[2].toLowerCase();
    let yearPart = dateMatch[3];
    if (yearPart.length === 2) yearPart = '20' + yearPart;

    let month = '01';
    if (/^\d+$/.test(monthPart)) {
      month = monthPart.padStart(2, '0');
    } else {
      const shortM = monthPart.slice(0, 3);
      if (months[shortM]) month = months[shortM];
    }
    const candidateDate = `${yearPart}-${month}-${day}`;
    if (!isNaN(Date.parse(candidateDate))) {
      date = candidateDate;
    }
  }

  // 4. Merchant / Description Detection
  let merchant = '';
  // Check known popular merchants first
  const knownMerchants = [
    'Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Uber', 'Ola', 'Myntra', 'Blinkit', 'Zepto',
    'Star Health', 'JioFiber', 'Airtel', 'Spotify', 'Netflix', 'BookMyShow', 'Apollo',
    'Tata Neu', 'BigBasket', 'Cultfit', 'HDFC Bank', 'ICICI Bank', 'SBI Bank',
  ];
  for (const km of knownMerchants) {
    if (new RegExp(`\\b${km}\\b`, 'i').test(text)) {
      merchant = km;
      break;
    }
  }

  // If not found, look for patterns: "at SWIGGY via", "to John via UPI", "by internship stipend"
  if (!merchant) {
    const atMatch = text.match(/(?:at|to|by|for|info:?|vpa:?)\s+([A-Za-z0-9\s.&_-]{2,30}?)(?:\s+via|\s+on|\s+ref|\s+avl|\s+bal|\.|$|,|;)/i);
    if (atMatch && atMatch[1]) {
      const clean = atMatch[1].replace(/^(a\/c|the|your)\s+/i, '').trim();
      if (clean && !/^(rs|inr|account|card)\b/i.test(clean)) {
        merchant = clean;
      }
    }
  }

  // 5. Payment Method
  let paymentMethod = 'UPI';
  if (/\bcredit\s*card\b/i.test(text)) paymentMethod = 'Credit Card';
  else if (/\bdebit\s*card\b/i.test(text) || /\bcard\s+ending\b/i.test(text)) paymentMethod = 'Debit Card';
  else if (/\bneft\b/i.test(text)) paymentMethod = 'NEFT';
  else if (/\brtgs\b/i.test(text)) paymentMethod = 'RTGS';
  else if (/\bimps\b/i.test(text)) paymentMethod = 'IMPS';
  else if (/\bnet\s*banking\b/i.test(text)) paymentMethod = 'Net Banking';
  else if (/\bcash\b/i.test(text)) paymentMethod = 'Cash';
  else if (/\bupi\b/i.test(text)) paymentMethod = 'UPI';

  // 6. Category Mapping
  const categoryMap = {
    'Food & Dining': ['food', 'swiggy', 'zomato', 'eat', 'dinner', 'lunch', 'restaurant', 'cafe', 'coffee', 'chai', 'mcdonalds', 'starbucks'],
    'Shopping': ['amazon', 'flipkart', 'myntra', 'shopping', 'clothes', 'bought', 'mall', 'retail', 'blinkit', 'zepto'],
    'Transport': ['uber', 'ola', 'taxi', 'auto', 'metro', 'fuel', 'petrol', 'diesel', 'bus', 'flight', 'railway', 'irctc'],
    'Utilities': ['jiofiber', 'airtel', 'electricity', 'water bill', 'recharge', 'broadband', 'phone bill', 'utility', 'gas'],
    'Entertainment': ['netflix', 'spotify', 'movie', 'hotstar', 'prime', 'cinema', 'bookmyshow', 'game'],
    'Education': ['books', 'course', 'college', 'tuition', 'fee', 'exam', 'certification', 'udemy', 'coursera'],
    'Healthcare': ['doctor', 'medicine', 'hospital', 'pharmacy', 'medical', 'star health', 'apollo', 'clinic'],
    'Salary & Income': ['salary', 'stipend', 'freelance', 'dividend', 'interest', 'bonus'],
  };

  let category = type === 'INCOME' ? 'Salary & Income' : 'General';
  for (const [catName, keywords] of Object.entries(categoryMap)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      category = catName;
      break;
    }
  }

  // 7. Clean Description
  let description = merchant ? `${merchant} (${paymentMethod})` : text.slice(0, 60);
  if (type === 'INCOME' && /stipend/i.test(text)) {
    description = 'Internship Stipend Credit';
    category = 'Salary & Income';
  } else if (type === 'INCOME' && /salary/i.test(text)) {
    description = 'Monthly Salary Credit';
    category = 'Salary & Income';
  }

  return {
    amount,
    type,
    category,
    date,
    merchant: merchant || (type === 'INCOME' ? 'Employer / Client' : 'Merchant'),
    description,
    paymentMethod,
  };
};

module.exports = {
  getTransactions,
  createTransaction,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  parseVoiceEntry,
  parseTextEntry,
};
