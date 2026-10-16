-- Make (userId, rawMessageHash) unique so the same SMS can never be double-ingested.
-- The application duplicate check (read, then insert) has a race window when two
-- devices sync the same message concurrently; this unique index closes it.
-- NULL rawMessageHash stays distinct, so rows without a hash never collide.

-- DropIndex
DROP INDEX IF EXISTS "pending_sms_transactions_userId_rawMessageHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pending_sms_transactions_userId_rawMessageHash_key" ON "pending_sms_transactions"("userId", "rawMessageHash");
