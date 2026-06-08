-- Phase 7 — Measurement OS (attribution · incrementality · reconciliation)
-- All-new objects: 4 CREATE TYPE + 2 CREATE TABLE + indexes + FKs + 1 ADD COLUMN.
-- No ALTER TYPE, no destructive change (the Phase-2 trap is avoided).

-- CreateEnum
CREATE TYPE "MeasurementTier" AS ENUM ('NONE', 'AGENCY', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AttributionModel" AS ENUM ('FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR', 'POSITION_BASED', 'INCREMENTALITY_WEIGHTED');

-- CreateEnum
CREATE TYPE "IncrementalityStatus" AS ENUM ('DESIGNED', 'RUNNING', 'CONCLUDED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable: measurement tier (gated, OFF by default — not core)
ALTER TABLE "workspaces" ADD COLUMN     "measurementTier" "MeasurementTier" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "incrementality_tests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "entityId" UUID,
    "entityLevel" "EntityLevel",
    "holdoutPct" DOUBLE PRECISION NOT NULL,
    "mde" DOUBLE PRECISION NOT NULL,
    "sampleSizePerArm" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "guardrails" JSONB NOT NULL,
    "status" "IncrementalityStatus" NOT NULL DEFAULT 'DESIGNED',
    "exposedUsers" INTEGER NOT NULL DEFAULT 0,
    "exposedConversions" INTEGER NOT NULL DEFAULT 0,
    "holdoutUsers" INTEGER NOT NULL DEFAULT 0,
    "holdoutConversions" INTEGER NOT NULL DEFAULT 0,
    "liftPct" DOUBLE PRECISION,
    "ciLow" DOUBLE PRECISION,
    "ciHigh" DOUBLE PRECISION,
    "confidenceLabel" "ConfidenceLevel",
    "incrementalRevenueMinor" INTEGER,
    "decisionId" UUID,
    "startedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incrementality_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "path_touches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "entityId" UUID,
    "touchPosition" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "isConversionTouch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "path_touches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incrementality_tests_workspaceId_status_idx" ON "incrementality_tests"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "path_touches_workspaceId_conversionId_touchPosition_idx" ON "path_touches"("workspaceId", "conversionId", "touchPosition");

-- AddForeignKey
ALTER TABLE "incrementality_tests" ADD CONSTRAINT "incrementality_tests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_touches" ADD CONSTRAINT "path_touches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
