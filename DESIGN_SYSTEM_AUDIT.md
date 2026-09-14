# LUMI DESIGN SYSTEM AUDIT

**Phase:** 0 — Frontend + Design System Reset Audit · **Mode:** read-only
**Source of truth:** `origin/master @ a3ec11618c6b2a14ec68382ea4f10d44afb9601c` (clean worktree, detached HEAD)
**Date:** 2026-09-13 · **Production observed:** `https://marcom-marketing-os.onrender.com` (serves this SHA)
**Nothing in the repository, backend, database or deployment was modified.** This file is the only artifact.

### How the evidence was gathered (and where the instruments failed)

| Instrument | What it measured | Controls / known failures |
|---|---|---|
| Import graph (static + dynamic `import`, `@/` alias, index resolution) over `client/src` | reachability from `src/main.jsx`, consumers per file, LOC | known positive `MemoryView` reachable; known negatives `pages/Proof.jsx`, `pages/OperationsPage.jsx`, `config/routes.ts`, `components/dev/ComparisonHarness.tsx` unreachable; reachable + unreachable = total (433) |
| Route-closure scan | files, LOC, endpoints owned per route | shell files subtracted from every route |
| Frontend endpoint → backend route matcher | every `api.get/post/…` literal vs the mounted Express routes | **failed its fiction control on run 1** (`GET *` SPA fallback matched `/api/lumi/zebra`; register-function routers were not followed). Fixed; fiction now refused. 4 remaining "unmatched" were checked by hand: 3 are instrument misses (template-literal route, re-exported router), 1 is real |
| Regex census (hex, rgb, arbitrary Tailwind, inline style, radius, shadow, blur, gradient, motion, aria, onClick) | counts per reachable file | **counts include comments** — e.g. the shell's apparent `GET /api/lumi/feed` call is a doc comment in `contracts/errors/ApiError.ts`. Counts are indicative; every finding below was verified by reading code |
| Browser (public surfaces only) | landing + login at 375 / 768 / 1024 / 1440 | **first run measured Render's cold-start interstitial, not Lumi** (free plan spun down). Discarded; re-run after confirming `index-BS0rr8x2.js` loaded. Authenticated surfaces not observable (auth wall) |

**Evidence limitation — design authority not in repository.** The *LUMI Design System Master Build Spec* is not present in the repository or plans directory. This audit uses only the fragments quoted in the Phase 0 spec (thesis, product model, brand palette, verdict palette, anti-convergence rules). Any comparison against the Master Spec beyond those fragments is **not measurable** here.

---

## 1. Executive Summary

The frontend is a **single React 18 + Vite + Tailwind SPA** (`client/`), served by the Express web service from `client/dist`. It is **433 production source files / 48,124 LOC**, of which **378 are reachable** from `main.jsx` and **55 (5,009 LOC) are unreachable**. It exposes **24 real `/app` destinations, 8 redirects**, 5 public routes, onboarding and an admin panel.

What exists is **not one design system but several layered ones**, each partly adopted:

- **Tokens:** one JSON source (`client/design-system/tokens/*.json`) feeding Tailwind, **restated by hand** as CSS variables in `src/index.css` under five variable namespaces. The palette has **multiple names for the same value** (e.g. `#F59E0B` is brand accent, HOLD, fatigue, trend-warning, intel-pending and status-warning).
- **Primitives:** **four parallel layers** — `src/primitives` (TSX/CVA: 0 live JSX consumers), `components/primitives` (2 pages), `design-system/patterns` (7 files, the B8 grammar), `components/ui` (most of the product).
- **State grammar:** a real, locked, centralised absence/confidence grammar exists (`design-system/states/absence.js`, `confidence.js`, `patterns/DetailGrammar.jsx`) — but only **5 files** consume `absence.js`. Everywhere else, state is hand-rolled per feature. **35 hooks** fetch with hand-written `useEffect`; react-query is used by **1**.
- **Honest state is uneven.** The B8 detail surfaces and `OutcomeEvidence.jsx` are genuine exemplars. The **app shell** and several secondary surfaces still turn failures into empty or healthy claims.

The highest-risk findings are **product-truth findings, not visual ones**:

1. 🟠 **P0-01** — On Campaigns and Attention the operator sees the **live verdict**, while Execute / Dismiss / Judgment attach to the **stored Decision**. The backend already publishes `decisionAgreement` (AGREES / DIVERGES) to name the difference; the client schema **strips it**, and `decisionVerdict` is parsed but **rendered by no component**.
2. 🟠 **P0-02** — Attention records Execute / Dismiss **by entity** (the server re-resolves "newest"), while Campaigns records the same action **by stored decision id** and documents why by-entity is wrong for that write.
3. 🟠 **P0-03 / P0-04** — The shell sidebar, visible on every `/app` page, renders **"No decisions yet"** on a failed read and **"Connect a channel · Start here"** when the connections read fails.

The legacy frontend is **replaceable surface by surface**, but it contains hidden product logic (verdict evidence, gating reasons, money formatting, execution identity, plan/role gates, contract schemas) that must be carried forward as **behaviour**, not as components. The final verdict (§35) is **READY WITH ARCHITECTURAL QUESTIONS**.

---

## 2. Repository Frontend Architecture

```text
Frontend root:        client/  (npm workspace "lumi-client"; root package.json workspaces: packages/*, client)
Build system:         Vite 5.4 (client/vite.config.js) → client/dist; manualChunks vendor-react, vendor-firebase; sourcemap:false
Framework:            React 18.3 (StrictMode), react-router-dom 7 (BrowserRouter), ES modules; JS/JSX with some TS/TSX
Styling system:       Tailwind 3.4 reading client/design-system/tokens/*.json + src/index.css (@layer base/components/utilities,
                      :root CSS variables, semantic role classes); CVA + clsx + tailwind-merge (lib/utils.js `cn`)
Component structure:  src/pages (route shells, many 2–3 line re-exports) · src/features/* (real surfaces) ·
                      src/components/{ui,layout,auth,primitives,…} · src/design-system/{states,patterns,signals,flows} ·
                      src/primitives (TSX) · src/layouts (TSX, dead)
Routing:              src/App.jsx (single <Routes>), paths from src/app/routeManifest.js; gates: ProtectedRoute,
                      OnboardingRoute, RoleGate, PlanGate, RequireUserRole, LockFromClient, RoleAwareRedirect
State management:     useState/useReducer + 2 contexts (AuthContext, RoleContext); ServerStateProvider (react-query) mounted
                      but used by 1 hook (features/shell/queries.js)
Data fetching:        src/lib/api.js (axios + Firebase token interceptor; api/client.ts re-exports); 41 zod schemas in
                      src/contracts/schemas; @marcom/runtime-contracts vocabularies (13 importers)
Testing:              vitest + Testing Library + msw (client, ~227 test files); Playwright specs in client/tests/e2e (stale, §20)
Design token location: client/design-system/tokens/{colors,typography,spacing,motion}.json
Global styles:        client/src/index.css (698 lines); one CSS module: pages/demo/Operations/Operations.module.css
Asset system:         @fontsource (Inter, Space Grotesk, JetBrains Mono — 9 weight files imported in main.jsx);
                      assets/fonts/NotoNaskhArabic-Regular.ttf (PDF export only); lucide-react icons (112 importers);
                      components/brand/LumiStar.jsx; 2 <img> in all of src
Entry:                client/index.html → src/main.jsx → AuthProvider → ServerStateProvider → BrowserRouter → App
Shell:                /app → ProtectedRoute → components/layout/MainLayout.jsx (RoleProvider, Sidebar, ContextBar, <main id="main-content">)
Served by:            src/server.js — express.static(client/dist) + GET * SPA fallback (production only)
```

Unused declared dependencies: **`xstate`, `@xstate/react`** (0 imports in reachable code). Reachable files import **`axios` directly in 5 files** (not traced individually).

---

## 3. Route Inventory

Gates are read from `client/src/App.jsx`. "Data" lists endpoints owned by the route's import closure, excluding the shell's. Status: **LIVE** (nav-reachable), **URL-ONLY** (routed, no nav entry), **REDIRECT**, **PLACEHOLDER**.

