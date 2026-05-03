// ============================================================
// MARCOM / Lumi — Routing shell  (Phase 8)
// ------------------------------------------------------------
// /            → /login
// /login/*     → LoginPage           (Clerk SignIn — public)
// /signup/*    → SignupPage          (Clerk SignUp — public)
// /onboarding  → OnboardingPage      (OnboardingRoute guard)
// /app         → MainAppPage         (ProtectedRoute guard)
// *            → 404 fallback        (redirects to /login)
// ============================================================
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage      from './pages/LoginPage.jsx';
import SignupPage     from './pages/SignupPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import MainAppPage    from './pages/MainAppPage.jsx';
import { ProtectedRoute, OnboardingRoute } from './router/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/"          element={<Navigate to="/login" replace />} />

      {/* Clerk's SignIn / SignUp use catch-all subroutes for verification flows */}
      <Route path="/login/*"   element={<LoginPage />} />
      <Route path="/signup/*"  element={<SignupPage />} />

      <Route
        path="/onboarding"
        element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}
      />

      <Route
        path="/app/*"
        element={<ProtectedRoute><MainAppPage /></ProtectedRoute>}
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
