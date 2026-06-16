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
import { Loader2 } from 'lucide-react';
import LandingPage      from './pages/LandingPage.jsx';
import AuthPage         from './pages/AuthPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import MainLayout       from './components/layout/MainLayout.jsx';
import HomePage         from './pages/Home.jsx';
import DecisionFeed     from './pages/DecisionFeed.jsx';
import ContentLab       from './pages/ContentLab/index.jsx';
import CopilotPage      from './pages/CopilotPage.jsx';
import MarketingTools   from './pages/tools/MarketingTools.jsx';
import SocialCalendar   from './pages/tools/SocialCalendar.jsx';
import ScoreContent     from './pages/tools/ScoreContent.jsx';
import SettingsPage     from './pages/Settings.jsx';
import Observability    from './pages/Observability.jsx';
import { CardSkeleton } from './components/ui/Skeleton.jsx';
import { ProtectedRoute, OnboardingRoute } from './router/ProtectedRoute.jsx';
import RoleGate from './components/auth/RoleGate.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { IntelligenceProvider } from './context/IntelligenceContext.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { appRoutes } from './app/routeManifest.js';

// ── Heavy views — lazy-load to keep the initial bundle slim ──
const CampaignAnalysis    = lazy(() => import('./pages/CampaignAnalysis.jsx'));
const GrowthStrategyBoard = lazy(() => import('./pages/GrowthStrategyBoard.jsx'));
const Operations          = lazy(() => import('./pages/demo/Operations/index.jsx'));
const ApprovalQueue       = lazy(() => import('./pages/ApprovalQueue.jsx')); // PR #36

// ── Phase 11A · surfacing the built brain (role-gated) ────────
const BlendedTruth = lazy(() => import('./pages/BlendedTruth.jsx'));
const Proof        = lazy(() => import('./pages/Proof.jsx'));

// ── Phase 4-A · Testing OS readout (BUYER-primary, role-gated) ─
const Testing      = lazy(() => import('./pages/Testing.jsx'));

// ── v2 views (gradual migration via Strangler Pattern) ────────
const DecisionViewV2 = lazy(() => import('./pages/v2/DecisionViewV2.tsx').then(m => ({ default: m.DecisionViewV2 })));

// ── Dev tools ──────────────────────────────────────────────────
import { ComparisonRoute } from './components/dev/ComparisonHarness.tsx';


