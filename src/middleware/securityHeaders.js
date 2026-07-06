// ============================================================
// Security headers — Helmet + hand-tuned CSP
// ------------------------------------------------------------
// Extracted from server.js so the header stack is unit-testable
// (server.js listens on import). Mounted once, before CORS.
// ============================================================
import helmet from 'helmet';

// ── HELMET ───────────────────────────────────────────────────
// Adds HSTS, X-Content-Type-Options: nosniff, X-Frame-Options, Referrer-Policy,
// X-DNS-Prefetch-Control, etc. Three of Helmet's defaults are deliberately OFF:
//   • contentSecurityPolicy — a hand-tuned, Firebase-Auth-aware CSP is set
//     manually below; letting Helmet emit its own default CSP would shadow it.
//   • crossOriginEmbedderPolicy — COEP can block the cross-origin Firebase Auth
//     iframe (accounts.google.com / *.firebaseapp.com).
//   • crossOriginOpenerPolicy — Helmet defaults COOP to `same-origin`, which
//     severs the opener↔popup window reference that Firebase `signInWithPopup`
//     (client/src/hooks/useFirebaseAuth.js) depends on — desktop Google login
//     would silently break. Future hardening: revisit `same-origin-allow-popups`
//     once popup auth is verified against it.
const helmetMiddleware = helmet({
  contentSecurityPolicy:     false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy:   false,
  // Pin HSTS to one year (preload-eligible) instead of relying on Helmet's
  // default. Browsers ignore HSTS over plain HTTP, so emitting it in dev is
  // harmless; on Render (TLS-terminated, trust proxy set) it is enforced.
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  // Nothing frames the app — not even itself. DENY aligns the legacy
  // X-Frame-Options header with the CSP frame-ancestors 'none' below
  // (modern browsers prefer frame-ancestors; older ones fall back to XFO).
  xFrameOptions: { action: 'deny' },
});

// ── CONTENT SECURITY POLICY (defense-in-depth XSS protection) ────────
// Restricts where scripts, styles, and other resources can be loaded from.
// Even if an XSS vulnerability exists in code, CSP blocks execution.
//
// SECURITY NOTE: Fonts are now self-hosted via @fontsource (no Google CDN).
// Firebase Auth requires both accounts.google.com AND *.firebaseapp.com iframes.
function cspMiddleware(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://apis.google.com",                          // Firebase Auth SDK
      // SECURITY NOTE: 'unsafe-inline' is required here. React's style={} prop and
      // several primitive/layout components use inline style objects (274 occurrences
      // across 50 files as of 2026-05-31). Switching to nonces would require threading
      // a per-request nonce through every component that uses style={}. This is a known
      // limitation — tracked as a future hardening task. Mitigation: script-src has no
      // unsafe-inline, so injected scripts cannot run even if styles can be injected.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",                                              // Self-hosted fonts + data URIs
      "img-src 'self' data: https:",                                        // Images + data URIs
      "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebase.com https://api.anthropic.com https://api.openai.com", // API calls
      "frame-src https://accounts.google.com https://*.firebaseapp.com",    // Google OAuth + Firebase Auth iframes
      "frame-ancestors 'none'",                                             // Clickjacking: no one may embed the app
      "object-src 'none'",                                                  // Block Flash, Java, etc
      "base-uri 'self'",                                                    // Prevent base tag hijacking
      "form-action 'self'",                                                 // Only submit forms to same origin
    ].join('; ')
  );
  next();
}

// Express accepts an array of middlewares in a single app.use().
export const securityHeaders = [helmetMiddleware, cspMiddleware];
