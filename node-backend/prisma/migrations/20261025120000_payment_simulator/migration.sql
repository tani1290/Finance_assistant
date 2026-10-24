-- Payment simulator support.
--
-- Purely additive:
--   * two new ledger types (REFUND, REVERSAL) that credit the account and
--     reduce net spending. Generic transaction creation does not accept them;
--     only the simulator's refund/reversal flows write them.
--   * transactions.isSimulated marks rows written by the simulator so a demo
--     reset can remove exactly those rows.
--   * simulated_payments stores synthetic attempts. PENDING/FAILED attempts
--     never create a transaction and never move a balance.
--
-- Existing rows keep their current values: isSimulated defaults to false and
-- no TransactionType value is backfilled.

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REVERSAL';

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "transactions_userId_isSimulated_idx"
  ON "transactions"("userId", "isSimulated");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SimulatedPaymentStatus') THEN
    CREATE TYPE "SimulatedPaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'REVERSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SimulatedPaymentMethod') THEN
    CREATE TYPE "SimulatedPaymentMethod" AS ENUM ('CARD', 'UPI', 'NET_BANKING', 'WALLET', 'BANK_TRANSFER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SimulatedPaymentScenario') THEN
    CREATE TYPE "SimulatedPaymentScenario" AS ENUM ('SUCCESS', 'PENDING', 'FAILURE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "simulated_payments" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "accountId"           TEXT NOT NULL,
  "categoryId"          TEXT,
  "amount"              DECIMAL(15,2) NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'INR',
  "merchant"            TEXT NOT NULL,
  "description"         TEXT,
  "paymentMethod"       "SimulatedPaymentMethod" NOT NULL DEFAULT 'CARD',
  "scenario"            "SimulatedPaymentScenario" NOT NULL DEFAULT 'SUCCESS',
  "status"              "SimulatedPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode"         TEXT,
  "failureMessage"      TEXT,
  "originTransactionId" TEXT,
  "refundTransactionId" TEXT,
  "idempotencyKey"      TEXT NOT NULL,
  "requestFingerprint"  TEXT NOT NULL,
  "settledAt"           TIMESTAMP(3),
  "refundedAt"          TIMESTAMP(3),
  "reversedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulated_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "simulated_payments_userId_idempotencyKey_key"
  ON "simulated_payments"("userId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "simulated_payments_originTransactionId_key"
  ON "simulated_payments"("originTransactionId");
CREATE UNIQUE INDEX IF NOT EXISTS "simulated_payments_refundTransactionId_key"
  ON "simulated_payments"("refundTransactionId");
CREATE INDEX IF NOT EXISTS "simulated_payments_userId_status_idx"
  ON "simulated_payments"("userId", "status");
CREATE INDEX IF NOT EXISTS "simulated_payments_userId_createdAt_idx"
  ON "simulated_payments"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'simulated_payments_userId_fkey') THEN
    ALTER TABLE "simulated_payments"
      ADD CONSTRAINT "simulated_payments_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'simulated_payments_accountId_fkey') THEN
    ALTER TABLE "simulated_payments"
      ADD CONSTRAINT "simulated_payments_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'simulated_payments_categoryId_fkey') THEN
    ALTER TABLE "simulated_payments"
      ADD CONSTRAINT "simulated_payments_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
