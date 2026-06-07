-- Phase 5 — Memory Moat (per-account learning → playbooks → gated network)
-- All-new objects + 3 workspace ADD COLUMNs. No ALTER TYPE.

-- CreateEnum
CREATE TYPE "PatternKind" AS ENUM ('FATIGUE_CEILING', 'SCALING_WINDOW', 'CREATIVE_ANGLE_LONGEVITY', 'SEASONAL_EFFECT');

-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('EMERGING', 'ESTABLISHED', 'SUPERSEDED', 'CONFLICTED');

-- AlterTable: workspace network-memory consent (opt-in, off by default)
ALTER TABLE "workspaces" ADD COLUMN     "networkConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN     "cohortTag" TEXT;
ALTER TABLE "workspaces" ADD COLUMN     "consentedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "account_patterns" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "patternKey" TEXT NOT NULL,
    "kind" "PatternKind" NOT NULL,
    "statement" TEXT NOT NULL,
    "basis" TEXT,
    "support" INTEGER NOT NULL DEFAULT 1,
    "effectiveSupport" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "PatternStatus" NOT NULL,
    "metric" TEXT,
    "scopeLevel" "EntityLevel",
    "audienceTag" TEXT,
    "comparator" "Comparator",
    "threshold" DOUBLE PRECISION,
    "unit" "ThresholdUnit",
    "emitVerdict" "Verdict",
    "sustainedDays" INTEGER,
    "supersededById" UUID,
    "promotedRuleId" UUID,
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_observations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "patternId" UUID NOT NULL,
    "decisionId" UUID,
    "entityId" UUID,
    "occurrenceKey" TEXT NOT NULL,
    "predicted" TEXT NOT NULL,
    "actual" TEXT,
    "correct" BOOLEAN,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pattern_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_patterns_workspaceId_status_idx" ON "account_patterns"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_patterns_workspaceId_patternKey_key" ON "account_patterns"("workspaceId", "patternKey");

-- CreateIndex
CREATE INDEX "pattern_observations_workspaceId_observedAt_idx" ON "pattern_observations"("workspaceId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pattern_observations_patternId_occurrenceKey_key" ON "pattern_observations"("patternId", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "account_patterns" ADD CONSTRAINT "account_patterns_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_patterns" ADD CONSTRAINT "account_patterns_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "account_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_observations" ADD CONSTRAINT "pattern_observations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_observations" ADD CONSTRAINT "pattern_observations_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "account_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
