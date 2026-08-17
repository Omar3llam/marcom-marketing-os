-- AlterTable
ALTER TABLE "execution_requests" ADD COLUMN     "decisionId" UUID;

-- CreateIndex
CREATE INDEX "execution_requests_decisionId_idx" ON "execution_requests"("decisionId");

-- AddForeignKey
ALTER TABLE "execution_requests" ADD CONSTRAINT "execution_requests_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

