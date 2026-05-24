// ============================================================
// MARCOM / Lumi — Top-level Error Boundary
// ------------------------------------------------------------
// Catches any synchronous render error in the React tree and
// shows a useful diagnostic page instead of a blank screen.
// Without this, a single broken component (e.g. ClerkProvider
// rejecting an invalid publishable key) renders nothing.
// ============================================================
// DESIGN SYSTEM NOTE: This component intentionally uses dark
// mode grays (bg-gray-900, bg-gray-950) for the error screen.
// It is explicitly exempt from the no-generic-tailwind lint rule.
// See: design-system/lint/no-generic-tailwind.js → EXEMPT_FILES
// ============================================================
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Surface to console so DevTools and remote logging see it
    // even if the UI does manage to render the fallback below.
    console.error('[lumi] React tree crashed:', error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-200">
        <div className="w-full max-w-2xl rounded-2xl border border-red-500/30 bg-gray-900 p-6">
          <div className="flex items-center gap-2 text-red-400">
            <span className="text-lg font-bold">Application failed to mount</span>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            The Lumi UI encountered a fatal error during render. Details below —
            this message replaces the previous blank screen so the issue is
            actually debuggable.
          </p>
          <pre className="mt-4 max-h-60 overflow-auto rounded-lg bg-black/50 p-3 text-xs text-red-300">
            {String(error?.message || error)}
          </pre>
          {info?.componentStack && (
            <details className="mt-3 text-xs text-gray-500">
              <summary className="cursor-pointer">Component stack</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">
                {info.componentStack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
