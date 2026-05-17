# MARCOM Production Migration Guide

## ⚠️ CRITICAL: First Deployment After Migration System Implementation

### Background

**BEFORE THIS CHANGE:**
- Production used `prisma db push --accept-data-loss` (DANGEROUS)
- Could drop tables/columns silently
- No migration history
- No rollback capability

**AFTER THIS CHANGE:**
- Production uses `prisma migrate deploy` (SAFE)
- Migrations are tracked and versioned
- Changes are auditable
- Rollback is possible

### First Deployment Steps

The production database already has tables created by the old `db push` system. We need to mark the baseline migration as "already applied" so Prisma doesn't try to recreate existing tables.

#### Option A: Manual Resolution (Recommended for First Deploy)

1. **Before deploying the new code**, connect to production database and run:

```bash
# Mark the baseline migration as applied (doesn't execute SQL)
npx prisma migrate resolve --applied "20260517000000_init"
```

This tells Prisma: "The database already has these tables, don't try to create them."

2. **Deploy the new code** — future deployments will work automatically.

#### Option B: Automatic Handling (If Manual Resolution Not Possible)

The baseline migration (`20260517000000_init`) is intentionally empty (only comments). If `prisma migrate deploy` runs on first deploy:
- It will see the migration as "pending"
- It will "apply" it (but no SQL executes since the file is empty)
- Future migrations will work correctly

**Result:** Both approaches are safe. Option A is cleaner.

### Future Deployments

After the first deployment, all future deployments work automatically:

1. Developer creates migration locally:
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

2. Commit migration files to git:
   ```bash
   git add prisma/migrations/
   git commit -m "feat(db): add new table for feature X"
   ```

3. Deploy to production — `npm run build` automatically runs:
   ```bash
   npx prisma migrate deploy
   ```

## Migration Best Practices

### DO ✅

- **Always create migrations for schema changes**
  ```bash
  npx prisma migrate dev --name add_column_x
  ```

- **Test migrations locally before deploying**
  - Verify migration SQL is correct
  - Check for data loss warnings
  - Ensure rollback strategy exists

- **Make migrations backward-compatible when possible**
  - Add columns as nullable first, backfill data, then make NOT NULL
  - Use `IF NOT EXISTS` for additive changes
  - Avoid dropping columns until confirmed unused

- **Keep migrations idempotent**
  - Use `CREATE TABLE IF NOT EXISTS`
  - Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  - Use `CREATE INDEX IF NOT EXISTS`

### DON'T ❌

- **Never use `prisma db push` in production**
  - It's not tracked
  - It can lose data
  - Reserved for local prototyping only

- **Never edit existing migration files**
  - Migrations are immutable once deployed
  - Create a new migration to fix issues

- **Never use `--force` or `--skip-generate` in production**
  - These flags bypass safety checks

- **Don't create migrations without testing them**
  - Always run locally first
  - Verify the generated SQL

## Rollback Strategy

If a migration fails in production:

1. **Immediate fix** (if migration was partially applied):
   ```bash
   # Mark as rolled back
   npx prisma migrate resolve --rolled-back "20260517_bad_migration"
   
   # Deploy a new migration that reverts the changes
   npx prisma migrate dev --name revert_bad_migration
   ```

2. **Redeploy previous version** (if deployment failed):
   - Git revert the commit with the bad migration
   - Redeploy
   - Previous schema state will be restored

## Development Workflow

### Local Development (Rapid Prototyping)

When experimenting locally, you CAN still use `db push`:

```bash
# Make schema changes in schema.prisma
# Then sync to local DB without creating a migration
npx prisma db push
```

**⚠️ This is ONLY for local experimentation. Once you're ready to commit, create a proper migration:**

```bash
# Create migration from your changes
npx prisma migrate dev --name my_feature
```

### Creating a Migration

1. **Edit `prisma/schema.prisma`** with your changes

2. **Generate migration**:
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

   This will:
   - Generate SQL in `prisma/migrations/[timestamp]_descriptive_name/`
   - Apply it to your local database
   - Regenerate Prisma Client

3. **Review the generated SQL**:
   - Open `prisma/migrations/[timestamp]_descriptive_name/migration.sql`
   - Verify it's correct
   - Check for destructive operations (DROP, data loss)

4. **Test the migration**:
   - Run your app locally
   - Verify everything works
   - Run tests

5. **Commit and deploy**:
   ```bash
   git add prisma/migrations prisma/schema.prisma
   git commit -m "feat(db): descriptive commit message"
   git push
   ```

## Troubleshooting

### Migration fails with "Table already exists"

**Cause:** The baseline migration wasn't marked as applied.

**Fix:**
```bash
npx prisma migrate resolve --applied "20260517000000_init"
npx prisma migrate deploy
```

### Migration fails with "Column already exists"

**Cause:** An `ensureSchema()` function created the column before the migration ran.

**Fix:** Migrations should use `IF NOT EXISTS`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_column TEXT;
```

### Can't connect to database during build

**Cause:** `DATABASE_URL` not set or unreachable.

**Effect:** Build will fail loudly (this is intentional and safe).

**Fix:** Verify `DATABASE_URL` is correct in Render dashboard.

## Emergency: Revert to Old System (NOT RECOMMENDED)

If you MUST revert to the old dangerous `db push` system:

```bash
# In package.json, change:
npx prisma migrate deploy

# Back to:
npx prisma db push --skip-generate --accept-data-loss
```

**⚠️ This is NOT recommended. Only do this if:**
- Production is completely broken
- Migrations are fundamentally incompatible with your setup
- You have a plan to fix properly later

## Summary

| Aspect | Old System (DANGEROUS) | New System (SAFE) |
|--------|----------------------|-------------------|
| Production command | `prisma db push --accept-data-loss` | `prisma migrate deploy` |
| Data loss risk | ❌ HIGH | ✅ LOW |
| Rollback | ❌ Impossible | ✅ Possible |
| Audit trail | ❌ None | ✅ Full history |
| First deploy | N/A | Run `prisma migrate resolve --applied "20260517000000_init"` |
| Future deploys | Automatic (but risky) | Automatic (safe) |

**The new system is production-grade and follows industry best practices.**
