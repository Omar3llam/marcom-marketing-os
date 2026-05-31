-- ============================================================
-- PR #29: Execution Checkpoints
-- ============================================================
-- Persistent state snapshots for resumable execution.
-- Enables pause/resume capability for human-in-the-loop
-- approval workflows.
--
-- Missing migration: ExecutionCheckpoint model was added to
-- prisma/schema.prisma but this table was never created in the
-- production database. Any route writing a checkpoint (e.g.,
-- pause-for-approval) would throw a Prisma runtime error.
-- ============================================================

CREATE TABLE IF NOT EXISTS "execution_checkpoints" (
    "id"              TEXT        NOT NULL,
    "executionId"     TEXT        NOT NULL,
    "workspaceId"     UUID        NOT NULL,
    "nodeId"          TEXT        NOT NULL,
    "status"          TEXT        NOT NULL,
    "serializedState" JSONB       NOT NULL,
    "pausedReason"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedAt"       TIMESTAMP(3),

    CONSTRAINT "execution_checkpoints_pkey" PRIMARY KEY ("id")
);

-- FK: must reference a real execution (cascade on delete)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'execution_checkpoints_executionId_fkey'
    ) THEN
        ALTER TABLE "execution_checkpoints"
            ADD CONSTRAINT "execution_checkpoints_executionId_fkey"
            FOREIGN KEY ("executionId")
            REFERENCES "execution_requests"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Resume candidates: WHERE status = 'PAUSED_FOR_APPROVAL' AND resumedAt IS NULL
CREATE INDEX IF NOT EXISTS "execution_checkpoints_executionId_createdAt_idx"
    ON "execution_checkpoints"("executionId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "execution_checkpoints_workspaceId_status_idx"
    ON "execution_checkpoints"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "execution_checkpoints_status_idx"
    ON "execution_checkpoints"("status");
