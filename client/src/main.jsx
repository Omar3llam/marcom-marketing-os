import React from 'react';
import ReactDOM             from 'react-dom/client';
import { BrowserRouter }    from 'react-router-dom';
import { Toaster }          from 'sonner';
import App                  from './App.jsx';
import { AuthProvider }     from './context/AuthContext.jsx';
import { ServerStateProvider } from './app/providers/ServerStateProvider.jsx';
import ErrorBoundary        from './components/ui/ErrorBoundary.jsx';
import { validateFirebaseConfig } from './firebase.js';

// Self-hosted fonts (eliminates Google Fonts CDN + CSP complexity)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './index.css';

// ── Build Fingerprint ────────────────────────────────────────
// Auto-generated from Git commit (set via render.yaml env var)
// Fallback to timestamp for local development
const BUILD_ID = import.meta.env.VITE_BUILD_ID
  || import.meta.env.VITE_RENDER_GIT_COMMIT
  || `local-${new Date().toISOString().slice(0, 10)}`;

// ── Firebase Configuration Validation ────────────────────────
const firebaseValidation = validateFirebaseConfig();
const CONFIG_VALID = firebaseValidation.valid;

// ── Configuration Error Page ─────────────────────────────────
// Shown when required Firebase environment variables are missing
// ARCHITECTURE: Uses design system tokens (not hardcoded colors)

function ConfigErrorPage() {
  const missing = firebaseValidation.missing || [];
  const isDev = import.meta.env.DEV;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-light p-6">
      <div className="w-full max-w-xl rounded-2xl border border-signal-hold/30 bg-surface-card p-6 shadow-lg">
        <div className="mb-4 flex items-start gap-3">
          <div className="metric-display text-dark-base leading-none">⚠️</div>
          <div>
            <h1 className="decision-title text-signal-hold">
              Platform services failed to initialize
            </h1>
            <p className="text-sm text-dark-muted leading-relaxed mt-1">
              Required Firebase environment variables are missing.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-signal-hold-bg p-4">
          <p className="text-sm text-dark-soft leading-relaxed font-mono text-xs">
            Missing: {missing.join(', ') || 'Unknown configuration error'}
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-sm text-dark-soft leading-relaxed">
            <strong>For deployment admins:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-dark-muted leading-relaxed">
            <li>Set Firebase environment variables in your hosting platform (Render, Vercel, etc.)</li>
            <li>Required: <code className="font-mono text-xs bg-surface-elevated px-1">VITE_FIREBASE_PROJECT_ID</code>, <code className="font-mono text-xs bg-surface-elevated px-1">VITE_FIREBASE_API_KEY</code>, <code className="font-mono text-xs bg-surface-elevated px-1">VITE_FIREBASE_APP_ID</code></li>
            <li>Trigger a fresh build so Vite can bake them into the bundle.</li>
            {isDev && <li className="text-signal-scale">Development mode: fallback config will be used if available.</li>}
          </ul>
        </div>

        <div className="mt-6 pt-4 border-t border-surface-border">
          <p className="text-xs text-dark-subtle font-mono">
            Build: {BUILD_ID} · Mode: {import.meta.env.MODE}
          </p>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {CONFIG_VALID ? (
        <AuthProvider>
          <ServerStateProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ServerStateProvider>
        </AuthProvider>
      ) : (
        <ConfigErrorPage />
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'lumi-toast',
        }}
      />
    </ErrorBoundary>
  </React.StrictMode>,
);


