-- ============================================================
-- P0-1: Workspace Isolation Fix for CampaignState
-- ============================================================
-- CRITICAL BUG FIX: campaignId was globally unique, allowing
-- cross-workspace data corruption. This migration:
--
-- 1. Drops the global unique constraint on campaignId
-- 2. Adds a composite unique constraint on (campaignId, workspaceId)
--
-- This enforces proper multi-tenant isolation at the DB level.
--
-- Impact: Prevents Workspace A from overwriting Workspace B's
-- campaign data when they have campaigns with the same ID.
-- ============================================================

-- Drop the global unique constraint on campaignId
ALTER TABLE "campaign_states"
  DROP CONSTRAINT IF EXISTS "campaign_states_campaignId_key";

-- Add composite unique constraint for workspace-scoped uniqueness
-- This ensures campaignId is unique WITHIN a workspace, not globally
ALTER TABLE "campaign_states"
  ADD CONSTRAINT "campaign_states_campaignId_workspaceId_key"
  UNIQUE ("campaignId", "workspaceId");
