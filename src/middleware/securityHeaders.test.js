// ============================================================
// Security headers — the real stack emits everything we promise
// ------------------------------------------------------------
// Audit 2026-07: the hand-tuned CSP had no frame-ancestors directive, so any
// site could embed the app (clickjacking). These tests pin the four headers
// the hardening pass guarantees, plus prove the extraction from server.js
// did not drop the Firebase-Auth-critical CSP directives.
// Driven through a throwaway express app (NOT server.js, which listens on
// import) mounting the same `securityHeaders` array server.js uses.
// ============================================================
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeaders } from './securityHeaders.js';

function buildApp() {
  const app = express();
  app.use(securityHeaders);
  app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  return app;
}

describe('securityHeaders on GET /api/health', () => {
  it('CSP forbids embedding via frame-ancestors and keeps the Firebase-aware directives', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    const csp = res.headers['content-security-policy'];

    expect(csp).toContain("frame-ancestors 'none'");
    // Regression guard: extracting the CSP out of server.js must not have
    // dropped the hand-tuned, Firebase-Auth-aware policy.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('script-src \'self\' https://apis.google.com');
    expect(csp).toContain('frame-src https://accounts.google.com https://*.firebaseapp.com');
    expect(csp).toContain("object-src 'none'");
  });

  it('HSTS is pinned to one year with includeSubDomains', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('X-Content-Type-Options is nosniff', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('Referrer-Policy is set (Helmet default no-referrer — stricter than strict-origin-when-cross-origin)', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('X-Frame-Options is DENY, agreeing with frame-ancestors for legacy browsers', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
