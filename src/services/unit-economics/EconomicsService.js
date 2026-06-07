// ============================================================
// EconomicsService — persistence wrapper for unit economics
// ============================================================
// Owns DB I/O (the deterministic unitEconomicsEngine never touches it).
//   getEconomics():        read the row; seed AOV from blended truth if
//                          the workspace has never set one.
//   setEconomics():        upsert the AccountEconomics row.
//   assessSustainability(): econ row + a CAC (point or scenario range)
//                          → computeUnitEconomics (LTV / payback / band).
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { computeUnitEconomics } from './unitEconomicsEngine.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';

// Conservative defaults for a workspace that hasn't configured economics
// yet — enough to compute, honestly flagged as defaults by the caller.
const DEFAULT_GROSS_MARGIN_PCT = Number(process.env.UNIT_ECON_DEFAULT_MARGIN || 0.5);
const DEFAULT_AOV_MINOR        = Number(process.env.UNIT_ECON_DEFAULT_AOV_MINOR || 5_000);

/**
 * Seed an AOV (minor units) from blended truth: portfolio blended revenue
 * is real; without a conversion count we fall back to the default AOV.
 * Pure-ish (reads blended truth) — returns a number, never writes.
 */
async function seedAovMinor(workspaceId) {
  try {
    const { portfolio } = await getBlendedTruth(workspaceId);
    // We don't track conversions in blended truth; use the default AOV but
    // keep the hook so a future conversion source can sharpen it.
    void portfolio;
  } catch (err) {
    logger.debug({ err: err.message, workspaceId }, '[EconomicsService] AOV seed best-effort skipped');
  }
  return DEFAULT_AOV_MINOR;
}

/**
 * Read the workspace's economics, or a default-seeded shape if unset.
 * @returns {Promise<{ economics, isDefault }>}
 */
export async function getEconomics(workspaceId) {
  if (!workspaceId) throw new Error('getEconomics: workspaceId required');
  const row = await prisma.accountEconomics.findUnique({ where: { workspaceId } });
  if (row) return { economics: row, isDefault: false };

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
  const aovMinor = await seedAovMinor(workspaceId);
  return {
    economics: {
      workspaceId,
      currency:             ws?.currency ?? 'USD',
      aovMinor,
      grossMarginPct:       DEFAULT_GROSS_MARGIN_PCT,
      repeatRate:           0,
      avgOrdersPerCustomer: 1,
      targetLtvToCac:       3,
    },
    isDefault: true,
  };
}

/** Upsert the AccountEconomics row. */
export async function setEconomics(workspaceId, data = {}) {
  if (!workspaceId) throw new Error('setEconomics: workspaceId required');
  const fields = {
    currency:             data.currency,
    aovMinor:             data.aovMinor,
    grossMarginPct:       data.grossMarginPct,
    repeatRate:           data.repeatRate,
    avgOrdersPerCustomer: data.avgOrdersPerCustomer,
    targetLtvToCac:       data.targetLtvToCac,
  };
  // Strip undefined so a partial update never nulls a column.
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (clean.aovMinor == null && !(await prisma.accountEconomics.findUnique({ where: { workspaceId } }))) {
    throw new Error('setEconomics: aovMinor is required to create economics');
  }
  const saved = await prisma.accountEconomics.upsert({
    where:  { workspaceId },
    create: { workspaceId, aovMinor: DEFAULT_AOV_MINOR, grossMarginPct: DEFAULT_GROSS_MARGIN_PCT, ...clean },
    update: clean,
  });
  logger.info({ workspaceId }, '[EconomicsService] economics saved');
  return saved;
}

/**
 * Assess sustainability of a CAC (point or scenario range) against the
 * workspace's economics.
 * @returns {Promise<{ economics, isDefault, result }>}
 */
export async function assessSustainability(workspaceId, { cacMinor } = {}) {
  if (!workspaceId) throw new Error('assessSustainability: workspaceId required');
  const { economics, isDefault } = await getEconomics(workspaceId);
  const result = computeUnitEconomics({
    aovMinor:             economics.aovMinor,
    grossMarginPct:       economics.grossMarginPct,
    repeatRate:           economics.repeatRate,
    avgOrdersPerCustomer: economics.avgOrdersPerCustomer,
    cacMinor,
    config: { targetLtvToCac: economics.targetLtvToCac, currency: economics.currency },
  });
  return { economics, isDefault, result };
}
