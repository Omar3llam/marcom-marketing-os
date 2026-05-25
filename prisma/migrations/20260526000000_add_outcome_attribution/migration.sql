-- ============================================================
-- PR #41: Outcome Attribution Engine
-- ============================================================
-- Links artifacts to Meta ads and tracks real business performance.
-- Enables provider routing based on actual CTR/CPC/ROAS.
-- ============================================================

-- CreateTable: published_creatives
CREATE TABLE IF NOT EXISTS "published_creatives" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "metaAdId" TEXT NOT NULL,
    "metaCampaignId" TEXT NOT NULL,
    "metaAdsetId" TEXT,
    "publishedBy" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adName" TEXT,
    "adStatus" TEXT,

    CONSTRAINT "published_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable: provider_performance_metrics
CREATE TABLE IF NOT EXISTS "provider_performance_metrics" (
    "id" TEXT NOT NULL,
    "publishedCreativeId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "model" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "cpc" DOUBLE PRECISION,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roas" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_performance_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'published_creatives_workspaceId_publishedAt_idx') THEN
        CREATE INDEX "published_creatives_workspaceId_publishedAt_idx" ON "published_creatives"("workspaceId", "publishedAt" DESC);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'published_creatives_artifactId_idx') THEN
        CREATE INDEX "published_creatives_artifactId_idx" ON "published_creatives"("artifactId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'published_creatives_metaAdId_idx') THEN
        CREATE INDEX "published_creatives_metaAdId_idx" ON "published_creatives"("metaAdId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'published_creatives_metaCampaignId_idx') THEN
        CREATE INDEX "published_creatives_metaCampaignId_idx" ON "published_creatives"("metaCampaignId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'provider_performance_metrics_publishedCreativeId_startD_idx') THEN
        CREATE UNIQUE INDEX "provider_performance_metrics_publishedCreativeId_startD_idx"
        ON "provider_performance_metrics"("publishedCreativeId", "startDate", "endDate");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'provider_performance_metrics_workspaceId_fetchedAt_idx') THEN
        CREATE INDEX "provider_performance_metrics_workspaceId_fetchedAt_idx"
        ON "provider_performance_metrics"("workspaceId", "fetchedAt" DESC);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'provider_performance_metrics_publishedCreativeId_idx') THEN
        CREATE INDEX "provider_performance_metrics_publishedCreativeId_idx"
        ON "provider_performance_metrics"("publishedCreativeId");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'provider_performance_metrics_provider_capability_idx') THEN
        CREATE INDEX "provider_performance_metrics_provider_capability_idx"
        ON "provider_performance_metrics"("provider", "capability");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'provider_performance_metrics_startDate_endDate_idx') THEN
        CREATE INDEX "provider_performance_metrics_startDate_endDate_idx"
        ON "provider_performance_metrics"("startDate", "endDate");
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'published_creatives_artifactId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'artifacts'
    ) THEN
        ALTER TABLE "published_creatives" ADD CONSTRAINT "published_creatives_artifactId_fkey"
            FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'published_creatives_workspaceId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workspaces'
    ) THEN
        ALTER TABLE "published_creatives" ADD CONSTRAINT "published_creatives_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_performance_metrics_publishedCreativeId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'published_creatives'
    ) THEN
        ALTER TABLE "provider_performance_metrics" ADD CONSTRAINT "provider_performance_metrics_publishedCreativeId_fkey"
            FOREIGN KEY ("publishedCreativeId") REFERENCES "published_creatives"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'provider_performance_metrics_workspaceId_fkey'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'workspaces'
    ) THEN
        ALTER TABLE "provider_performance_metrics" ADD CONSTRAINT "provider_performance_metrics_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
