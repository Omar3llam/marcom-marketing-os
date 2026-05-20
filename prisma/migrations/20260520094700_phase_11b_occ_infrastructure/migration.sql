-- ============================================================
-- Phase 11B Task 2: OCC Infrastructure Migration
-- Adds optimistic concurrency control + lifecycle governance fields
-- to ExecutionRequest table
-- ============================================================

-- Add updatedAt timestamp (auto-managed by Prisma)
ALTER TABLE "execution_requests"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add version field for optimistic concurrency control (OCC)
-- Architecture Gate Decision 2: Monotonic version enforcement
-- WHERE version = expectedVersion prevents race conditions
ALTER TABLE "execution_requests"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Add correlationId for distributed tracing lineage
-- Governance Constraint C: Correlation IDs everywhere
ALTER TABLE "execution_requests"
  ADD COLUMN "correlationId" TEXT;

-- Add activeStep for orchestration reconciliation payload
-- Architecture Gate Decision 1: Backend authority fields
ALTER TABLE "execution_requests"
  ADD COLUMN "activeStep" TEXT;

-- Add retryMetadata for retry tracking
-- JSON structure: { attempt, maxAttempts, nextRetryAt }
ALTER TABLE "execution_requests"
  ADD COLUMN "retryMetadata" JSONB;

-- Create index on status for efficient status filtering
CREATE INDEX IF NOT EXISTS "execution_requests_status_idx"
  ON "execution_requests"("status");

-- Create index on correlationId for distributed tracing queries
CREATE INDEX IF NOT EXISTS "execution_requests_correlationId_idx"
  ON "execution_requests"("correlationId");
