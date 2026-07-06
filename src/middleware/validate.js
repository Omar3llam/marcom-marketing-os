// ============================================================
// MARCOM — Request Validation (Zod)
// ============================================================
import { z } from 'zod';

// ── SCHEMAS ───────────────────────────────────────────────────
export const chatSchema = z.object({
  message:          z.string().min(1).max(8_000),
  session_id:       z.string().max(100).optional(),
  mode:             z.coerce.number().int().min(1).max(5).optional(),
  image_base64:     z.string().max(5_242_880).optional(),  // ~4 MB base64
  image_media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  // Locked context from the onboarding wizard — used as a fallback when the
  // session row was created before the wizard's context round-trip
  // (PUT /api/campaigns/me/context) landed. Capped at 16 KB.
  lumi_context:     z.string().max(16_000).optional(),
});

export const exportSchema = z.object({
  session_id:  z.string().max(100).optional(),
  export_type: z.enum(['campaign', 'social', 'content', 'context']),
  // payload from frontend is discarded — server rebuilds it from session DB.
  // Still accepted to avoid breaking existing clients, but not trusted.
  payload:     z.record(z.unknown()).optional(),
  label:       z.string().max(200).optional(),
});

// ── HIGH-TRAFFIC TOOL BODIES (audit 2026-07 hardening) ───────
// These POST routes previously trusted req.body shapes beyond a couple of
// inline truthiness checks. Schemas cap lengths and pin types; routes keep
// their existing semantic 4xx checks (belt and braces). Free-form objects the
// handlers read defensively (campaignContext, options, contextLock) stay
// z.record so no key the handler needs is stripped.

export const contentGenerateSchema = z.object({
  campaignContext: z.record(z.unknown()).optional(),
  options:         z.record(z.unknown()),          // required object — which assets to generate
  tone:            z.string().max(200).optional(),
  brandVoice:      z.string().max(2_000).optional(),
  targetAudience:  z.string().max(2_000).optional(),
  industry:        z.string().max(200).optional(),
  objective:       z.string().max(2_000).optional(),
  format:          z.string().max(200).optional(),
  dimensions:      z.string().max(100).optional(),
});

export const contentCalendarSchema = z.object({
  projectId:    z.string().min(1).max(100),
  targetMonth:  z.string().min(1).max(100),
  targetSector: z.string().min(1).max(200),
  keyFocus:     z.string().min(1).max(2_000),
});

export const campaignBriefSchema = z.object({
  projectId:  z.string().min(1).max(100),
  objective:  z.string().min(1).max(2_000),
  keyMessage: z.string().min(1).max(2_000),
  duration:   z.string().max(500).optional(),
  budget:     z.string().max(500).optional(),
  competitor: z.string().max(500).optional(),
});

export const strategyBriefSchema = z.object({
  objective:   z.string().min(1).max(2_000),
  audience:    z.string().min(1).max(2_000),
  budget:      z.union([z.string().max(500), z.number()]).optional(),
  timeline:    z.string().max(500).optional(),
  contextLock: z.record(z.unknown()).optional(),
});

// Type/length guard only — the route's own InvalidEmail/InvalidRole 400s are
// an established FE contract and stay authoritative for semantics (including
// the missing-email case, which must stay a 400 InvalidEmail, not a 422).
export const teamInviteSchema = z.object({
  email:      z.string().max(254).optional(),
  collabRole: z.string().max(20).optional(),
});

// ── MIDDLEWARE FACTORY ────────────────────────────────────────
/**
 * Returns an Express middleware that validates req.body with `schema`.
 * Responds 422 with structured errors on failure.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        status: 'error',
        message: 'Validation failed',
        errors: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    req.body = result.data;   // replace with coerced/stripped values
    next();
  };
}
