-- ============================================================
-- PR #14: Execution Metrics
-- Append-only record written after every terminal transition.
-- Enables GET /api/execute/metrics/summary.
--
-- READ-ONLY from the observability layer.
-- Never mutates execution state.
-- ============================================================

CREATE TABLE "execution_metrics" (
  "id"              TEXT        NOT NULL,
  "executionId"     TEXT        NOT NULL,
  "workspaceId"     UUID        NOT NULL,

  -- Timing (derived from ExecutionTransition audit log)
  "queueWaitMs"     INTEGER,        -- PENDING → EXECUTING elapsed ms
  "executionMs"     INTEGER,        -- EXECUTING → terminal elapsed ms

  -- Outcome counters
  "retryCount"      INTEGER     NOT NULL DEFAULT 0,
  "timeoutOccurred" BOOLEAN     NOT NULL DEFAULT false,

  -- Agent attribution (from execution response payload)
  "agentUsed"       TEXT,           -- 'claude' | 'openai' | 'hybrid'
  "tokenEstimate"   INTEGER,

  "finalStatus"     TEXT        NOT NULL,
  "recordedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "execution_metrics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "execution_metrics"
  ADD CONSTRAINT "execution_metrics_executionId_fkey"
  FOREIGN KEY ("executionId")
  REFERENCES "execution_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Workspace-scoped summary queries (7-day window)
CREATE INDEX "execution_metrics_workspaceId_recordedAt_idx"
  ON "execution_metrics"("workspaceId", "recordedAt" DESC);

-- Per-execution lookup
CREATE INDEX "execution_metrics_executionId_idx"
  ON "execution_metrics"("executionId");
