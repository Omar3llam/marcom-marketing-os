// ============================================================
// ReconciliationService — platform vs blended vs incremental
// ============================================================
// Owns DB I/O. Composes the THREE honest views of revenue per channel,
// side by side, with the gaps explicit:
//   • platform-reported  (last-click, what the ad platform claims)
//   • blended-truth      (P3 — GA4/Shopify reconciled)
//   • incrementality-adjusted (causal — measured holdout lift, where one exists)
//
// And the allocation feed (acceptance #3): `incrementalChannels()` returns
// P3 channel inputs whose marginalEfficiency is discounted by the measured
// incremental/claimed ratio, so budget moves ride INCREMENTAL, not claimed,
// performance — with ZERO change to the allocation engine.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { attributed, ATTRIBUTION_SOURCE, CONFIDENCE_LEVEL } from '../attribution-engine/attributionTypes.js';

/** Concluded holdouts keyed by the channel they measured. */
async function concludedByChannel(workspaceId, channels) {
  const tests = await prisma.incrementalityTest.findMany({
    where: { workspaceId, status: 'CONCLUDED' },
  }).catch(() => []);
  const byChannelId = new Map();
  for (const t of tests) {
    const match = channels.find((c) => (t.entityId && c.channelId === t.entityId) || c.channel === t.channel);
    if (match) byChannelId.set(match.channelId, t);
  }
  return byChannelId;
}

/**
 * The reconciliation surface: three Attributed columns per channel + gaps.
 * READ-ONLY.
 */
export async function getReconciliation(workspaceId) {
  if (!workspaceId) throw new Error('getReconciliation: workspaceId required');
  const { channels, portfolio } = await getBlendedTruth(workspaceId);
  if (channels.length === 0) return { status: 'INSUFFICIENT_DATA', rows: [], portfolio: null };

  const tests = await concludedByChannel(workspaceId, channels);

  const rows = channels.map((c) => {
    const platform = attributed(c.platformRevenueMinor, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: 'last-click, as reported' });
    const blended  = attributed(c.blendedRevenueMinor, ATTRIBUTION_SOURCE.BLENDED,
      c.coverage === 'RECONCILED' ? CONFIDENCE_LEVEL.HIGH : CONFIDENCE_LEVEL.LOW,
      { caveat: c.coverage === 'RECONCILED' ? 'GA4/Shopify reconciled' : 'unverified — no actuals source' });

    const t = tests.get(c.channelId);
    const incremental = (t && t.incrementalRevenueMinor != null)
      ? attributed(t.incrementalRevenueMinor, ATTRIBUTION_SOURCE.INCREMENTALITY, t.confidenceLabel ?? CONFIDENCE_LEVEL.MEDIUM,
          { band: (t.ciLow != null && t.ciHigh != null) ? [t.ciLow, t.ciHigh] : null, caveat: 'measured holdout lift' })
      : attributed(null, ATTRIBUTION_SOURCE.INCREMENTALITY, CONFIDENCE_LEVEL.LOW, { caveat: 'no holdout on this channel — not proven causal' });

    return {
      channelId: c.channelId,
      channel:   c.channel,
      platform, blended, incremental,
      gaps: {
        platformVsBlendedMinor:     c.platformRevenueMinor - c.blendedRevenueMinor,
        blendedVsIncrementalMinor:  incremental.value != null ? c.blendedRevenueMinor - incremental.value : null,
      },
    };
  });

  logger.info({ workspaceId, channels: rows.length, tested: tests.size }, '[ReconciliationService] reconciled');
  return {
    status: 'OK',
    rows,
    portfolio: {
      spendMinor:            portfolio.spendMinor,
      platformRevenueMinor:  portfolio.platformRevenueMinor,
      blendedRevenueMinor:   portfolio.blendedRevenueMinor,
      platformVsBlendedMinor: portfolio.gapMinor,
      gapPct:                portfolio.gapPct,
    },
  };
}

/**
 * Allocation feed: P3 channel inputs whose marginalEfficiency is discounted
 * by the MEASURED incremental/claimed ratio (tested channels only; untested
 * channels keep blendedRoas, flagged). Fed to allocate() — no engine change.
 * @returns {Promise<{ channels, anyIncremental }>}
 */
export async function incrementalChannels(workspaceId) {
  if (!workspaceId) throw new Error('incrementalChannels: workspaceId required');
  const [{ channels }] = await Promise.all([getBlendedTruth(workspaceId)]);
  if (channels.length === 0) return { channels: [], anyIncremental: false };

  const tests = await concludedByChannel(workspaceId, channels);

  let anyIncremental = false;
  const out = channels.map((c) => {
    const t = tests.get(c.channelId);
    let marginalEfficiency = c.blendedRoas;
    let basis = 'blended';
    if (t && t.incrementalRevenueMinor != null && c.blendedRevenueMinor > 0) {
      // incremental / claimed ratio scales the efficiency Lumi optimizes on.
      const ratio = Math.max(0, Math.min(1.5, t.incrementalRevenueMinor / c.blendedRevenueMinor));
      marginalEfficiency = c.blendedRoas * ratio;
      basis = 'incremental';
      anyIncremental = true;
    }
    return {
      channelId:           c.channelId,
      channel:             c.channel,
      blendedRoas:         c.blendedRoas,
      marginalEfficiency,
      currentSpendMinor:   c.spendMinor,
      currentRevenueMinor: c.blendedRevenueMinor,
      currency:            c.currency,
      basis,
    };
  });
  return { channels: out, anyIncremental };
}
