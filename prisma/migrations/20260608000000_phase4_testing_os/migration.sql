-- Phase 4 — Testing OS (closed-loop weekly experiments)
-- All-new objects only (2 enums + 2 tables + indexes + FKs). No ALTER TYPE.

-- CreateEnum
CREATE TYPE "TestDimension" AS ENUM ('HOOK', 'OFFER', 'AUDIENCE', 'CREATIVE_ANGLE');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('PROPOSED', 'RUNNING', 'CONCLUDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "test_experiments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" UUID,
    "entityLevel" "EntityLevel",
    "dimension" "TestDimension" NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "expectedSignal" TEXT NOT NULL,
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TestStatus" NOT NULL DEFAULT 'PROPOSED',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),
    "winnerLabel" TEXT,
    "lift" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "confidenceLabel" TEXT,
    "sampleNote" TEXT,
    "decisionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_variants" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "metaEntityId" TEXT,
    "metaLevel" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "spendMinor" INTEGER NOT NULL DEFAULT 0,
    "revenueMinor" INTEGER NOT NULL DEFAULT 0,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_experiments_workspaceId_createdAt_idx" ON "test_experiments"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "test_experiments_status_idx" ON "test_experiments"("status");

-- CreateIndex
CREATE INDEX "test_experiments_entityId_entityLevel_idx" ON "test_experiments"("entityId", "entityLevel");

-- CreateIndex
CREATE INDEX "test_variants_testId_idx" ON "test_variants"("testId");

-- AddForeignKey
ALTER TABLE "test_experiments" ADD CONSTRAINT "test_experiments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_experiments" ADD CONSTRAINT "test_experiments_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_variants" ADD CONSTRAINT "test_variants_testId_fkey" FOREIGN KEY ("testId") REFERENCES "test_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
