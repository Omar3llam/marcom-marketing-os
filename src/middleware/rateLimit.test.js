// ============================================================
// Rate limiters — the route-specific caps actually cap
// ------------------------------------------------------------
// apiLimiter/chatLimiter are the blanket caps (exercised implicitly by every
// route test). These pin the three narrower guards added for security hardening:
// each must let exactly `max` requests through in a window, then 429 with the
// codebase's { status, message } error shape. Driven through a throwaway express
// app (NOT server.js, which listens on import) so the real limiter singletons are
// exercised without booting the server. Each limiter is hit in exactly one test,
// so the shared in-memory store never carries state across cases.
// ============================================================
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authLimiter, syncLimiter, adminSeedLimiter } from './rateLimit.js';

function appWith(limiter) {
  const app = express();
  app.use(limiter);
  app.get('/', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

// Fires `count` sequential GETs and returns the array of responses in order.
async function fire(app, count) {
  const out = [];
  // Sequential on purpose: each request must observe the prior one's increment.
  for (let i = 0; i < count; i++) out.push(await request(app).get('/'));
  return out;
}

describe('route-specific rate limiters cap at their configured max', () => {
  it('syncLimiter: 5 pass, the 6th is 429 with the standard error shape', async () => {
    const res = await fire(appWith(syncLimiter), 6);
    expect(res.slice(0, 5).every((r) => r.status === 200)).toBe(true);
    expect(res[5].status).toBe(429);
    expect(res[5].body).toEqual({ status: 'error', message: expect.stringMatching(/sync rate limit/i) });
    // draft-7 standard headers advertise the policy on the allowed responses.
    expect(res[0].headers).toHaveProperty('ratelimit-policy');
  });

  it('adminSeedLimiter: 10 pass, the 11th is 429', async () => {
    const res = await fire(appWith(adminSeedLimiter), 11);
    expect(res.slice(0, 10).every((r) => r.status === 200)).toBe(true);
    expect(res[10].status).toBe(429);
    expect(res[10].body.message).toMatch(/demo seed rate limit/i);
  });

  it('authLimiter: 20 pass, the 21st is 429', async () => {
    const res = await fire(appWith(authLimiter), 21);
    expect(res.slice(0, 20).every((r) => r.status === 200)).toBe(true);
    expect(res[20].status).toBe(429);
    expect(res[20].body.message).toMatch(/authentication attempts/i);
  });
});
