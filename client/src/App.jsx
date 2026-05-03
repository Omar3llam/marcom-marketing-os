// ============================================================
// MARCOM / Lumi — Routing shell
// ------------------------------------------------------------
// Public:    /login, /signup
// Gated:     /onboarding   (OnboardingRoute — needs Clerk session, no context)
//            /app/*        (ProtectedRoute  — needs session AND context)
//   index   → /app/feed
//   feed    → DecisionFeed
//   tools/* → MarketingTools | SocialCalendar | ScoreContent | CampaignAnalysis
//   settings→ Settings
// ============================================================
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthPage         from '@/pages/AuthPage.jsx';
import OnboardingPage   from '@/pages/OnboardingPage.jsx';
import MainLayout       from '@/components/layout/MainLayout.jsx';
import DecisionFeed     from '@/pages/DecisionFeed.jsx';
import MarketingTools   from '@/pages/tools/MarketingTools.jsx';
import SocialCalendar   from '@/pages/tools/SocialCalendar.jsx';
import ScoreContent     from '@/pages/tools/ScoreContent.jsx';
import CampaignAnalysis from '@/pages/tools/CampaignAnalysis.jsx';
import SettingsPage     from '@/pages/Settings.jsx';
import { ProtectedRoute, OnboardingRoute } from '@/router/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/"          element={<Navigate to="/app/feed" replace />} />

      {/* Public — Clerk hosted UI */}
      <Route path="/login/*"   element={<AuthPage mode="login"  />} />
      <Route path="/signup/*"  element={<AuthPage mode="signup" />} />

      {/* Onboarding — gated, blocks if context already saved */}
      <Route
        path="/onboarding"
        element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}
      />

      {/* Authenticated app shell with nested children */}
      <Route
        path="/app"
        element={<ProtectedRoute><MainLayout /></ProtectedRoute>}
      >
        <Route index               element={<Navigate to="feed" replace />} />
        <Route path="feed"         element={<DecisionFeed />} />
        <Route path="tools/marketing" element={<MarketingTools />} />
        <Route path="tools/calendar"  element={<SocialCalendar />} />
        <Route path="tools/score"     element={<ScoreContent />} />
        <Route path="tools/campaigns" element={<CampaignAnalysis />} />
        <Route path="settings"     element={<SettingsPage />} />
      </Route>

      {/* 404 → home */}
      <Route path="*" element={<Navigate to="/app/feed" replace />} />
    </Routes>
  );
}
