/**
 * Single source of truth for how a transaction row changes account balances.
 *
 * A normal row affects one account:
 *   INCOME      → +amount on accountId
 *   REFUND      → +amount on accountId (simulator refund)
 *   REVERSAL    → +amount on accountId (simulator reversal)
 *   EXPENSE     → -amount on accountId
 *   INVESTMENT  → -amount on accountId
 *   LOAN_PAYMENT→ -amount on accountId
 *
 * A TRANSFER affects two accounts:
 *   -amount on accountId, +amount on toAccountId.
 *
 * Keeping this in one module means the web controller, the AI tools and the
 * reversal paths can never disagree about the ledger. Every function is pure
 * except `applyEffects`, which only issues the writes it is given.
 */

'use strict';

/** Decimal columns serialise as strings; Number() keeps the maths finite. */
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Balance deltas produced by a transaction-like object.
 *
 * Legacy transfers created before `toAccountId` existed have no destination,
 * so they intentionally produce only the source debit. That keeps reversal of
 * historical rows exactly as they were originally applied.
 *
 * @param {{ transactionType: string, amount: number|string, accountId?: string|null, toAccountId?: string|null }} transaction
 * @returns {Array<{accountId: string, delta: number}>}
 */
function transactionEffects(transaction) {
  const sourceAccountId = transaction?.accountId || null;
  const destinationAccountId = transaction?.toAccountId || null;
  const amount = toNumber(transaction?.amount);
  const type = String(transaction?.transactionType || '').toUpperCase();

  if (!sourceAccountId || amount === 0) return [];

  if (type === 'TRANSFER') {
    const effects = [{ accountId: sourceAccountId, delta: -amount }];
    if (destinationAccountId) {
      effects.push({ accountId: destinationAccountId, delta: amount });
    }
    return effects;
  }

  return [
    {
      accountId: sourceAccountId,
      delta: type === 'INCOME' || type === 'REFUND' || type === 'REVERSAL' ? amount : -amount,
    },
  ];
}

/** Exact inverse of `transactionEffects`. */
function reverseEffects(transaction) {
  return transactionEffects(transaction).map((effect) => ({
    accountId: effect.accountId,
    delta: -effect.delta,
  }));
}

/**
 * Apply a list of deltas, aggregating per account first.
 *
 * Aggregation matters for edits: reversing an old transfer and applying the
 * new amount would otherwise update the same account twice in one write, and
 * a source/destination swap could transiently move the wrong amount. One
 * `increment` per account is both cheaper and atomic.
 *
 * The caller owns the transaction boundary (`prisma.$transaction`).
 */
async function applyEffects(tx, effects) {
  const totals = new Map();
  for (const effect of effects || []) {
    if (!effect || !effect.accountId) continue;
    const delta = toNumber(effect.delta);
    if (delta === 0) continue;
    totals.set(effect.accountId, (totals.get(effect.accountId) || 0) + delta);
  }

  for (const [accountId, delta] of totals) {
    if (delta === 0) continue;
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }
}

/** Undo a stored transaction's balance effect. */
function revertEffects(tx, transaction) {
  return applyEffects(tx, reverseEffects(transaction));
}

/**
 * Does this transaction type debit the primary account?
 */
function isDebitType(transactionType) {
  const type = String(transactionType || '').toUpperCase();
  return type === 'EXPENSE' || type === 'INVESTMENT' || type === 'LOAN_PAYMENT' || type === 'TRANSFER';
}

/**
 * Account types that are exempt from strict insufficient-funds enforcement.
 * CREDIT_CARD represents a revolving credit line (spending increases liability / negative balance).
 */
function isExemptFromBalanceCheck(accountType) {
  return String(accountType || '').toUpperCase() === 'CREDIT_CARD';
}

/**
 * Checks whether an account has sufficient balance for a net delta change.
 * If the accountType is CREDIT_CARD, or if account.balance is undefined/null,
 * the transaction is allowed.
 *
 * @param {{ balance?: number|string|null, accountType?: string|null, name?: string }} account
 * @param {number} delta - The net balance change (negative for outflows/debits)
 * @returns {{ allowed: boolean, currentBalance?: number, required?: number }}
 */
function checkSufficientFunds(account, delta) {
  if (!account) return { allowed: true };
  if (isExemptFromBalanceCheck(account.accountType)) return { allowed: true };
  if (account.balance === undefined || account.balance === null) return { allowed: true };

  const currentBalance = toNumber(account.balance);
  const netDelta = toNumber(delta);

  // If netDelta is negative (outflow) and would make balance negative:
  if (netDelta < 0 && (currentBalance + netDelta) < -0.0001) {
    return {
      allowed: false,
      currentBalance,
      required: Math.abs(netDelta),
    };
  }

  return { allowed: true, currentBalance };
}

/**
 * Locks one or more accounts for update inside a transaction to prevent race conditions.
 * Sorts account IDs in ascending order to prevent deadlocks when locking multiple accounts (e.g. transfers).
 *
 * @param {object} tx - Prisma transactional client
 * @param {string|string[]} accountIds - Single ID or array of IDs
 * @returns {Promise<Map<string, { id: string, balance: number, accountType: string, name: string }>>}
 */
async function lockAccountsForUpdate(tx, accountIds) {
  const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
  const uniqueSortedIds = [...new Set(ids.filter(Boolean))].sort();

  const accountMap = new Map();
  if (uniqueSortedIds.length === 0) return accountMap;

  if (typeof tx.$queryRaw === 'function') {
    try {
      const rows = await tx.$queryRaw`
        SELECT id, balance, "accountType", name
        FROM "financial_accounts"
        WHERE id = ANY(${uniqueSortedIds}::text[])
        ORDER BY id ASC
        FOR UPDATE
      `;
      if (Array.isArray(rows) && rows.length > 0) {
        for (const row of rows) {
          accountMap.set(row.id, {
            id: row.id,
            balance: toNumber(row.balance),
            accountType: row.accountType,
            name: row.name,
          });
        }
        return accountMap;
      }
    } catch (_) {
      // In non-Postgres or mock environments where raw SQL fails, fall through
    }
  }

  // Fallback for mocked or non-PostgreSQL clients
  if (typeof tx.financialAccount?.findMany === 'function') {
    try {
      const rows = await tx.financialAccount.findMany({
        where: { id: { in: uniqueSortedIds } },
      });
      for (const row of rows) {
        accountMap.set(row.id, {
          id: row.id,
          balance: toNumber(row.balance),
          accountType: row.accountType,
          name: row.name,
        });
      }
    } catch (_) {}
  } else if (typeof tx.financialAccount?.findUnique === 'function') {
    for (const id of uniqueSortedIds) {
      try {
        const row = await tx.financialAccount.findUnique({ where: { id } });
        if (row) {
          accountMap.set(row.id, {
            id: row.id,
            balance: toNumber(row.balance),
            accountType: row.accountType,
            name: row.name,
          });
        }
      } catch (_) {}
    }
  }

  return accountMap;
}

module.exports = {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
  isDebitType,
  isExemptFromBalanceCheck,
  checkSufficientFunds,
  lockAccountsForUpdate,
};
