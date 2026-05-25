-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "feedback" TEXT,
    "feedbackType" TEXT,
    "severity" TEXT,
    "preserveAspects" TEXT[],
    "provider" TEXT,
    "capability" TEXT,
    "model" TEXT,
    "reviewerId" UUID NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_approvalId_key" ON "approval_decisions"("approvalId");

-- CreateIndex
CREATE INDEX "approval_decisions_workspaceId_reviewedAt_idx" ON "approval_decisions"("workspaceId", "reviewedAt" DESC);

-- CreateIndex
CREATE INDEX "approval_decisions_provider_decision_idx" ON "approval_decisions"("provider", "decision");

-- CreateIndex
CREATE INDEX "approval_decisions_capability_decision_idx" ON "approval_decisions"("capability", "decision");

-- CreateIndex
CREATE INDEX "approval_decisions_feedbackType_idx" ON "approval_decisions"("feedbackType");

-- CreateIndex
CREATE INDEX "approval_decisions_severity_idx" ON "approval_decisions"("severity");

-- CreateIndex
CREATE INDEX "approval_decisions_executionId_idx" ON "approval_decisions"("executionId");

-- CreateIndex
CREATE INDEX "approval_decisions_reviewerId_idx" ON "approval_decisions"("reviewerId");

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "artifact_approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
