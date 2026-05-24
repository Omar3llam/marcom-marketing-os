-- ============================================================
-- PR #20: DecisionMemory Foundation
-- Replaces the old campaign-centric decision_memory table with
-- an execution-centric append-only memory layer.
--
-- Breaking change: old columns (campaignId, actionType,
-- decisionRationale, resultStatus, delta*, isSustainable,
-- recordedAt) are dropped. Any data in the old table is lost.
-- This table had no production data at the time of this migration.
-- ============================================================

-- Drop old table (FK from workspaces.id is on this table's
-- workspaceId column — dropping here removes that constraint).
DROP TABLE IF EXISTS "decision_memory";

-- Recreate with execution-centric schema.
-- id: cuid (TEXT) to match ExecutionRequest / ExecutionMetric pattern.
CREATE TABLE "decision_memory" (
  "id"            TEXT          NOT NULL,
  "workspaceId"   UUID          NOT NULL,
  "executionId"   TEXT          NOT NULL,
  "correlationId" TEXT,
  "decisionType"  TEXT          NOT NULL,
  "signalType"    TEXT          NOT NULL,
  "diagnosis"     TEXT          NOT NULL,
  "actionTaken"   TEXT          NOT NULL,
  "outcome"       TEXT          NOT NULL,
  "confidence"    DOUBLE PRECISION NOT NULL,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_memory_pkey" PRIMARY KEY ("id")
);

-- FK: must belong to a valid workspace
ALTER TABLE "decision_memory"
  ADD CONSTRAINT "decision_memory_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: must reference a real execution
ALTER TABLE "decision_memory"
  ADD CONSTRAINT "decision_memory_executionId_fkey"
  FOREIGN KEY ("executionId")
  REFERENCES "execution_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Primary read pattern: GET /api/decision-memory/recent (workspace, newest-first)
CREATE INDEX "decision_memory_workspaceId_createdAt_idx"
  ON "decision_memory"("workspaceId", "createdAt" DESC);

-- Execution-scoped lookup (trace enrichment, future)
CREATE INDEX "decision_memory_executionId_idx"
  ON "decision_memory"("executionId");

-- Correlation lineage queries
CREATE INDEX "decision_memory_correlationId_idx"
  ON "decision_memory"("correlationId");
