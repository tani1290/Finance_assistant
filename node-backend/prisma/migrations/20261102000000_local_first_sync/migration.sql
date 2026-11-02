-- Local-first sync (Phase 2)
--
-- Additive only. Every statement is safe to replay against an existing
-- database that already holds production financial data:
--   * new columns are nullable or carry a default;
--   * no existing column is dropped, renamed or retyped;
--   * no row is deleted or rewritten.
--
-- `version` is an audit counter. `updatedAt` stays the authoritative
-- optimistic-concurrency token because Prisma maintains it on every write
-- path, including the web client.

ALTER TABLE "financial_accounts"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "transactions"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "budgets"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "goals"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "loans"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "investments"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientUpdatedAt" TIMESTAMP(3);

ALTER TABLE "portfolios"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Client-generated operation idempotency for non-transfer writes as well.
CREATE INDEX "transactions_userId_idempotencyKey_idx"
  ON "transactions" ("userId", "idempotencyKey");

ALTER TABLE "mobile_devices"
  ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'android',
  ADD COLUMN "lastPulledAt" TIMESTAMP(3),
  ADD COLUMN "lastPushedAt" TIMESTAMP(3),
  ADD COLUMN "syncCursor" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "sync_state" (
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "lastBackupAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "sync_operations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "opId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payload" JSONB,
  "baseUpdatedAt" TIMESTAMP(3),
  "baseVersion" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "appliedRevision" INTEGER,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_conflicts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "opId" TEXT,
  "deviceId" TEXT,
  "reason" TEXT NOT NULL,
  "localPayload" JSONB,
  "serverPayload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_tombstones" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedBy" TEXT NOT NULL DEFAULT 'mobile',
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_tombstones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_backups" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT,
  "format" TEXT NOT NULL DEFAULT 'finpro-sync-backup-v1',
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "salt" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "recordCounts" JSONB NOT NULL,
  "serverRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_backups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_operations_userId_opId_key"
  ON "sync_operations" ("userId", "opId");
CREATE INDEX "sync_operations_userId_status_idx"
  ON "sync_operations" ("userId", "status");
CREATE INDEX "sync_operations_userId_createdAt_idx"
  ON "sync_operations" ("userId", "createdAt");

CREATE INDEX "sync_conflicts_userId_status_idx"
  ON "sync_conflicts" ("userId", "status");
CREATE INDEX "sync_conflicts_userId_entityId_idx"
  ON "sync_conflicts" ("userId", "entityId");

CREATE UNIQUE INDEX "sync_tombstones_userId_entityType_entityId_key"
  ON "sync_tombstones" ("userId", "entityType", "entityId");
CREATE INDEX "sync_tombstones_userId_revision_idx"
  ON "sync_tombstones" ("userId", "revision");

CREATE INDEX "sync_backups_userId_createdAt_idx"
  ON "sync_backups" ("userId", "createdAt");

ALTER TABLE "sync_state"
  ADD CONSTRAINT "sync_state_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_operations"
  ADD CONSTRAINT "sync_operations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_conflicts"
  ADD CONSTRAINT "sync_conflicts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_tombstones"
  ADD CONSTRAINT "sync_tombstones_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_backups"
  ADD CONSTRAINT "sync_backups_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
