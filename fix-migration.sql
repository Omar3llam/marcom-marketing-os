-- ============================================================
-- Fix Failed Migration P3009
-- Run: psql "postgresql://marcom_db_user:pn5W3vIihFjyPk8L6fl96mFUEv24TdBA@dpg-d7lsn5gg4nts739edsg0-a/marcom_db" -f fix-migration.sql
-- ============================================================

-- Step 1: Check current status
\echo '=== STEP 1: Current Migration Status ==='
SELECT
    migration_name,
    started_at,
    finished_at,
    rolled_back_at,
    applied_steps_count
FROM _prisma_migrations
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Step 2: Mark as rolled back
\echo ''
\echo '=== STEP 2: Marking Migration as Rolled Back ==='
UPDATE _prisma_migrations
SET rolled_back_at = NOW(),
    finished_at = NULL,
    logs = 'Manually rolled back - missing prerequisite tables. Will retry with new migrations 20260524230000 (artifacts) and 20260526000000 (published_creatives) that create dependencies first.'
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Step 3: Verify the rollback
\echo ''
\echo '=== STEP 3: Verification (rolled_back_at should have timestamp) ==='
SELECT
    migration_name,
    rolled_back_at,
    finished_at
FROM _prisma_migrations
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Step 4: Show all recent migrations
\echo ''
\echo '=== STEP 4: Recent Migrations ==='
SELECT
    migration_name,
    finished_at,
    rolled_back_at
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 8;

\echo ''
\echo '=== SUCCESS! Migration marked as rolled back ==='
\echo 'Next step: Trigger redeploy on Render'
