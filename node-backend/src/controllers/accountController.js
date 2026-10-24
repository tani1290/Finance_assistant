const crypto = require('crypto');
const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');
const { ACCOUNT_TYPE_ERROR, parseAccountType } = require('../config/accountTypes');

/**
 * Optional client-supplied idempotency key.
 *
 * A deposit is a money movement, so a retried request must never credit the
 * account twice. The client generates one key per logical deposit and reuses
 * it for every retry of that deposit. The server records the key in
 * `idempotency_records`, whose primary key (userId, scope, key) is the actual
 * guarantee: the second attempt collides with the first and resolves to the
 * original result instead of creating a second credit.
 *
 * The key is optional: a client that does not send one keeps the previous
 * behaviour exactly (every request is a new deposit).
 */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const DEPOSIT_SCOPE = 'account_deposit';

function normalizeIdempotencyKey(raw) {
  if (raw === undefined || raw === null || raw === '') return { key: null, invalid: false };
  if (typeof raw !== 'string') return { key: null, invalid: true };
  const value = raw.trim();
  if (!value) return { key: null, invalid: false };
  if (!IDEMPOTENCY_KEY_RE.test(value)) return { key: null, invalid: true };
  return { key: value, invalid: false };
}

/**
 * Which request fields define a deposit's identity?
 *
 * The target account, amount, source, description and requested date all end
 * up on the ledger row, so a retry must resend the same values. A key reused
 * with any different value is a different logical deposit and is rejected
 * with 409 instead of being replayed.
 *
 * `date` is the *requested* date. An omitted date stays null rather than being
 * resolved to "today", so a retry after midnight still matches the original
 * request. Amounts are canonicalised to the ledger's 2-decimal precision.
 */
