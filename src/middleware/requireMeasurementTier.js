// ============================================================
// requireMeasurementTier — Phase 7 measurement paywall gate
// ============================================================
// Measurement (attribution · incrementality) is Agency/Enterprise depth, OFF
// by default. NONE → 403. Resolves the workspace once and stashes it on req
// (req.measurementWorkspaceId + req.measurementTier) for downstream handlers.
//
// Extracted from routes/lumi/measurement.js so the SAME gate guards the
// Phase-7C Testing→Incrementality bridge in routes/lumi/testing.js — one source
// of truth for the paywall, no drift between two copies.
//
// Env override MEASUREMENT_TIER_OVERRIDE for local/dev — R11 (I62): inert in
// production via devOverride.
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { devOverride } from '../lib/devOverrides.js';

// Resolve workspaceId — mirrors the per-route resolvers. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[requireMeasurementTier] workspaceId fallback failed');
    return null;
  }
}

export async function requireMeasurementTier(req, res, next) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const override = devOverride('MEASUREMENT_TIER_OVERRIDE'); // dev/local escape hatch
  let tier = override;
  if (!tier) {
    try {
      const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { measurementTier: true } });
      tier = ws?.measurementTier ?? 'NONE';
    } catch (err) {
      // R11 (I61): this read had no catch, so a DB failure rejected the async
      // middleware — which Express does not forward — and the request hung
      // rather than answering. Fail closed, and answer.
      logger.error({ err: err.message, workspaceId: wsId }, '[requireMeasurementTier] tier lookup failed');
      return res.status(503).json({ error: 'MeasurementTierUnavailable', message: 'Could not determine measurement entitlement right now.' });
    }
  }
  if (tier === 'NONE') {
    return res.status(403).json({ error: 'MeasurementGated', tier: 'NONE', message: 'Measurement is an Agency/Enterprise capability — not enabled for this workspace.' });
  }
  req.measurementWorkspaceId = wsId;
  req.measurementTier = tier;
  next();
}
