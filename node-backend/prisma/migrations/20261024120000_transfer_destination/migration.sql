-- Transfer destination (double-entry) support.
--
-- A TRANSFER row used to record only the source account, so the destination
-- balance never changed and deleting the transfer could not restore it. This
-- migration adds a nullable, self-relation destination column. It is purely
-- additive:
--
--   * every existing transaction keeps NULL and its current behaviour,
--   * legacy transfers stay source-only on reversal,
--   * non-transfer rows are unaffected.
--
-- No backfill is possible from existing data (the destination account was
-- never stored), so nothing is guessed and no balance is rewritten.

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "toAccountId" TEXT;

-- `ON DELETE SET NULL` mirrors the source-account relation: deleting an
-- account must never delete ledger history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_toAccountId_fkey'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_toAccountId_fkey"
      FOREIGN KEY ("toAccountId") REFERENCES "financial_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "transactions_toAccountId_idx"
  ON "transactions"("toAccountId");
