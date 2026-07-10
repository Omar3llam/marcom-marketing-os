-- AddAIInsightToLoopRun
-- Add aiInsight column to store pre-generated portfolio briefing (1-2 sentences)
-- Generated in the sweep, best-effort, never fails the sweep if AI call fails

ALTER TABLE "loop_runs"
  ADD COLUMN IF NOT EXISTS "ai_insight" TEXT;
