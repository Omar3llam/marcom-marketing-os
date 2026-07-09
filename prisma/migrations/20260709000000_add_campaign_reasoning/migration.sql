-- CreateTable
CREATE TABLE "campaign_reasonings" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "impactScore" INTEGER,
    "sweepId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_reasonings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_reasonings_workspaceId_entityId_key" ON "campaign_reasonings"("workspaceId", "entityId");

-- CreateIndex
CREATE INDEX "campaign_reasonings_workspaceId_generatedAt_idx" ON "campaign_reasonings"("workspaceId", "generatedAt" DESC);

-- AddForeignKey
ALTER TABLE "campaign_reasonings" ADD CONSTRAINT "campaign_reasonings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
