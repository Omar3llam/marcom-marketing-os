-- CreateTable
CREATE TABLE "content_generations" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_generations_workspaceId_createdAt_idx" ON "content_generations"("workspaceId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
