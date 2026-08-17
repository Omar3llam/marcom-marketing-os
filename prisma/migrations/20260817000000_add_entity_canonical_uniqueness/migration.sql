-- CreateIndex
CREATE UNIQUE INDEX "accounts_workspaceId_channel_externalId_key" ON "accounts"("workspaceId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_entities_workspaceId_channel_externalId_key" ON "campaign_entities"("workspaceId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sets_workspaceId_channel_externalId_key" ON "ad_sets"("workspaceId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ads_workspaceId_channel_externalId_key" ON "ads"("workspaceId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_workspaceId_channel_externalId_key" ON "creatives"("workspaceId", "channel", "externalId");

