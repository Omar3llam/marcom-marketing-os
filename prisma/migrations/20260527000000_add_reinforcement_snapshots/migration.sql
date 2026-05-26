-- ============================================================
-- PR #42: Adaptive Reinforcement Engine
-- ============================================================
-- Creates the ReinforcementSnapshot table for tracking provider
-- performance scores over time. Enables autonomous learning and
-- adaptive routing optimization.
-- ============================================================

-- CreateTable: reinforcement_snapshots
CREATE TABLE IF NOT EXISTS "reinforcement_snapshots" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinforcement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'reinforcement_snapshots_provider_capability_createdAt_idx') THEN
        CREATE INDEX "reinforcement_snapshots_provider_capability_createdAt_idx"
        ON "reinforcement_snapshots"("provider", "capability", "createdAt" DESC);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'reinforcement_snapshots_workspaceId_createdAt_idx') THEN
        CREATE INDEX "reinforcement_snapshots_workspaceId_createdAt_idx"
        ON "reinforcement_snapshots"("workspaceId", "createdAt" DESC);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'reinforcement_snapshots_windowStart_windowEnd_idx') THEN
        CREATE INDEX "reinforcement_snapshots_windowStart_windowEnd_idx"
        ON "reinforcement_snapshots"("windowStart", "windowEnd");
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reinforcement_snapshots_workspaceId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workspaces'
    ) THEN
        ALTER TABLE "reinforcement_snapshots" ADD CONSTRAINT "reinforcement_snapshots_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
