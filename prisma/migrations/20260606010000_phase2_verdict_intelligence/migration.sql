-- ============================================================
-- Phase 2 — Verdict intelligence
-- Adds REALLOCATE/REFRESH verdicts + their ActionTypes, the
-- guardrail-rule condition enums, and the FatiguePrediction +
-- GuardrailRule tables.
-- ============================================================

-- AlterEnum: new first-class verdicts
ALTER TYPE "Verdict" ADD VALUE 'REALLOCATE';
ALTER TYPE "Verdict" ADD VALUE 'REFRESH';

-- NOTE: ActionType is a Prisma-level enum only — in the database the
-- audit_logs.actionType / execution columns are TEXT (see the init
-- migration), so there is no "ActionType" Postgres type to ALTER. The
-- new REALLOCATE_BUDGET / REFRESH_CREATIVE values are enforced
-- application-side (ALLOWED_ACTIONS in src/routes/execution/meta.js and
-- validateActionTarget in src/services/metaExecutionService.js). No DDL
-- is needed here for them.

-- CreateEnum
CREATE TYPE "Comparator" AS ENUM ('GT', 'GTE', 'LT', 'LTE');

-- CreateEnum
CREATE TYPE "ThresholdUnit" AS ENUM ('MINOR', 'RATIO', 'PCT');

-- CreateTable
CREATE TABLE "fatigue_predictions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLevel" "EntityLevel" NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'frequency',
    "ceiling" DOUBLE PRECISION NOT NULL,
    "projectedBreachDate" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "basis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "actualBreachDate" TIMESTAMP(3),
    "accuracy" DOUBLE PRECISION,

    CONSTRAINT "fatigue_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scopeLevel" "EntityLevel" NOT NULL DEFAULT 'ADSET',
    "audienceTag" TEXT,
    "metric" TEXT NOT NULL,
    "comparator" "Comparator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unit" "ThresholdUnit" NOT NULL DEFAULT 'RATIO',
    "sustainedDays" INTEGER NOT NULL DEFAULT 1,
    "emitVerdict" "Verdict" NOT NULL DEFAULT 'WATCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardrail_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fatigue_predictions_workspaceId_createdAt_idx" ON "fatigue_predictions"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "fatigue_predictions_entityId_entityLevel_idx" ON "fatigue_predictions"("entityId", "entityLevel");

-- CreateIndex
CREATE INDEX "fatigue_predictions_resolvedAt_idx" ON "fatigue_predictions"("resolvedAt");

-- CreateIndex
CREATE INDEX "guardrail_rules_workspaceId_enabled_idx" ON "guardrail_rules"("workspaceId", "enabled");

-- AddForeignKey
ALTER TABLE "fatigue_predictions" ADD CONSTRAINT "fatigue_predictions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_rules" ADD CONSTRAINT "guardrail_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
