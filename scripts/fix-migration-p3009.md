# Fix Failed Migration P3009

## Problem
Migration `20260525000000_add_approval_decision_analytics` failed and locked the database.

## Solution

### Option A: Manual Fix (Recommended for Production)

1. **Connect to production database**:
   ```bash
   # Get DATABASE_URL from Render environment variables
   psql $DATABASE_URL
   ```

2. **Check migration status**:
   ```sql
   SELECT * FROM _prisma_migrations 
   WHERE migration_name = '20260525000000_add_approval_decision_analytics';
   ```

3. **Mark migration as rolled back**:
   ```sql
   UPDATE _prisma_migrations 
   SET rolled_back_at = NOW(), 
       finished_at = NULL 
   WHERE migration_name = '20260525000000_add_approval_decision_analytics';
   ```

4. **Redeploy** - the migration will retry automatically

### Option B: Using Prisma CLI (if you have direct DB access)

```bash
# Mark as rolled back
npx prisma migrate resolve --rolled-back 20260525000000_add_approval_decision_analytics

# Deploy all pending migrations
npx prisma migrate deploy
```

## Prevention

The migration failed because it references tables that don't exist yet. The proper fix is to merge all feature branch commits to master so migrations run in order.
