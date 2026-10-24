-- Phase 5 — deposit idempotency: reject a key reused with different details.
--
-- Additive only:
--   * a NULLABLE `requestFingerprint` column on `idempotency_records`.
--
-- The fingerprint is a SHA-256 of the canonical deposit payload (target
-- account, amount, date, source, description). On a replay the controller
-- compares it with the stored value and returns 409 IDEMPOTENCY_CONFLICT when
-- the retried request describes a different deposit.
--
-- Compatibility:
--   * Existing rows keep NULL. A NULL fingerprint falls back to comparing
--     `amount` only, so pre-existing replays keep working.
--   * No unique constraint is added to an existing table, so `prisma db push`
--     does not require --accept-data-loss.

ALTER TABLE "idempotency_records"
    ADD COLUMN "requestFingerprint" TEXT;
