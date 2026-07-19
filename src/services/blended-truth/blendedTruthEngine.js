// ============================================================
// BlendedTruthEngine — platform-claimed vs actual revenue
// ============================================================
// Public API: reconcile({ channels })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps. (Mirrors DiagnosisEngine / VerdictEngine.)
//
// ISOLATION CONTRACT:
//   Never reads/writes DB. The caller (BlendedTruthService) loads
//   MetricSnapshots grouped by `source` and feeds this engine.
//
// WHY THIS EXISTS:
//   Allocation is only as honest as the revenue under it. Platforms
//   over-report revenue (cross-channel conversion double-counting).
//   We are NOT doing attribution (Phase 7) — this is a thin
//   reconciliation: where GA4/Shopify ACTUALS exist for a channel we
//   use them (the blended truth) and surface the gap vs the platform
//   claim; where they do NOT exist we fall back to the raw platform
//   number but flag it confidence:LOW / coverage:UNVERIFIED so the
//   allocator (and the human) can see which calls rest on unverified
//   claims.
//
// Money stays in integer minor units throughout.
// ============================================================
import { logger } from '../../utils/logger.js';

export const COVERAGE   = Object.freeze({ RECONCILED: 'RECONCILED', UNVERIFIED: 'UNVERIFIED' });
export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', LOW: 'LOW' });

function validate(channels) {
  if (!Array.isArray(channels)) throw new Error('reconcile: channels must be an array');
  for (const c of channels) {
    if (!c || typeof c !== 'object') throw new Error('reconcile: each channel must be an object');
    if (typeof c.platformRevenueMinor !== 'number' || !Number.isFinite(c.platformRevenueMinor)) {
      throw new Error('reconcile: channel.platformRevenueMinor must be a finite number');
    }
    if (typeof c.spendMinor !== 'number' || !Number.isFinite(c.spendMinor)) {
      throw new Error('reconcile: channel.spendMinor must be a finite number');
    }
  }
}

function roas(revenueMinor, spendMinor) {
  return spendMinor > 0 ? revenueMinor / spendMinor : 0;
}

/**
 * Reconcile platform-claimed revenue against actuals, per channel.
 *
 * @param {object} args
 * @param {Array<object>} args.channels — each:
 *   { channelId, channel?, platformRevenueMinor, actualRevenueMinor|null|undefined,
 *     spendMinor, currency? }
 *   `actualRevenueMinor` present (a finite number) ⇒ reconciled; absent/null ⇒ unverified.
 * @returns {{
 *   channels: Array<{ channelId, channel, name, currency, spendMinor,
 *     platformRevenueMinor, actualRevenueMinor, blendedRevenueMinor,
 *     gapMinor, gapPct, platformRoas, blendedRoas, coverage, confidence }>,
 *   portfolio: { spendMinor, platformRevenueMinor, blendedRevenueMinor,
 *     gapMinor, gapPct, platformRoas, blendedRoas,
 *     reconciledCount, unverifiedCount }
 * }}
 */
export function reconcile({ channels } = {}) {
  validate(channels ?? []);

  const rows = channels.map((c) => {
    const hasActual = typeof c.actualRevenueMinor === 'number' && Number.isFinite(c.actualRevenueMinor);
    const platformRevenueMinor = c.platformRevenueMinor;
    const blendedRevenueMinor  = hasActual ? c.actualRevenueMinor : platformRevenueMinor;

    // gap = how much the platform OVER-reports vs the blended truth
    // (positive ⇒ platform inflated). For unverified channels gap is 0
    // by construction (blended == platform) — the LOW flag carries the warning.
    const gapMinor = platformRevenueMinor - blendedRevenueMinor;
    const gapPct   = platformRevenueMinor > 0 ? gapMinor / platformRevenueMinor : 0;

    return {
      channelId:           c.channelId,
      channel:             c.channel ?? null,   // platform enum — grouping/staleness/styling
      name:                c.name ?? null,      // display identity (campaign name); null → view falls back
      currency:            c.currency ?? 'USD',
      spendMinor:          c.spendMinor,
      platformRevenueMinor,
      actualRevenueMinor:  hasActual ? c.actualRevenueMinor : null,
      blendedRevenueMinor,
      gapMinor,
      gapPct,
      platformRoas:        roas(platformRevenueMinor, c.spendMinor),
      blendedRoas:         roas(blendedRevenueMinor, c.spendMinor),
      coverage:            hasActual ? COVERAGE.RECONCILED : COVERAGE.UNVERIFIED,
      confidence:          hasActual ? CONFIDENCE.HIGH : CONFIDENCE.LOW,
    };
  });

  const portfolio = rows.reduce(
    (acc, r) => {
      acc.spendMinor            += r.spendMinor;
      acc.platformRevenueMinor  += r.platformRevenueMinor;
      acc.blendedRevenueMinor   += r.blendedRevenueMinor;
      if (r.coverage === COVERAGE.RECONCILED) acc.reconciledCount += 1;
      else acc.unverifiedCount += 1;
      return acc;
    },
    { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, reconciledCount: 0, unverifiedCount: 0 },
  );
  portfolio.gapMinor     = portfolio.platformRevenueMinor - portfolio.blendedRevenueMinor;
  portfolio.gapPct       = portfolio.platformRevenueMinor > 0 ? portfolio.gapMinor / portfolio.platformRevenueMinor : 0;
  portfolio.platformRoas = roas(portfolio.platformRevenueMinor, portfolio.spendMinor);
  portfolio.blendedRoas  = roas(portfolio.blendedRevenueMinor, portfolio.spendMinor);

  logger.debug(
    { channels: rows.length, reconciled: portfolio.reconciledCount, unverified: portfolio.unverifiedCount, gapPct: portfolio.gapPct },
    '[BlendedTruthEngine] reconciled',
  );

  return { channels: rows, portfolio };
}
