# MARCOM v4.1 — Claude Code Project Guide
**Last updated: post-Firebase migration, post-dual-agent, post-Prisma**

> Full architecture: see MARCOM-ARCHITECTURE.md  
> Design system: see MARCOM-DESIGN-BIBLE.md  
> This file: quick reference for Claude Code sessions

---

## Current Stack

### Frontend
- React 18 + Vite + Tailwind CSS + shadcn/ui (select components)
- Firebase Auth (NOT Clerk — Clerk was removed)
- Axios via `client/src/lib/api.js` (the ONLY API client)
- FSM state machine: `client/src/hooks/useDecisionFSM.js`

### Backend
- Node.js 22 + Express + ES Modules
- Prisma + PostgreSQL (NOT MongoDB, NOT Airtable)
- BullMQ + Redis (async job queue)
- Firebase Admin SDK (token verification)
- Anthropic Claude + OpenAI GPT (dual-agent)

---

## Entry Points

```
client/src/main.jsx        → React app root
client/src/App.jsx         → Router + route definitions
src/server.js              → Express app + all route mounting
prisma/schema.prisma       → Database schema (source of truth for models)
```

---

## Auth Model (Firebase, NOT Clerk)

**Frontend:**  Firebase SDK → `auth.currentUser.getIdToken()`  
               Axios interceptor in `api.js` attaches token automatically  
**Backend:**   `src/middleware/firebaseAuth.js` → `req.user` + `req.workspaceId`  
**Protected:** `requireAuth` on all `/api/*` (see `server.js` for exceptions)

**NEVER use `clerkAuth.js` — it is a dead file from v1.**

---

## The ONE WAY ONLY Rules (summary — full laws in ARCHITECTURE.md)

**API calls:**     `api.get`/`post` via `client/src/lib/api.js` ONLY  
**State:**         `useState` / `useReducer` / Context ONLY (no Redux/Zustand)  
**Styling:**       Semantic tokens from `design-system/tokens/` ONLY (no `bg-gray-*`)  
**AI calls:**      `src/agents/orchestrator.js` ONLY (not `services/orchestrator.js`)  
**Sessions:**      `src/utils/sessionStore.js` (active sessions, `master.js`)  
**Memory:**        `src/utils/memoryStore.js` (Anthropic Memory API, `lumi.js`)  
**History:**       `src/models/chatSession.js` (chat history, `history.js`)

---

## PR Base Rule (operational requirement, not advice)

> **Every PR must be based on `master` unless explicitly approved otherwise.**
> **After reporting a PR as merged, verify that its changes are present on `origin/master`.**
> **A GitHub "merged" status alone is not sufficient evidence.**

**Stacking is forbidden by default.** A PR based on another PR's branch merges
safely only if the CHILD merges FIRST — and merges here happen in review order,
not dependency order. If a stack is genuinely unavoidable, say so **explicitly in
the PR body** and state that the child must merge first.

Avoiding a merge conflict is **not** an approved reason to stack. Resolving one
conflict later is cheaper than a silently orphaned merge.

### Verify, every time

```bash
npm run check-orphans            # all recently merged PRs → is their code on master?
```

Or for one PR, read the file off the trunk — never trust the badge:

```bash
git fetch origin
git show origin/master:<a-file-the-PR-changed> | grep -q "<a-string-it-added>" \
  && echo ON-MASTER || echo ORPHANED
```

**Do NOT verify with commit ancestry.** `git merge-base --is-ancestor <mergeCommit> master`
gives false positives — a stacked child's content can reach master through its
parent's merge, and a squash merge rewrites the SHA entirely. SHA identity
answers "did this commit travel"; the question is "is this CODE on master".

**Why this is a rule:** PR #344 merged into `fix/reallocate-actionability` 21
minutes after that branch had itself merged into master. Both PRs showed
"Merged"; master received one of them. Render deploys master, so the other never
shipped and nothing said so — found only because a human asked why a deploy had
not happened. See `scripts/check-orphaned-prs.js`.

---

## Critical Files

### Frontend

