# Production Deployment Hotfix

## ✅ What I Fixed

### 1. Root Cause Identified
- **Migration `20260525000000_add_approval_decision_analytics` failed in production**
- Created `approval_decisions` table with foreign keys to:
  - `artifact_approvals` (doesn't exist - added in PR #36 without migration)
  - `artifacts` (doesn't exist - added in PR #27 without migration)
- Foreign key constraints failed → migration marked as FAILED → all deploys blocked

### 2. Created Missing Migrations
✅ **20260524230000_add_artifacts_and_approvals**
   - Creates `artifacts` and `artifact_approvals` tables
   - Uses `IF NOT EXISTS` for safe idempotence
   - Runs BEFORE the failed migration (timestamp-ordered)

✅ **20260526000000_add_outcome_attribution**
   - Creates `published_creatives` and `provider_performance_metrics` tables
   - Part of PR #41 (Outcome Attribution Engine)
   - Runs AFTER approval_decisions migration

### 3. Pushed to Production
✅ Merged PRs #40 + #41 to master
✅ Pushed to origin/master (commit: b17ae3f)
✅ Render will auto-deploy on next trigger

---

## 🚨 Required Action: Fix Failed Migration

**You must manually mark the failed migration as rolled back** before Render can redeploy successfully.

### Option 1: Via Render Shell (Easiest)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Navigate to your service → **Shell** tab
3. Run:
   ```bash
   npx prisma migrate resolve --rolled-back 20260525000000_add_approval_decision_analytics
   ```
4. Expected output:
   ```
   Migration `20260525000000_add_approval_decision_analytics` was marked as rolled back.
   ```

### Option 2: Direct SQL (if you have DATABASE_URL)

```bash
# Connect to production database
psql $DATABASE_URL
```

```sql
-- Verify the failed migration
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
FROM _prisma_migrations 
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Mark as rolled back
UPDATE _prisma_migrations 
SET rolled_back_at = NOW(), 
    finished_at = NULL,
    logs = 'Manually rolled back - missing prerequisite tables (artifacts, artifact_approvals). Will retry with new migrations that create these tables first.'
WHERE migration_name = '20260525000000_add_approval_decision_analytics';

-- Verify it's rolled back
SELECT migration_name, rolled_back_at, finished_at
FROM _prisma_migrations 
WHERE migration_name = '20260525000000_add_approval_decision_analytics';
-- Should show: rolled_back_at = [timestamp], finished_at = NULL

-- Exit
\q
```

### Option 3: Nuclear (only if Options 1-2 fail)

⚠️ **Only use this if you're 100% certain no data was partially written**

```sql
DELETE FROM _prisma_migrations 
WHERE migration_name = '20260525000000_add_approval_decision_analytics';
```

---

## 🚀 Deploy to Production

### Step 1: Fix the Failed Migration
Run **Option 1** or **Option 2** above ☝️

### Step 2: Trigger Redeploy on Render

**Automatic Deploy (if enabled):**
- Render will auto-detect the new master commit (b17ae3f)
- Monitor: Dashboard → Service → Events

**Manual Deploy:**
1. Go to Render Dashboard → Your Service
2. Click **"Manual Deploy"** → **"Deploy latest commit"**
3. Select branch: `master`
4. Click **"Deploy"**

### Step 3: Monitor Build Logs

Watch for migration success:
```
===PRISMA MIGRATE DEPLOY===
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "marcom_db"

3 migrations found in prisma/migrations

Applying migration `20260524230000_add_artifacts_and_approvals`
Applying migration `20260525000000_add_approval_decision_analytics`
Applying migration `20260526000000_add_outcome_attribution`

The following migration(s) have been applied:

migrations/
  └─ 20260524230000_add_artifacts_and_approvals/
  └─ 20260525000000_add_approval_decision_analytics/
  └─ 20260526000000_add_outcome_attribution/

✔ Generated Prisma Client

===VITE BUILD===
...
✅ Build succeeded
```

---

## 🔍 Verification

After successful deploy:

### 1. Check Migration Status
```bash
# Via Render Shell
npx prisma migrate status
```

Expected output:
```
Database schema is up to date!
```

### 2. Verify Tables Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'artifacts',
    'artifact_approvals', 
    'approval_decisions',
    'published_creatives',
    'provider_performance_metrics'
  )
ORDER BY table_name;
```

Should return all 5 tables.

### 3. Check Foreign Keys
```sql
SELECT
    tc.table_name, 
    tc.constraint_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'approval_decisions'
ORDER BY tc.table_name;
```

Should show 4 foreign keys:
- `approval_decisions_approvalId_fkey` → `artifact_approvals(id)`
- `approval_decisions_artifactId_fkey` → `artifacts(id)`
- `approval_decisions_executionId_fkey` → `execution_requests(id)`
- `approval_decisions_workspaceId_fkey` → `workspaces(id)`

---

## 🆘 Troubleshooting

### Migration still fails after rollback

**Symptom:** Same P3009 error after marking as rolled back

**Cause:** The prerequisite tables still don't exist in production

**Solution:**
```sql
-- Check which tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('artifacts', 'artifact_approvals', 'execution_requests', 'workspaces');
```

If any are missing, you have two options:

**Option A:** Run the new migration manually first:
```bash
psql $DATABASE_URL < prisma/migrations/20260524230000_add_artifacts_and_approvals/migration.sql
```

**Option B:** Let Prisma handle it (recommended):
- The rollback should allow the new migration to run first
- If it doesn't work, check `_prisma_migrations` table to see migration order

### Build succeeds but runtime errors

**Symptom:** Deploy succeeds, but API returns 500 errors related to database

**Cause:** Prisma Client not regenerated after schema change

**Solution:** Redeploy or run in Render Shell:
```bash
npx prisma generate
pm2 restart all  # or however you restart the Node process
```

### Rollback didn't take effect

**Symptom:** `prisma migrate resolve` says "already rolled back" but deploy still fails

**Cause:** Database state is out of sync with migration records

**Solution:**
```sql
-- Check current state
SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;

-- If the migration shows finished_at IS NOT NULL, force rollback:
UPDATE _prisma_migrations 
SET rolled_back_at = NOW(), finished_at = NULL
WHERE migration_name = '20260525000000_add_approval_decision_analytics';
```

---

## 📊 What's New in Production

After successful deploy, these features will be live:

### PR #40: Cost-Quality Optimization
- Provider routing now considers cost-per-approval
- Environment variable: `ENABLE_COST_OPTIMIZATION=true/false`
- Maximum cost limit: `MAX_COST_PER_APPROVAL=0.05` (USD)

### PR #41: Outcome Attribution Engine
- Track which artifacts are published to Meta ads
- Fetch real CTR/CPC/ROAS from Meta API
- Route based on actual business performance, not just approval rates
- Environment variable: `ENABLE_REAL_PERFORMANCE=true/false`

### New API Endpoints
- `POST /api/attribution/publish` - Track artifact → Meta ad link
- `GET /api/attribution/metrics` - Query performance by provider/capability
- `GET /api/attribution/summary` - Aggregated provider performance

### New Database Tables
- `artifacts` - AI-generated content storage
- `artifact_approvals` - Human approval workflow
- `approval_decisions` - Rich approval analytics
- `published_creatives` - Artifact → Meta ad mapping
- `provider_performance_metrics` - Real business metrics (CTR/ROAS)

---

## 📝 Prevention for Future

### Always Create Migrations for Schema Changes

**Bad (what caused this issue):**
```bash
# 1. Edit prisma/schema.prisma to add model
# 2. Git commit
# 3. Deploy → Fails because table doesn't exist
```

**Good:**
```bash
# 1. Edit prisma/schema.prisma to add model
# 2. Generate migration
npx prisma migrate dev --name descriptive_name
# 3. Git commit (includes migration SQL)
# 4. Deploy → Succeeds (migration auto-runs)
```

### Test Migrations in Staging

Before pushing to production:
1. Create a staging Render service with separate DB
2. Deploy there first
3. Verify migrations succeed
4. Then deploy to production

### Monitor Migration Health

Add this to your monitoring/alerting:
```sql
-- Check for failed migrations (run daily)
SELECT migration_name, started_at, logs
FROM _prisma_migrations 
WHERE finished_at IS NULL 
  AND rolled_back_at IS NULL
  AND started_at < NOW() - INTERVAL '1 hour';
```

If this returns any rows, you have a stuck migration.

---

## 🔗 Related Documentation

- Full guide: [DEPLOY-FIX-GUIDE.md](./DEPLOY-FIX-GUIDE.md)
- PR #40 details: [PR-40-SUMMARY.md](./PR-40-SUMMARY.md)
- PR #41 details: [PR-41-SUMMARY.md](./PR-41-SUMMARY.md)
- Prisma migration docs: https://pris.ly/d/migrate-resolve

---

## ✅ Checklist

Before declaring victory:

- [ ] Marked failed migration as rolled back
- [ ] Triggered Render redeploy
- [ ] Build logs show all 3 migrations applied successfully
- [ ] `npx prisma migrate status` returns "Database schema is up to date!"
- [ ] All 5 new tables exist in production
- [ ] API health check returns 200
- [ ] No runtime errors in Render logs
- [ ] Updated .env with new feature flags (if using them)

---

**Last updated:** 2026-05-25  
**Git commit:** b17ae3f  
**Status:** ✅ Hotfix committed and pushed to master