function PageFallback() {
  return (
    <div className="p-8 space-y-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

function AuthLoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-surface-dark">
      <div className="flex items-center gap-2 text-dark-soft">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Initializing authentication…</span>
      </div>
    </div>
  );
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
          className="mt-5 inline-flex rounded-xl bg-lumi-accent px-4 py-2 font-display text-sm font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover"
        >
          {app ? 'Back to overview' : 'Back to home'}
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  const { loading: authLoading } = useAuth();

  // CRITICAL: Don't render any routes until Firebase auth state resolves.
  // This prevents components from accessing currentUser before it's available.
  if (authLoading) {
    return <AuthLoadingScreen />;
  }

  return (
    <ErrorBoundary boundaryId="root">
      <Routes>
        {/* ── Public ───────────────────────────────────────── */}
        <Route path="/"         element={<LandingPage />} />
        <Route path="/login/*"  element={<AuthPage mode="login" />} />
        <Route path="/signup/*" element={<AuthPage mode="signup" />} />

        {/* ── Onboarding gate ──────────────────────────────── */}
        <Route
          path="/onboarding"
          element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}
        />

        {/* ── Authenticated app shell ──────────────────────── */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <IntelligenceProvider>
                <MainLayout />
              </IntelligenceProvider>
            </ProtectedRoute>
          }
        >
          <Route index             element={<Navigate to={appRoutes.overview} replace />} />
          <Route path="overview"   element={
            <ErrorBoundary boundaryId="home">
              <HomePage />
            </ErrorBoundary>
          } />
          <Route path="decisions"  element={
            <ErrorBoundary boundaryId="feed">
              <DecisionFeed />
            </ErrorBoundary>
          } />
          <Route path="campaigns"  element={
            <ErrorBoundary boundaryId="campaigns">
              <Suspense fallback={<PageFallback />}><CampaignAnalysis /></Suspense>
            </ErrorBoundary>
          } />

          <Route path="intelligence" element={<Navigate to={appRoutes.blendedTruth} replace />} />

          {/* ── Phase 11A · Blended Truth (STRATEGIST/BUYER; CLIENT → Home) ── */}
          <Route path="intelligence/blended-truth" element={
            <ErrorBoundary boundaryId="truth">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<Navigate to={appRoutes.overview} replace />}>
                <Suspense fallback={<PageFallback />}><BlendedTruth /></Suspense>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── Phase 11A · Proof of Learning (all roles; view narrows by role) ── */}
          <Route path="intelligence/proof" element={
            <ErrorBoundary boundaryId="proof">
              <Suspense fallback={<PageFallback />}><Proof /></Suspense>
            </ErrorBoundary>
          } />

          {/* ── Phase 4-B · Growth Strategy + Account Briefing (STRATEGIST/BUYER; CLIENT → Home) ──
              The memory-moat war room. Gated to match its sibling blended-truth + the
              Intelligence nav — closes a deep-link hole where a CLIENT could reach it by URL. */}
          <Route path="intelligence/insights" element={
            <ErrorBoundary boundaryId="growth">
              <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<Navigate to={appRoutes.overview} replace />}>
                <Suspense fallback={<PageFallback />}><GrowthStrategyBoard /></Suspense>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── Phase 4-A · Testing OS readout (BUYER/STRATEGIST; CLIENT → Home) ── */}
          <Route path="testing" element={
            <ErrorBoundary boundaryId="testing">
              <RoleGate role={['BUYER', 'STRATEGIST']} fallback={<Navigate to={appRoutes.overview} replace />}>
                <Suspense fallback={<PageFallback />}><Testing /></Suspense>
              </RoleGate>
            </ErrorBoundary>
          } />

          {/* ── Phase 12 · Connected Channels (STRATEGIST/BUYER; CLIENT → Home) ── */}
          <Route path="connections" element={<Navigate to={appRoutes.settingsIntegrations} replace />} />
          <Route path="content"    element={
            <ErrorBoundary boundaryId="content">
              <ContentLab />
            </ErrorBoundary>
          } />
          <Route path="copilot"    element={
            <ErrorBoundary boundaryId="copilot">
              <CopilotPage />
            </ErrorBoundary>
          } />
          <Route path="growth"     element={<Navigate to={appRoutes.insights} replace />} />
          <Route path="tools/score"    element={
            <ErrorBoundary boundaryId="tools-score">
              <ScoreContent />
            </ErrorBoundary>
          } />
          <Route path="tools/calendar" element={
            <ErrorBoundary boundaryId="tools-calendar">
              <SocialCalendar />
            </ErrorBoundary>
          } />
          {/* Legacy tools mount kept so the sidebar's old "/marketing" deep-link still resolves */}
          <Route path="tools/marketing" element={
            <ErrorBoundary boundaryId="tools-marketing">
              <MarketingTools />
            </ErrorBoundary>
          } />
          <Route path="settings"   element={
            <ErrorBoundary boundaryId="settings">
              <SettingsPage />
            </ErrorBoundary>
          } />
          <Route path="settings/:section" element={
            <ErrorBoundary boundaryId="settings-section">
              <SettingsPage />
            </ErrorBoundary>
          } />

          <Route path="home"  element={<Navigate to={appRoutes.overview} replace />} />
          <Route path="feed"  element={<Navigate to={appRoutes.decisions} replace />} />
          <Route path="truth" element={<Navigate to={appRoutes.blendedTruth} replace />} />
          <Route path="proof" element={<Navigate to={appRoutes.proof} replace />} />

          {/* ── PR #45 · Mission Control (Observability Dashboard) ── */}
          <Route path="observability" element={
            <ErrorBoundary boundaryId="observability">
              <Observability />
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

          {/* ── v2 routes (Strangler Pattern migration) ─────── */}
          <Route path="v2/decision" element={
            <ErrorBoundary boundaryId="v2-decision">
              <Suspense fallback={<PageFallback />}><DecisionViewV2 /></Suspense>
            </ErrorBoundary>
          } />

          {/* ── Comparison routes (dev harness) ─────────────── */}
          <Route path="compare/decision" element={
            <ErrorBoundary boundaryId="compare-decision">
              <Suspense fallback={<PageFallback />}>
                <ComparisonRoute
                  v1={<DecisionFeed />}
                  v2={<DecisionViewV2 />}
                  label="Decision View"
                />
              </Suspense>
            </ErrorBoundary>
          } />
          <Route path="*" element={<NotFound app />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}
