-- Team & Roles — workspace invitations.
-- Additive only: one new enum + one new table + one FK to workspaces. No DROP,
-- no ALTER of any existing table or column. Existing rows are untouched.

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "collabRole" "WorkspaceRole" NOT NULL DEFAULT 'BUYER',
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_workspaceId_idx" ON "invitations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_workspaceId_email_key" ON "invitations"("workspaceId", "email");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
