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
import { getBlendedTruth, latestPerStream } from '../blended-truth/BlendedTruthService.js';
import { selectOperationalSnapshots } from '../evidence/index.js';

// Conservative defaults for a workspace that hasn't configured economics
// yet — enough to compute, honestly flagged as defaults by the caller.
const DEFAULT_GROSS_MARGIN_PCT = Number(process.env.UNIT_ECON_DEFAULT_MARGIN || 0.5);
const DEFAULT_AOV_MINOR        = Number(process.env.UNIT_ECON_DEFAULT_AOV_MINOR || 5_000);

// Platform sources whose MetricSnapshot conversions are real acquisitions.
// MUST match AttributionService's aggregation so "conversions" never diverges
// between the two surfaces.
const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);

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
 * The account's CURRENT (realized) blended CAC — trailing actual spend ÷
 * actual platform conversions, from the SAME sources attribution uses
 * (blended-truth spend + MetricSnapshot platform conversions).
 *
 * DISTINCT FROM the plan's PROJECTED CAC (scenarioEngine: projected spend ÷
 * projected volume, forward/hypothetical). These answer different questions —
 * "what is this account's CAC right now" vs "what would CAC be under a proposed
 * plan" — so they are named differently ON PURPOSE and must never be conflated.
 * Null conversions → null CAC (honest: no realized CAC to compute against).
 *
 * @returns {Promise<{ currentBlendedCacMinor:(number|null), totalSpendMinor:number, totalConversions:number, currency:string }>}
 */
export async function getCurrentCac(workspaceId) {
  if (!workspaceId) throw new Error('getCurrentCac: workspaceId required');
  const { channels } = await getBlendedTruth(workspaceId);
  if (!channels || channels.length === 0) {
    return { currentBlendedCacMinor: null, totalSpendMinor: 0, totalConversions: 0, currency: 'USD' };
  }

  const totalSpendMinor = channels.reduce((sum, c) => sum + (c.spendMinor ?? 0), 0);
  const currency = channels.find((c) => c.currency)?.currency ?? 'USD';

  // Platform-reported conversions — same rows, same stream reduction and same
  // population as AttributionService (kept consistent so the two never disagree
  // on volume; latestPerStream is literally the same function rather than a copy
  // that has to be kept in step by hand).
  //
  // R3: this service no longer states where its evidence lives. The operational
  // population — workspace scope and the window allow-list Phase G introduced —
  // is declared once, in the Evidence layer, and asked for here.
  //
  // THREE THINGS ARE PRESERVED EXACTLY, none of them incidental:
  //
  //   1. NO TEMPORAL BOUND. This query has never had one, and #359's fix was not
  //      to add one — it was latestPerStream below, which supersedes a channel's
  //      older readings instead of summing them. Introducing a `since` here would
  //      silently drop channels whose last sync predates it, and a channel that
  //      vanishes from the denominator makes CAC look CHEAPER, which is the
  //      direction that gets a budget increased.
  //   2. THE ENTITY NARROWING. Only the channels blended truth returned are
  //      asked about; the seam takes them as an explicit list rather than this
  //      service filtering a workspace-wide read afterwards, which would be a
  //      different query wearing the same result.
  //   3. THE CATCH. This read has always degraded to `[]`, so a failed read
  //      yields zero conversions and therefore a NULL CAC — never a number. It
  //      stays at THIS call site rather than moving into the seam, where it would
  //      turn an unreachable database into "no metrics" for every other consumer.
  //
  // entityId + date are selected so the reduction can identify a stream and its
  // newest row; the sum below then runs once per entity, not once per sync.
  // No orderBy — this query never had one, and latestPerStream is documented
  // order-independent precisely so it does not need one.
  const snaps = await selectOperationalSnapshots(workspaceId, {
    entityIds: channels.map((c) => c.channelId),
    select:    { entityId: true, date: true, conversions: true, source: true },
    orderBy:   null,
  }).catch(() => []);
  let totalConversions = 0;
  for (const s of latestPerStream(snaps)) {
    if (!PLATFORM_SOURCES.has(s.source)) continue;
    totalConversions += s.conversions ?? 0;
  }

  const currentBlendedCacMinor = totalConversions > 0 ? Math.round(totalSpendMinor / totalConversions) : null;
  return { currentBlendedCacMinor, totalSpendMinor, totalConversions, currency };
}

/**
 * The standalone unit-economics assessment for the Intelligence surface.
 * GOVERNING LAW: a sustainability verdict is computed ONLY when the user has
 * ASSERTED their economics (not the seeded defaults) AND a real current CAC
 * exists. Otherwise `assessment` stays null and `reason` tells the surface to
 * stay honest-empty — a default-based number is never dressed as a measurement.
 *
 * @returns {Promise<{ economics, isDefault, currentCac, assessment:(object|null), reason:(string|null) }>}
 */
export async function getEconomicsAssessment(workspaceId) {
  if (!workspaceId) throw new Error('getEconomicsAssessment: workspaceId required');
  const [{ economics, isDefault }, currentCac] = await Promise.all([
    getEconomics(workspaceId),
    getCurrentCac(workspaceId),
  ]);

  let assessment = null;
  let reason = null;
  if (isDefault) {
    reason = 'NOT_CONFIGURED'; // economics never asserted — don't compute off defaults
  } else if (currentCac.currentBlendedCacMinor == null) {
    reason = 'NO_CONVERSIONS'; // no realized CAC to assess against
  } else {
    assessment = computeUnitEconomics({
      aovMinor:             economics.aovMinor,
      grossMarginPct:       economics.grossMarginPct,
      repeatRate:           economics.repeatRate,
      avgOrdersPerCustomer: economics.avgOrdersPerCustomer,
      cacMinor:             currentCac.currentBlendedCacMinor,
      config: { targetLtvToCac: economics.targetLtvToCac, currency: economics.currency },
    });
  }
  return { economics, isDefault, currentCac, assessment, reason };
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
