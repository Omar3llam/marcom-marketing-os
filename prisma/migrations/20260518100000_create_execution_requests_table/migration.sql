-- ============================================================
-- Create ExecutionRequest Table
-- ============================================================
-- This migration creates the execution_requests table that is
-- referenced by later migrations (ExecutionTransition, ExecutionMetric, etc).
-- 
-- The table uses CUID for IDs and matches the Prisma schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS "execution_requests" (
  "id"              TEXT NOT NULL,
  "workspaceId"     UUID NOT NULL,
  "idempotencyKey"  TEXT NOT NULL,
  "actionType"      TEXT NOT NULL,
  "targetId"        TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "payload"         JSONB,
  "response"        JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"         INTEGER NOT NULL DEFAULT 0,
  "correlationId"   TEXT,
  "activeStep"      TEXT,
  "retryMetadata"   JSONB

  CONSTRAINT "execution_requests_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on idempotencyKey
CREATE UNIQUE INDEX IF NOT EXISTS "execution_requests_idempotencyKey_key"
  ON "execution_requests"("idempotencyKey");

-- Create index on workspaceId for workspace-scoped queries
CREATE INDEX IF NOT EXISTS "execution_requests_workspaceId_idx"
  ON "execution_requests"("workspaceId");

-- Create index on createdAt for time-ordered queries
CREATE INDEX IF NOT EXISTS "execution_requests_createdAt_idx"
  ON "execution_requests"("createdAt");

-- Create index on status for efficient status filtering
CREATE INDEX IF NOT EXISTS "execution_requests_status_idx"
  ON "execution_requests"("status");

-- Create index on correlationId for distributed tracing queries
CREATE INDEX IF NOT EXISTS "execution_requests_correlationId_idx"
  ON "execution_requests"("correlationId");

-- Add foreign key constraint to workspaces table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'execution_requests_workspaceId_fkey'
  ) THEN
    ALTER TABLE "execution_requests"
      ADD CONSTRAINT "execution_requests_workspaceId_fkey"
      FOREIGN KEY ("workspaceId")
      REFERENCES "workspaces"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