```
client/src/lib/api.js              — Axios client with Firebase token interceptor
client/src/hooks/useDecisionFSM.js — 8-state FSM (the brain of the UI)
client/src/hooks/useCampaignFeed.js — Campaign data fetching hook
client/src/pages/DecisionFeed.jsx  — Main FSM container page
client/src/context/AuthContext.jsx — Firebase auth state
```

### Backend

```
src/server.js                      — All routes mounted here
src/routes/lumi.js                 — Campaign feed, orchestration, rollback
src/routes/campaigns.js            — CSV upload, Meta fetch, context
src/routes/execution.js            — Meta action execution (4-layer guards)
src/agents/orchestrator.js         — CANONICAL dual-agent (Claude + GPT)
src/utils/csvParser.js             — CSV parsing with BOM removal, EGP handling
prisma/schema.prisma               — DB schema
```

---

## Deprecated / Dead Files (DO NOT IMPORT)

```
src/middleware/clerkAuth.js   → LEGACY. Still used by auth/meta.js
                                 Replace with firebaseAuth.js when refactoring OAuth
src/models/userContext.js     → LEGACY. Still used by project.js
                                 Replace with campaigns/me/context route
src/utils/scraper.js          → Check if still used before touching.
```

**WARNING:** Files marked LEGACY are not truly dead — they have active imports.
Check `arch-check.js` output or `git grep` before deleting.

---

## Commands

```bash
# Development
npm run dev                         # start server (src/server.js)
cd client && npm run dev            # start frontend (Vite)

# Frontend only
cd client && npm run lint           # ESLint with design system rules
cd client && npm run build          # production build (bundle < 700KB target)

# Database
npx prisma studio                   # visual DB browser
npx prisma migrate dev              # run new migrations
npx prisma generate                 # regenerate client after schema change

# Testing — see "Verification" below for what each one proves
npm test                            # = test:fast
npm run test:fast                   # backend suite; DB-backed suites MAY skip
npm run test:full                   # backend suite; DB-backed suites MUST run
npm run test:http                   # 13 HTTP cases vs a running server (NOT the suite)
node src/tests/dialect.test.js      # standalone node script, excluded from vitest
```

---

## Verification

Two commands, **one suite**. The difference is not which tests run — it is which
claim the command is allowed to make.

| Command | `REQUIRE_DB` | DB-backed suites | Claim |
|---|---|---|---|
| `npm test` / `npm run test:fast` | unset | may skip | *nothing about database semantics* |
| `npm run test:full` | `1` | **must execute** | database semantics were verified |

Both run the same vitest discovery (`vitest.config.js` → `src/**/*.test.js` +
`packages/**/*.test.js`). `test:full` is `test:fast` plus a requirement; it is
**not** a separate file list.

### Fast verification

```bash
npm test
```

Runs the backend suite. With no migrated database configured, the 27 DB-gated
suites skip and the run still exits 0. **That is a valid result for a fast loop
and is not evidence that database behaviour works.**

### Full verification

Requires PostgreSQL and one environment variable:

```bash
# Point at a database name on any reachable server. It does NOT need to exist,
# and nothing is ever run against it directly — it is the naming root and the
# admin connection. The credentials need CREATEDB.
export TEST_DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/marcom_verify"

npm run test:full
```

That is the whole flow. `test:full` provisions the databases itself:

```
TEST_DATABASE_URL  →  marcom_verify_tmpl    created + `prisma migrate deploy`  (~3s, once)
                   →  marcom_verify_w1..wN  CREATE DATABASE … TEMPLATE         (~360ms each)
                                            one per vitest worker
```

Every worker gets **its own physical database**, so two test files running in
parallel cannot see, delete, update, or collide with each other's rows. All of
them are dropped on teardown, including after a failure.

`DIRECT_URL` no longer needs setting by hand — the provisioner passes it to
`migrate deploy` itself. (It is genuinely required there: `migrate deploy` fails
with P1012 without it, despite the comment at `schema.prisma:29` claiming it
falls back to `DATABASE_URL`. It does not.)

On Windows PowerShell use `$env:TEST_DATABASE_URL = "…"` — the `VAR=value cmd`
form is POSIX-only. `test:full` itself is cross-platform; it sets `REQUIRE_DB`
through `scripts/run-tests.js` rather than through shell syntax.

