import React from 'react';
import ReactDOM             from 'react-dom/client';
import { BrowserRouter }    from 'react-router-dom';
import { Toaster }          from 'sonner';
import App                  from './App.jsx';
import { AuthProvider }     from './context/AuthContext.jsx';
import ErrorBoundary        from './components/ui/ErrorBoundary.jsx';
import { validateFirebaseConfig } from './firebase.js';
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

// eslint-disable-next-line no-console
console.info(
  '[lumi] build:',
  BUILD_ID,
  '| mode:',
  import.meta.env.MODE,
  '| firebase:',
  firebaseValidation.valid ? '✓' : '✗',
  firebaseValidation.missing.length > 0 ? `(missing: ${firebaseValidation.missing.join(', ')})` : ''
);

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
          <div className="metric-display leading-none">⚠️</div>
          <div>
            <h1 className="decision-title text-signal-hold">
              Platform services failed to initialize
            </h1>
            <p className="body-subtle mt-1">
              Required Firebase environment variables are missing.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-signal-hold-bg p-4">
          <p className="body-muted font-mono text-xs">
            Missing: {missing.join(', ') || 'Unknown configuration error'}
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <p className="body-muted">
            <strong>For deployment admins:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5 body-subtle">
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
          <BrowserRouter>
            <App />
          </BrowserRouter>
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


