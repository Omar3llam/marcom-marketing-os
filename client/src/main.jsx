import React from 'react';
import ReactDOM             from 'react-dom/client';
import { BrowserRouter }    from 'react-router-dom';
import { Toaster }          from 'sonner';
import App                  from './App.jsx';
import { AuthProvider }     from './context/AuthContext.jsx';
import ErrorBoundary        from './components/ui/ErrorBoundary.jsx';
import './index.css';

// Build-time stamp so we can confirm Render rebuilt the bundle.
// Bumped manually whenever we need a forced cache-bust.
const BUILD_ID = 'phase-10-firebase-env-fix';

// Accept either the env var (baked in by Vite from render.yaml) OR the
// hardcoded fallback from firebase.js. firebase.js always works without env
// vars — the guard here was over-strict and would show ConfigErrorPage even
// when the app was fully functional.
const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID
  || 'marcom-ai-722f0';   // hardcoded fallback matching firebase.js
const CONFIG_VALID = typeof FIREBASE_PROJECT_ID === 'string' && FIREBASE_PROJECT_ID.length > 0;

// eslint-disable-next-line no-console
console.info('[lumi] build', BUILD_ID, '| Firebase project:', FIREBASE_PROJECT_ID || '(missing)');

// Standalone error page when Firebase config is missing
function ConfigErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-200">
      <div className="w-full max-w-xl rounded-2xl border border-yellow-500/30 bg-gray-900 p-6">
        <h1 className="text-lg font-bold text-yellow-300">
          Lumi can't start: Firebase configuration is missing
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          The environment variable <code className="text-gray-200">VITE_FIREBASE_PROJECT_ID</code>{' '}
          was empty at build time, so authentication can't initialize.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-400">
          <li>Set Firebase environment variables in the Render web service (see .env.example).</li>
          <li>Required: VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_API_KEY, etc.</li>
          <li>Trigger a fresh deploy so Vite can bake them into the bundle.</li>
        </ul>
        <p className="mt-4 text-xs text-gray-500">
          Build: {BUILD_ID} · Detected project:{' '}
          <code className="text-gray-300">
            {FIREBASE_PROJECT_ID || '(none)'}
          </code>
        </p>
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
          style: {
            background: '#141720',
            border:     '1px solid #1E2130',
            color:      '#E8ECF2',
            fontFamily: 'Inter, sans-serif',
            fontSize:   '13px',
          },
        }}
      />
    </ErrorBoundary>
  </React.StrictMode>,
);


