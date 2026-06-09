-- ============================================================
-- Phase 9 — Agentic OS
-- ============================================================
-- The loop-sweep audit. All-additive: 2 CREATE TYPE + 1 CREATE TABLE +
-- indexes + FK. No ALTER TYPE, no destructive change — safe to apply forward.
-- ============================================================

-- CreateEnum
CREATE TYPE "LoopTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'ON_READ');

-- CreateEnum
CREATE TYPE "LoopHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'STALLED');

-- CreateTable
CREATE TABLE "loop_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "trigger" "LoopTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "proposalsByType" JSONB NOT NULL,
    "stageStatus" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL,
    "loopHealth" "LoopHealth" NOT NULL,
    "staleStages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loop_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loop_runs_workspaceId_createdAt_idx" ON "loop_runs"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "loop_runs_workspaceId_loopHealth_idx" ON "loop_runs"("workspaceId", "loopHealth");

-- AddForeignKey
ALTER TABLE "loop_runs" ADD CONSTRAINT "loop_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
