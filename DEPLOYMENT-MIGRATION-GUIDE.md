# MARCOM Production Migration Guide

## Current authority — Backend 03A (2026-10-17)

Ordinary builds do not install dependencies, migrate, execute legacy SQL, resolve
history or verify a live database. Install separately with `npm ci --include=dev`;
`npm run build` generates Prisma Client and compiles the existing UI.
`npm run build:backend` / `build:worker` generate and run backend static checks.
Read [the 03A contract and cutover proposal](docs/BACKEND_STABILIZATION_03A.md)
before any operational action. This PR authorizes code review only.

One named, separately approved operator owns `npm run db:migrate:deploy` and,
only if explicitly required, `npm run db:migrate:legacy`. Neither command belongs
in Web/Worker build, predeploy, start or package lifecycle hooks. The old aliases
`migrate` and `build:migrate` are removed deliberately; stale live build commands
will fail rather than execute legacy DDL. No automatic retry/resolve/repair of
the current production incident is authorized.

**H-1 / NO-DEPLOY FREEZE:** Prisma 5.22.0 `migrate status` can exit 0 and say
"Database schema is up to date!" after `resolve --rolled-back`, while that
migration remains pending for deploy selection. A resolve changes history,
not schema. After a separately approved resolve, compare the exact history rows
in `_prisma_migrations` (including checksum, finished/rolled-back timestamps and
steps) with every affected object in native catalogs, including definitions,
constraints, indexes, functions/triggers, owners and privileges. A status message
alone proves neither schema presence nor readiness. Keep builds, predeploys,
manual deploys and worker rollout frozen until separate recovery/cutover approval.

The historical description below explains earlier incidents. It is not an
executable recovery approval and does not override the current contract.

## Historical migration-system introduction

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

1. Only after separate approval and proof of every existing baseline object,
   a named operator could mark a verified baseline:

```bash
# Writes migration history; does not create the missing schema
npx prisma migrate resolve --applied "20260517000000_init"
```

This tells Prisma: "The database already has these tables, don't try to create them."

2. Verify history AND native catalogs. Deployment requires separate approval.

#### ~~Option B: Automatic Handling~~ — REMOVED (B5-01Q)

This section used to say the deploy would baseline itself, on the grounds that
`20260517000000_init` "is intentionally empty (only comments)".

**That was false when it was written.** The file is 140 lines, of which 109 are
DDL: it creates `workspaces`, `users`, `oauth_tokens`, `integrations` and more.
Marking it applied does not "execute nothing" — it *skips* that DDL and asserts
the tables already exist in exactly the declared shape.

The build no longer baselines automatically. See **Baselining an existing
database** below.

### Baselining an existing database

`prisma migrate deploy` reports **P3005** when the target has schema objects but
no `_prisma_migrations` history. The deploy now stops there.

It stops because baselining is a *claim about a database nobody has inspected*.
`migrate resolve --applied` writes "succeeded" into history without reading the
schema, so a wrong baseline produces a green deploy on top of a database whose
real shape is unknown.

To baseline deliberately:

1. Determine which migration the schema **actually** corresponds to — compare it
   against `prisma/migrations/*/migration.sql`, oldest first.
2. In a shell against that database, mark that migration and every earlier one:
   ```bash
   npx prisma migrate resolve --applied "<migration it truly matches>"
   ```
3. Verify history and native catalogs, retaining the no-deploy freeze. An
   ordinary build no longer verifies a database. The explicit operator migration
   gate retains its existing schema-diff verification; that is not a native-object
   ownership/privilege certification and cannot resolve the current incident.

If the database was *meant* to be empty, the answer is not to baseline — it is to
point `DATABASE_URL` at the right database.

### A failed migration (P3009)

The deploy stops and prints `prisma migrate status` plus the procedure. It does
**not** resolve anything for you.

Before B5-01Q it did, against a hard-coded migration name. Measured on a
disposable copy with that migration genuinely failed and its table dropped: the
build exited **0**, history recorded 66/66 applied, `migrate status` said
*"Database schema is up to date!"* — and the table was still missing. Five
modules read it.

The recovery did not repair anything; it erased the evidence that anything was
wrong. Resolve a failed migration only after checking the database for every
object its SQL creates. See `scripts/prisma-migrate-safe.js` and
`src/tests/productionMigrationSafety.test.js`.

### Future Deployments

After independent review and a separately approved operational plan:

1. Developer creates migration locally:
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

2. Commit migration files to git:
   ```bash
   git add prisma/migrations/
   git commit -m "feat(db): add new table for feature X"
   ```

3. A single named migration operator may run the explicit gate, against the
   approved direct target, after backup/recovery and compatibility checks:
   ```bash
   npm run db:migrate:deploy
   ```

4. Record postconditions before either service's separately approved rollout.
   Builds never perform this operation, and no #578 deployment is approved here.

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

Freeze deployment on migration failure. Preserve history, logs and native state;
obtain a separate recovery decision. `resolve --rolled-back` does not undo SQL
and can make the same migration eligible to run again (H-1). Never run `migrate
dev` against production or assume reverting code restores schema.

03A rollback is a code/artifact rollback only, with pure build settings retained
on BOTH services. Reverting package.json to a migration-bearing build is unsafe.
No destructive down migration, object drop, history rewrite or automatic restore
is part of rollback. A database restore requires separately approved recovery,
writer quiescence and a verified backup; see the 03A proposal.

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
