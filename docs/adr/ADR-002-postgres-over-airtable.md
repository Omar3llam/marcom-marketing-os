# ADR-002: PostgreSQL + Prisma over Airtable

**Status:** ✅ Accepted  
**Date:** Sprint 3 (v3.5 → v4.0)  
**Deciders:** Engineering team + cost analysis

## Context

MARCOM v1-v2 used **Airtable** as the primary database for:
- User sessions (`marcom_sessions` table)
- Campaign states (`marcom_campaigns` table)
- User context (`marcom_user_context` table)
- Decision memory (`marcom_decisions` table)

Airtable was chosen initially because:
- Low-code setup (no migrations, no schema management)
- Built-in UI for non-technical stakeholders to view data
- Fast prototyping (Airtable API is REST-based and simple)

However, as we scaled to 500+ campaigns and 50+ users, we hit Airtable's limits:
1. **5 requests/second rate limit** — our radar feed was fetching 20 campaigns/second, causing 429 errors
2. **No transactions** — we had race conditions when updating campaign state + decision memory simultaneously
3. **No relations enforcement** — orphaned records when users were deleted but their campaigns remained
4. **$50/month cost** — Airtable Pro plan required for API access, but we still hit rate limits
5. **No complex queries** — filtering by multiple conditions required client-side JS (slow, memory-intensive)

The question: **Migrate to a real database or optimize Airtable usage?**

## Decision

**Migrate to PostgreSQL** with **Prisma ORM** for all persistent data.

Key changes:
- Replace `src/utils/airtable.js` with `src/lib/prisma.js`
- Migrate all Airtable tables to Prisma models (`User`, `Workspace`, `CampaignState`, `Action`, `DecisionMemory`)
- Use Prisma transactions for atomic operations (e.g., `decision commit → update campaign → log action`)
- Keep `airtable.js` as a legacy fallback (marked DEAD, but not deleted yet)

## Rationale

### Why PostgreSQL?

