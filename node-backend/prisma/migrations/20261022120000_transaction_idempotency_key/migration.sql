-- Phase 5 — deposit idempotency.
--
-- Additive only:
--   1. a nullable `idempotencyKey` column on the ledger, for traceability;
--   2. a new `idempotency_records` table whose PRIMARY KEY
--      (userId, scope, key) is the actual guarantee.
--
-- Why a separate table instead of a unique index on `transactions`:
-- `prisma db push` treats "adding a unique constraint to an existing table"
-- as a possible data-loss operation and refuses to run without
-- --accept-data-loss. This project never passes that flag, so a unique index
-- on the ledger would make the deploy-time schema reconciliation FAIL. A new
-- table with a primary key is a safe, additive change for `db push` and is
-- equally strong: the second insert of the same (user, scope, key) fails with
-- a primary-key violation.
--
-- Compatibility:
--   * The column is NULLABLE and every existing row keeps a NULL key, so no
--     data is rewritten and no existing behaviour changes.
--   * Clients that do not send a key behave exactly as before.

ALTER TABLE "transactions"
    ADD COLUMN "idempotencyKey" TEXT;

CREATE TABLE "idempotency_records" (
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "transactionId" TEXT,
    "amount" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("userId", "scope", "key")
);

CREATE INDEX "idempotency_records_createdAt_idx"
    ON "idempotency_records"("createdAt");

ALTER TABLE "idempotency_records"
    ADD CONSTRAINT "idempotency_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
