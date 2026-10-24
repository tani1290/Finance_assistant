-- Phase 4 — explicit AI action execution state.
--
-- Additive only. A consumed token moves PENDING -> EXECUTING before the
-- mutation runs. It can only reach a terminal state afterwards; a failure must
-- never make the same token usable again.
--
-- Existing rows (from the Phase 3 confirmation gate) keep their status. Any
-- legacy CONFIRMED row is treated as already resolved by the application.

ALTER TABLE "ai_action_proposals"
    ADD COLUMN "executionStartedAt" TIMESTAMP(3),
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT,
    ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;
