-- ============================================================
-- Phase 8 — Collaboration & Reporting OS
-- ============================================================
-- Roles · stakeholder narratives · approvals · collaboration audit.
-- All-additive: 5 CREATE TYPE + 3 ADD COLUMN + 3 CREATE TABLE + indexes + FKs.
-- No ALTER TYPE, no destructive change — safe to apply forward.
-- ============================================================

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('STRATEGIST', 'BUYER', 'CLIENT');

-- CreateEnum
CREATE TYPE "NarrativePeriod" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "NarrativeAudience" AS ENUM ('STRATEGIST', 'BUYER', 'LEADERSHIP');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollaborationEventType" AS ENUM ('APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'HANDOFF', 'NARRATIVE_GENERATED');

-- AlterTable: collaboration role on a seat (null ⇒ STRATEGIST in app code)
ALTER TABLE "users" ADD COLUMN "collabRole" "WorkspaceRole";

-- AlterTable: opt-in approval gate on a plan/reallocation
ALTER TABLE "plans" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "approvalState" "ApprovalState";

-- CreateTable
CREATE TABLE "stakeholder_narratives" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "period" "NarrativePeriod" NOT NULL,
    "audience" "NarrativeAudience" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "headline" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "confidenceBasis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stakeholder_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "planId" UUID,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "state" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorId" UUID,
    "type" "CollaborationEventType" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromRole" "WorkspaceRole",
    "toRole" "WorkspaceRole",
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaboration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stakeholder_narratives_workspaceId_createdAt_idx" ON "stakeholder_narratives"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_workspaceId_state_idx" ON "approval_requests"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "approval_requests_planId_idx" ON "approval_requests"("planId");

-- CreateIndex
CREATE INDEX "collaboration_events_workspaceId_createdAt_idx" ON "collaboration_events"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "collaboration_events_subjectId_idx" ON "collaboration_events"("subjectId");

-- AddForeignKey
ALTER TABLE "stakeholder_narratives" ADD CONSTRAINT "stakeholder_narratives_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_events" ADD CONSTRAINT "collaboration_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
