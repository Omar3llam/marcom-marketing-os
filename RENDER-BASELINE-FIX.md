# Fix Render P3005 Error — One-Time Baseline

## Problem
```
Error: P3005
The database schema is not empty. Read more about how to baseline an existing production database.
```

**Root cause:** Database has tables (created by `scripts/migrate.js` or `ensureSchema()`), but Prisma doesn't know the baseline migration `20260517000000_init` was already "applied."

---

## Solution (ONE TIME ONLY)

### Step 1: Baseline on Render

Go to **Render Dashboard** → Your Service → **Shell** tab, then run:

```bash
npx prisma migrate resolve --applied "20260517000000_init"
```

**What this does:** Marks the baseline migration as "already applied" without running any SQL. Safe for production - touches ONLY the `_prisma_migrations` table.

### Step 2: Verify

```bash
npx prisma migrate status
```

Expected output:
```
1 migration found in prisma/migrations
1 migration already applied
0 migrations pending
```

### Step 3: Trigger Redeploy

Click **Manual Deploy** in Render dashboard. Build should now succeed:

```
✅ ===PRISMA MIGRATE DEPLOY===
1 migration found, 1 applied, 0 pending
✅ Build succeeded
```

---

## Why This Works

The migration file `prisma/migrations/20260517000000_init/migration.sql` is **intentionally empty** - it's a baseline marker. The actual tables were created by:
- `scripts/migrate.js` (legacy custom migration)
- Prisma models with `ensureSchema()` calls

The baseline tells Prisma: "these tables already exist, you're now in sync."

**Future migrations** will be applied normally by `npx prisma migrate deploy` in the build script.

---

## If You See P3005 Again

This should only happen once. If it recurs:
1. Check if someone reset the database without resetting migrations
2. Check if `_prisma_migrations` table exists: 
   ```sql
   SELECT * FROM _prisma_migrations;
   ```
3. Re-run the baseline command above

---

## Alternative: Local with Prod DATABASE_URL

If you can't access Render Shell:

```bash
# 1. Get DATABASE_URL from Render environment variables
# 2. Run locally:
DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied "20260517000000_init"

# 3. Trigger redeploy on Render
```

**⚠️ WARNING:** Do NOT run `prisma migrate reset` - it deletes all data.
