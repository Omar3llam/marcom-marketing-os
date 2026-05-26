-- ============================================================
-- MARCOM Production Baseline Migration
-- ============================================================
-- This is the baseline migration representing the current
-- production schema state. All tables already exist in
-- production, so this migration uses IF NOT EXISTS.
-- ============================================================

-- Create core tables if they don't exist
CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "clerkId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_key" UNIQUE ("email"),
  CONSTRAINT "users_clerkId_key" UNIQUE ("clerkId"),
  CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "oauth_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "encryptionVersion" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  
  CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "integrations" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "platform" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "expiresAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  
  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integrations_workspaceId_platform_key" UNIQUE ("workspaceId", "platform"),
  CONSTRAINT "integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "actions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "campaignId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  
  CONSTRAINT "actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "actions_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actionId" UUID,
  "actionType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "response" JSONB,
  "errorMessage" TEXT,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "audit_logs_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "campaign_states" (
  "id" UUID NOT NULL,
  "campaignId" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "stage" TEXT NOT NULL,
  "healthScore" DOUBLE PRECISION NOT NULL,
  "lastAnalysis" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  
  CONSTRAINT "campaign_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_states_campaignId_workspaceId_key" UNIQUE ("campaignId", "workspaceId"),
  CONSTRAINT "campaign_states_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_events_externalEventId_key" UNIQUE ("externalEventId")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "users_workspaceId_idx" ON "users"("workspaceId");
CREATE INDEX IF NOT EXISTS "oauth_tokens_userId_provider_idx" ON "oauth_tokens"("userId", "provider");
CREATE INDEX IF NOT EXISTS "integrations_workspaceId_idx" ON "integrations"("workspaceId");
CREATE INDEX IF NOT EXISTS "actions_workspaceId_status_idx" ON "actions"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "actions_campaignId_idx" ON "actions"("campaignId");
CREATE INDEX IF NOT EXISTS "audit_logs_workspaceId_performedAt_idx" ON "audit_logs"("workspaceId", "performedAt" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_targetId_idx" ON "audit_logs"("targetId");
CREATE INDEX IF NOT EXISTS "audit_logs_actionType_idx" ON "audit_logs"("actionType");
CREATE INDEX IF NOT EXISTS "audit_logs_status_idx" ON "audit_logs"("status");
CREATE INDEX IF NOT EXISTS "campaign_states_workspaceId_idx" ON "campaign_states"("workspaceId");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_status_idx" ON "webhook_events"("provider", "status");

-- For initial deployment: run `prisma migrate resolve --applied 20260517000000_init`
-- to mark this migration as already applied without executing SQL.

-- Future migrations will be applied automatically via `prisma migrate deploy`.
