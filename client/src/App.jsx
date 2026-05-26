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
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import LandingPage      from './pages/LandingPage.jsx';
import AuthPage         from './pages/AuthPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import MainLayout       from './components/layout/MainLayout.jsx';
import HomePage         from './pages/Home.jsx';
import DecisionFeed     from './pages/DecisionFeed.jsx';
import ContentLab       from './pages/ContentLab/index.jsx';
import MarketingTools   from './pages/tools/MarketingTools.jsx';
import SocialCalendar   from './pages/tools/SocialCalendar.jsx';
import ScoreContent     from './pages/tools/ScoreContent.jsx';
import SettingsPage     from './pages/Settings.jsx';
import Observability    from './pages/Observability.jsx';
import { CardSkeleton } from './components/ui/Skeleton.jsx';
import { ProtectedRoute, OnboardingRoute } from './router/ProtectedRoute.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { IntelligenceProvider } from './context/IntelligenceContext.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// ── Heavy views — lazy-load to keep the initial bundle slim ──
const CampaignAnalysis    = lazy(() => import('./pages/CampaignAnalysis.jsx'));
const GrowthStrategyBoard = lazy(() => import('./pages/GrowthStrategyBoard.jsx'));
const Operations          = lazy(() => import('./pages/demo/Operations/index.jsx'));
const ApprovalQueue       = lazy(() => import('./pages/ApprovalQueue.jsx')); // PR #36

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
          <Route index             element={<Navigate to="home" replace />} />
          <Route path="home"       element={
            <ErrorBoundary boundaryId="home">
              <HomePage />
            </ErrorBoundary>
          } />
          <Route path="feed"       element={
            <ErrorBoundary boundaryId="feed">
              <DecisionFeed />
            </ErrorBoundary>
          } />
          <Route path="campaigns"  element={
            <ErrorBoundary boundaryId="campaigns">
              <Suspense fallback={<PageFallback />}><CampaignAnalysis /></Suspense>
            </ErrorBoundary>
          } />
          <Route path="content"    element={
            <ErrorBoundary boundaryId="content">
              <ContentLab />
            </ErrorBoundary>
          } />
          <Route path="growth"     element={
            <ErrorBoundary boundaryId="growth">
              <Suspense fallback={<PageFallback />}><GrowthStrategyBoard /></Suspense>
            </ErrorBoundary>
          } />
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
        </Route>

        {/* 404 → home (NOT app, so unauthed visitors don't bounce-loop) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
