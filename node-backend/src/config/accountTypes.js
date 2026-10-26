/**
 * Canonical account categories.
 *
 * This list MUST mirror the `AccountType` enum in prisma/schema.prisma. It is
 * the single allow-list used by account CRUD and the AI tool schema so the two
 * cannot drift apart.
 *
 * `CASH_WALLET` and `CASH_IN_HAND` are additive categories:
 *   - CASH_WALLET  — money held in a payment wallet (Paytm, PhonePe, etc.)
 *   - CASH_IN_HAND — physical currency kept on hand
 * Existing `CASH` and `WALLET` rows keep their original values.
 */
const ACCOUNT_TYPES = Object.freeze([
  'BANK',
  'CASH',
  'WALLET',
  'CREDIT_CARD',
  'CASH_WALLET',
  'CASH_IN_HAND',
  'SAVINGS',
  'CURRENT',
  'OTHER',
]);

const DEFAULT_ACCOUNT_TYPE = 'BANK';

const ACCOUNT_TYPE_ERROR = `Account type must be one of: ${ACCOUNT_TYPES.join(', ')}.`;

/**
 * Parse a client-supplied account type.
 *
 * Returns `{ value }` on success, or `{ error: true }` for an unsupported
 * value so the controller can answer with a 400 instead of letting Prisma
 * throw a 500. An omitted/empty value resolves to the historical default.
 */
function parseAccountType(raw, { defaultType = DEFAULT_ACCOUNT_TYPE } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: defaultType };
  }
  if (typeof raw !== 'string') {
    return { error: true };
  }
  const value = raw.trim().toUpperCase();
  if (!ACCOUNT_TYPES.includes(value)) {
    return { error: true };
  }
  return { value };
}

module.exports = {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_ERROR,
  parseAccountType,
};
