-- ============================================================
-- PR #27/35/36: Artifact Storage and Approval Infrastructure
-- ============================================================
-- This migration adds the base tables that were missing from
-- previous migrations. Uses IF NOT EXISTS for safety.
-- ============================================================

-- CreateTable: artifacts
CREATE TABLE IF NOT EXISTS "artifacts" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER,
    "contentHash" TEXT,
    "content" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: artifact_approvals
CREATE TABLE IF NOT EXISTS "artifact_approvals" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "decision" TEXT,
    "reviewerId" UUID,
    "feedback" TEXT,
    "decisionMetadata" JSONB,
    "escalatedTo" UUID,
    "escalatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS pattern for PostgreSQL)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_artifactId_key') THEN
        CREATE UNIQUE INDEX "artifact_approvals_artifactId_key" ON "artifact_approvals"("artifactId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifacts_workspaceId_type_idx') THEN
        CREATE INDEX "artifacts_workspaceId_type_idx" ON "artifacts"("workspaceId", "type");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifacts_executionId_idx') THEN
        CREATE INDEX "artifacts_executionId_idx" ON "artifacts"("executionId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifacts_nodeId_idx') THEN
        CREATE INDEX "artifacts_nodeId_idx" ON "artifacts"("nodeId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifacts_createdAt_idx') THEN
        CREATE INDEX "artifacts_createdAt_idx" ON "artifacts"("createdAt" DESC);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifacts_contentHash_idx') THEN
        CREATE INDEX "artifacts_contentHash_idx" ON "artifacts"("contentHash");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_workspaceId_status_idx') THEN
        CREATE INDEX "artifact_approvals_workspaceId_status_idx" ON "artifact_approvals"("workspaceId", "status");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_artifactId_idx') THEN
        CREATE INDEX "artifact_approvals_artifactId_idx" ON "artifact_approvals"("artifactId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_status_idx') THEN
        CREATE INDEX "artifact_approvals_status_idx" ON "artifact_approvals"("status");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_decision_idx') THEN
        CREATE INDEX "artifact_approvals_decision_idx" ON "artifact_approvals"("decision");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_escalatedTo_idx') THEN
        CREATE INDEX "artifact_approvals_escalatedTo_idx" ON "artifact_approvals"("escalatedTo");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artifact_approvals_createdAt_idx') THEN
        CREATE INDEX "artifact_approvals_createdAt_idx" ON "artifact_approvals"("createdAt" DESC);
    END IF;
END $$;

-- AddForeignKey (only if table exists and constraint doesn't)
DO $$
BEGIN
    -- artifacts -> workspaces
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'artifacts_workspaceId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workspaces'
    ) THEN
        ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- artifacts -> execution_requests
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'artifacts_executionId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'execution_requests'
    ) THEN
        ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_executionId_fkey"
            FOREIGN KEY ("executionId") REFERENCES "execution_requests"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- artifact_approvals -> artifacts
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'artifact_approvals_artifactId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'artifacts'
    ) THEN
        ALTER TABLE "artifact_approvals" ADD CONSTRAINT "artifact_approvals_artifactId_fkey"
            FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- artifact_approvals -> workspaces
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'artifact_approvals_workspaceId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workspaces'
    ) THEN
        ALTER TABLE "artifact_approvals" ADD CONSTRAINT "artifact_approvals_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
