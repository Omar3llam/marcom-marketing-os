# Render Deployment Fix Guide

## Problem Summary
Deployment failing with Prisma migration error P3009:
- Migration `20260525000000_add_approval_decision_analytics` failed in production
- This blocks all subsequent migrations
- Root cause: Migration references tables that don't exist yet

## Current State
- **Master branch**: Has PRs #23-#39 (commit 768bf65)
- **Feature branch**: Has PRs #40-#41 (2 commits ahead)
- **Production DB**: Has a failed migration that needs resolution

## Solution: 3-Step Process

### Step 1: Fix the Failed Migration in Production

You need to mark the failed migration as rolled back so it can retry.

**Option A: Via Render Shell (Recommended)**

1. Go to Render Dashboard → Your Service → Shell
2. Run:
   ```bash
   npx prisma migrate resolve --rolled-back 20260525000000_add_approval_decision_analytics
   ```

**Option B: Direct Database Access**

If you have the DATABASE_URL, connect via psql:

```sql
-- Check the failed migration
SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations 
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Mark it as rolled back
UPDATE _prisma_migrations 
SET rolled_back_at = NOW(), 
    finished_at = NULL,
    logs = 'Manually rolled back - will retry on next deploy'
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Verify
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations 
ORDER BY started_at DESC LIMIT 5;
```

**Option C: Delete and Retry (More Aggressive)**

```sql
-- Only use if Option A/B don't work
DELETE FROM _prisma_migrations 
WHERE migration_name = '20260525000000_add_approval_decision_analytics';
```

### Step 2: Merge PR #40 and #41 to Master

These PRs add cost optimization and outcome attribution features.

```bash
# Make sure you're on feat/pr26-executor-ai-integration
git checkout feat/pr26-executor-ai-integration

# Rebase on master to get latest changes
git fetch origin
git rebase origin/master

# If there are conflicts, resolve them, then:
# git add .
# git rebase --continue

# Push updated feature branch (may need --force-with-lease due to rebase)
git push origin feat/pr26-executor-ai-integration --force-with-lease

# Create PR on GitHub (or merge locally if you prefer)
```

**Or merge locally:**

```bash
git checkout master
git merge feat/pr26-executor-ai-integration --no-ff -m "Merge PRs #40-41: Cost Optimization + Outcome Attribution"
git push origin master
```

### Step 3: Trigger Redeploy on Render

After merging to master:

1. Go to Render Dashboard → Your Service
2. Click "Manual Deploy" → "Deploy latest commit"
3. Or wait for auto-deploy (if enabled)
4. Monitor build logs

The migration should succeed this time because:
- The rolled_back flag allows retry
- All prerequisite migrations will run in order

## Verification

After deployment succeeds:

```bash
# Check migration status
npx prisma migrate status

# Should show all migrations applied
```

## Prevention for Future

### Issue: Schema Mismatch Between Dev and Prod

The root cause is that some tables exist in the schema but weren't created via migrations. This happens when:
1. Tables are created via `ensureSchema()` in model files
2. Database is manually modified
3. Migrations are skipped during development

### Best Practices Going Forward:

1. **Always use migrations in dev**:
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

2. **Never use `ensureSchema()` for new tables** - use Prisma migrations only

3. **Test migrations in staging before prod**:
   - Create a staging environment on Render
   - Deploy there first
   - Verify migrations run cleanly

4. **Monitor migration health**:
   ```sql
   SELECT migration_name, 
          finished_at, 
          rolled_back_at,
          applied_steps_count,
          logs
   FROM _prisma_migrations 
   WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
   ```

## If Migration Still Fails

If the migration continues to fail after rollback, it means the prerequisite tables don't exist. Check production schema:

```sql
-- Check if required tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('artifacts', 'artifact_approvals', 'execution_requests', 'workspaces');
```

If tables are missing, you have two options:

**Option A: Create missing tables manually** (quick fix):
- Find the migrations that should have created them
- Run the CREATE TABLE statements manually
- Then retry the failed migration

**Option B: Reset migrations** (nuclear option, only if no prod data):
```bash
# ⚠️ DANGER: This will drop all data
npx prisma migrate reset
npx prisma migrate deploy
```

## Emergency Rollback

If the deploy breaks production:

1. **Revert on GitHub**:
   - Find the last working commit
   - Create revert PR
   - Merge to master

2. **Rollback on Render**:
   - Go to Render Dashboard → Deploys
   - Find last successful deploy
   - Click "Rollback to this version"

3. **Fix forward**:
   - Address the issue in feature branch
   - Test locally with production-like DB
   - Redeploy

## Contact

If you need help:
- Check Render logs: Dashboard → Service → Logs
- Check build logs: Dashboard → Service → Events
- Prisma docs: https://pris.ly/d/migrate-resolve
