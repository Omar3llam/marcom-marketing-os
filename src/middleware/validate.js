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
  // session row was created before the wizard's /api/context/save round-trip
  // landed. Capped at 16 KB.
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
