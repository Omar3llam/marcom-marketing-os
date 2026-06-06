-- ============================================================
-- Phase 1 — Marketing OS data substrate
-- Entity graph (Account→Campaign→AdSet→Ad→Creative), numeric
-- MetricSnapshot (minor units + source + granularity), and the
-- decision graph (Decision→Outcome→Memory).
-- ============================================================

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "EntityLevel" AS ENUM ('ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD', 'CREATIVE');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN', 'GA4', 'SHOPIFY', 'MANUAL');

-- CreateEnum
CREATE TYPE "Granularity" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('KILL', 'HOLD', 'SCALE', 'WATCH');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_entities" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "adSetId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "adId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLevel" "EntityLevel" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" "DataSource" NOT NULL,
    "granularity" "Granularity" NOT NULL DEFAULT 'DAILY',
    "spendMinor" INTEGER NOT NULL DEFAULT 0,
    "revenueMinor" INTEGER NOT NULL DEFAULT 0,
    "cpaMinor" INTEGER,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "roas" DOUBLE PRECISION,
    "frequency" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLevel" "EntityLevel" NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "rootCause" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcome_snapshots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLevel" "EntityLevel" NOT NULL,
    "spendDeltaMinor" INTEGER,
    "revenueDeltaMinor" INTEGER,
    "roasDelta" DOUBLE PRECISION,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "sustained" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcome_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_memory_entries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "decisionId" UUID,
    "entityId" UUID,
    "actionType" TEXT,
    "rationale" TEXT NOT NULL,
    "isSustainable" BOOLEAN,
    "impactDurationHrs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_workspaceId_idx" ON "accounts"("workspaceId");

-- CreateIndex
CREATE INDEX "campaign_entities_workspaceId_idx" ON "campaign_entities"("workspaceId");

-- CreateIndex
CREATE INDEX "campaign_entities_accountId_idx" ON "campaign_entities"("accountId");

-- CreateIndex
CREATE INDEX "ad_sets_workspaceId_idx" ON "ad_sets"("workspaceId");

-- CreateIndex
CREATE INDEX "ad_sets_campaignId_idx" ON "ad_sets"("campaignId");

-- CreateIndex
CREATE INDEX "ads_workspaceId_idx" ON "ads"("workspaceId");

-- CreateIndex
CREATE INDEX "ads_adSetId_idx" ON "ads"("adSetId");

-- CreateIndex
CREATE INDEX "creatives_workspaceId_idx" ON "creatives"("workspaceId");

-- CreateIndex
CREATE INDEX "creatives_adId_idx" ON "creatives"("adId");

-- CreateIndex
CREATE INDEX "metric_snapshots_workspaceId_entityId_entityLevel_date_idx" ON "metric_snapshots"("workspaceId", "entityId", "entityLevel", "date");

-- CreateIndex
CREATE INDEX "metric_snapshots_entityId_date_idx" ON "metric_snapshots"("entityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "metric_snapshots_entityId_entityLevel_date_granularity_sour_key" ON "metric_snapshots"("entityId", "entityLevel", "date", "granularity", "source");

-- CreateIndex
CREATE INDEX "decisions_workspaceId_createdAt_idx" ON "decisions"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "decisions_entityId_entityLevel_idx" ON "decisions"("entityId", "entityLevel");

-- CreateIndex
CREATE INDEX "outcome_snapshots_workspaceId_createdAt_idx" ON "outcome_snapshots"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "outcome_snapshots_decisionId_idx" ON "outcome_snapshots"("decisionId");

-- CreateIndex
CREATE INDEX "decision_memory_entries_workspaceId_createdAt_idx" ON "decision_memory_entries"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "decision_memory_entries_decisionId_idx" ON "decision_memory_entries"("decisionId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_entities" ADD CONSTRAINT "campaign_entities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_entities" ADD CONSTRAINT "campaign_entities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_snapshots" ADD CONSTRAINT "outcome_snapshots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_snapshots" ADD CONSTRAINT "outcome_snapshots_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_memory_entries" ADD CONSTRAINT "decision_memory_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_memory_entries" ADD CONSTRAINT "decision_memory_entries_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
