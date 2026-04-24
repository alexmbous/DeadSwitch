-- Outbox: events written atomically with their originating state changes.
-- A relay process drains them to BullMQ. Deletion-on-success keeps the
-- table small and makes the backlog signal cleanly observable.

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "queueName"    TEXT NOT NULL,
  "jobName"      TEXT NOT NULL,
  "jobId"        TEXT NOT NULL,       -- deterministic; the relay uses this as BullMQ jobId
  payload        JSONB NOT NULL,
  "availableAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
  attempts       INT NOT NULL DEFAULT 0,
  "lockedUntil"  TIMESTAMP,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "lastError"    TEXT
);

-- Deterministic jobIds are unique per queue.
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_queue_jobId_uq"
  ON "OutboxEvent" ("queueName", "jobId");

-- Relay scanner: pick oldest due, not locked.
CREATE INDEX IF NOT EXISTS "OutboxEvent_ready_idx"
  ON "OutboxEvent" ("availableAt", "lockedUntil")
  WHERE "lockedUntil" IS NULL OR "lockedUntil" <= NOW();

-- Audit export checkpoint (section 6).
CREATE TABLE IF NOT EXISTS "AuditExport" (
  "chainScope"      TEXT PRIMARY KEY,
  "exportedUpToSeq" INT NOT NULL DEFAULT 0,
  "lastExportedAt"  TIMESTAMP,
  "lastSinkObject"  TEXT,
  "lastSinkHash"    TEXT
);
