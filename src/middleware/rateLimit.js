// ============================================================
// MARCOM — Rate Limiting
// ============================================================
import rateLimit from 'express-rate-limit';

const keyGen = (req) => req.auth?.userId || req.ip;

/** 30 requests / minute — general API endpoints */
export const apiLimiter = rateLimit({
  windowMs:         60 * 1_000,
  max:              30,
  keyGenerator:     keyGen,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { status: 'error', message: 'Too many requests. Please wait and try again.' },
});

/** 10 requests / minute — AI chat endpoint (expensive) */
export const chatLimiter = rateLimit({
  windowMs:         60 * 1_000,
  max:              10,
  keyGenerator:     keyGen,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { status: 'error', message: 'Chat rate limit reached. Please wait 60 seconds.' },
});

/** 20 requests / 15 min — OAuth initiation + callback (brute-force guard) */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1_000,
  max:              20,
  keyGenerator:     keyGen,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { status: 'error', message: 'Too many authentication attempts. Please try again later.' },
});

/** 5 requests / minute — connector sync (Meta/Google API abuse guard) */
export const syncLimiter = rateLimit({
  windowMs:         60 * 1_000,
  max:              5,
  keyGenerator:     keyGen,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { status: 'error', message: 'Sync rate limit exceeded. Please wait before syncing again.' },
});

/** 10 requests / hour — admin demo seed (spam guard) */
export const adminSeedLimiter = rateLimit({
  windowMs:         60 * 60 * 1_000,
  max:              10,
  keyGenerator:     keyGen,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { status: 'error', message: 'Demo seed rate limit exceeded. Please wait before seeding again.' },
});

/** 15 requests / minute — on-demand LLM campaign reasoning (per workspace).
 *  Keyed by workspaceId so the cap is shared across a team, not per-IP — an
 *  expensive Claude call guarded against click-spam. Applied as route middleware
 *  (inside /api/lumi, after auth) so req.workspaceId is resolved. */
export const reasoningLimiter = rateLimit({
  windowMs:         60 * 1_000,
  max:              15,
  keyGenerator:     (req) => req.workspaceId || req.auth?.userId || req.ip,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  message:          { error: 'ReasoningRateLimit', message: 'Too many reasoning requests. Please wait a moment.' },
});
