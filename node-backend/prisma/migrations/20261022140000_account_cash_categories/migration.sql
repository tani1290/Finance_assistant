-- Additive account categories for cash held in wallets / at hand.
--
-- PostgreSQL supports adding a value to an existing enum in place. IF NOT
-- EXISTS keeps the migration safe to re-run and keeps every existing row
-- (BANK, CASH, WALLET, CREDIT_CARD, SAVINGS, CURRENT, OTHER) untouched.
--
-- No default, cast, backfill or column change is required: CASH_WALLET and
-- CASH_IN_HAND are new optional labels, not a rename of CASH/WALLET.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'CASH_WALLET';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'CASH_IN_HAND';
