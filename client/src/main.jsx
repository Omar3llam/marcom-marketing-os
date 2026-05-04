import React, { useEffect } from 'react';
import ReactDOM             from 'react-dom/client';
import { BrowserRouter }    from 'react-router-dom';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { Toaster }          from 'sonner';
import App                  from './App.jsx';
import { bindClerkTokenGetter } from './lib/api.js';
import ErrorBoundary        from './components/ui/ErrorBoundary.jsx';
import './index.css';

// Build-time stamp so we can confirm Render rebuilt the bundle.
// Bumped manually whenever we need a forced cache-bust.
const BUILD_ID = 'phase-8.1-bundle-bust';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const KEY_VALID = typeof PUBLISHABLE_KEY === 'string'
  && /^pk_(test|live)_[A-Za-z0-9_-]+$/.test(PUBLISHABLE_KEY);

// eslint-disable-next-line no-console
console.info('[lumi] build', BUILD_ID, '| Clerk key valid:', KEY_VALID);

// Tiny shim that wires the axios interceptor to Clerk's getToken()
// once the auth context is mounted.
function ClerkTokenBridge({ children }) {
  const { getToken } = useAuth();
  useEffect(() => {
    bindClerkTokenGetter(getToken);
  }, [getToken]);
  return children;
}

// Standalone error page when the publishable key is missing or
// malformed. ClerkProvider crashes synchronously on bad keys, so
// we guard on the OUTSIDE and never call ClerkProvider with junk.
function ConfigErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-200">
      <div className="w-full max-w-xl rounded-2xl border border-yellow-500/30 bg-gray-900 p-6">
        <h1 className="text-lg font-bold text-yellow-300">
          Lumi can't start: Clerk publishable key is missing
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          The environment variable <code className="text-gray-200">VITE_CLERK_PUBLISHABLE_KEY</code>{' '}
          was empty or invalid at build time, so authentication can't initialize.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-400">
          <li>Set <code className="text-gray-200">VITE_CLERK_PUBLISHABLE_KEY</code> in the Render web service environment.</li>
          <li>It MUST start with <code className="text-gray-200">pk_test_</code> or <code className="text-gray-200">pk_live_</code>.</li>
          <li>Trigger a fresh deploy so Vite can bake it into the bundle.</li>
        </ul>
        <p className="mt-4 text-xs text-gray-500">
          Build: {BUILD_ID} · Detected key prefix:{' '}
          <code className="text-gray-300">
            {PUBLISHABLE_KEY ? `${String(PUBLISHABLE_KEY).slice(0, 10)}…` : '(none)'}
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
      {KEY_VALID ? (
        <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
          <BrowserRouter>
            <ClerkTokenBridge>
              <App />
            </ClerkTokenBridge>
          </BrowserRouter>
        </ClerkProvider>
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


