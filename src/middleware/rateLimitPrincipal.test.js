// ============================================================
// R11-E — rate-limit PRINCIPALS  (E1)
// ------------------------------------------------------------
// Every shared limiter keyed on `req.auth?.userId || req.ip`. `req.auth` is a
// CLERK artifact and nothing has assigned it since the Firebase migration, so
// that expression has evaluated to `undefined` on every request for as long as
// Firebase has been the auth provider — and every limiter silently degraded to
// per-IP counting.
//
// That is not a smaller limit, it is a different one. These two controls are
// the proof, and they fail if the key reverts.
// ============================================================
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiLimiter, syncLimiter, authLimiter, executionLimiter } from './rateLimit.js';

/** An app that stamps identity onto the request before the limiter sees it. */
function appWith(limiter, identify) {
  const app = express();
  app.use(identify);
  app.use(limiter);
  app.get('/', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function fire(app, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await request(app).get('/'));
  return out;
}

describe('apiLimiter counts per USER, not per IP (NC-D1 / NC-D2)', () => {
  it('two users sharing ONE IP do not share a budget', async () => {
    // The office-behind-a-NAT case. Under per-IP counting the second user is
    // 429'd by the first user's traffic.
    let n = 0;
    const app = appWith(apiLimiter, (req, _res, next) => {
      // Same connection, alternating identities.
      req.userId = (n++ % 2 === 0) ? 'user-alpha' : 'user-beta';
      next();
    });

    // 40 requests, 20 each — over the 30/min cap only if they are pooled.
    const res = await fire(app, 40);

    expect(res.every((r) => r.status === 200)).toBe(true);
  });

  it('ONE user is still capped across requests', async () => {
    const app = appWith(apiLimiter, (req, _res, next) => { req.userId = 'user-solo'; next(); });

    const res = await fire(app, 31);

    expect(res.slice(0, 30).every((r) => r.status === 200)).toBe(true);
    expect(res[30].status).toBe(429);
  });
});

describe('syncLimiter counts per WORKSPACE (NC-D3)', () => {
  it('a team shares one budget — the resource is the account\'s API quota', async () => {
    let n = 0;
    const app = appWith(syncLimiter, (req, _res, next) => {
      req.workspaceId = 'ws-shared';
      req.userId = `teammate-${n++}`;   // different people…
      next();
    });

    const res = await fire(app, 6);

    // …one account, one 5/min quota against the ad platform.
    expect(res.slice(0, 5).every((r) => r.status === 200)).toBe(true);
    expect(res[5].status).toBe(429);
  });

  it('two workspaces do NOT share a budget', async () => {
    let n = 0;
    const app = appWith(syncLimiter, (req, _res, next) => {
      req.workspaceId = (n++ % 2 === 0) ? 'ws-one' : 'ws-two';
      next();
    });

    const res = await fire(app, 10);   // 5 each

    expect(res.every((r) => r.status === 200)).toBe(true);
  });
});

describe('executionLimiter counts per WORKSPACE', () => {
  it('caps real ad-platform mutations at the account level', async () => {
    const app = appWith(executionLimiter, (req, _res, next) => { req.workspaceId = 'ws-exec'; next(); });

    const res = await fire(app, 21);

    expect(res.slice(0, 20).every((r) => r.status === 200)).toBe(true);
    expect(res[20].status).toBe(429);
  });
});

describe('authLimiter stays IP-keyed (NC-D6)', () => {
  it('does NOT key on a caller-asserted identity — that is the point of a brute-force guard', async () => {
    // The over-correction this locks out: keying the auth limiter on a user id
    // would let an attacker mint a fresh budget per guess.
    let n = 0;
    const app = appWith(authLimiter, (req, _res, next) => {
      req.userId = `guess-${n++}`;       // a new "identity" every attempt
      req.workspaceId = `ws-${n}`;
      next();
    });

    const res = await fire(app, 21);

    expect(res.slice(0, 20).every((r) => r.status === 200)).toBe(true);
    expect(res[20].status).toBe(429);   // still counted, because it is per-IP
  });
});
