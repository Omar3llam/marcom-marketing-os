-- Promote onboarding preferences from User.context onto the workspace so
-- workspace-scoped services (AgenticLoop, /api/user/workspace) can read them.
-- All additive + nullable / empty-default: existing rows and skipped steps
-- never break.
ALTER TABLE "workspaces" ADD COLUMN "spendTier" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "objective" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "adChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN "workspaces"."spendTier"  IS 'Onboarding tier id (t1..t4) — no billing meaning';
COMMENT ON COLUMN "workspaces"."objective"  IS 'Onboarding goal id: roas | conversions | ltv | custom';
COMMENT ON COLUMN "workspaces"."adChannels" IS 'Normalized Channel values the account runs, e.g. {META,GOOGLE}';
