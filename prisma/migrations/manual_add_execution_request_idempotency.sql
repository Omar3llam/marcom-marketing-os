-- ============================================================
-- MARCOM / Lumi — Manual Migration: ExecutionRequest
-- ============================================================
-- This migration adds the ExecutionRequest table for idempotency
-- protection. It prevents duplicate Meta executions from:
--   - Double-clicks
--   - Network retries
--   - Browser refreshes
--   - Flaky connections
--
-- Run this migration on production when deploying the idempotency
-- feature. The migration is idempotent (safe to re-run).
-- ============================================================

-- Create execution_requests table
CREATE TABLE IF NOT EXISTS execution_requests (
  id              TEXT PRIMARY KEY,
  workspace_id    UUID NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  action_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  status          TEXT NOT NULL,
  payload         JSONB,
  response        JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_execution_requests_workspace_id
  ON execution_requests(workspace_id);

CREATE INDEX IF NOT EXISTS idx_execution_requests_created_at
  ON execution_requests(created_at);

-- Add comment for documentation
COMMENT ON TABLE execution_requests IS 'Idempotency protection: stores execution requests with unique keys to prevent duplicate Meta API calls';
