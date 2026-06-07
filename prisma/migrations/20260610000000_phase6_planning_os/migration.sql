-- Phase 6 — Planning OS (scenario · north-star · unit-economics · PLAN surface)
-- All-new objects: 3 CREATE TYPE + 3 CREATE TABLE + indexes + FKs.
-- No ALTER TYPE, no destructive change (the Phase-2 trap is avoided).

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED', 'MISSED');

-- CreateEnum
CREATE TYPE "SustainabilityBand" AS ENUM ('HEALTHY', 'THIN', 'UNDERWATER');

-- CreateTable
CREATE TABLE "account_economics" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "aovMinor" INTEGER NOT NULL,
    "grossMarginPct" DOUBLE PRECISION NOT NULL,
    "repeatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgOrdersPerCustomer" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "targetLtvToCac" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_economics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalBudgetMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "channelMix" JSONB NOT NULL,
    "testingAgenda" JSONB NOT NULL,
    "projections" JSONB NOT NULL,
    "memoryBasis" JSONB NOT NULL,
    "allocationPlanId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "north_star_goals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparator" "Comparator" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "spendCeilingMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ON_TRACK',
    "planId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "north_star_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_economics_workspaceId_key" ON "account_economics"("workspaceId");

-- CreateIndex
CREATE INDEX "plans_workspaceId_status_idx" ON "plans"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "north_star_goals_workspaceId_status_idx" ON "north_star_goals"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "account_economics" ADD CONSTRAINT "account_economics_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "north_star_goals" ADD CONSTRAINT "north_star_goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "north_star_goals" ADD CONSTRAINT "north_star_goals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