function buildDepositFingerprint({ accountId, amount, source, description, date }) {
  const canonical = JSON.stringify({
    v: 1,
    accountId: accountId || null,
    amount: Number(amount).toFixed(2),
    source: String(source),
    description: String(description),
    date: date ? formatDateOnly(date) : null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compare a stored idempotency record with this request.
 *
 * Records written before `requestFingerprint` existed have NULL there; for
 * those, the stored amount is the only identity we can compare. New records
 * always carry the full fingerprint.
 */
function recordMatchesRequest(record, fingerprint, amountNum) {
  if (!record) return false;
  if (record.requestFingerprint) return record.requestFingerprint === fingerprint;
  return record.amount !== null && record.amount !== undefined && Number(record.amount) === amountNum;
}

function sendIdempotencyConflict(res) {
  return res.status(409).json({
    success: false,
    error: {
      code: 'IDEMPOTENCY_CONFLICT',
      message:
        'This idempotencyKey was already used for a different deposit. Use a new key for a new deposit.',
    },
  });
}

/**
 * Serialise deposits for one user inside the current transaction.
 *
 * PostgreSQL advisory locks are released automatically when the transaction
 * ends, so a crash cannot leave a lock behind. This makes "find the default
 * account" and "is this key already used?" deterministic when two requests
 * arrive at the same time. The unique index remains the real guarantee; the
 * lock only removes the race window.
 */
async function lockUserForDeposit(tx, userId) {
  try {
    // `$executeRaw` is used instead of `$queryRaw` because the lock function
    // returns void, which Prisma cannot deserialize into a query result.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${userId}), 1, 8))::bit(32)::int)`;
  } catch (err) {
    // Never block a deposit because a lock could not be taken: the unique
    // index still prevents a double credit.
    console.warn('[DEPOSIT] Could not take the per-user lock:', err.message);
  }
}

/**
 * GET /api/v1/accounts
 */
const getAccounts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const accounts = await prisma.financialAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        totalBalance,
        formattedTotalBalance: formatINR(totalBalance),
        accounts: accounts.map((acc) => ({
          id: acc.id,
          name: acc.name,
          institution: acc.institution || 'General',
          accountType: acc.accountType,
          accountNumberMasked: acc.accountNumberMasked || null,
          balance: parseFloat(acc.balance),
          formattedBalance: formatINR(acc.balance),
          currency: acc.currency,
          isActive: acc.isActive,
          createdAt: acc.createdAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/accounts
 */
const createAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, accountType, institution, balance = 0, accountNumberMasked } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Account name is required.' },
      });
    }

    const parsedType = parseAccountType(accountType);
    if (parsedType.error) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: ACCOUNT_TYPE_ERROR },
      });
    }

    const account = await prisma.financialAccount.create({
      data: {
        userId,
        name: String(name).trim(),
        accountType: parsedType.value,
        institution: institution?.trim() || null,
        accountNumberMasked: accountNumberMasked ? accountNumberMasked.trim() : null,
        balance: parseFloat(balance) || 0,
        currency: 'INR',
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...account,
        formattedBalance: formatINR(account.balance),
        message: 'Account created successfully!',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/accounts/:accountId/deposit
 * POST /api/v1/accounts/deposit      (default account)
 * Atomically deposit money into an account.
 *
 * Body: { amount, source?, description?, date?, idempotencyKey? }
 *
 * `idempotencyKey` makes the call safe to retry. A repeat of a key that was
 * already applied returns the ORIGINAL transaction and does NOT credit the
 * account again.
 */
const depositMoney = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const accountId = req.params.accountId || null;
    const { amount, source = 'Deposit', description = 'Added funds', date, idempotencyKey } = req.body || {};

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Amount must be a positive number.' },
      });
    }

    const { key, invalid } = normalizeIdempotencyKey(idempotencyKey);
    if (invalid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'idempotencyKey must be 8-128 characters of letters, digits, dot, dash, underscore or colon.',
        },
      });
    }

    // Parse the requested date before starting the transaction: an invalid
    // date must fail with 400 and leave no partial write behind.
    const requestedDate = date ? parseDateOnly(date, 'date') : null;
    const ledgerDate = requestedDate || parseDateOnly(todayDateOnly());
    const fingerprint = key
      ? buildDepositFingerprint({ accountId, amount: amountNum, source, description, date: requestedDate })
      : null;

    const buildResponse = (account, transaction, replayed) => {
      // Always describe the amount that was actually credited. On a replay the
      // retried amount may differ from the original request, and the response
      // must never imply that it was deposited again.
      const credited = Number(transaction.amount);
      return {
        success: true,
        data: {
          message: replayed
            ? 'This deposit was already applied. No new funds were added.'
            : `Successfully added ${formatINR(credited)} to ${account.name}!`,
          newBalance: parseFloat(account.balance),
          formattedNewBalance: formatINR(account.balance),
          transactionId: transaction.id,
          replayed: Boolean(replayed),
          ...(replayed
            ? { originalAmount: credited, formattedOriginalAmount: formatINR(credited) }
            : {}),
        },
      };
    };

    // Transaction (DB) for atomicity
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await lockUserForDeposit(tx, userId);

        // 1. A key that was already used replays the original result.
        if (key) {
          const record = await tx.idempotencyRecord.findUnique({
            where: { userId_scope_key: { userId, scope: DEPOSIT_SCOPE, key } },
          });
          if (record && record.transactionId) {
            // Same key, different deposit details: reject without writing.
            if (!recordMatchesRequest(record, fingerprint, amountNum)) {
              throw Object.assign(
                new Error(
                  'This idempotencyKey was already used for a different deposit. Use a new key for a new deposit.'
                ),
                { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' }
              );
            }
            const original = await tx.transaction.findFirst({
              where: { id: record.transactionId, userId },
            });
            if (original) {
              const account = await tx.financialAccount.findFirst({
                where: { userId, id: original.accountId || accountId || undefined },
              });
              return {
                account: account || { name: 'account', balance: original.amount },
                transaction: original,
                replayed: true,
              };
            }
          }
        }

        // 2. Resolve the target account (and create the default one on demand).
        let account = null;
        if (accountId) {
          account = await tx.financialAccount.findFirst({
            where: { id: accountId, userId },
          });
          if (!account) {
            throw Object.assign(new Error('Account not found.'), { statusCode: 404, code: 'ACCOUNT_NOT_FOUND' });
          }
        } else {
          account = await tx.financialAccount.findFirst({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'asc' },
          });
          if (!account) {
            account = await tx.financialAccount.create({
              data: { userId, name: 'Primary Account', accountType: 'BANK', balance: 0, currency: 'INR' },
            });
          }
        }

        // 3. Update balance
        const updatedAccount = await tx.financialAccount.update({
          where: { id: account.id },
          data: { balance: { increment: amountNum } },
        });

        // 4. Find or create Income category
        let incomeCategory = await tx.category.findFirst({
          where: { userId, name: 'Income' },
        });
        if (!incomeCategory) {
          incomeCategory = await tx.category.create({
            data: { userId, name: 'Income', categoryType: 'INCOME' },
          });
        }

        // 5. Create the income ledger row
        const transaction = await tx.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId: incomeCategory.id,
            amount: amountNum,
            transactionType: 'INCOME',
            description: `[${source}] ${description}`,
            date: ledgerDate,
            currency: 'INR',
            idempotencyKey: key,
          },
        });

        // 6. Claim the key. The primary key makes this the single point that
        // decides whether this request is the first one or a replay.
        if (key) {
          await tx.idempotencyRecord.create({
            data: {
              userId,
              scope: DEPOSIT_SCOPE,
              key,
              transactionId: transaction.id,
              amount: amountNum,
              requestFingerprint: fingerprint,
            },
          });
        }

        return { account: updatedAccount, transaction, replayed: false };
      });
    } catch (err) {
      // A concurrent request with the same key won the race. The primary key
      // did its job: converge on the original deposit instead of crediting
      // twice.
      if (err && err.code === 'P2002' && key) {
        const record = await prisma.idempotencyRecord.findUnique({
          where: { userId_scope_key: { userId, scope: DEPOSIT_SCOPE, key } },
        });
        // The winner may have used different deposit details. Never replay it
        // as if it were this request.
        if (record && !recordMatchesRequest(record, fingerprint, amountNum)) {
          return sendIdempotencyConflict(res);
        }
        const original = record?.transactionId
          ? await prisma.transaction.findFirst({ where: { id: record.transactionId, userId } })
          : null;
        if (original) {
          const account = await prisma.financialAccount.findFirst({
            where: { userId, id: original.accountId || accountId || undefined },
          });
          return res.status(200).json(
            buildResponse(account || { name: 'account', balance: original.amount }, original, true)
          );
        }
      }
      throw err;
    }

    return res.status(200).json(buildResponse(result.account, result.transaction, result.replayed));
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: error.code || 'REQUEST_FAILED', message: error.message },
      });
    }
    next(error);
  }
};

