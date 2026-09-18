// ============================================================
// MARCOM / Lumi — Routing shell  (Phase 1 of the OS pivot)
// ------------------------------------------------------------
// Public:    /                LandingPage
//            /login, /signup  AuthPage
// Gated:     /onboarding      OnboardingRoute
//            /app/*           ProtectedRoute → MainLayout
//   index → /app/feed
//   feed       → CommandHub
//   campaigns  → CampaignAnalysis (lazy)
//   growth     → GrowthStrategyBoard (lazy)
//   tools/*    → MarketingTools | SocialCalendar | ScoreContent
//   settings   → Settings
// ============================================================
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import LandingPage      from './pages/LandingPage.jsx';
import PrivacyPage      from './pages/PrivacyPage.jsx';
import TermsPage        from './pages/TermsPage.jsx';
import AuthPage         from './pages/AuthPage.jsx';
import { CardSkeleton } from './components/ui/Skeleton.jsx';
import { ProtectedRoute, OnboardingRoute, AdminRoute, FullscreenLoader } from './router/ProtectedRoute.jsx';
import RoleGate from './components/auth/RoleGate.jsx';
import PlanGate from './components/auth/PlanGate.jsx';
import UpgradePrompt from './components/plan/UpgradePrompt.jsx';
import RequireUserRole from './components/auth/RequireUserRole.jsx';
import { useCollabRole, WORKSPACE_ROLE } from './hooks/useCollabRole.js';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { appRoutes } from './app/routeManifest.js';