| Route | Component (entry) | Auth | Role gate | Plan gate | API / data source (owned) | State handling | Status |
|---|---|---|---|---|---|---|---|
| `/` | `pages/LandingPage.jsx` | — | — | — | none | static | LIVE (public) |
| `/privacy`, `/terms` | `PrivacyPage`, `TermsPage` | — | — | — | none | static | LIVE (public) |
| `/login/*`, `/signup/*` | `pages/AuthPage.jsx` | — | — | — | Firebase SDK | form states | LIVE (public) |
| `/onboarding` | `pages/OnboardingPage` (Name → Connect → Sync → Ready) | OnboardingRoute | — | — | entities/campaigns, entities/verdicts, projects/mine, connections/account (PATCH), connections/sync (POST), campaigns/me/context (PUT) | per step | LIVE |
| `/admin` | `pages/AdminPanel.jsx` (lazy) | RequireUserRole ADMIN (errs closed) | UserRole ADMIN | — | 11 `/api/admin/*` | AsyncBlock | LIVE (outside shell) |
| `/app` (index) | `RoleAwareRedirect` | ProtectedRoute | CLIENT → leadership | — | — | — | REDIRECT |
| `/app/overview` | `pages/Home.jsx` → `features/overview/OverviewView.jsx` | ✓ | LockFromClient | — | home, portfolio, account/aggregate, accuracy, entities/{campaigns,health,verdicts}, decisions/by-entity/:id/learning, decisions/:id/judgment (PATCH), copilot (POST), loop/run (POST) | overviewState (`unreadable`), interrupts, slots | LIVE — Attention |
| `/app/leadership` | `pages/Leadership.jsx` (lazy) | ✓ | none (CLIENT home) | — | narratives, narratives/:id, narratives/generate | local | LIVE — Reports |
| `/app/decisions` | `features/decisions/DecisionHistoryView.jsx` (lazy) | ✓ | none | none | decisions | absence grammar | LIVE — THEN |
| `/app/decisions/:id` | `DecisionDetailView.jsx` (lazy) | ✓ | none | none | decisions/:id | DetailGrammar + absence | LIVE (deep link) |
| `/app/campaigns` | `pages/CampaignAnalysis.jsx` → `features/campaigns/CampaignsView.jsx` (lazy) | ✓ | LockFromClient | — | entities/{campaigns,health,verdicts}, entities/:id/{adsets,reasoning}, entities/:adSetId/ads, account/aggregate, decisions/:id/{executions,judgment}, decisions/by-entity/:id/learning, **execute/meta (POST)**, connections/sync | substrateError, gating reasons | LIVE — SUBJECT |
| `/app/intelligence` | `Navigate` → blended-truth | | | | | | REDIRECT |
| `/app/intelligence/blended-truth` | `pages/BlendedTruth.jsx` (lazy) | ✓ | STRATEGIST, BUYER | GROWTH | blended, portfolio/allocate, portfolio/allocate/commit | EmptyPanel | LIVE (secondary nav) |
| `/app/intelligence/insights` | `pages/GrowthStrategyBoard.jsx` → `InsightsView` (lazy) | ✓ | STRATEGIST, BUYER | GROWTH | approvals, economics, goals, plans, plans/:id/promote, entities/{campaigns,verdicts,fatigue} | per panel | URL + sub-nav |
| `/app/memory` | `features/memory/MemoryView.jsx` (lazy) | ✓ | none at page (briefing gated inside) | GROWTH | briefing, accuracy, decisions/pending-outcomes, decisions/:id/{outcome,outcome-evidence}, patterns/:id/promotion-request, promotions/:id/decision, guardrails/:id/revoke, network/consent | absence grammar, OutcomeEvidence | LIVE — ACROSS |
| `/app/intelligence/proof`, `/app/proof` | `Navigate` → memory | | | | | | REDIRECT |
| `/app/testing` | `pages/Testing.jsx` (lazy) | ✓ | BUYER, STRATEGIST | PRO | tests + start/metrics/conclude/promote-to-holdout | confidence grammar | LIVE |
| `/app/testing/:id` | `TestDetailView.jsx` (lazy) | ✓ | BUYER, STRATEGIST | PRO | `${path}/:id` (dynamic base) | DetailGrammar | LIVE (deep link) |
| `/app/measure` | `pages/Measure.jsx` (lazy) | ✓ | STRATEGIST, BUYER | PRO | incrementality (+conclude/metrics), scenario | local | LIVE |
| `/app/measure/:id` | `HoldoutDetailView.jsx` (lazy) | ✓ | STRATEGIST, BUYER | PRO | `${path}/:id` (dynamic base) | DetailGrammar, NOT_PERMITTED | LIVE (deep link) |
| `/app/connections` | `features/connectors/ConnectorsView.jsx` (lazy) | ✓ | STRATEGIST, BUYER | none (deliberate) | connections (shell), connections/account, projects/mine | absence grammar | LIVE — Connectors |
| `/app/content` | `pages/ContentLab` → `ContentLabView` | ✓ | LockFromClient | — | tools/content-generate, tools/content-generations, campaigns/me/context, entities/{campaigns,verdicts} | local | LIVE (secondary nav) |
| `/app/publishing` | `pages/Publishing.jsx` (lazy) | ✓ | BUYER, STRATEGIST | GROWTH | execute/artifacts/approved, attribution/publish | local | LIVE (secondary nav) |
| `/app/copilot` | `pages/CopilotPage.jsx` | ✓ | **none** | — | none | static | URL-ONLY · PLACEHOLDER ("Coming soon") |
| `/app/growth` | `Navigate` → insights | | | | | | REDIRECT |
| `/app/tools/score`, `/tools/calendar`, `/tools/marketing` | `pages/tools/*.jsx` (23 LOC each) | ✓ | **none** | — | none | static | URL-ONLY · PLACEHOLDER ("Coming Soon") |
| `/app/settings/integrations` | `Navigate` → connections | | | | | | REDIRECT (OAuth return address) |
| `/app/settings`, `/app/settings/:section` | `pages/Settings.jsx` → `SettingsView` (general, team, revenue, workspace, security) | ✓ | **none at route** | — | team/*, user/*, credentials/status, auth/meta/connect, revenue/csv, roles/me, loop/run | EmptyState (1 use) | LIVE (footer/⌘K) |
| `/app/home`, `/app/feed`, `/app/truth` | `Navigate` | | | | | | REDIRECT |
| `/app/observability` | `pages/Observability.jsx` | ✓ | **none** | — | observability/{live,providers,failures} | `|| 0` (§13) | URL-ONLY |
| `/app/approvals/:executionId` | `pages/ApprovalQueue.jsx` (lazy) | ✓ | **none at route** | — | execute/:id/artifacts/pending-approval, execute/:id/resume, attribution/publish | local | URL (linked from `PendingApprovalItem`) |
| `/app/demo/operations` | `pages/demo/Operations/index.jsx` (lazy) | ✓ | **none** | — | execute/{active,vitals,metrics/summary,:id/incident,:id/transitions,:id/retry}, events/token | inline styles | URL-ONLY · DEMO |
| `/app/*` | `NotFound app` | ✓ | | | | | fallback |
| `*` | `NotFound` | — | | | | | fallback (verified in production) |

**Findings**

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-20 | 🟡 | Six URL-reachable operator routes carry **no role gate** in the router (copilot, tools×3, observability, demo/operations; settings and approvals gate inside or not at all) | App.jsx route elements | `client/src/App.jsx:382-448` | a CLIENT seat can load operator pages; backend gates the data (Security C refuses `/api/execute` to CLIENT) so the page renders a failure, not data | ARCHITECTURAL RISK | carry "route audience = API audience" (B7 Ruling 3) into the new router as a rule, not per route |
| P0-21 | 🔵 | `legacyAppRedirects` documents the redirect table by hand and has **no importer** | self-documented | `client/src/app/routeManifest.js:67-83` (declared at `:70`) | drift between table and router is undetectable | DESIGN DEBT | new router should derive redirects from one declaration |
| P0-22 | ⚪ | The dynamic detail endpoint `${path}/${id}` is not statically traceable | `useExperimentDetail.js` | `client/src/hooks/useExperimentDetail.js` | endpoint census cannot see it | OBSERVATION | name the two bases explicitly when rebuilt |

---

## 4. Product Surface Inventory

Surface size = files and LOC owned by the route's closure, excluding shell; "excl." = files used by no other route.

| Surface | Exists | Used | Routed | Reachable (nav) | Data-backed | Partial | Size (files / LOC / excl.) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Attention / Overview | ✓ | ✓ | `/app/overview` | primary | ✓ 11 endpoints | — | 57 / 6,466 / 31 | **LIVE** |
| Decisions | ✓ | ✓ | `/app/decisions` | primary | ✓ | — | 10 / 590 / 2 | **LIVE** |
| Decision Detail | ✓ | ✓ | `/app/decisions/:id` | from Decisions, Testing, Holdout only | ✓ | no inbound link from Attention or Campaigns (P0-11) | 11 / 811 / 3 | **LIVE** |
| Campaigns | ✓ | ✓ | `/app/campaigns` | primary | ✓ 12 endpoints | — | 56 / 8,151 / 30 | **LIVE** (largest) |
| Reports / Leadership | ✓ | ✓ | `/app/leadership` | primary (CLIENT home) | ✓ | — | 6 / 513 / 5 | **LIVE** |
| Memory | ✓ | ✓ | `/app/memory` | primary (GROWTH) | ✓ 9 endpoints | — | 24 / 2,204 / 10 | **LIVE** |
| Connectors | ✓ | ✓ | `/app/connections` | primary | ✓ | — | 14 / 717 / 1 | **LIVE** |
| Intelligence / Blended Truth | ✓ | ✓ | `/app/intelligence/blended-truth` | secondary (GROWTH) | ✓ | pacing/allocation NOT_MEASURABLE in prod (#474) | 12 / 989 / 5 | **LIVE** |
| Growth Strategy | ✓ | ✓ | `/app/intelligence/insights` | via Intelligence sub-nav | ✓ 14 endpoints | mixes goals, economics, plans, approvals, fatigue | 23 / 2,844 / 14 | **LIVE** |
| Testing (+ detail) | ✓ | ✓ | `/app/testing(/:id)` | primary (PRO) | ✓ | — | 13 / 1,366 · 11 / 760 | **LIVE** |
| Measurement (+ detail) | ✓ | ✓ | `/app/measure(/:id)` | primary (PRO) | ✓ | — | 11 / 1,105 · 11 / 787 | **LIVE** |
| Content Lab | ✓ | ✓ | `/app/content` | secondary | ✓ (AI generation) | — | 42 / 4,473 / 13 | **LIVE** |
| Publishing | ✓ | ✓ | `/app/publishing` | secondary (GROWTH) | ✓ | — | 10 / 1,073 / 3 | **LIVE** |
| Approval Queue | ✓ | ✓ | `/app/approvals/:executionId` | linked from pending item | ✓ | — | 9 / 1,614 / 5 | **LIVE (deep link)** |
| Settings | ✓ | ✓ | `/app/settings(/:section)` | footer / ⌘K | ✓ 14 endpoints | — | 23 / 1,877 / 13 | **LIVE** |
| Copilot page | ✓ | — | `/app/copilot` | none | ✗ | static "Coming soon" | 9 / 424 / 1 | **PLACEHOLDER** |
| Copilot panel (on Attention) | ✓ | ✓ | inside overview | slot | ✓ POST copilot | — | (in overview) | **LIVE** |
| Tools (score / calendar / marketing) | ✓ | — | 3 routes | none | ✗ | "Coming Soon" | 3 × 23 LOC | **PLACEHOLDER** |
| Observability ("Mission Control") | ✓ | ? | `/app/observability` | none | ✓ | `|| 0` | 4 / 299 | **URL-ONLY / UNKNOWN use** |
| Demo · Operations | ✓ | ? | `/app/demo/operations` | none | ✓ | demo styling | 21 / 2,771 / 18 | **URL-ONLY / UNKNOWN use** |
| Onboarding | ✓ | ✓ | `/onboarding` | post-signup | ✓ | 14 legacy step files unreachable | 12 / 899 live | **LIVE** + dead legacy |
| Admin | ✓ | ✓ | `/admin` | ADMIN only | ✓ | — | 15 / 1,759 | **LIVE** |
| Landing | ✓ | ✓ | `/` | public | none (illustrative) | — | 10 / 1,037 | **LIVE** |
| App shell (MainLayout + Sidebar + ContextBar) | ✓ | ✓ | every `/app` | — | ✓ 5 endpoints | — | 81 / 8,086 (incl. 40 schema files) | **LIVE** |

"UNKNOWN use" = no production usage telemetry was read in this audit.

---

## 5. Component Inventory

**Scale:** 223 JSX/TSX component files (197 reachable) · 67 hooks in `src/hooks` (62 reachable) + 5 feature hooks · 2 contexts · 41 zod schemas.

### 5.1 Reusable components by layer

Consumer counts are JSX call sites in non-test files, excluding the defining file.

| Component | Location | Consumers | Responsibility | Duplicate of | Legacy? | Classification |
|---|---|---|---|---|---|---|
| `DetailSection` / `DetailRefusal` / `DetailBackLink` | `design-system/patterns/DetailGrammar.jsx` | 3 detail views each | state + layout grammar | — | no (B8) | KEEP (behaviour) / EVOLVE (visual) |
| `PageHeader` | `design-system/patterns/PageHeader.jsx` | 8 | layout | ad-hoc headers elsewhere | no | EVOLVE |
| `StateBlock` / `EmptyState` / `ErrorState` / `LoadingState` | `design-system/patterns/StateBlock.jsx` | EmptyState 1, others 0 | state | `EmptyPanel`, per-feature states | partial | CONSOLIDATE |
| `MetricTile` | `design-system/patterns/MetricTile.jsx` | 1 (CopilotPage placeholder) | visual | `StatCard`, `MetricValue`, KpiStrip | — | CONSOLIDATE |
| `EvidencePanel`, `RecommendationCard` | `design-system/patterns/` | **0** | visual | — | dead in practice | REMOVE (later) |
| `Shell`, `Panel`, `Button`, `Stack`, `Cluster` (CVA) | `src/primitives/*.tsx` | **0 live** (only dead `src/layouts/*`) | visual | `components/ui/Panel.jsx`; raw `<button>` (182 sites) | yes | REMOVE (later) |
| `Text`, `DecisionTitle`, `MetricValue`, `SectionLabel`, `BodyMuted`, `BodySubtle` | `components/primitives/{core,typography}` | Text 11; others 0–3 | typography | CSS role classes in index.css | partial | CONSOLIDATE |
| `VerdictBadge` | `components/primitives/signals/VerdictBadge.jsx` | 1 live (ContentLabView) + dead assemblies | verdict visual + **unknown→HOLD fallback** | `VerdictPill` | yes | REPLACE (P0-14) |
| `ConfidenceIndicator`, `RiskSignal`, `UrgencyBadge`, `RecommendationStrength`, `Input*` | `components/primitives/flows/` | 0 live (only dead assemblies / flows) | visual | — | yes | REMOVE (later) |
| `VerdictPill`, `PriorityPill`, `StagePill` | `components/ui/DecisionPill.jsx` | VerdictPill 4 live | verdict visual; includes non-engine `TEST` | `VerdictBadge` | partial | EVOLVE → single verdict primitive |
| `EmptyPanel` | `components/ui/EmptyPanel.jsx` | 5 | state | `StateBlock` | — | CONSOLIDATE |
| `CardSkeleton`, `Skeleton` | `components/ui/Skeleton.jsx` | 8 | loading | `LumiLoader`, `Loader2` spinners | — | CONSOLIDATE |
| `LumiLoader` | `components/ui/LumiLoader.jsx` | 1 | decorative loading (gradients, blur, glow) | Skeleton | — | REPLACE |
| `Panel` | `components/ui/Panel.jsx` | 1 (AgendaBand) | container | `src/primitives/Panel.tsx` | — | CONSOLIDATE |
| `StatCard` | `components/ui/StatCard.jsx` | 1 (KpiStrip) | metric | MetricTile | — | CONSOLIDATE |
| `HelpTip` | `components/ui/HelpTip.jsx` | 10 | tooltip/popover | native `title` elsewhere | — | EVOLVE |
| `ConfirmModal` | `components/ui/ConfirmModal.jsx` | 1 | modal (no focus trap, §20) | `DeleteWorkspaceDialog`, `RawAuditLogModal` | — | CONSOLIDATE |
| `CommandPalette` (+Items) | `components/ui/` | 1 (Sidebar) | command / nav (reads `navItems`, so gated) | — | — | EVOLVE |
| `NotificationBell`, `InboxPanel` | `components/ui`, `features/inbox` | Sidebar | notifications (GET inbox) | — | — | EVOLVE |
| `RecentDecisions` | `components/ui/RecentDecisions.jsx` | Sidebar | decision list; **rows are `<button>` with no handler**; failure → "No decisions yet" (P0-03) | — | — | REPLACE |
| `RadarStrip` + Sidebar "WATCHING" | `components/layout/` | Sidebar | **decorative liveness** (P0-10) | — | — | REPLACE |
| `Sidebar` (630 LOC) | `components/layout/Sidebar.jsx` | MainLayout | nav + **role/plan filtering**, connect CTA, recent decisions, radar | — | — | REPLACE visuals · KEEP gating behaviour |
| `MainLayout`, `ContextBar` | `components/layout/` | App | shell, skip-link target, mobile menu | — | — | REPLACE visuals · KEEP structure contract |
| `RoleGate`, `PlanGate`, `RequireUserRole`, `ProtectedRoute`, `OnboardingRoute` | `components/auth`, `router/` | App + views | **authorization / entitlement** | — | — | KEEP |
| `UpgradePrompt` | `components/plan/UpgradePrompt.jsx` | 4 | entitlement state | — | — | EVOLVE |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` (root, boundaryId) and `components/ui/ErrorBoundary.jsx` (main.jsx) | 2 implementations | failure containment | each other | — | CONSOLIDATE |
| `FirstRunBanner`, `RevenueOnboardingBanner` | `features/overview/components` | Overview | onboarding interrupts | — | — | EVOLVE (P0-06) |
| `DecisionCard` | `features/overview/components/DecisionCard.jsx` | ActNowSection | **decision object** with judgment + execution context | Campaigns row panel | — | EVOLVE (P0-01/02) |
| `ConnectorCampaignsPanel` (701), `CampaignDetailPanel` (607), `ExecutionContext`, `DecisionJudgment`, `EvidenceState` | `features/campaigns/` | Campaigns, Attention | **decision + evidence + action + judgment** | partially Attention | — | EVOLVE (hidden product logic, §33) |
| `OutcomeEvidence`, `RecordOutcomePanel`, `ProofView`, `AccountBriefing` | `features/intelligence/{proof,insights}` | Memory | outcome + memory | — | — | KEEP behaviour · REPLACE visuals |
| `PacingWidget`, `KpiStrip`, `ConnectionHealthStrip`, `AccountStateHero`, `AgendaBand` | `features/overview/components` | Attention | measurement, KPIs, account state | — | — | EVOLVE |
| `CopilotPanel` | `features/overview/components/CopilotPanel.jsx` | Attention slot | **chat-first AI** (§16, §23) | CopilotPage placeholder | — | UNKNOWN (product ruling Q6) |
| `PerformanceChart`, `MetricsPanel`, `InlineBar` | `components/campaign-analysis/` | Campaigns | data viz (P0-05) | — | legacy naming | REPLACE |
| `DecisionTrustCluster` (×2), `AlertActionPlan`, `HistoricalInsight`, `MetricSignalGrid`, `PriorityBadge`, `StageBadge` | `components/assemblies/`, `src/layouts/` | **0 (unreachable)** | decision "trust" assemblies | each other | yes | REMOVE (later) |

### 5.2 Largest reachable components (budget in CLAUDE.md: page ≤ 300, primitive ≤ 150)

`TestingView.jsx` 719 · `ConnectorCampaignsPanel.jsx` 701 · `ContentLabView.jsx` 639 · `Sidebar.jsx` 630 · `CampaignsView.jsx` 620 · `CampaignDetailPanel.jsx` 607 · `App.jsx` 458 · `PlansPanel.jsx` 370 · `AccountBriefing.jsx` 354.

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-30 | 🟡 | Four parallel primitive layers; the one documented as "the UI Runtime Layer" (`src/primitives`, CVA) has **0 live JSX consumers** | JSX consumer scan; only `src/layouts/*` (unreachable) use Button/Stack/Cluster | `client/src/primitives/`, `client/src/components/primitives/index.js` | a new design system cannot "migrate" to an existing primitive layer; none is canonical | DESIGN DEBT | the reset defines one primitive layer; do not inherit any of the four by default |
| P0-31 | 🔵 | Documented governance is stale: `TAXONOMY-FREEZE.md` (2026-06-04) blocks new primitives at "4% adoption, 80% threshold" | doc lines 46-50 | `client/design-system/TAXONOMY-FREEZE.md` | a reset violates a written rule unless explicitly superseded | PRODUCT RULING | Q4 |

---

## 6. Existing Design System

| Artifact | What it is | Adopted? | Classification |
|---|---|---|---|
| `design-system/tokens/colors.json` (100 lines) | 13 colour groups, single JSON source for Tailwind | yes | EVOLVE (values replaced by Master Spec; the *single-source* mechanism is worth keeping) |
| `tokens/typography.json` | 3 families, 8-step scale, 10 semantic roles | roles as CSS classes; JSON not read by Tailwind (scale restated in `tailwind.config.js`) | EVOLVE |
| `tokens/spacing.json` | 7 named spacing levels, 6 radii, 11 shadows (6 are glows) | radius + shadows via Tailwind; named spacing not wired | REPLACE |
| `tokens/motion.json` | durations, easings, animations, keyframes | yes | EVOLVE |
| `tailwind.config.js` | extends colors / fonts / fontSize / shadows / radii / motion from JSON | yes | EVOLVE |
| `src/index.css` (698 lines) | `:root` variables restated by hand, semantic role classes, `.btn-gold`, glass vars, grid lines, global reduced-motion override | yes | REPLACE (keep reduced-motion override behaviour) |
| `design-system/lint/no-generic-tailwind.js` (FE-01) | lint rule (allowlist) in `lint:ci` | yes, CI | KEEP (mechanism) |
| `client/scripts/checkTokenResolution.js` (FE-01) | build-time "does this class exist" check | yes, CI | KEEP (mechanism) |
| `design-system/{ui-registry,component-states,TAXONOMY-FREEZE,PRIMITIVE-INVENTORY,ADOPTION-COVERAGE,CVA-*,SEMANTIC-DUPLICATE-ANALYSIS}.md` | governance docs | stale (June 2026) | REPLACE |
| `design-system/codemods/` | migration codemods | not in build | UNKNOWN |
| `src/design-system/states/{absence,confidence}.js` | locked B8 state grammar | 5 + 4 consumers | **KEEP** |
| `src/design-system/patterns/*` | B8 patterns | partial (§5) | KEEP DetailGrammar behaviour; CONSOLIDATE rest |
| `src/design-system/signals/signals.js` | verdict → token map with unknown→HOLD | 1 live consumer | REPLACE |
| `src/design-system/flows/decisionFlows.js` | 257 LOC | unreachable | REMOVE (later) |

---

## 7. Token Audit

### 7.1 Three sources for the same values

```text
colors.json ──► tailwind.config.js ──► utility classes          (single source, enforced by FE-01 tooling)
index.css :root  --color-* / --c-* / --sh-* / --shadow-* / --spacing-* / --radius-* / --font-size-* / --glass-*
                 ▲ restated BY HAND — no tooling ties these to colors.json
```

`var(--…)` is used from JSX/JS in **30+ distinct variables** (e.g. `--c-surface-border` ×26, `--spacing-xs` ×25, `--c-text-muted` ×25). The Operations demo defines its own set in a CSS module. All sampled variables resolve, but nothing enforces that they stay equal to `colors.json`.

### 7.2 Duplication (same value, many names)

| Value | Names carrying it | Semantic meaning | Verdict |
|---|---|---|---|
| `#F6C945` | `brand.gold` (`lumi-gold`), `radar.active`, `intel.verified`, `--color-brand-gold`, `--c-intel-verified` | brand vs "verified" vs "active" | **different semantic meanings sharing a value** |
| `#E0A800` | `brand.deep`, `lumi.accent` (`lumi-accent`), `--color-lumi-accent`, `--selection-text` | brand accent | legacy aliases |
| `#F59E0B` | `accent.warm`, `signal.hold`, `stage.fatigued`, `trend.warning`, `intel.pending`, `--color-status-warning`, `--color-accent-orange` | **brand accent AND HOLD verdict** | **conflict** — brand colour doubles as semantic truth (P0-15) |
| `#EF4444` | `signal.kill`, `stage.dying`, `trend.danger`, `radar.critical`, `--color-status-danger` | KILL vs generic danger | accidental duplication |
| `#DC2626` | `verdict.kill-text` | second KILL red | duplicate |
| `#10B981` | `signal.scale`, `stage.stable`, `trend.positive`, `radar.stable`, `--color-accent-green` | SCALE vs generic positive | accidental duplication |
| `#059669` | `verdict.scale-text` | second SCALE green | duplicate |
| `#F8F6F2` / `#FFFFFF` / `#F1EEE8` / `#EDEAE4` / `#D4CFCA` | `surface.*` **and** `lumi.*` (two complete neutral namespaces: `surface-*`/`dark-*` vs `lumi-*`) | same | legacy aliases |
| `#2B2B2B`…`#9A9A9A` | `text.*` (`dark-*`) and `lumi.text/muted/subtle` | same | legacy aliases |
| `#F8B4B4` | `blush` | none (`_blush_status: "orphaned — not in use"`) | REMOVE |

### 7.3 Master Spec delta (fragments available)

| Master Spec | Current nearest | Delta |
|---|---|---|
| Gold `#D4A017` | `#F6C945` / `#E0A800` | not present |
| Charcoal `#0B0F14` | `#0F0F0F` (`surface.dark`); `index.html` theme-color `#0A0B0F` | not present |
| Off White `#F7F7F3` | `#F8F6F2` | not present |
| Warm Gray `#E6E2DA` | `#EDEAE4` / `#F1EEE8` | not present |
| KILL `#C74646` | `#EF4444` / `#DC2626` | not present |
| HOLD `#D97732` | `#F59E0B` / `#D97706` | not present |
| SCALE `#3D9B6D` | `#10B981` / `#059669` | not present |
| WATCH, REFRESH, REALLOCATE | blue / indigo / cyan / amber (inconsistent, §15) | **not specified in available fragments** (Q9) |

---

## 8. Typography Audit

- **Families:** Space Grotesk (display), Inter (body; `index.css` adds `"Noto Sans"` to the stack, which the JSON does not declare), JetBrains Mono (numbers/system). All three are self-hosted via `@fontsource`, 9 weight files imported in `main.jsx`. NotoNaskhArabic is used only for PDF export.
- **Scale:** 11 / 12 / 14 / 15 / 17 / 20 / 24 / 30 px, Tailwind-overridden so `text-xs` is 11px. The linter bans `text-xl/2xl/3xl`, yet the scale defines them.
- **Semantic roles:** 10 CSS role classes (`decision-title`, `metric-display`, `financial-impact`, `radar-label`, `intel-caption`, `system-mono`, `section-label`, `signal-timestamp`, `verdict-number`, `command-label`), alongside a parallel set of 6 typography React primitives with 0–11 consumers.
- **Arbitrary sizes:** `text-[9px]`, `[10px]`, `[11px]`, `[14px]` are common. They are part of the 401 arbitrary-value occurrences, and `DecisionPill` uses `text-[9px]` / `[10px]`.
- **Numbers:** `tabular-nums` is wired as a Tailwind utility, and mono roles are declared tabular.

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-32 | 🔵 | Two typography systems (CSS role classes and React typography primitives) plus arbitrary px sizes down to 9px | `DecisionPill.jsx` sizeConfig; typography primitives consumer counts | `components/ui/DecisionPill.jsx`, `components/primitives/typography/` | legibility of verdict labels at 9–10px; no single type API | DESIGN DEBT | one typographic API in the new system, with a legibility floor |

---

## 9. Color Audit

**Hardcoded style census** over 378 reachable files. Counts include comments.

| Pattern | Count | Where concentrated | Classification |
|---|---|---|---|
| hex | 115 in 15 files | `index.css` 62 (SYSTEM TOKEN restatement) · `Operations.module.css` 18 (LEGACY/demo) · `lib/pdfExport.js` 12 (VALID EXCEPTION — PDF has no Tailwind) · `ContentLabView.jsx` 5, `OnboardingPage/steps/onboardingStyles.js` 5, `OnboardingPage/index.jsx` 3 (ARBITRARY) | mixed |
| rgb/rgba/hsl | 101 | `pdfExport.js` 34 (VALID EXCEPTION) · `index.css` 27 (SYSTEM TOKEN) · Operations demo 17 · `LumiLoader.jsx` 6 · `HeroSection.jsx` 4 (ARBITRARY) | mixed |
| arbitrary Tailwind `x-[…]` | 401 in 84 files | `ContentLabView` 40 · `OutputComponents` 25 · `DecisionJudgment` 20 · `HeroSection` 20 · `CostTab` 17 · `Sidebar` 16 · `WhyKillSection` 13 · `ConnectorCampaignsPanel` 10 | ARBITRARY |
| inline `style={{…}}` | 204 | Operations demo 120+ · `ErrorBoundary.tsx` 11 · verdict-lane widths in `PerformanceChart` (VALID: computed widths) · pulse animations in `Sidebar`/`RadarStrip` | LEGACY / VALID |
| gradients | 22 | `LumiLoader` 8 · `HeroSection` 4 · `Sidebar` 3 · `ProfileTab`, `TeamTab` 2 each · `StatCard` 1 | DECORATIVE |
| verdict colour maps | 2 | `components/ui/DecisionPill.jsx` verdictConfig · `design-system/signals/signals.js` SIGNALS | DUPLICATE (§15) |

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-15 | 🟡 | The brand accent value `#F59E0B` **is** the HOLD verdict colour; gold `#F6C945` also means "verified" and "active" | §7.2 | `client/design-system/tokens/colors.json` | brand colour cannot be used anywhere without reading as a verdict or status; directly contradicts the Master Spec rule that brand gold must not substitute semantic truth | DESIGN DEBT | the reset assigns brand and verdict tokens disjoint values *and* disjoint names |
| P0-16 | 🔵 | `index.html` declares `class="dark"` and `theme-color #0A0B0F`; the product is a light theme with no dark mode (`index.css` "DARK MODE PREPARATION (Future)") | production DOM `htmlClass: "dark"` | `client/index.html:2,13` | browser chrome tints dark over a light app; stale meta ("Drop a URL. Lock your context…") | OBSERVATION | Q11 |

---

## 10. Layout / Spacing Audit

- **Spacing:** named levels in `spacing.json` (micro … page) are **documentation only**. Components use raw Tailwind steps plus arbitrary values; `index.css` has `--spacing-xs…xl`, used by 25 inline style references.
- **Radius:** tokens sm 6 / md 8 / lg 12 / xl 16 / 2xl 20 / pill. There are 521 `rounded*` uses, 137 of them `rounded-2xl/3xl/full`. The dominant container is `rounded-xl border bg-lumi-surface`, often with `shadow-card`.
- **Elevation:** 11 shadow tokens, 6 of which are glows (`gold-glow`, `accent-glow`, `optimize-glow`, `kill-glow`, `scale-glow`, `hold-glow`). There are 102 `shadow*` uses. `shadow-accent-glow` sits on primary CTAs such as the Overview connect button and the skip link.
- **Page structure:** `p-6 lg:p-8`, `max-w-*` wrappers. There is no shared page-layout primitive; `PageHeader` is used by 8 files.
- **Effects:** 19 blur uses (modal backdrops `backdrop-blur-sm`, `LumiLoader`, landing). `--glass-bg`/`--glass-blur` variables are defined.

---

## 11. State System Audit

### 11.1 What exists

| Mechanism | States | Centralised? | Consumers |
|---|---|---|---|
| `design-system/states/absence.js` | PRESENT, NOT_REACHABLE, NOT_MEASURED, NOTHING_FOUND, NOT_SUPPORTED, NOT_PERMITTED, driven by backend **KNOWLEDGE** tokens; **throws** on an unknown token | yes, locked (B8-02) | 5: DetailGrammar, DecisionDetailView, HoldoutDetailView, TestDetailView, AccountBriefing |
| `design-system/states/confidence.js` | rung MODERATE≡MEDIUM, INCONCLUSIVE≡null≡finding | yes (B8-05) | 4 |
| `patterns/DetailGrammar.jsx` | DetailSection / DetailRefusal | yes | 3 detail views |
| `features/overview/overviewState.js` + `useOverviewModel` | `unreadable` (read failed) distinct from `hasAnyData:false` | local to Attention | Attention |
| `features/campaigns/gatingReasonCopy.js` | C-07 gating reasons, 2 sharing `NOTHING_THERE`, unknown → `action: null` | local, shared by 4 | Campaigns, PDF, growth summary |
| `features/campaigns/verdictEvidence.js` | C-09 dimension value + basis, three-state limiting flags | local, 6 consumers | Campaigns, Attention |
| `lib/accountAggregate.js` `AGGREGATE_ABSENCE` | NO_MEASUREMENT etc. | local | Attention/Campaigns |
| `PacingWidget` | NOT_MEASURABLE (spend window, #474) | local | Attention |
| `OutcomeEvidence.jsx` | §11.3 | local | Memory |
| `StateBlock` / `EmptyPanel` / `CardSkeleton` / `UpgradePrompt` | generic empty / loading / locked | partly | 1 / 5 / 8 / 4 |
| Everything else | per-component `loading` / `error` / `[]` | **no** | 35 hand-rolled fetch hooks |

### 11.2 Required states vs representation

| State | Represented honestly where | Collapsed / missing where |
|---|---|---|
| loading | skeletons, `Loader2` everywhere | Campaigns chart shows "No campaign data yet" **while loading** (P0-05) |
| empty vs error | B8 surfaces, Attention hero, OutcomeEvidence, Connectors | shell sidebar (P0-03, P0-04), Campaigns chart (P0-05), first-run interrupt (P0-06) |
| unavailable / not measured | absence grammar, pacing NOT_MEASURABLE, OutcomeEvidence UNAVAILABLE | Observability `|| 0` (P0-07) |
| not permitted | HoldoutDetail NOT_PERMITTED; UpgradePrompt | nav **hides** plan-locked items (P0-12) |
| stale | CampaignDetailPanel "may be stale"; revenueStale | — |
| unsupported | OutcomeEvidence UNSUPPORTED, C-07 reasons | — |
| partial / mixed currency | `accountAggregate` currency agreement | not audited per surface (UNKNOWN) |
| insufficient data / no conversions | C-07 gating reasons, `insufficientData` in EvidenceState | — |
| processing / success | execution/judgment states (`executing`/`executed`/`stale`) | toast-only in several mutations (not traced) |
| unknown verdict | `VerdictPill` neutral fallback | `signals.js` → **HOLD** (P0-14) |

### 11.3 State exemplar — `OutcomeEvidence.jsx`

**Verified: it is still the exemplar.** In `client/src/features/intelligence/proof/OutcomeEvidence.jsx`, loading (`:104`), transport or contract failure (`:107`, fed by `useOutcomeEvidence`'s `safeParse` → error), then **seven** backend statuses each with its own branch: MEASURABLE `:123`, INSUFFICIENT_COVERAGE `:135`, UNSUPPORTED `:148`, NOT_OBSERVED `:157`, AMBIGUOUS `:170`, UNAVAILABLE `:193` (a 200 carrying UNAVAILABLE handled explicitly), NOT_MEASURABLE `:210`. It also has an **unrecognised-status branch** (`:221`) that refuses to inherit NOT_MEASURABLE. It never computes a ratio from an absent value (`'—'`). → **STATE EXEMPLAR**.

A second exemplar class: **`absence.js` + `DetailGrammar`**, which make absence a measured token and fail loudly on an unknown one.

---

## 12. API / Frontend Contract Audit

- **Endpoint census:** 110 distinct endpoint strings in production files.
  - **108** resolve to mounted backend routes (3 confirmed by hand after instrument misses).
  - **1** targets a **deleted** route: `POST /api/lumi/orchestrate/:campaignId` in `hooks/useOrchestrate/fetchers.js`, removed by S1-B. It is only callable through `useOrchestrate`, which has **0 importers**, and `verdictAuthority.test.js` pins that. No reachable surface requires it.
  - **1** dynamic base (§3).
- **Schema validation:** 41 zod schemas. The shell alone pulls 40 schema modules through `contracts/schemas/index.ts`.

### 12.1 Chains for major surfaces

```text
Attention  OverviewView → useOverviewModel → useConnectorCampaigns / useConnectorVerdicts / useAccountHealth /
           useConnections / useHome / usePortfolio / useAccuracy … → lib/api.js → /api/lumi/{entities/*,home,portfolio,accuracy,…}
           → zod safeParse (most) → overviewDerive (pure) → slots/interrupts → components
Campaigns  CampaignsView → useConnectorCampaigns + useConnectorVerdicts + useAccountHealth → projection list (CampaignsView:330-400)
           → ConnectorCampaignsPanel → CampaignDetailPanel → ExecutionContext → executeWithLumi (POST /api/execute/meta, decisionId)
           → useDecisionAction (PATCH decisions/by-entity/:entityId/{execute,dismiss}[?decisionId]) → useDecisionJudgment (PATCH decisions/:id/judgment)
Decisions  DecisionHistoryView / DecisionDetailView → useDecisionHistory / useDecisionDetail → /api/lumi/decisions(/:id) → DecisionDetail schema → DetailGrammar
Memory     MemoryView → useAccountBriefing (GET briefing, GROWTH) + ProofView → useAccuracy / usePendingOutcomes / useOutcomeEvidence → OutcomeEvidence
Shell      MainLayout → useRecentDecisions (react-query; GET decisions/recent, NO schema) · Sidebar → useConnections (GET connections, schema) ·
           usePlan/useWorkspace (GET user/workspace) · useCollabRole (GET roles/me) · usePendingApprovals · InboxPanel (GET inbox)
```

### 12.2 Contract findings

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-01a | 🟠 | **Published field stripped.** `decisionAgreement` (AGREES / DIVERGES + KNOWLEDGE) is written and published by the backend (C-12) and **not declared** in the client schema, so zod strips it | `connectorVerdictService.js:621` publishes it; `grep decisionAgreement client/src` → 0; schema object ends at `humanReasonNote` | `client/src/contracts/schemas/connectorCampaigns.schema.ts:127-137` | the one fact that distinguishes current assessment from stored decision never reaches the client (close-out gate: written → published → **not parsed** → not rendered) | DEFECT | see P0-01 |
| P0-40 | 🟡 | Shell recent-decisions read has **no schema validation** and defaults `decisions || []` | `fetchRecentDecisions` | `client/src/features/shell/services.js:28-32` | a malformed 200 becomes "No decisions yet" | DEFECT | part of P0-03 |
| P0-41 | 🔵 | Two data-fetching paradigms: react-query (1 consumer) vs 35 hand-rolled `useEffect` hooks with no cache; `useConnections` runs up to **3×** per Attention render (Sidebar, ConnectionHealthStrip, useOverviewModel) | caller grep | `client/src/hooks/useConnections.js` and callers | duplicate requests; three independent loading/error states for one fact | DESIGN DEBT | one server-state layer in the rebuild |
| P0-42 | 🟡 | Client **re-derives** a confidence label from a backend number (≥0.8 High, ≥0.6 Medium) | `confidenceLabel` | `client/src/features/content-lab/ContentLabView.jsx:172-175` | the frontend invents a band the backend does not publish (C-09: display, never recompute) | DEFECT | Q12 |
| P0-43 | ⚪ | Dead client verdict authority (`mapContent` derives SCALE/OPTIMIZE/KILL from a score) remains in a **live file** (`fetchers.js` is reachable via `fetchContext`) | file header R8 note | `client/src/hooks/useOrchestrate/fetchers.js:124-150` | none today (pinned unreachable); a delete-by-file in the reset must keep `fetchContext` | OBSERVATION | extract `fetchContext` before removal |
| P0-44 | ⚪ | `workspace.adSetsCount` is rendered by the Sidebar and **produced nowhere** (client or server) | repo-wide grep → 1 hit | `client/src/components/layout/Sidebar.jsx:193-196` | never renders; dead field | OBSERVATION | drop |

---

## 13. Truth / Fallback Audit

The raw pattern counts (`?? 0`, `?? []`, `|| []`, `catch`) were traced in context. Most are honest: they appear inside pure view-models with explicit null handling, or in `?? []` over optional arrays after a successful parse. The violations below were each **confirmed by reading the code path**.

| ID | Sev | Pattern | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|---|
| **P0-03** | 🟠 | failure → `[]` → "No data" | Sidebar "Recent" shows **"No decisions yet"** when `GET /api/lumi/decisions/recent` fails or returns a malformed 200 | `const { data: recentDecisions = [] } = useRecentDecisions()` (react-query `data` is undefined on error); `RecentDecisions` renders "No decisions yet" for `length === 0`; `error` never read | `client/src/components/layout/MainLayout.jsx:32`; `client/src/components/ui/RecentDecisions.jsx:32-35`; `client/src/features/shell/services.js:30` | visible on **every** `/app` page; an outage reads as "Lumi has decided nothing" | DEFECT | shell reads must carry failure distinctly (invariant §31) |
| **P0-04** | 🟠 | failed request → "Connect a channel" | Sidebar shows **"Connect a channel · Start here"** when the connections read fails | `hasConnector = (connectionsData?.connections ?? []).some(…)`; `showConnectCTA = … && !connectionsLoading && !hasConnector`; `useConnections` sets `data: null, error` on failure; Sidebar never reads `error` | `client/src/components/layout/Sidebar.jsx:276-278, 536-556`; `client/src/hooks/useConnections.js:24-31` | a connected account is told to connect during an outage — the exact pattern Attention's CONNECT interrupt was fixed for in B8-02 | DEFECT | same invariant |
| **P0-05** | 🟡 | failure/loading → "Connect Meta" | Campaigns' budget chart says **"No campaign data yet. Connect Meta to see budget allocation."** while the campaigns read is loading or has failed | `hasConnectorData = connectorCampaigns.length > 0`; `useConnectorCampaigns` starts `[]` and stays `[]` on error; chart gates only on `spend === 0` + `hasConnectorData` | `client/src/features/campaigns/CampaignsView.jsx:459, 604`; `client/src/components/campaign-analysis/PerformanceChart.jsx:13-27` | contradicts the honest error rendered above it by `ConnectorCampaignsPanel` | DEFECT | — |
| **P0-06** | 🟡 | failure → onboarding advice | Attention's **FIRST_RUN** interrupt ("Connect a channel to get started") does not exclude `unreadable`; only CONNECT does | `when: (c) => c.firstRunFlag && !c.hasAnyData` vs CONNECT `!c.hasAnyData && !c.unreadable` | `client/src/features/overview/overviewInterrupts.js:26-29, 47-56` | a new account that connected during onboarding and then hits a read failure is told to connect, under a hero that says the account could not be read | DEFECT | — |
| **P0-07** | 🟡 | missing → 0 | Observability "Mission Control" renders **Active / Paused / Queued / Failed (1h) / queue depth / wait** as `0` when the field is absent | `value={liveData?.executions?.failed_last_hour || 0}` (×6) | `client/src/components/observability/MetricsSummary.jsx:29-43` | "Failed: 0" is unknown → healthy; URL-only surface | DEFECT | — |
| **P0-10** | 🟡 | unknown → healthy | Sidebar shows a pulsing green **"WATCHING"** on every account, and RadarStrip says **"Monitoring"**, with no data behind either. `hasHighAlerts` is fed by `alertsData`, which is always `[]` since FE-03 | static JSX; MainLayout FE-03 note | `client/src/components/layout/Sidebar.jsx:182-190`; `client/src/components/layout/RadarStrip.jsx` | asserts continuous monitoring regardless of connection or sync state (the agentic cron is disabled in production) | DEFECT | liveness claims must be measured or absent |
| **P0-14** | 🟡 | unknown verdict → HOLD | `getSignalTokens` falls back to **HOLD** for an unknown verdict | `console.warn(… Falling back to HOLD.)` | `client/src/design-system/signals/signals.js:99-100` (via `VerdictBadge`, live in `ContentLabView`) | an unrecognised verdict is displayed as a real one | DEFECT | unknown verdict renders as unknown |
| P0-17 | 🔵 | static status claim | `/app/copilot` placeholder shows a tile **"Campaign context: Ready"** | `MetricTile value="Ready"` | `client/src/pages/CopilotPage.jsx` | an unmeasured readiness claim | OBSERVATION | — |
| P0-18 | 🔵 | null verdict label | `VerdictPill` with `verdict={null}` renders an empty neutral pill with `aria-label="Verdict: null"`, and supports a non-engine `TEST` verdict | `verdictConfig` includes TEST | `client/src/components/ui/DecisionPill.jsx:4-12, 40-55` | screen-reader text "null"; legacy verdict vocabulary | DESIGN DEBT | — |

**Previously reported defect "dead campaign path → 'No campaigns yet'": RESOLVED.** FE-03 removed `feed.campaigns`, `CampaignFeedContext`, `useCampaignFeed` and `useIntelligenceData` (0 bundle occurrences, verified in the production census). `AnalysisSummary`'s "No campaign data yet" is gone. Attention's CONNECT interrupt excludes `unreadable` (`overviewInterrupts.js:47-56`). The residual siblings are P0-05 and P0-06.

---

## 14. Decision Grammar Audit

| Concept | Exists? | Reusable? | Standalone? | Visual only? | Business logic embedded? | Clear relationship? | Terminology | Lifecycle |
|---|---|---|---|---|---|---|---|---|
| VERDICT | ✓ (`VerdictPill`, `VerdictBadge`) | partly | ✓ | ✓ (pill) | no | live vs stored not distinguished (P0-01) | 6 engine verdicts + legacy TEST / OPTIMIZE | live |
| WHY / REASON | ✓ (rationale, "Lumi's Read", `verdictEvidence`) | Campaigns ↔ Attention share `verdictEvidence.js` | no | no | **yes** (`verdictEvidence.js` 6 consumers, `hypothesisViewModel`, `counterfactualViewModel`) | ✓ within Campaigns | "Lumi's Read" is AI prose; rationale is engine | live |
| EVIDENCE | ✓ (`EvidenceState`, `EvidenceReferenceBlock`, `useEvidence`, C-09 dimensions) | partly | no | no | **yes** | stored provenance shown under live reasoning, labelled | ✓ | stored + live mixed on one panel |
| ACTION | ✓ (`ExecutionContext`, `executeWithLumi`, `useDecisionAction`) | shared | no | no | **yes** (identity routing) | two different "Execute" meanings (P0-13) | ✗ ambiguous | server-authorized |
| DECISION | ✓ destination `/app/decisions(/:id)` | DetailGrammar | ✓ | no | stored row read-only | **no inbound link** from Attention / Campaigns (P0-11) | ✓ "What Lumi decided" | stored |
| OUTCOME | ✓ (`OutcomeEvidence`, `RecordOutcomePanel`, "How it closed" in detail) | local | Memory only | no | yes | detail shows closure timestamps; evidence lives in Memory, not linked from detail | ✓ | stored |
| MEMORY | ✓ `/app/memory` (briefing + proof) | local | ✓ | no | yes | per-campaign memory also on Campaigns panel | ✓ | stored |
| ATTENTION | ✓ `/app/overview` (label "Attention") | — | ✓ | no | `overviewPlan` / `overviewInterrupts` / `overviewDerive` (pure) | URL still `/overview`, file `Home.jsx` | mixed naming | current |
| MEASUREMENT | ✓ `/app/measure`, pacing, OutcomeEvidence | — | ✓ | no | yes | label "Measurement", URL `/measure` | mixed | current + stored |

**Current relationship in the UI:**

```text
Attention card (LIVE verdict) ──► Campaigns panel (LIVE verdict + STORED provenance + actions on STORED id) ──X──► Decision detail
Decisions list ──► Decision detail (STORED) ──X──► campaign lens, outcome evidence
Testing / Holdout detail ──► Decision detail (only forward links into a decision)
```

The product grammar VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY is **present in parts, but not traversable as one path**.

---

## 15. Verdict Audit

| Verdict | Where displayed | Component | Colour: VerdictPill | Colour: VerdictBadge (`signals.js`) | Current / historical | Actionable | Backend-authoritative | Generic badge |
|---|---|---|---|---|---|---|---|---|
| KILL | Attention act-now, Campaigns rows/panel, inbox, sidebar recent, PDF, Content Lab | Pill (4) · Badge (1) | `signal-kill` #EF4444 | kill | live on Attention/Campaigns; stored in sidebar recent / Decisions | yes (PAUSE path) | yes (engine) | rounded-full pill |
| HOLD | same | same | `signal-hold` #F59E0B (= brand accent) | hold | same | no | yes | pill |
| SCALE | same | same | `signal-scale` #10B981 | scale | same | no execution (RESUME only for paused) | yes | pill |
| WATCH | same | same | `signal-watch` #3B82F6 | watch blue | same | no | yes | pill |
| REFRESH | same | same | **`stage-testing` indigo #6366F1** | **watch blue** | same | no | yes | pill |
| REALLOCATE | same | same | **`stage-scaling` cyan #06B6D4** | **hold amber** | same | allocation path | yes | pill |
| TEST / OPTIMIZE | legacy | Pill (TEST), `signals.js` (OPTIMIZE) | indigo | indigo | — | — | **not engine verdicts** | — |

Coarsening: `PerformanceChart` folds 6 verdicts into 3 lanes (HOLD / WATCH / REALLOCATE / REFRESH → "hold"). Attention bands: ACT_NOW = KILL, REALLOCATE (`overviewDerive.js:78`). Budget-at-risk = KILL + REFRESH (a different population, stated separately). `lib/verdictRank.js` ranks verdicts for sorting and PDF.

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-19 | 🟡 | The same verdict renders in **different colours** depending on component (REFRESH indigo vs blue; REALLOCATE cyan vs amber) | two maps | `components/ui/DecisionPill.jsx:4-12`; `design-system/signals/signals.js:44-63` | colour cannot be trusted as a verdict signal | DESIGN DEBT | one verdict token map (Q9) |

---

## 16. AI Surface Audit

| Surface | Where | Data it receives | Displays | Authors numbers? | Authors verdicts? | Authors decisions? | Persistent? |
|---|---|---|---|---|---|---|---|
| Copilot panel | Attention slot (`CopilotPanel`, `useCopilot`) | question + last N messages; server grounds in live account data | free-text answers in chat bubbles; fixed fallback on error | **can, in prose** — numbers in answers are not traceable to rows in the UI | no (text only) | no ("Read-only: it answers, never executes") | ephemeral (React state) |
| Copilot page | `/app/copilot` | none | "Coming soon", waitlist mailto | static "Ready" tile (P0-17) | no | no | — |
| "Lumi's read" (hero) | `AccountStateHero` | sweep narrative, shown only when fresh | one attributed sentence under deterministic counts | prose | no | no | stored (sweep) |
| "Lumi's Read" (campaign) | `CampaignDetailPanel` → `entities/:id/reasoning` | per-campaign reasoning | prose + "Updated … · may be stale" | prose | no | no | stored |
| Leadership narratives | `/app/leadership` → narratives, `narratives/generate` | `StakeholderNarrative` sections + `evidenceRefs` + confidence score | reports | prose; confidence score is computed server-side | no | no | stored |
| Content Lab generation | `/app/content` → `tools/content-generate` | brand context + campaign + engine verdict | generated creative; recommendations keyed on **engine** verdict | copy only | no | no | history stored |
| Legacy orchestrator flows | `useOrchestrate` | — | — | **client-side verdict derivation (dead)** | would | — | unreachable (P0-43) |

The boundary holds structurally: no AI response feeds a verdict, decision or execution. The residual risk is **numeric claims inside AI prose** (Copilot, narratives, reasoning), which the UI presents without provenance.

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-50 | 🟡 | Contradictory AI product claims: Attention hosts a **live** Copilot, `/app/copilot` says **"Coming soon / Join the waitlist"**, and the landing page advertises "NEW · Ask anything … Real answers from live data — in seconds" | three sources | `features/overview/components/CopilotPanel.jsx`; `pages/CopilotPage.jsx`; landing FeaturesSection (production DOM) | the product states three different truths about one capability | PRODUCT RULING | Q6 |
| P0-51 | 🔵 | AI prose can contain numbers with no row provenance in the UI | `useCopilot` renders `answer` verbatim | `client/src/hooks/useCopilot.js:37-43` | "every displayed number traces to a row" is not demonstrable for AI text | ARCHITECTURAL RISK | Q3 |

---

## 17. Data Visualization Audit

| Visualization | Question it answers | Evidence powering it | Decision supported | Flag |
|---|---|---|---|---|
| `PerformanceChart` (stacked spend bar by verdict lane) | where current spend sits by verdict | connector verdict `spendMinor` | reallocation / kill | coarsens 6 → 3 verdicts; false empty state (P0-05) |
| `ProofView` learning-velocity polyline (SVG) | is calibration improving over time | accuracy history | trust in Lumi's calls | — |
| `KpiStrip` / `StatCard` | account KPIs | account aggregate / portfolio | context | generic KPI cards |
| `PacingWidget` | budget pacing | spend-period resolver (#474) | budget | NOT_MEASURABLE in production today |
| `MetricsPanel` / `InlineBar` | per-campaign metric vs benchmark | connector metrics | investigation | — |
| `ConnectionHealthStrip` | connector freshness | connections | data trust | — |
| Relative rank / Impact badge | where a campaign ranks | `relativeRank`, `impactScore` | prioritisation | — |
| Observability `MetricCard`s | execution queue health | observability live | ops | missing → 0 (P0-07) |
| Operations `WorkflowGraph`, `CollisionGraph`, `LiveMonitor`, `ExecutionTimeline` | execution lifecycle (demo) | execute/* | ops demo | **DECORATIVE / PURPOSE UNKNOWN** for operators |
| `LumiLoader` (animated gradient) | none | none | none | **DECORATIVE** |
| Sidebar WATCHING pulse / RadarStrip | none (static) | none | none | **DECORATIVE**, false liveness (P0-10) |
| Landing hero mock, "Why Lumi said KILL" timeline, SignalToAction | illustrate the product | **illustrative numbers** (94% confidence, CTR 1.8% → 0.48%, "Alexandria Villas — July") | persuasion | Q3 |
| Removed: sidebar sparkline `[3,5,2,8,4,6,5]` (R7) | — | — | — | already removed; noted as precedent |

No charting library is used; all visualization is Tailwind or inline SVG.

---

## 18. Card / Surface Audit

The dominant container is `rounded-xl border border-lumi-border bg-lumi-surface (shadow-card)`, with 521 radius and 102 shadow uses.

| Card-like UI | Classification |
|---|---|
| `DecisionCard` (Attention) | **Decision object** |
| Campaign row + `CampaignDetailPanel` | Decision object + Evidence object + Action grouping |
| `ExecutionContext`, `DecisionJudgment` | Action grouping |
| `EvidenceState`, `EvidenceReferenceBlock`, `OutcomeEvidence` shells | Evidence object |
| `AccountStateHero` | Information grouping (account state) |
| `KpiStrip` / `StatCard`, `MetricTile` | Information grouping / generic SaaS KPI card |
| `AgendaBand` `Panel` | Action grouping |
| `FirstRunBanner`, `RevenueOnboardingBanner`, Overview CONNECT block | Navigation grouping (onboarding) |
| `EmptyPanel`, `UpgradePrompt`, `NotFound` card | state container |
| `DetailSection` | Information grouping (B8 grammar) |
| Settings / Admin panels | Information grouping |
| Landing capability grid, TrustedBy three cards, pricing tiers | **Generic SaaS card** |
| CopilotPage tiles | **Decorative container** |
| Sidebar WATCHING / Radar strips | **Decorative container** |
| Operations demo cards | Unknown (demo) |

---

## 19. Responsive Audit

**Measured in production (public pages only)**

| Viewport | Landing `/` | Login `/login` |
|---|---|---|
| 375 × 812 | no horizontal overflow; page height 10,623 px; 9 sections; **16 of 18 interactive elements < 44 px tall** | — |
| 768 × 1024 | no horizontal overflow | — |
| 1024 × 768 | no horizontal overflow | — |
| 1440 × 900 | no horizontal overflow; page height 6,584 px | no overflow; inputs labelled |

**Source-only (authenticated shell, not observable)**
- Mobile menu: `MainLayout` `mobileMenuOpen` with a `lg:hidden` backdrop, and the Sidebar collapses (268 / 64 px).
- There are 200 breakpoint-prefixed classes across reachable files.
- 4 `hidden sm|md|lg:` action-hiding patterns.
- **Tables:** 11 files render `<table>`. 6 have an `overflow-x-auto` wrapper in the same file (4 admin tabs, `ConnectorCampaignsPanel`, `OutcomeEvidence`); **5 do not** (`AllocationPanel`, `BlendedTruthView`, `GoalsPanel`, `ProofView`, `RevenueCsvTab`). Parent-level wrappers were not verified, so those 5 are **UNKNOWN**.
- No duplicated mobile-only components found.

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-60 | 🟡 | No responsive or accessibility verification exists. The Playwright suite targets **retired** flows (Command Center FSM, CSV upload), and its committed failure artifacts (2026-05-12) all failed with `ERR_CONNECTION_REFUSED` | `client/test-results/*/error-context.md`; `client/tests/e2e/*.spec.cjs` | `client/tests/e2e/`, `client/test-results/` | a reset has no behavioural baseline for layout or accessibility | DESIGN DEBT | baseline measurements of the authenticated app before replacement (requires an authenticated harness) |

---

## 20. Accessibility Audit

| Area | Evidence | Status |
|---|---|---|
| Skip link | `index.html` + MainLayout link to `#main-content`; the target exists **only in MainLayout** | ❌ broken on `/`, `/login` (production DOM: no target) |
| Landmarks | landing: `nav` + `footer`, **no `main`** | 🟡 |
| Headings | landing has one H1 and ordered H2/H3; 27 `<h1>` across feature/page code | ✓ landing; app not measured |
| Labels | login inputs labelled (production) | ✓ |
| ARIA | 157 `aria-*`, 52 `role=` in reachable code; `PerformanceChart` `role="img"` + label; `ProofView` SVG labelled | partial |
| Interactive semantics | 13 `onClick` on non-button elements (8 files: MainLayout backdrop, CommandPalette, ConfirmModal ×2, DeleteWorkspaceDialog ×2, ContentLabView ×3, CopilotPanel, Operations); `RecentDecisions` rows are `<button>` **with no handler** | 🟡 |
| Modals / focus | 6 files declare `role="dialog"`/`aria-modal`; only 3 use `useFocusTrap` (CommandPalette, SecurityTab, RawAuditLogModal). **ConfirmModal, DeleteWorkspaceDialog, CopilotPanel do not trap focus** | 🟡 |
| Tooltips | `HelpTip` tooltip (hover / focus) and popover (click) variants | ✓ partial |
| Focus states | 133 `focus:`/`focus-visible:` uses; `--focus-ring` variable | partial |
| Contrast | `text-lumi-subtle` `#9A9A9A` on `#F8F6F2`/`#FFF` is used widely for real content; 9–10 px verdict labels | ⚠️ not measured (likely below 4.5:1) → UNKNOWN |
| Reduced motion | **global** `@media (prefers-reduced-motion: reduce)` override zeroes animations and transitions | ✓ |
| Touch targets | 16 of 18 landing interactive elements under 44 px at 375 px | 🟡 |

---

## 21. Performance Audit

**Measured production assets (`a3ec116`)**

| Asset | Raw | gzip | Loaded |
|---|---|---|---|
| `index-BS0rr8x2.js` (entry) | 584,759 B | 164,533 B | every page, including landing |
| `vendor-react` | 179,878 | 58,992 | every page |
| `vendor-firebase` | 166,042 | 33,614 | every page |
| `index-Dn9gzeJZ.css` | 106,596 | 29,032 | every page |
| **First load, public landing** | **≈ 1.04 MB** | **≈ 286 KB** | |
| `jspdf.es.min` / `html2canvas` / `index.es` / `purify` | 390 K / 202 K / 151 K / 29 K | 127 / 47 / 51 / 11 K | lazy (PDF export) |
| `NotoNaskhArabic-Regular.ttf` | 197,420 | 93,352 | PDF export |
| Largest route chunks | CampaignAnalysis 68 K, index (Operations) 47 K, AdminPanel 40 K, GrowthStrategy 45 K, MemoryView 30 K | | lazy |

| ID | Sev | Finding | Evidence | Location | Impact | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| P0-70 | 🟡 | The public landing page downloads the **entire eagerly-imported app**: Attention, Content Lab, Settings, Onboarding, Auth, Observability, Copilot, Tools and the full shell (40 schemas) | static imports in `App.jsx:18-31`; entry 164.5 KB gzip | `client/src/App.jsx` | first paint cost on the marketing page; the landing is meant to become the design system's first expression | DESIGN DEBT | split public and app bundles in the reset |
| P0-71 | 🔵 | Duplicate uncached fetches (`useConnections` ×3 on Attention; verdicts and campaigns fetched by several hooks on one page) | §12 P0-41 | hooks | redundant network | DESIGN DEBT | — |
| P0-72 | 🔵 | Unused dependencies `xstate`, `@xstate/react`; 55 unreachable files (5,009 LOC); continuous `animate-pulse`/`pulse` loops in the always-mounted sidebar | graph | `client/package.json`; §29 | install weight; constant repaint | OBSERVATION | — |

---

## 22. Landing Page Audit

*Source:* `client/src/pages/LandingPage/*`. Verified in production at the 4 viewports.

| Aspect | Current implementation |
|---|---|
| Sections (order) | Navbar → **Hero** "Know what to do next. After every sync." → **SignalToAction** "From signal to action." (5 steps: synced → weak signals → verdict → action → performance improves) → **TrustedBy** "Used by performance marketers who are tired of staring at dashboards." → **CapabilitiesGrid** "Every campaign gets a verdict. Not another metric." (Always watching, Clear verdicts, Ask anything, Audience fatigue forecast, Revenue-based scoring, Weekly narratives) → **WhyLumiDecides** "Why Lumi said KILL" (a dated decline timeline) → **HowItWorks** "From connect to first verdict — in minutes." → **Pricing** Free / Growth / Pro → **BottomCTA** → Footer |
| Message | verdicts, not dashboards; decision-first; MENA ("EGP · SAR · AED native") |
| CTA | "Connect Meta — Get my first verdict", "Request early access", "Start free", "Get started", "Contact us" (five CTA phrasings) |
| Visuals | a coded product mock ("Lumi — Campaign Analysis · Alexandria Villas — July · KILL 94%"), an illustrative timeline, lucide icons; `ScreenshotGallery.jsx` exists but is **unreachable** ("Preview coming soon") |
| Product representation | a KILL example dominates; SCALE / HOLD / WATCH are named in copy; REFRESH / REALLOCATE are absent from the capability copy |
| Objections | none addressed explicitly |
| FAQ | **none** |
| Trust / data integrity | one line: "Your campaign data stays in your workspace. Never shared." (see Q7) |
| Memory explanation | one capability bullet ("Decision Memory — Lumi learns from every verdict") |
| Walkthrough | SignalToAction + HowItWorks (3 steps) |
| Responsive | no overflow at 375–1440; touch targets under 44 px; no `<main>`; skip-link target missing |

Gaps against the Master Spec landing requirements: FAQ, objections, a trust / data-integrity section, a Decision Memory explanation and a meaningful walkthrough are **absent or single-line**.

---

## 23. Anti-Convergence Audit

| Pattern | Present? | Where | Flag |
|---|---|---|---|
| Chat-first UI / assistant bubbles / generic prompt box | **yes** | `CopilotPanel` on Attention ("Ask about your campaigns...", message bubbles, typing indicator); landing "Ask anything" | 🟡 generic AI-copilot convergence |
| "AI Copilot" framing with Bot / Sparkles icons | **yes** | `CopilotPage` (Bot icon, "AI Copilot" eyebrow, "Early access" chip); `Sparkles` on "Lumi's read" | 🟡 |
| Decorative gradients | yes (22) | `LumiLoader`, `HeroSection`, `Sidebar`, `ProfileTab`/`TeamTab` avatars, `StatCard` | 🔵 |
| Glassmorphism / backdrop blur | limited | `--glass-*` variables; modal backdrops `backdrop-blur-sm`; `LumiLoader` blur | 🔵 |
| Glow / neon | **yes** | 6 glow shadow tokens; `shadow-accent-glow` on primary CTAs and the skip link; `shadow-gold-glow` on landing CTA; pulsing dots | 🟡 |
| Floating AI orbs | not found | — | — |
| Generic dashboard cards | yes | `KpiStrip`/`StatCard`, `MetricTile`, landing capability and TrustedBy cards, CopilotPage tiles | 🟡 |
| Decorative charts | yes | Operations demo graphs; `LumiLoader`; WATCHING / Radar liveness | 🟡 |
| Emoji as UI icons | yes | Observability `MetricCard icon="▶" "⏸" "⏳" "✖"` | 🔵 |

---

## 24. Dependency Map

```text
LEGEND  [H] HIGH coupling to backend truth   [L] LOW   [D] DUPLICATED   [X] DEAD   [?] UNKNOWN

main.jsx ─ AuthProvider[H: Firebase] ─ ServerStateProvider[L] ─ BrowserRouter
  └ App.jsx [H: routes + gates]
     ├ /            LandingPage [L] (10 files, 0 endpoints)
     ├ /login       AuthPage [H: Firebase auth] ─ components/primitives [D]
     ├ /onboarding  OnboardingRoute[H] ─ Name/Connect/Sync/Ready [H: connections, sync, context]
     │               └ 14 legacy step files + shared.jsx [X]
     ├ /admin       RequireUserRole ADMIN[H] ─ AdminPanel [H: /api/admin/* incl. plan + role PATCH]
     └ /app         ProtectedRoute[H] ─ MainLayout
          ├ RoleProvider[H: roles/me] · Sidebar [H: role+plan filter, connections, recent decisions] [D: WATCHING/Radar decorative]
          ├ overview    OverviewView ─ useOverviewModel[H] ─ overviewDerive/Plan/Interrupts/State[H pure] ─ DecisionCard[H]
          │                ─ features/campaigns/{verdictEvidence, ExecutionContext, useDecisionAction, useDecisionJudgment}[H] ◄── shared with Campaigns
          ├ campaigns   CampaignsView[H] ─ ConnectorCampaignsPanel[H] ─ CampaignDetailPanel[H] ─ executionSignals → POST /api/execute/meta [H, money]
          ├ decisions   DecisionHistory/DetailView[H] ─ design-system/{patterns,states}[H grammar]
          ├ memory      MemoryView ─ AccountBriefing[H] + ProofView ─ OutcomeEvidence[H exemplar] ─ RecordOutcomePanel[H]
          ├ connections ConnectorsView[H] ─ startConnect → /api/auth/meta/connect [H OAuth]
          ├ testing/:id, measure/:id  Detail views[H] ─ DetailGrammar + confidence.js
          ├ intelligence/*  BlendedTruth[H] · InsightsView[H: 6 panels]
          ├ content     ContentLabView[H: AI gen] ─ VerdictBadge→signals.js [D, unknown→HOLD]
          ├ settings    SettingsView[H: team, roles, revenue CSV, account deletion]
          ├ copilot / tools/*  placeholders [L]
          └ observability · demo/operations · approvals/:id  [?]
  shared leaves: lib/api.js[H] · contracts/schemas (41)[H] · lib/money.ts (22 consumers)[H] · lib/currencyFormatter.js[D with money.ts]
                 · app/routeManifest.js[H] · @marcom/runtime-contracts[H]
  dead: src/layouts/* · components/assemblies/* · src/primitives/* (live-dead) · design-system/flows · contracts/adapters/* ·
        contracts/registry.ts · contracts/result · contracts/telemetry · types/{api,auth,errors,sse,index}.ts · services/useSSE.ts ·
        hooks/useExecutionReconciliation* · hooks/useOrchestrate(.js,/index.js) · config/routes.ts · components/dev/ComparisonHarness.tsx ·
        pages/{Proof,OperationsPage}.jsx · LandingPage/ScreenshotGallery.jsx · lib/{dateUtils,metricDisplay}.js · 5 feature index.js barrels
```

---

## 25. KEEP

Survives the reset as **behaviour and contract**. Visuals may change.

| Artifact | Why |
|---|---|
| `AuthContext`, `firebase.js`, `lib/api.js` token interceptor | authentication truth |
| `ProtectedRoute`, `OnboardingRoute`, `RoleGate`, `PlanGate`, `RequireUserRole`, `LockFromClient`, `RoleAwareRedirect`, `RoleContext`/`useCollabRole`, `usePlan` | authorization and entitlement semantics |
| `app/routeManifest.js` addresses + App.jsx redirect table | deep links, bookmarks, OAuth return (`settings/integrations`) |
| `contracts/schemas/*` (41) + `@marcom/runtime-contracts` vocabularies | the parse layer (B8-01) |
| `design-system/states/absence.js`, `confidence.js`, `DetailGrammar` behaviour | locked state grammar |
| `OutcomeEvidence.jsx` state branches | STATE EXEMPLAR |
| `lib/money.ts` (minor-unit currency, 22 consumers) | currency semantics |
| `features/campaigns/{gatingReasonCopy, verdictEvidence, executionSignals, judgmentVocabulary, useDecisionAction terminalStateFor}` | C-07, C-09, execution identity, judgment semantics |
| `features/overview/{overviewDerive, overviewPlan, overviewInterrupts, overviewState}` (pure) | Attention logic (P0-06 fix aside) |
| `PacingWidget` / allocation NOT_MEASURABLE copy (#474) | spend-window integrity |
| `design-system/lint/no-generic-tailwind.js`, `scripts/checkTokenResolution.js` | enforcement mechanisms |
| global reduced-motion override | accessibility |

## 26. EVOLVE

`VerdictPill` (→ the single verdict primitive) · `PageHeader` · `HelpTip` · `CommandPalette` · `UpgradePrompt` · `DecisionCard` · `ConnectorCampaignsPanel` / `CampaignDetailPanel` / `ExecutionContext` / `DecisionJudgment` (keep the logic, re-express the grammar) · `AccountStateHero` · `PacingWidget` · `KpiStrip` · `ProofView` · `AccountBriefing` · `FirstRunBanner` · the token JSON single-source mechanism · `motion.json` · typography roles.

## 27. CONSOLIDATE

| Into one | From |
|---|---|
| state container | `StateBlock` (Empty/Error/Loading), `EmptyPanel`, per-feature ad-hoc states |
| loading | `CardSkeleton`/`Skeleton`, `LumiLoader`, inline `Loader2` spinners |
| panel / container | `components/ui/Panel.jsx`, `src/primitives/Panel.tsx`, raw `rounded-xl border` blocks |
| metric display | `MetricTile`, `StatCard`, `MetricValue`, `KpiStrip` cards, Observability `MetricCard` |
| verdict display + colour map | `VerdictPill`, `VerdictBadge`, `signals.js`, `DecisionPill.verdictConfig`, `PriorityBadge`/`StageBadge` (dead) |
| typography API | CSS role classes, `components/primitives/typography/*`, arbitrary px sizes |
| modal | `ConfirmModal`, `DeleteWorkspaceDialog`, `RawAuditLogModal` (with focus trap) |
| error boundary | `components/ErrorBoundary.tsx`, `components/ui/ErrorBoundary.jsx` |
| currency formatting | `lib/money.ts`, `lib/currencyFormatter.js` |
| server-state fetching | react-query (1) + 35 hand-rolled hooks |
| colour tokens | `surface-*`/`dark-*`/`lumi-*`/`signal-*`/`trend-*`/`stage-*`/`radar-*`/`intel-*`/`verdict-*` + 5 CSS variable namespaces |

## 28. REPLACE

`Sidebar` visuals (keep gating) · `MainLayout` / `ContextBar` visuals · `RecentDecisions` · `RadarStrip` + WATCHING status · `LumiLoader` · `PerformanceChart` / `MetricsPanel` / `InlineBar` · `VerdictBadge` + `signals.js` · `CopilotPage` · `index.css` (keep reduced-motion) · token *values* (→ Master Spec) · landing page · `spacing.json` shadows/glows · `index.html` meta and theme · design-system governance docs (June 2026) · Observability `MetricsSummary` (if the surface survives, Q5).

## 29. REMOVE

To be removed **later**, after replacement parity, and never in Phase 0.

| Artifact | LOC | Evidence |
|---|---|---|
| `src/layouts/*.tsx` (7 files) | 712 | unreachable |
| `components/assemblies/*` | 121 | unreachable |
| `src/primitives/*.tsx` + `index.ts` | 562 | 0 live JSX consumers |
| `components/primitives/flows/*` (except any live `Input*`) | — | 0 live consumers |
| `design-system/patterns/{EvidencePanel,RecommendationCard}.jsx` | — | 0 consumers |
| `design-system/flows/decisionFlows.js` | 257 | unreachable |
| `contracts/{adapters,registry.ts,result,telemetry}` | 763 | unreachable (`contractDrift.ts` has an unresolved import `@/contracts/telemetry`) |
| `types/{api,auth,errors,sse,index}.ts` | 1,020 | unreachable |
| `services/{index.ts,useSSE.ts}` | 236 | unreachable (live SSE is `services/sseClient.ts`) |
| `hooks/useExecutionReconciliation*`, `hooks/useOrchestrate.js` + `/index.js` | 244 | unreachable (keep `useOrchestrate/fetchers.js#fetchContext`) |
| `config/routes.ts`, `components/dev/ComparisonHarness.tsx` | 305 | unreachable (Dead Code Register agrees) |
| `pages/Proof.jsx`, `pages/OperationsPage.jsx`, `pages/Settings/index.jsx` | 89 | unreachable |
| `pages/OnboardingPage/steps/{Audience,Channels,Identity,Industry,Objective,Plan,Review,Spend,Step1Company,Step2Business,Step3Voice,Voice,Welcome}Step.jsx` + `shared.jsx` | 1,092 | unreachable (live wizard: Name/Connect/Sync/Ready) |
| `pages/LandingPage/ScreenshotGallery.jsx`, `lib/dateUtils.js`, `lib/metricDisplay.js`, 5 feature `index.js` barrels | 170 | unreachable |
| `blush` token, `xstate`, `@xstate/react` | — | orphaned / unused |
| `client/test-results/**` (committed artifacts) + e2e specs for retired flows | — | stale evidence |

## 30. UNKNOWN

| Item | Why unknown | What would measure it |
|---|---|---|
| Real usage of `/app/observability`, `/app/demo/operations`, `/app/approvals/:id` | no usage telemetry read | production request logs per path (client-side routes need analytics) |
| Authenticated render at mobile / tablet | auth wall | an authenticated browser session |
| Contrast ratios | not computed | automated contrast scan on the authenticated app |
| The 5 tables without a same-file overflow wrapper | parent containers not traced | render at 375 px |
| Frequency of live verdict ≠ stored PROPOSED decision (P0-01) | backend behaviour, not measured | query `decisionAgreement = DIVERGES` rate from the verdicts read |
| Whether `PATCH …/by-entity/:entityId/execute` without a decisionId resolves to the decision the card was showing (P0-02) | server resolution not traced here | backend route trace |
| `design-system/codemods/` | not in any build path, not traced | — |
| Master Spec content beyond quoted fragments | not in repository | the spec itself |
| Mixed-currency state per surface | not traced surface by surface | per-surface trace of `accountAggregate` currency agreement |

---

## 31. Critical Frontend Invariants

These must survive the reset. Each is stated against current evidence.

| Invariant | Where it lives today | Status |
|---|---|---|
| **Backend truth** — the client never computes a verdict, class, confidence band or eligibility | engine verdicts; `decisionClass` received; `execution` descriptor from the server | holds, except P0-42 (client confidence band) and P0-14 (unknown → HOLD) |
| **Tenant isolation** | server `requireWorkspace`; client carries no workspace id in URLs for data | holds (server-side) |
| **Authentication** | ProtectedRoute, Firebase token interceptor | holds |
| **Authorization / role behaviour** | RoleGate, LockFromClient, CLIENT → Reports | holds for primary surfaces; gaps P0-20 |
| **Plan gates** — surface gate = API gate (B7 Ruling 3) | PlanGate + `requirePlan` | holds; nav hides rather than locks (P0-12) |
| **Route behaviour + deep links** | routeManifest + 8 redirects, including the OAuth return | holds |
| **Decision ownership** — a Decision has its own address | `/app/decisions/:id` | holds; not linked from Attention / Campaigns (P0-11) |
| **Assessment ≠ Decision** — "Decisions are acted on. Assessments are recomputed. Neither rewrites the other." | backend publishes both plus `decisionAgreement` | **violated in presentation** (P0-01, P0-02) |
| **Execution boundaries** — only server-declared executable actions; the stored decision re-authorized at mutation time | `executeWithLumi` + backend `loadExecutability` (status / dismissed only) | holds for status; the backend does **not** check action vs stored verdict (P0-01 note) |
| **AI authority boundary** — AI explains, never authors verdict, decision or action | Copilot read-only; narratives attributed | holds structurally; numeric prose unprovenanced (P0-51) |
| **Currency semantics** — minor units per currency exponent | `lib/money.ts` | holds (duplicate formatter exists) |
| **Measurement semantics** — windows must match periods (#474) | spendPeriod, PacingWidget | holds |
| **Evidence semantics** — value + basis; three-state flags | `verdictEvidence.js` | holds |
| **Outcome semantics** — seven statuses, UNAVAILABLE ≠ NOT_MEASURABLE | OutcomeEvidence | holds (exemplar) |
| **Memory semantics** — checks published beside accuracy, never reconciled | AccountBriefing | holds |
| **Honest absence** — `null ≠ 0`, `failed ≠ empty`, `unknown ≠ healthy`, `unavailable ≠ zero` | absence grammar | **violated in shell and secondary surfaces** (P0-03…P0-07, P0-10) |
| **No fabricated numbers** | R7 removed sparkline; `—` for null | holds in-app; landing illustrative numbers (Q3); AI prose (P0-51) |
| **No silent failures** | B8 surfaces | violated where failures render as empty (above) |

---

## 32. Risks

| ID | Sev | Risk | Why |
|---|---|---|---|
| R-1 | 🔴 | **Hidden product logic deleted with its component.** Verdict evidence, gating reasons, execution identity routing, judgment terminal states, Attention interrupts and money formatting live inside feature folders that look like UI | a visual reset that deletes `features/campaigns` or `features/overview` without extracting these reintroduces fixed defects (C-07, C-09, C-12, R13, B8-02, #474) |
| R-2 | 🟠 | **Rebuilding on the wrong primitive layer.** Four layers exist; the "canonical" CVA layer is unused | inheriting any of them imports its drift |
| R-3 | 🟠 | **Porting the current-vs-stored confusion into the new UI.** P0-01 is structural, not visual | a redesigned card with the same props repeats it |
| R-4 | 🟠 | **Freezes and governance docs contradict the reset** (TAXONOMY-FREEZE, PRIMITIVE-FREEZE, CLAUDE.md file budgets) | without explicit supersession, every new primitive "violates" a written rule |
| R-5 | 🟡 | **No baseline to prove parity.** No working e2e, responsive or accessibility suite; authenticated surfaces unobservable without a harness | "the new frontend does what the old one did" cannot be demonstrated |
| R-6 | 🟡 | **Brand / semantic palette collision re-created** if the Master Spec gold or amber is mapped onto existing token names | HOLD and brand share names today |
| R-7 | 🟡 | **Unspecified verdicts.** Master Spec fragments define KILL / HOLD / SCALE colours only; the engine emits six | WATCH / REFRESH / REALLOCATE need a ruling |
| R-8 | 🔵 | Deleting `useOrchestrate/fetchers.js` breaks onboarding context (`fetchContext`) | live function in a dead file |

---

## 33. Questions Requiring Product Decision

Documented, **not decided**.

| # | Question | Evidence |
|---|---|---|
| Q1 | How is the **current assessment vs the stored decision** presented on acting surfaces, given B7-06 ("never shown side by side as a diff") and the published `decisionAgreement`? | P0-01 |
| Q2 | Should Attention's Execute / Dismiss write to the **stored decision id** (as Campaigns does) or remain by-entity? And should "Execute" (record that I did it) and "Execute with Lumi" (platform mutation) keep sharing a word? | P0-02, P0-13 |
| Q3 | Does **"every number traces to a DB row"** apply to (a) illustrative landing and marketing visuals and (b) numbers inside AI prose? | §17, P0-51 |
| Q4 | Are `TAXONOMY-FREEZE.md` / `PRIMITIVE-FREEZE.md` / CLAUDE.md file-size budgets **superseded** by the reset? | P0-31 |
| Q5 | Do URL-only surfaces survive: `/app/copilot` placeholder, `/app/tools/*` placeholders, `/app/observability`, `/app/demo/operations`? | §4 |
| Q6 | What is the Copilot's product truth: live panel on Attention, "Coming soon" page, or landing "NEW · Ask anything"? And is a chat-first panel compatible with anti-convergence? | P0-50, §23 |
| Q7 | Is the landing claim "Your campaign data stays in your workspace. Never shared." compatible with the opt-in network features (`POST /api/lumi/network/consent`)? | §22 |
| Q8 | Should plan-locked navigation items be **hidden** (current code) or **shown locked** (what the Sidebar header comment says)? | P0-12 |
| Q9 | What are the semantic colours for **WATCH, REFRESH, REALLOCATE** in the new palette? | §15, R-7 |
| Q10 | Should Attention and Campaigns link a decision to its own destination (`/app/decisions/:id`), and should the detail link back to the campaign lens and outcome evidence? | P0-11 |
| Q11 | Light, dark, or both? The Master Spec names Charcoal; the app is light; `index.html` declares dark. | P0-16 |
| Q12 | Should the backend publish a confidence **label**, instead of the client bucketing 0.8 / 0.6? | P0-42 |
| Q13 | Does Growth Strategy (goals · economics · plans · approvals · fatigue in one view) remain one surface? | §4 (FE plan had already flagged mixed axes) |

---

## 34. Recommended Reset Sequence

This is a sequence recommendation, not a plan of work. Each step is gated on Omar's review.

```text
0. REVIEW      Omar rules on Q1–Q13; stop conditions (§35) acknowledged.
1. CONSTITUTE  New design constitution: Master Spec tokens with DISJOINT brand vs verdict names (6 verdicts),
               one primitive layer, one state container; explicit supersession of the June governance docs.
2. PIN BEHAVIOUR  Before any replacement, freeze the §25 KEEP set and the §31 invariants as behaviour tests that do not
               depend on markup: routes + gates + redirects, absence/confidence grammar, OutcomeEvidence statuses,
               gating reasons, money, execution identity, judgment terminal states, Attention interrupts.
               Stand up an authenticated measurement harness (layout, a11y, contrast) to capture the baseline (R-5).
3. FOUNDATION  Tokens → primitives → state components → verdict primitive, with lint/resolution tooling pointed at them.
4. LOW COUPLING FIRST  Landing (first expression of the system, no backend coupling) and public/app bundle split.
5. GRAMMAR SURFACES  Decisions, Decision Detail, Testing/Holdout detail, Connectors, Memory: already on the B8 grammar,
               lowest behavioural risk.
6. SHELL      Sidebar / MainLayout / command palette, fixing honest-state invariants P0-03, P0-04 and P0-10 by construction.
7. HIGH COUPLING  Attention and Campaigns last: they carry the hidden logic (R-1) and the Q1/Q2 rulings.
8. REMOVE      §29 only after parity is proven per surface; never delete by filename (R-8).
```

---

## 35. Phase 0 Verdict

**Stop conditions encountered.** They were reported, not resolved.

1. **Frontend behaviour contradicts a locked product invariant.** "Decisions are acted on. Assessments are recomputed." is not violated in data, but it is **collapsed in presentation**. The live verdict is shown while actions attach to the stored decision (P0-01), and Attention and Campaigns resolve that identity differently (P0-02). The honest-absence invariant is violated in the shell (P0-03, P0-04, P0-10) and in secondary surfaces (P0-05 to P0-07).
2. **Documentation contradicts repository behaviour.**
   - The `Sidebar.jsx` header says plan-locked items "render LOCKED … rather than hidden" (`:63-66`); the code hides them (`Sidebar.jsx:248-256`).
   - The `DecisionCard.jsx` header says "Nothing here executes"; the card wires `onExecute` / `onDismiss` (`:14` vs `:171-172`).
   - The `design-system/*.md` governance docs describe a June 2026 adoption state.
3. **Liveness undeterminable** for Observability, Operations demo and the Approval Queue (§30).
4. **The Master Spec is not in the repository**, so a spec-vs-product-truth contradiction can only be checked against the quoted fragments. One gap is visible: three of the six engine verdicts have no specified colour.

None of these requires a backend change to *understand* the frontend. The backend already publishes the facts the frontend drops (`decisionAgreement`, `decisionVerdict`). No reachable route requires a backend contract that does not exist.

```text
READY WITH ARCHITECTURAL QUESTIONS
```

---

### Appendix — Findings Register (P0-01, P0-02, P0-11, P0-12, P0-13 in full)

**P0-01 · 🟠 HIGH · Live verdict shown, stored decision acted on**
- **Evidence:**
  - `CampaignsView.jsx:366-372` projects `decisionId` and `decisionVerdict` beside the live `verdict`. `decisionVerdict` has **0 consumers** in `client/src`.
  - `ConnectorCampaignsPanel.jsx:515-541` routes Execute / Dismiss / Judgment to `info.decisionId`.
  - `decisionAgreement` is published by `src/services/verdict-engine/connectorVerdictService.js:621` and stripped client-side (P0-01a). The backend's own header in `decisionAgreement.js:14-17` names this frontend omission.
  - Backend `loadExecutability` checks only `status === 'PROPOSED'` and `dismissedAt` (`src/services/execution/decisionEligibility.js:62-72`), so an action is not checked against the stored verdict.
- **Location:** `client/src/features/campaigns/CampaignsView.jsx`, `ConnectorCampaignsPanel.jsx`, `client/src/contracts/schemas/connectorCampaigns.schema.ts`.
- **Impact:** when the live verdict and the stored PROPOSED decision diverge, the operator's judgment and execution are attributed to a call they were not shown. That is a learning and memory integrity risk. Divergence frequency is **UNKNOWN**.
- **Classification:** DEFECT + PRODUCT RULING (Q1).
- **Recommendation:** treat the P0-01a close-out as a precondition of any rebuilt decision surface; do not redesign the card before Q1.

**P0-02 · 🟠 HIGH · Same action, two identity rules**
- **Evidence:**
  - Attention's `DecisionCard.jsx:171-172` calls `execute(entityId)` / `dismiss(entityId)` with **no** decisionId (by-entity; the server re-resolves the newest), although the card receives `decisionId` (`:45`).
  - Campaigns (`ConnectorCampaignsPanel.jsx:518-525`) passes the stored id and documents why: "so the write lands on THAT row rather than on whatever the server re-resolves as newest at click time".
- **Location:** `client/src/features/overview/components/DecisionCard.jsx`.
- **Impact:** identical buttons on two surfaces can write to different Decision rows.
- **Classification:** DEFECT / PRODUCT RULING (Q2).
- **Recommendation:** one identity rule for the rebuilt action primitive.

**P0-11 · 🟡 MEDIUM · Decision destination not reachable from where decisions are shown**
- **Evidence:** links to `/app/decisions/:id` exist only in `DecisionHistoryView.jsx:46`, `TestingView.jsx:169`, `TestDetailView.jsx:165` and `HoldoutDetailView.jsx:192`. None exist in Attention or Campaigns. The detail view links only back to the list (`DecisionDetailView.jsx:99`).
- **Impact:** the VERDICT → DECISION → OUTCOME → MEMORY path is not traversable.
- **Classification:** ARCHITECTURAL RISK (Q10).
- **Recommendation:** rule on edges before IA expression.

**P0-12 · 🔵 LOW · Plan-locked navigation hidden, contrary to the file's own header**
- **Evidence:**
  - `Sidebar.jsx:63-66` says "renders LOCKED (dimmed + upgrade tooltip) rather than hidden".
  - `Sidebar.jsx:248-256` says "locked items are hidden completely" and filters them out.
- **Impact:** FREE workspaces cannot discover Memory, Testing, Measurement, Intelligence or Publishing from the nav.
- **Classification:** PRODUCT RULING (Q8).

**P0-13 · 🔵 LOW · "Execute" means two things**
- **Evidence:**
  - `useDecisionAction` executes `recordExecute`, which records that the human did it (PATCH by-entity/execute).
  - `executeWithLumi` performs a platform mutation (POST `/api/execute/meta`).
  - Both sit in the same Campaigns panel family.
- **Impact:** terminology ambiguity at the money boundary.
- **Classification:** DESIGN DEBT (Q2).
