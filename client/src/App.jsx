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
import LandingPage      from './pages/LandingPage.jsx';
import AuthPage         from './pages/AuthPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import MainLayout       from './components/layout/MainLayout.jsx';
import DecisionFeed     from './pages/DecisionFeed.jsx';
import MarketingTools   from './pages/tools/MarketingTools.jsx';
import SocialCalendar   from './pages/tools/SocialCalendar.jsx';
import ScoreContent     from './pages/tools/ScoreContent.jsx';
import SettingsPage     from './pages/Settings.jsx';
import { CardSkeleton } from './components/ui/Skeleton.jsx';
import { ProtectedRoute, OnboardingRoute } from './router/ProtectedRoute.jsx';

// ── Heavy views — lazy-load to keep the initial bundle slim ──
const CampaignAnalysis    = lazy(() => import('./pages/CampaignAnalysis.jsx'));
const GrowthStrategyBoard = lazy(() => import('./pages/GrowthStrategyBoard.jsx'));


function PageFallback() {
  return (
    <div className="p-8 space-y-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

export default function App() {
  return (
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
        element={<ProtectedRoute><MainLayout /></ProtectedRoute>}
      >
        <Route index             element={<Navigate to="feed" replace />} />
        <Route path="feed"       element={<DecisionFeed />} />
        <Route path="campaigns"  element={
          <Suspense fallback={<PageFallback />}><CampaignAnalysis /></Suspense>
        } />
        <Route path="growth"     element={
          <Suspense fallback={<PageFallback />}><GrowthStrategyBoard /></Suspense>
        } />
        <Route path="tools/score"    element={<ScoreContent />} />
        <Route path="tools/calendar" element={<SocialCalendar />} />
        {/* Legacy tools mount kept so the sidebar's old "/marketing" deep-link still resolves */}
        <Route path="tools/marketing" element={<MarketingTools />} />
        <Route path="settings"   element={<SettingsPage />} />
      </Route>

      {/* 404 → home (NOT app, so unauthed visitors don't bounce-loop) */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