**`TEST_DATABASE_URL` may not name your development database.** Full
verification drops and recreates databases derived from it, so it refuses to
start if it resolves to the same PostgreSQL identity (host + port + name) as
`DATABASE_URL` — comparing identity, not the string, so different credentials
on the same database are still caught.

### Failure semantics

`test:full` with an unusable database is a **verification failure**, not a
graceful fallback:

```
DatabaseVerificationRequiredError: REQUIRE_DB=1 but no migrated database is
reachable, so this suite cannot be verified.
```

Non-zero exit. It does **not** degrade to fast mode. This is the point of the
command: B5-Discovery-03 measured a real data-corruption defect (timestamps
three hours adrift; a repeated revenue upload inserting a duplicate row instead
of updating one) surviving a fast run that reported `4631 passed | 330 skipped`
and exit 0.

### What full verification still does NOT prove

Open findings from B5-Discovery-03, deliberately not closed by B5-01G:

- **STOP-2** — the probe answers "available" for a database missing 11
  migrations. It checks one column (`workspaces.networkConsent`, added June
  2026), not migration completeness.
- **STOP-3** — the full suite is not deterministic: a vitest forks-pool worker
  still crashes in roughly 3 of 10 runs, dropping tests with exit 1 and a
  reduced "passed" count rather than a named failure. This is a pool-level
  crash, unrelated to database state; B5-01H did not address it.
- ~~**STOP-4** — cross-suite database mutation~~ — **CLOSED by B5-01H.** Every
  worker holds its own database, so no suite's cleanup predicate or hard-coded
  identity can reach another's rows. Fast mode is unchanged and still shares
  the ambient database if one is configured, which is a further reason a
  verification claim belongs to `test:full`.
- GitHub Actions has been blocked by billing since 2026-08-23, so **no CI run
  has executed** for any B5 slice. `npm run test:full`, run by hand, is
  currently the only backend verification that exists.

---

## Prisma Models (source of truth)

```
User              → workspace membership, Firebase UID
Workspace         → the company/account unit
Decision          → what Lumi decided, and its provenance
MetricSnapshot    → one observation of an entity over a declared window
ExecutionRequest  → the platform-mutation lifecycle
```

**Retired, still in the schema** (S1-B — no runtime readers or writers; model
removal is a separate schema slice):

```
CampaignState     → writer deleted in R7, last reader removed in S1-B
Action            → zero writers; one diagnostic row count on /lumi/_health
DecisionMemory    → no production code touches this model at all
```

Full schema: `prisma/schema.prisma`

---

## Forbidden Patterns (enforced by lint + CI)

```javascript
// ❌ Direct fetch — always use api client
fetch('/api/anything')

// ❌ Raw axios — always use api client
await axios.post('/api/execute/meta', payload)

// ❌ Import deprecated orchestrator
import from '../services/orchestrator.js'

// ❌ Prisma in loops (N+1)
for (const x of items) { await prisma.model.create(...) }

// ❌ useEffect without cleanup
useEffect(() => { api.get('/x').then(setState); }, [])

// ❌ Raw hex or gray-* in JSX (use design tokens)
className="bg-gray-900 text-white #F6C945"
```

---

## File Size Budget

```
Page component:    max 300 lines
Route file:        max 400 lines
Hook:              max 200 lines
UI primitive:      max 150 lines
Context:           max 100 lines
```

---

## AI Prompt Requirements

Every prompt must include:

- **MAX_FILES_TO_MODIFY**
- **PROOF_BEFORE_PATCH**
- **NO_SCOPE_CREEP**
- **NO_SILENT_SUCCESS**
- **ATOMIC**
- **AUDIT_MISMATCH_RULE**

---

## Dead Code Register
**Maintained by: Architecture Check CI (scripts/arch-check.js)**  
**Last audit: 2026-07-06** (Wave 5 PR-11: deleted the `pages/v2` decision strangler + `types/fsm.ts`)

