// ============================================================
// MARCOM — Rate Limiting
// ============================================================
// R11 (E1) — THE PRINCIPAL WAS WRONG EVERYWHERE.
//
// Every shared limiter keyed on `req.auth?.userId || req.ip`. `req.auth` is a
// CLERK artifact; Clerk was removed in the Firebase migration and nothing has
// assigned `req.auth` since. So `req.auth?.userId` has evaluated to undefined
// on every request for as long as Firebase has been the auth provider, and
// every one of these limiters silently degraded to per-IP counting.
//
// That is not a smaller limit, it is a different one. Per-IP means a whole
// office behind one NAT shares a 30/min budget, while one user on a phone gets
// a fresh budget per network. The Firebase identity is `req.userId`, set by
// firebaseAuthMiddleware, which runs globally before every route — including
// the ones where a limiter is mounted ahead of requireAuth.
//
// Each limiter now names its principal explicitly, because the right answer
// differs per resource:
//
//   USER       — general API surface, chat, admin: the budget belongs to a
//                person, and sharing it by IP punishes teams.
//   WORKSPACE  — anything that spends money or a third-party quota: AI calls,
//                connector syncs, ad-platform executions. A team shares one
//                account's budget, so the cap belongs to the account.
//   IP         — credential brute-force and unauthenticated surfaces: there is
//                no identity yet, so the network address is all there is. This
//                is the one place the old default was accidentally correct.
//
// R11 does NOT re-tune the numbers. Fixing the principal changes what the
// existing numbers mean; choosing new ones is an evidence-driven decision that
// needs production data, and inventing them here would be guessing.
//
// Store: shared through Redis where available (see rateLimitStore.js), so the
// cap is a real number rather than N-instances times the configured value.
// ============================================================
import rateLimit from 'express-rate-limit';
import { makeRateLimitStore } from './rateLimitStore.js';

// ── Principals ───────────────────────────────────────────────
// Each falls back to the next-broadest identity, never to nothing: an
// unauthenticated caller must still be counted, just more coarsely.

/** The acting person. */
const byUser = (req) => req.userId || req.ip;

/** The paying account. Used where the cost is the account's, not the person's. */
const byWorkspace = (req) => req.workspaceId || req.userId || req.ip;

/** The network address. Correct where no identity exists yet. */
const byIp = (req) => req.ip;

function limiter(name, { windowMs, max, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator,
    store: makeRateLimitStore(name),
    standardHeaders: 'draft-7',
    legacyHeaders:   false,
    message,
  });
}

/** 30 requests / minute — general API endpoints. Principal: USER. */
export const apiLimiter = limiter('api', {
  windowMs:     60 * 1_000,
  max:          30,
  keyGenerator: byUser,
  message:      { status: 'error', message: 'Too many requests. Please wait and try again.' },
});

/** 10 requests / minute — AI chat endpoint (expensive). Principal: USER.
 *  Also guards /webhook, where there is no user and the fallback to IP is the
 *  correct answer — the shared secret is the real gate there. */
export const chatLimiter = limiter('chat', {
  windowMs:     60 * 1_000,
  max:          10,
  keyGenerator: byUser,
  message:      { status: 'error', message: 'Chat rate limit reached. Please wait 60 seconds.' },
});

/** 20 requests / 15 min — OAuth initiation + callback. Principal: IP.
 *  Deliberately IP-keyed: this is a brute-force guard on a surface where the
 *  caller has not yet proven an identity, so keying it on one would let an
 *  attacker mint fresh budgets at will. */
export const authLimiter = limiter('auth', {
  windowMs:     15 * 60 * 1_000,
  max:          20,
  keyGenerator: byIp,
  message:      { status: 'error', message: 'Too many authentication attempts. Please try again later.' },
});

/** 5 requests / minute — connector sync. Principal: WORKSPACE.
 *  The resource being protected is a third-party API quota that belongs to the
 *  connected ad account, so the whole team shares one budget. */
export const syncLimiter = limiter('sync', {
  windowMs:     60 * 1_000,
  max:          5,
  keyGenerator: byWorkspace,
  message:      { status: 'error', message: 'Sync rate limit exceeded. Please wait before syncing again.' },
});

/** 10 requests / hour — admin demo seed (spam guard). Principal: USER. */
export const adminSeedLimiter = limiter('adminSeed', {
  windowMs:     60 * 60 * 1_000,
  max:          10,
  keyGenerator: byUser,
  message:      { status: 'error', message: 'Demo seed rate limit exceeded. Please wait before seeding again.' },
});

/** 15 requests / minute — on-demand LLM campaign reasoning. Principal: WORKSPACE. */
export const reasoningLimiter = limiter('reasoning', {
  windowMs:     60 * 1_000,
  max:          15,
  keyGenerator: byWorkspace,
  message:      { error: 'ReasoningRateLimit', message: 'Too many reasoning requests. Please wait a moment.' },
});

/** 30 questions / minute — the Copilot Q&A endpoint. Principal: WORKSPACE. */
export const copilotLimiter = limiter('copilot', {
  windowMs:     60 * 1_000,
  max:          30,
  keyGenerator: byWorkspace,
  message:      { error: 'CopilotRateLimit', message: 'Too many questions. Please wait a moment.' },
});

// ── R11: limiters that did not exist ─────────────────────────

/** 20 executions / minute — real ad-platform mutations. Principal: WORKSPACE.
 *  Queueing a Meta mutation had no cap of its own; it sat under the blanket
 *  apiLimiter, which was IP-keyed and shared with every read in the product.
 *  The budget being spent here is the account's, and so is the risk. */
export const executionLimiter = limiter('execution', {
  windowMs:     60 * 1_000,
  max:          20,
  keyGenerator: byWorkspace,
  message:      { error: 'ExecutionRateLimit', message: 'Too many executions queued. Please wait a moment.' },
});

/** 30 connections / minute — SSE stream. Principal: IP.
 *  /api/events/stream had NO limiter at all, and each connection holds a socket
 *  and a heartbeat interval for as long as it lives. IP-keyed because the
 *  stream token is presented in place of an identity. */
export const streamLimiter = limiter('stream', {
  windowMs:     60 * 1_000,
  max:          30,
  keyGenerator: byIp,
  message:      { error: 'StreamRateLimit', message: 'Too many stream connections. Please wait a moment.' },
});

/** 60 probes / minute — health endpoints. Principal: IP.
 *  Both health routes were unauthenticated and uncapped, and one of them
 *  performs a DB round trip. Generous enough for any real probe cadence. */
export const healthLimiter = limiter('health', {
  windowMs:     60 * 1_000,
  max:          60,
  keyGenerator: byIp,
  message:      { status: 'error', message: 'Too many health checks.' },
});
