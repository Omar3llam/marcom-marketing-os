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