1. **Transactions**: Prisma's `$transaction` ensures atomicity — if a decision commit fails, the campaign state doesn't update
2. **Relations**: Foreign keys prevent orphaned data (`ON DELETE CASCADE` when a user is deleted)
3. **Performance**: 10x faster queries — Airtable took ~800ms to fetch 20 campaigns, Postgres + Prisma takes ~80ms
4. **No rate limits**: PostgreSQL can handle 1000+ queries/second (vs. Airtable's 5/second)
5. **Cost**: Render PostgreSQL free tier is enough for <10GB data (vs. Airtable's $50/month)
6. **Type safety**: Prisma generates TypeScript types from schema — no runtime errors from missing fields

### Why Prisma ORM?

- **Schema-first**: `prisma/schema.prisma` is the single source of truth (vs. scattered Airtable field configs)
- **Migrations**: `prisma migrate` handles schema changes safely (Airtable required manual field addition)
- **Auto-generated client**: `npx prisma generate` creates type-safe query methods (no raw SQL)
- **Developer experience**: IntelliSense for all models, auto-complete for relations

### Why NOT stay with Airtable?

- Airtable is excellent for internal tools and prototypes, but NOT for production SaaS
- We were using <10% of Airtable's features (no forms, no automations, no views) — paying for a spreadsheet UI we didn't need
- Rate limits are non-negotiable — Airtable Enterprise ($100+/month) still caps at 10 req/sec

## Consequences

### Positive

✅ **10x query performance**: Campaign feed loads in 80ms (was 800ms)  
✅ **Transactions**: Atomic decision commits — no more orphaned records  
✅ **Foreign keys**: Cascade deletes prevent data integrity issues  
✅ **No rate limits**: Can handle 1000+ campaigns without 429 errors  
✅ **Type safety**: Prisma Client catches schema mismatches at compile-time  
✅ **Cost reduction**: $50/mo → $0 (Render free tier)  
✅ **Migrations**: Schema changes are versioned, reversible, and testable

### Negative

❌ **Migration effort**: 2 sprints to migrate 4 tables + 500 campaigns  
❌ **Lost Airtable UI**: Stakeholders can no longer view data in Airtable — had to build internal admin panel  
❌ **Learning curve**: Team needed to learn Prisma schema syntax and migration workflow  
❌ **DevOps complexity**: Now we manage a PostgreSQL instance (Airtable was fully managed)  
❌ **No live collaboration**: Airtable had real-time updates — Postgres requires polling or WebSockets  
❌ **Schema rigidity**: Airtable let us add fields on-the-fly — Prisma requires migrations for schema changes

### Migration debt repaid

We kept `src/utils/airtable.js` for 2 sprints after migration as a **fallback** in case Postgres had issues. It was never used in production and is now marked **DEAD** in the dead code register.

## Evidence in Code

**Prisma schema (canonical):**
```
prisma/schema.prisma
  → 5 models: User, Workspace, CampaignState, Action, DecisionMemory
  → Foreign keys: user → workspace, campaignState → workspace
  → Indexes on workspaceId, clerkId, createdAt
```

**Prisma client usage:**
```
src/lib/prisma.js
  → Singleton PrismaClient instance
  → Used by all routes: campaigns.js (10 calls), lumi.js, execution.js
```

**Session store (PostgreSQL):**
```
src/utils/sessionStore.js
  → Replaced Airtable-based session management
  → Uses Prisma for session CRUD
```

**Dead Airtable code:**
```
src/utils/airtable.js
  → Marked LEGACY / FALLBACK
  → Zero imports (verified by arch-check.js)
  → Safe to delete
```

## Alternatives Considered

### 1. MongoDB + Mongoose
- **Pro**: Flexible schema (like Airtable), good for rapid prototyping
- **Con**: No foreign keys, no transactions (until MongoDB 4.0+), weaker type safety

### 2. Supabase (Postgres + REST API)
- **Pro**: Postgres backend + auto-generated REST API (like Airtable)
- **Con**: Another vendor lock-in, pricing similar to Airtable at scale, less control

### 3. MySQL + Sequelize
- **Pro**: Mature ecosystem, widely supported
- **Con**: Sequelize ORM is less type-safe than Prisma, no schema-first workflow

### 4. Stay with Airtable + caching layer
- **Pro**: No migration effort
- **Con**: Band-aid solution — rate limits would still block high-traffic features

### 5. Firebase Realtime Database
- **Pro**: Real-time updates, simple API
- **Con**: NoSQL (no joins, no complex queries), expensive at scale, poor querying

## Migration Strategy

We used a **dual-write, gradual cutover** approach:

1. **Sprint 1**: Create Prisma schema, run initial migration, backfill Airtable data into Postgres
2. **Sprint 2**: Update routes to write to BOTH Airtable and Postgres (dual-write)
3. **Sprint 3**: Flip feature flag to read from Postgres, verify data consistency
4. **Sprint 4**: Remove Airtable writes, mark `airtable.js` as DEAD

This minimized downtime — we could rollback to Airtable at any point during Sprints 1-3.

## Rollback Plan

If PostgreSQL proves unreliable, we can rollback in ~1 sprint:
1. Re-enable Airtable writes in all routes
2. Backfill Postgres data into Airtable (reverse sync)
3. Flip feature flag to read from Airtable
4. Drop Postgres tables (but keep Prisma schema for future attempt)

**Likelihood of rollback:** <1% — PostgreSQL has been stable for 6 months post-migration, no incidents.

## Performance Benchmarks

| Operation | Airtable (v2) | Postgres + Prisma (v4) | Improvement |
|---|---|---|---|
| Fetch 20 campaigns | 800ms | 80ms | **10x faster** |
| Create decision + update campaign | 1200ms (2 API calls) | 150ms (1 transaction) | **8x faster** |
| Count campaigns by workspace | 600ms (client-side filter) | 15ms (SQL COUNT) | **40x faster** |
| Delete user + cascade campaigns | Not possible (manual cleanup) | 50ms (ON DELETE CASCADE) | **Integrity enforced** |

## Related ADRs

- None (this is the foundational database decision)