| File | Status | Reason | Imports | Safe to delete? |
|---|---|---|---|---|
| `src/middleware/clerkAuth.js` | DEAD | Firebase replaced Clerk (auth/meta.js now uses firebaseAuth) | 0 | YES — verified zero imports |
| `src/models/userContext.js` | LEGACY | Replaced by /api/campaigns/me/context | 1 (project.js) | NO — refactor project.js first |
| `client/src/pages/AuthPage-Clerk-BACKUP.jsx` | DEAD | Backup from Clerk → Firebase migration | 0 | YES — backup file, not in routes |
| `client/src/pages/PlaceholderPage.jsx` | STUB | Placeholder, not in App.jsx routes | 0 | YES — verify not in router first |
| ~~`client/src/pages/v2/` + `client/src/types/fsm.ts`~~ | ✅ DELETED (PR-11) | v2/decision strangler never activated (features.newDecisionView=false); route + dir + FSM types removed | 0 | DONE |
| `client/src/config/routes.ts`, `config/features.ts`, `components/dev/ComparisonHarness.tsx` | DEAD (residual) | Remaining strangler infra: routes.ts/getActiveRoute have **zero importers**; features flags are all false; ComparisonHarness only mentions the deleted v2 view in comments | 0 | YES — next strangler-cleanup PR (left out of PR-11 to keep it scoped) |

### Deletion Protocol

**Never delete without:**
1. Running `grep -rn "filename" src/ client/src/` to confirm zero imports
2. Checking `npm run arch-check` passes after deletion
3. Testing `npm run build` (frontend) or `npm run check` (backend) passes
4. Separate commit per deletion with reason in message
5. Git blame to understand why file was created (avoid deleting active experiments)

**Sprint cleanup target:**  
Delete verified dead files (0 imports, DEAD status) every 2-week architecture sprint.

**Refactor target:**  
Convert DEPRECATED/LEGACY files to new canonical equivalents, then delete.
- ~~`services/orchestrator.js` → `agents/orchestrator.js`~~ ✅ COMPLETED & DELETED — all importers (paidController, campaigns, syncWorker) migrated to `agents/orchestrator.js`; the deprecated file was removed in the pre-Phase-6 cleanup. The compatibility methods (`analyzeRadarData`, `analyzeCampaignData`, `healthCheck`) now live on `agents/orchestrator.js`.
- ~~`clerkAuth.js` → `firebaseAuth.js`~~ ✅ COMPLETED (auth/meta.js refactored)
- `userContext.js` → API route (1 model file to refactor)

---

## CSV Removal — Option A (completed, phases 1–5)

The system is now **connector-only** for all user-facing data ingestion. CSV upload is fully gone from every user-facing surface.

- `CsvConnector`, `csvNormalize` — DELETED (Phase 1, PR #163)
- `POST /api/campaigns/upload-csv` + upload modal/button — DELETED (Phase 2, PR #164)
- `POST /api/campaigns/data-inject` + `POST /api/v1/paid/analyze` — DELETED (Phase 3, PR #165)
- CSV copy / messaging across landing, empty states, CTAs — REMOVED (Phase 4, PR #166)
- `UploadCSVResponse` / `UploadCSVError` types + `mockUploadCSVResponse` fixture — DELETED (Phase 5, this PR). `FetchMetaResponse` promoted from a CSV alias to a standalone live-contract interface.

### ~~Intentionally kept (Option A)~~ — SUPERSEDED by S1-B

The paragraph here described the legacy `CampaignState` feed substrate as
"deliberately preserved" and named `temporalObserver` as its writer. **Both
statements were already false when written**: R7 had deleted `temporalObserver`,
leaving the model structurally unwritable, and the readers were not preserving a
feature — they were reading a table nothing could fill.

**S1-B removed the backend half.** `GET /api/lumi/feed` no longer publishes a
`campaigns` array, the agent context block is gone, and `POST
/lumi/orchestrate/:campaignId` plus the dual-agent `runOrchestration` behind it
are deleted. See "Retired, still in the schema" above.

**Still open, deliberately:**

- `client/src/hooks/useCampaignFeed.js` and the two contexts that read
  `feed.campaigns` — the field is gone from the response; both already default
  to `[]`, so nothing breaks, but the empty state they render now means "this
  field no longer exists" rather than "you have no campaigns". Frontend was
  out of scope for S1-B.
- `src/utils/csvParser.js` — no production importer.
- The `CampaignState` / `Action` / `DecisionMemory` **models** — schema slice.
