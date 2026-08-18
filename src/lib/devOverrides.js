// ============================================================
// devOverrides — R11 (I62) production-inert escape hatches
// ============================================================
// Three env vars exist so a developer can put themselves in another seat
// without touching the database:
//
//   PLAN_OVERRIDE              — pretend the workspace is on FREE/GROWTH/PRO
//   COLLAB_ROLE_OVERRIDE       — pretend the seat is STRATEGIST/BUYER/CLIENT
//   MEASUREMENT_TIER_OVERRIDE  — pretend measurement is enabled
//
// Each one short-circuits a real authorization decision, and each was read
// unconditionally — so a single stray value in the production environment
// silently rewrote the entitlement, the role, or the paywall for every request
// the process served. An override is a development affordance; in production it
// is an authorization bypass with an innocent name.
//
// Reading them through this seam makes that impossible to reintroduce
// per-middleware: production returns null, and says loudly that it did, because
// an override sitting in a production environment is a configuration incident
// worth seeing in the logs.
// ============================================================
import { logger } from '../utils/logger.js';

const warned = new Set();

/**
 * Read a development-only override.
 * @param   {string} name  env var name
 * @returns {string|null}  its value outside production; ALWAYS null in production
 */
export function devOverride(name) {
  const raw = process.env[name];
  if (!raw) return null;

  if (process.env.NODE_ENV === 'production') {
    // Once per process per variable — this is a standing misconfiguration, not
    // a per-request event, and a log line per request would bury it.
    if (!warned.has(name)) {
      warned.add(name);
      logger.error(
        { override: name },
        '[devOverrides] a development authorization override is set in production and is being IGNORED — remove it from the environment',
      );
    }
    return null;
  }

  return raw;
}

/** Test seam: forget which overrides have already been reported. */
export function _resetOverrideWarnings() {
  warned.clear();
}