// ── Phase 5.4 · the authenticated half is deferred ────────────
// These were static imports, so every visitor to the PUBLIC landing downloaded
// the app shell, the operator home, Content Lab, Copilot, the tools, Settings
// and Observability before `/` could paint. Not one of them is reachable
// without a session, and the landing reads none of them.
//
// The shell is deferred with them, which costs a signed-in visitor one chunk
// fetch after the guards resolve. That trade is deliberate: the wait belongs
// to the surface that needs the code, not to the marketing page.
const MainLayout     = lazy(() => import('./components/layout/MainLayout.jsx'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.jsx'));
const HomePage       = lazy(() => import('./pages/Home.jsx'));
const ContentLab     = lazy(() => import('./pages/ContentLab/index.jsx'));
const CopilotPage    = lazy(() => import('./pages/CopilotPage.jsx'));
const MarketingTools = lazy(() => import('./pages/tools/MarketingTools.jsx'));
const SocialCalendar = lazy(() => import('./pages/tools/SocialCalendar.jsx'));
const ScoreContent   = lazy(() => import('./pages/tools/ScoreContent.jsx'));
const SettingsPage   = lazy(() => import('./pages/Settings.jsx'));
const Observability  = lazy(() => import('./pages/Observability.jsx'));

// ── Heavy views — lazy-load to keep the initial bundle slim ──
const CampaignAnalysis    = lazy(() => import('./pages/CampaignAnalysis.jsx'));
const GrowthStrategyBoard = lazy(() => import('./pages/GrowthStrategyBoard.jsx'));
const Operations          = lazy(() => import('./pages/demo/Operations/index.jsx'));
const ApprovalQueue       = lazy(() => import('./pages/ApprovalQueue.jsx')); // PR #36
const Publishing          = lazy(() => import('./pages/Publishing.jsx'));     // approved-creative surface

// ── Phase 11A · surfacing the built brain (role-gated) ────────
const BlendedTruth = lazy(() => import('./pages/BlendedTruth.jsx'));
// B8-03 — the THEN destination. Its route was a redirect to Overview until now.
const DecisionHistory = lazy(() => import('./features/decisions/DecisionHistoryView.jsx'));
const DecisionDetail  = lazy(() => import('./features/decisions/DecisionDetailView.jsx'));
// FE-02 — the ACROSS destination. `Proof` used to be lazy-loaded here as its own
// page; it is a reading inside this one now, and /app/intelligence/proof is a
// redirect (B7 Ruling 2 — one object may not have two destinations).
const MemoryView   = lazy(() => import('./features/memory/MemoryView.jsx'));
// FE-04 — the Connectors destination. This surface shipped in Phase 12 but only
// ever rendered inside Settings, so it was never lazy: SettingsPage is a static
// import, and so was onboarding, which pulled the same module in for one
// exported function. Both paths are cut (see features/connectors/startConnect.js).
const ConnectorsView = lazy(() => import('./features/connectors/ConnectorsView.jsx'));

// ── Internal admin panel — standalone (no app shell), ADMIN-only ─
const AdminPanel = lazy(() => import('./pages/AdminPanel.jsx'));

// ── Phase 4-A · Testing OS readout (BUYER-primary, role-gated) ─
const Testing      = lazy(() => import('./pages/Testing.jsx'));
const TestDetail   = lazy(() => import('./features/testing/TestDetailView.jsx'));

// ── Phase 4-E · Measurement OS (scenario + incrementality; tier-gated) ─
const Measure       = lazy(() => import('./pages/Measure.jsx'));
const HoldoutDetail = lazy(() => import('./features/measurement/HoldoutDetailView.jsx'));

// ── Phase 8 · Leadership/Reports (the reasoned narrative; CLIENT's home) ─
const Leadership   = lazy(() => import('./pages/Leadership.jsx'));

function PageFallback() {
  return (
    <div className="p-8 space-y-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

// ── Phase 8 · CLIENT routing ──────────────────────────────────
// A CLIENT seat is a read-only stakeholder: its home is the Reports surface, not
// the operator Overview. These route by the RESOLVED role and err OPEN while it
// loads (RoleContext defaults to STRATEGIST), so a transient role-miss never
// bounces a real operator off a page they're entitled to.

// CLIENT → Reports; everyone else → Overview. Used for the app index and as the
// denied-fallback for the operator surfaces below.
function RoleAwareRedirect() {
  const { role } = useCollabRole();
  return <Navigate to={role === WORKSPACE_ROLE.CLIENT ? appRoutes.leadership : appRoutes.overview} replace />;
}

// Keep a CLIENT out of an operator surface WITHOUT bouncing during the role-load
// window — Overview must never flicker for a logged-in operator.
function LockFromClient({ children }) {
  const { role, loading } = useCollabRole();
  if (loading) return children;
  if (role === WORKSPACE_ROLE.CLIENT) return <Navigate to={appRoutes.leadership} replace />;
  return children;
}

function NotFound({ app = false }) {
  return (
    <div className={app ? 'flex min-h-full items-center justify-center p-6' : 'flex min-h-screen items-center justify-center bg-surface-light p-6'}>
      <div className="max-w-md rounded-2xl border border-lumi-border bg-lumi-surface p-6 text-center shadow-card">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-lumi-subtle">404</p>
        <h1 className="mt-2 decision-title text-lumi-text">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-lumi-muted">This page does not exist or has moved.</p>
        <Link
          to={app ? appRoutes.overview : '/'}
          className="mt-5 inline-flex rounded-xl bg-lumi-accent px-4 py-2 font-display text-sm font-semibold text-lumi-bg transition-colors hover:bg-lumi-gold"
        >
          {app ? 'Back to overview' : 'Back to home'}
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  // Phase 5.2 — the auth boundary lives on THE ROUTES THAT NEED IT, not here.
  // This function used to return a full-screen loader for EVERY path while
  // Firebase resolved, so the public landing waited on a service it never reads.
  // Each guard below (ProtectedRoute, OnboardingRoute, AdminRoute) still holds
  // its own route until auth resolves, so nothing authenticated renders early.
  return (
    <ErrorBoundary boundaryId="root">
      <Routes>
        {/* ── Public ───────────────────────────────────────── */}
        <Route path="/"         element={<LandingPage />} />
        <Route path="/privacy"  element={<PrivacyPage />} />
        <Route path="/terms"    element={<TermsPage />} />
        <Route path="/login/*"  element={<AuthPage mode="login" />} />
        <Route path="/signup/*" element={<AuthPage mode="signup" />} />

        {/* ── Onboarding gate ──────────────────────────────── */}
        <Route
          path="/onboarding"
          element={<OnboardingRoute><Suspense fallback={<FullscreenLoader />}><OnboardingPage /></Suspense></OnboardingRoute>}
        />

        {/* ── Internal admin panel ─────────────────────────── */}
        {/* Standalone, OUTSIDE the /app shell (no Sidebar/TopBar). Gated to
            system ADMINs; errs CLOSED while the role resolves and bounces
            everyone else to Overview. */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <RequireUserRole role="ADMIN" fallback={<Navigate to={appRoutes.overview} replace />}>
                <Suspense fallback={<PageFallback />}><AdminPanel /></Suspense>
              </RequireUserRole>
            </AdminRoute>
          }
        />

        {/* ── Authenticated app shell ──────────────────────── */}
        <Route
          path="/app"
          element={
            // FE-03 — IntelligenceProvider stood here, singleton-fetching
            // GET /api/lumi/feed for the whole /app tree. Its only consumed
            // field was deleted server-side by S1-B, so every mount paid for a
            // round trip whose output reached no pixel — and its failure still
            // made Attention claim it could not read the account.
            <ProtectedRoute>
              <Suspense fallback={<FullscreenLoader />}>
                <MainLayout />
              </Suspense>
            </ProtectedRoute>
          }
        >
          <Route index             element={<RoleAwareRedirect />} />
          <Route path="overview"   element={
            <ErrorBoundary boundaryId="home">
              <LockFromClient><Suspense fallback={<PageFallback />}><HomePage /></Suspense></LockFromClient>
            </ErrorBoundary>
          } />

          {/* ── Phase 8 · Leadership/Reports — reasoned narratives. Ungated: all
              roles may read (the view scopes a CLIENT to LEADERSHIP audience).
              This is the CLIENT seat's home. ── */}
          <Route path="leadership" element={
            <ErrorBoundary boundaryId="leadership">
              <Suspense fallback={<PageFallback />}><Leadership /></Suspense>
            </ErrorBoundary>
          } />
          {/* B8-03 — THE THEN DESTINATION (B7 R-N1 + R-N2).
              This route was a redirect to Overview ever since the legacy Command
              Center was removed. It is now a real destination again: the
              Decision is the unit of work and owns its own address, and Campaign
              is the lens you locate it through, not the place it lives.
              UNGATED by plan (B7 Ruling 3) and by role — reading what Lumi
              decided is not an operator action. */}
          <Route path="decisions"  element={
            <ErrorBoundary boundaryId="decisions">
              <Suspense fallback={<PageFallback />}><DecisionHistory /></Suspense>
            </ErrorBoundary>
          } />
          {/* B8-04 — the Decision is independently addressable (B7 Ruling 1).
              Campaign remains the lens you LOCATE a decision through; it does
              not own the decision's destination. Ungated, like the list. */}
          <Route path="decisions/:id" element={
            <ErrorBoundary boundaryId="decision-detail">
              <Suspense fallback={<PageFallback />}><DecisionDetail /></Suspense>
            </ErrorBoundary>
          } />
          <Route path="campaigns"  element={
            <ErrorBoundary boundaryId="campaigns">
              <LockFromClient>
                <Suspense fallback={<PageFallback />}><CampaignAnalysis /></Suspense>
              </LockFromClient>
            </ErrorBoundary>
          } />

          <Route path="intelligence" element={<Navigate to={appRoutes.blendedTruth} replace />} />

          {/* ── Phase 11A · Blended Truth (STRATEGIST/BUYER; CLIENT → Reports;
              Intelligence is a GROWTH feature → FREE sees the upgrade prompt) ── */}
          <Route path="intelligence/blended-truth" element={
            <ErrorBoundary boundaryId="truth">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="GROWTH" fallback={<UpgradePrompt feature="Intelligence" requiredPlan="GROWTH" />}>
                  <Suspense fallback={<PageFallback />}><BlendedTruth /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── FE-02 · ACROSS — Memory, read two ways (B7 Ruling 2) ───────
              PlanGate only. NO RoleGate, deliberately: before this destination
              existed the two readings had different entitlements — the briefing
              was STRATEGIST/BUYER, Proof of Learning was open to every role and
              narrowed itself to a narrative line for a CLIENT. A page-level
              RoleGate would have taken Proof away from the CLIENT seat, which is
              a regression, not a consolidation. The gate lives on the briefing
              reading inside MemoryView, where it always was.

              GROWTH matches `GET /lumi/briefing`'s own requirePlan('GROWTH') —
              B7 Ruling 3's test that a surface and its API agree. ── */}
          <Route path="memory" element={
            <ErrorBoundary boundaryId="memory">
              <PlanGate required="GROWTH" fallback={<UpgradePrompt feature="Memory" requiredPlan="GROWTH" />}>
                <Suspense fallback={<PageFallback />}><MemoryView /></Suspense>
              </PlanGate>
            </ErrorBoundary>
          } />

          {/* Phase 11A's Proof of Learning page. The URL stays alive — it is
              linked and bookmarked — but it resolves to the destination that
              now owns the object, rather than rendering a second one. */}
          <Route path="intelligence/proof" element={<Navigate to={appRoutes.memory} replace />} />

          {/* ── Phase 4-B · Growth Strategy + Account Briefing (STRATEGIST/BUYER; CLIENT → Reports) ──
              The memory-moat war room. Gated to match its sibling blended-truth + the
              Intelligence nav — closes a deep-link hole where a CLIENT could reach it by URL. */}
          <Route path="intelligence/insights" element={
            <ErrorBoundary boundaryId="growth">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="GROWTH" fallback={<UpgradePrompt feature="Intelligence" requiredPlan="GROWTH" />}>
                  <Suspense fallback={<PageFallback />}><GrowthStrategyBoard /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── Phase 4-A · Testing OS readout (BUYER/STRATEGIST; CLIENT → Reports; PRO) ── */}
          <Route path="testing" element={
            <ErrorBoundary boundaryId="testing">
              <RoleGate role={['BUYER', 'STRATEGIST']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="PRO" fallback={<UpgradePrompt feature="Testing" requiredPlan="PRO" />}>
                  <Suspense fallback={<PageFallback />}><Testing /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* B8-05 · R-E1 — the experiment gets its own address, carrying EXACTLY
              the gates of the list it opens from. The two experiment surfaces
              keep separate addresses because their entitlements genuinely
              differ (`/tests/:id` is PRO; `/incrementality/:id` is PRO *and*
              measurement-tier), and one shared address would have to satisfy
              the looser gate — which is how a by-id read becomes a way around
              the gate on its own list. */}
          <Route path="testing/:id" element={
            <ErrorBoundary boundaryId="test-detail">
              <RoleGate role={['BUYER', 'STRATEGIST']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="PRO" fallback={<UpgradePrompt feature="Testing" requiredPlan="PRO" />}>
                  <Suspense fallback={<PageFallback />}><TestDetail /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── Phase 4-E · Measurement OS (STRATEGIST/BUYER; CLIENT → Reports; PRO).
              Scenario is open to both roles; incrementality is further gated to
              STRATEGIST inside the view AND tier-gated server-side. ── */}
          <Route path="measure" element={
            <ErrorBoundary boundaryId="measure">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="PRO" fallback={<UpgradePrompt feature="Measurement" requiredPlan="PRO" />}>
                  <Suspense fallback={<PageFallback />}><Measure /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* B8-05 — the holdout's own address. The route it reads has been
              served since Phase 7C with no caller at all. The measurement TIER
              is enforced server-side and reported here as a measured
              NOT_PERMITTED, not as a failure: a 403 is an honest locked state,
              which is the rule `useIncrementality` already follows for the list. */}
          <Route path="measure/:id" element={
            <ErrorBoundary boundaryId="holdout-detail">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="PRO" fallback={<UpgradePrompt feature="Measurement" requiredPlan="PRO" />}>
                  <Suspense fallback={<PageFallback />}><HoldoutDetail /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── FE-04 · Connectors — the destination, reclaimed ─────────────
              This path was a <Navigate> into Settings › Channels while the
              surface it names lived there as a tab. B8-03's shape exactly.

              RoleGate STRATEGIST/BUYER, and NO PlanGate. Settings carried no
              gate at all, so a CLIENT could reach Channels by URL — that was
              an omission, not an entitlement, and URL reachability does not
              decide product audience. The backend already scopes the writes
              (POST /connections/sync is BUYER+, PATCH /connections/account is
              STRATEGIST); this makes the surface agree with them.

              A plan gate would be the wrong instrument: connectors are how an
              account gets ANY data at all, so gating them on tier would lock a
              FREE workspace out of the one action that makes Lumi work. This
              is role authorization, not monetization. ── */}
          <Route path="connections" element={
            <ErrorBoundary boundaryId="connectors">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<RoleAwareRedirect />}>
                <Suspense fallback={<PageFallback />}><ConnectorsView /></Suspense>
              </RoleGate>
            </ErrorBoundary>
          } />
          <Route path="content"    element={
            <ErrorBoundary boundaryId="content">
              <LockFromClient><Suspense fallback={<PageFallback />}><ContentLab /></Suspense></LockFromClient>
            </ErrorBoundary>
          } />

          {/* ── Publishing · approved creative → record live Meta publishes
              (BUYER/STRATEGIST; CLIENT → Reports). Matches the publish-record
              tier and gates the deep-link the same way Testing/Measure do. ── */}
          <Route path="publishing" element={
            <ErrorBoundary boundaryId="publishing">
              <RoleGate role={['BUYER', 'STRATEGIST']} fallback={<RoleAwareRedirect />}>
                <PlanGate required="GROWTH" fallback={<UpgradePrompt feature="Publishing" requiredPlan="GROWTH" />}>
                  <Suspense fallback={<PageFallback />}><Publishing /></Suspense>
                </PlanGate>
              </RoleGate>
            </ErrorBoundary>
          } />
          <Route path="copilot"    element={
            <ErrorBoundary boundaryId="copilot">
              <Suspense fallback={<PageFallback />}><CopilotPage /></Suspense>
            </ErrorBoundary>
          } />
          <Route path="growth"     element={<Navigate to={appRoutes.insights} replace />} />
          <Route path="tools/score"    element={
            <ErrorBoundary boundaryId="tools-score">
              <Suspense fallback={<PageFallback />}><ScoreContent /></Suspense>
            </ErrorBoundary>
          } />
          <Route path="tools/calendar" element={
            <ErrorBoundary boundaryId="tools-calendar">
              <Suspense fallback={<PageFallback />}><SocialCalendar /></Suspense>
            </ErrorBoundary>
          } />
          {/* Legacy tools mount kept so the sidebar's old "/marketing" deep-link still resolves */}
          <Route path="tools/marketing" element={
            <ErrorBoundary boundaryId="tools-marketing">
              <Suspense fallback={<PageFallback />}><MarketingTools /></Suspense>
            </ErrorBoundary>
          } />
          {/* FE-04 — Settings › Channels is a REDIRECT now, never a second
              rendering of the same object (B7 Ruling 2). The address stays
              alive because it is bookmarked and is where Meta's OAuth callback
              returns. Declared before `settings/:section` for readability;
              React Router ranks the static segment above the dynamic one
              regardless of order. */}
          <Route path="settings/integrations" element={<Navigate to={appRoutes.connections} replace />} />
          <Route path="settings"   element={
            <ErrorBoundary boundaryId="settings">
              <Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>
            </ErrorBoundary>
          } />
          <Route path="settings/:section" element={
            <ErrorBoundary boundaryId="settings-section">
              <Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>
            </ErrorBoundary>
          } />

          <Route path="home"  element={<Navigate to={appRoutes.overview} replace />} />
          <Route path="feed"  element={<Navigate to={appRoutes.overview} replace />} />
          <Route path="truth" element={<Navigate to={appRoutes.blendedTruth} replace />} />
          {/* FE-02 — straight to the destination. Pointing this at
              `appRoutes.proof` would now be a redirect to a redirect. */}
          <Route path="proof" element={<Navigate to={appRoutes.memory} replace />} />

          {/* ── PR #45 · Mission Control (Observability Dashboard) ── */}
          <Route path="observability" element={
            <ErrorBoundary boundaryId="observability">
              <Suspense fallback={<PageFallback />}><Observability /></Suspense>
            </ErrorBoundary>
          } />

          {/* ── PR #36 · Approval Queue (Artifact Review Workflow) ── */}
          <Route path="approvals/:executionId" element={
            <ErrorBoundary boundaryId="approvals">
              <Suspense fallback={<PageFallback />}><ApprovalQueue /></Suspense>
            </ErrorBoundary>
          } />

          {/* ── Demo · Operations / Runtime panel (Phase 11B surface) ── */}
          <Route path="demo/operations" element={
            <ErrorBoundary boundaryId="demo-operations">
              <Suspense fallback={<PageFallback />}><Operations /></Suspense>
            </ErrorBoundary>
          } />

          <Route path="*" element={<NotFound app />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}
