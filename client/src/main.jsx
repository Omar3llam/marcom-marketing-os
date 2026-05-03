import React, { useEffect } from 'react';
import ReactDOM             from 'react-dom/client';
import { BrowserRouter }    from 'react-router-dom';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { Toaster }          from 'sonner';
import App                  from './App.jsx';
import { bindClerkTokenGetter } from './lib/api.js';
import './index.css';

// Vite injects this at build time — set VITE_CLERK_PUBLISHABLE_KEY
// in client/.env (or in Render → lumi-backend env vars).
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  // Hard-fail at build/boot so a missing env var can't silently
  // ship as broken auth in production.
  console.error('[lumi] VITE_CLERK_PUBLISHABLE_KEY is missing');
}

// Tiny shim that wires the axios interceptor to Clerk's getToken()
// once the auth context is mounted.
function ClerkTokenBridge({ children }) {
  const { getToken } = useAuth();
  useEffect(() => {
    bindClerkTokenGetter(getToken);
  }, [getToken]);
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY || 'pk_missing'}>
      <BrowserRouter>
        <ClerkTokenBridge>
          <App />
        </ClerkTokenBridge>
      </BrowserRouter>
    </ClerkProvider>
    <Toaster theme="dark" position="bottom-right" />
  </React.StrictMode>,
);
