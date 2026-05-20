-- ============================================================
-- Phase 11B Task 7: ExecutionTransition Audit Log
-- Immutable append-only log of every state transition
-- ============================================================
-- Architectural Law:
-- Every state mutation must emit a durable transition record.
--
-- Purpose:
-- - Forensic debugging: "who changed the state and why?"
-- - Replay capability: reconstruct execution timeline
-- - Incident analysis: track correlation lineage
-- - Timeline UI: execution visualization
-- - Compliance: immutable audit trail
-- ============================================================

-- Create TransitionActor enum
CREATE TYPE "TransitionActor" AS ENUM (
  'WORKER',
  'TIMEOUT_HANDLER',
  'USER',
  'API',
  'RECONCILIATION',
  'RETRY_POLICY',
  'SYSTEM'
);

-- Create execution_transitions table
CREATE TABLE "execution_transitions" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "actor" "TransitionActor" NOT NULL,
  "correlationId" TEXT,
  "reason" TEXT,
  "previousVersion" INTEGER NOT NULL,
  "newVersion" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "execution_transitions_pkey" PRIMARY KEY ("id")
);

-- Create foreign key constraint to execution_requests
ALTER TABLE "execution_transitions"
  ADD CONSTRAINT "execution_transitions_executionId_fkey"
  FOREIGN KEY ("executionId")
  REFERENCES "execution_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Create indexes for efficient queries

-- Timeline queries: WHERE executionId = ? ORDER BY createdAt
CREATE INDEX "execution_transitions_executionId_createdAt_idx"
  ON "execution_transitions"("executionId", "createdAt");

-- Workspace audit: WHERE workspaceId = ? ORDER BY createdAt DESC
CREATE INDEX "execution_transitions_workspaceId_createdAt_idx"
  ON "execution_transitions"("workspaceId", "createdAt" DESC);

-- Actor audit: WHERE actor = 'worker'
CREATE INDEX "execution_transitions_actor_idx"
  ON "execution_transitions"("actor");

-- Correlation lineage: WHERE correlationId = ? ORDER BY createdAt
CREATE INDEX "execution_transitions_correlationId_idx"
  ON "execution_transitions"("correlationId");
