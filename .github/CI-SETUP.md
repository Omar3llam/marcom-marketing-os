# CI/CD Setup

This document covers MARCOM's CI/CD pipeline configuration — workflow files, manual repo settings, and the technical-debt inventory that the gate currently flags.

## Workflows

| File | Triggers | Purpose |
|---|---|---|
| `.github/workflows/architecture-check.yml` | PR / push to `master` | Token-discipline lint, architecture audit, security audit, bundle-size budget |
| `.github/workflows/tests.yml` | PR / push to `master` | Backend + package contract tests, frontend tests |

Both workflows use a single root `npm ci` (workspace-aware install) instead of two separate `cd client && npm install` steps. Cache key is `package-lock.json` at the repo root — the only authoritative lockfile after PR #8.

## Status (post-restore)

> ⚠ **CI is red on first run.** The original architecture-check workflow targeted `main` (the repo's default branch is `master`), so it never actually executed on any PR. That meant ~19 architecture violations and 12+ lint violations accumulated silently. This PR turns the lights back on. The list below is the cleanup backlog.

Tests + build + bundle-size pass cleanly. Lint and arch-check fail.

## Cleanup backlog (priority order)

### Tier 1 — security / data integrity

These are the highest-risk debt items; fix first.

- [ ] **Possible N+1 Prisma query in `src/services/temporalObserver.js`** — convert to `createMany` / `updateMany`
- [ ] **Forbidden import of dead `userContext.js`** in `src/routes/context.js` and `src/routes/master.js` — replace with `/api/campaigns/me/context` route
- [ ] **Forbidden import of deprecated `services/orchestrator.js`** in `src/workers/syncWorker.js` — migrate to `agents/orchestrator.js`

### Tier 2 — my-PR debt (route file bloat)

Introduced during the Operations panel build-out (PRs #2, #3, #4, #5).

- [ ] **`src/routes/execution.js` = 1155 lines (max 400)** — split into endpoint-shaped modules:
  - `src/routes/execution/index.js` — router mount + middleware
  - `src/routes/execution/meta.js` — POST /meta
  - `src/routes/execution/audit.js` — GET /audit
  - `src/routes/execution/active.js` — GET /active
  - `src/routes/execution/reconciliation.js` — GET /:id/active
  - `src/routes/execution/transitions.js` — GET /:id/transitions
  - `src/routes/execution/incident.js` — GET /:id/incident
  - `src/routes/execution/retry.js` — POST /:id/retry
  - `src/routes/execution/vitals.js` — GET /vitals
- [ ] **`src/routes/execution.test.js` = 826 lines (max 400)** — split alongside the route file (test file per endpoint module)

### Tier 3 — pre-existing route bloat

- [ ] **`src/routes/campaigns.js` = 735 lines (max 400)** — pre-existing; split by feature area

### Tier 4 — token-discipline (`marcom-ds/no-generic-tailwind`)

Pre-existing lint debt across several pages. Files with violations:

- `client/src/pages/OnboardingPage.jsx` — raw hex `#0F0F0F` at line 165, plus typography role violations
- `client/src/pages/tools/SocialCalendar.jsx` — `text-3xl`
- `client/src/pages/tools/ScoreContent.jsx` — `text-2xl`, `text-3xl`
- `client/src/pages/Settings.jsx` — `text-3xl`, `text-gray-600`
- `client/src/pages/CampaignAnalysis.jsx` — `text-xl`, `text-2xl`
- Other pages with `text-xl` / `text-2xl` / `text-3xl` / `text-gray-*`

Fix: replace generic Tailwind text classes with design-system typography roles (`metric-display`, `decision-title`, `radar-label`, etc.) and replace raw hex with design tokens. See `client/design-system/tokens/` for the canonical list.

### Tier 5 — known-failing backend tests (excluded from CI)

The `Tests` workflow excludes `src/tests/` because of pre-existing failures:

| File | Failures | Reason |
|---|---|---|
| `src/tests/dialect.test.js` | 1 | Pre-existing edge-case failure in dialect resolver |
| `src/tests/resilience.integration.test.js` | 3 | Circuit breaker tests expect orchestrator API state that has since changed |

Once fixed, **remove the exclusion** in `tests.yml`: change the `run:` line to `npx vitest run src packages/runtime-contracts`.

## Manual setup (one-time, by repo admin)

### 1. Branch protection on `master`

GitHub UI: **Settings → Branches → Add branch protection rule → master**.

Recommended toggles (apply once the cleanup tiers above land and CI goes green):

- [x] Require a pull request before merging
  - [x] Require approvals: **1**
  - [x] Dismiss stale approvals when new commits are pushed
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - Required checks:
    - `Architecture & Token Discipline`
    - `Backend + package contract tests`
    - `Frontend tests`
- [x] Require conversation resolution before merging

These can't be set programmatically without an admin token; the UI flow takes ~30 seconds.

**Don't enable the required-checks toggle until the cleanup tiers complete**, otherwise no PR can land.

### 2. Render preview deploys

Render does not auto-create preview environments per PR by default for non-Pro plans. To enable:

1. Render dashboard → **lumi-backend** service → **Settings → Pull Request Previews**
2. Toggle **Enable pull request previews** on
3. Preview URLs will be commented automatically on each PR opened against `master`

If preview deploys are blocked by plan limits, the workaround is manual ad-hoc staging deploys until SaaS plan upgrade.