/**
 * GET /api/v1/accounts/:accountId
 */
const getAccount = async (req, res, next) => {
  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: req.params.accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...account, formattedBalance: formatINR(account.balance) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/accounts/:id or /api/v1/accounts/:accountId
 */
const updateAccount = async (req, res, next) => {
  try {
    const accountId = req.params.accountId || req.params.id;
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    const { name, accountType, institution, balance, accountNumberMasked } = req.body;

    let nextAccountType;
    if (accountType !== undefined && accountType !== null && accountType !== '') {
      const parsedType = parseAccountType(accountType, { defaultType: account.accountType });
      if (parsedType.error) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: ACCOUNT_TYPE_ERROR },
        });
      }
      nextAccountType = parsedType.value;
    }

    const updated = await prisma.financialAccount.update({
      where: { id: accountId },
      data: {
        ...(name && { name: name.trim() }),
        ...(nextAccountType && { accountType: nextAccountType }),
        ...(institution !== undefined && { institution: institution?.trim() || null }),
        ...(accountNumberMasked !== undefined && {
          accountNumberMasked: accountNumberMasked?.trim() || null,
        }),
        ...(balance !== undefined && !isNaN(parseFloat(balance)) && { balance: parseFloat(balance) }),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        formattedBalance: formatINR(updated.balance),
        message: 'Account updated successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/accounts/:accountId (soft delete)
 */
const deleteAccount = async (req, res, next) => {
  try {
    const accountId = req.params.accountId || req.params.id;
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found.' },
      });
    }

    await prisma.financialAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });

    return res.status(200).json({
      success: true,
      data: { message: 'Account deleted successfully.' },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAccounts, createAccount, depositMoney, getAccount, updateAccount, deleteAccount };
