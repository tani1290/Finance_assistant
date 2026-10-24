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

module.exports = {
  transactionEffects,
  reverseEffects,
  applyEffects,
  revertEffects,
};
