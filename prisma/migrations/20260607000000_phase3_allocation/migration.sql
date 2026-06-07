-- ============================================================
-- Phase 3 — Capital allocation
-- Adds the GoalType + AllocationStatus enums and the AllocationPlan
-- table. All-new types/table — no ALTER TYPE on a pre-existing enum
-- (none of the Phase-2 ActionType TEXT-drift trap applies here).
--
-- Individual allocation MOVES are not new columns: each is a PROPOSED
-- REALLOCATE Decision linked back via Decision.rootCause =
-- 'allocation:<planId>' (mirrors the Phase-2 'guardrail:' convention),
-- so reallocations flow through the existing confirm→execute governance.
-- ============================================================

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('GROWTH_CEILING');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "allocation_plans" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "goalType" "GoalType" NOT NULL,
    "goalValue" DOUBLE PRECISION,
    "totalBudgetMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "projectedRoas" DOUBLE PRECISION,
    "projectedCpaMinor" INTEGER,
    "merBefore" DOUBLE PRECISION,
    "merAfter" DOUBLE PRECISION,
    "reasoning" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allocation_plans_workspaceId_createdAt_idx" ON "allocation_plans"("workspaceId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
