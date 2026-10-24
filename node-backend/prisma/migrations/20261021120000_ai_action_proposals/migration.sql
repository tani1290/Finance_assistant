-- AI action confirmation gate.
--
-- Additive only: creates one table plus indexes and a cascading FK to users.
-- Tokens are stored hashed; the plaintext token is returned to the client once.

CREATE TABLE "ai_action_proposals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resultSummary" TEXT,

    CONSTRAINT "ai_action_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_action_proposals_tokenHash_key"
    ON "ai_action_proposals"("tokenHash");

CREATE INDEX "ai_action_proposals_userId_status_idx"
    ON "ai_action_proposals"("userId", "status");

CREATE INDEX "ai_action_proposals_expiresAt_idx"
    ON "ai_action_proposals"("expiresAt");

ALTER TABLE "ai_action_proposals"
    ADD CONSTRAINT "ai_action_proposals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
