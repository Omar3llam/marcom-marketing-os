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
import { MONETARY_STATUS, MONETARY_REASON, monetaryUnavailable, sameMonetaryUnit } from '../../lib/operationalMonetary.js';
import { combineRevenueWindows, unknownRevenueWindow } from '../../lib/revenueMeasurementWindow.js';
import { evaluateBlendedRevenueEfficiency } from '../../lib/blendedRevenueEfficiency.js';
import { evaluateRevenueReconciliation, aggregateRevenueReconciliations } from '../../lib/revenueReconciliation.js';

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

const valid = (state) => state?.monetaryStatus === MONETARY_STATUS.VALID;

function aggregateUnit(channels, field, evidenceKey) {
  const contributors = channels.filter((c) => c[field] >= 0 && c.monetaryEvidence?.[evidenceKey]
    && (evidenceKey !== 'spend' || c.spendEvidencePresent !== false)
    && (evidenceKey !== 'platform' || c.platformEvidencePresent !== false));
  if (contributors.length === 0) return monetaryUnavailable(MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED);
  return sameMonetaryUnit(...contributors.map((c) => c.monetaryEvidence?.[evidenceKey]));
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
    const spendUnit = c.monetaryEvidence?.spend;
    const platformUnit = c.monetaryEvidence?.platform;
    const blendedUnit = c.monetaryEvidence?.blended;
    const blendedRatioUnit = sameMonetaryUnit(spendUnit, blendedUnit);
    const blendedRevenueWindow = hasActual
      ? (c.actualRevenueWindow ?? unknownRevenueWindow())
      : (c.platformRevenueWindow ?? unknownRevenueWindow());
    const spendWindow = c.spendWindow ?? unknownRevenueWindow();
    const blendedRevenueEfficiency = evaluateBlendedRevenueEfficiency({
      revenueMinor: blendedRevenueMinor, spendMinor: c.spendMinor,
      revenueMoney: blendedUnit, spendMoney: spendUnit,
      revenueWindow: blendedRevenueWindow, spendWindow,
    });
    const platformRoasEvidence = evaluateBlendedRevenueEfficiency({
      revenueMinor: platformRevenueMinor, spendMinor: c.spendMinor,
      revenueMoney: platformUnit, spendMoney: spendUnit,
      revenueWindow: c.platformRevenueWindow ?? unknownRevenueWindow(), spendWindow,
    });

    const reconciliation = evaluateRevenueReconciliation({
      actualPresent: c.actualRevenueMinor != null, platformRevenueMinor, actualRevenueMinor: c.actualRevenueMinor,
      platformMoney: platformUnit, actualMoney: c.monetaryEvidence?.actual,
      platformMeasurements: c.reconciliationEvidence?.platform, actualMeasurements: c.reconciliationEvidence?.actual,
      platformWindow: c.platformRevenueWindow, actualWindow: c.actualRevenueWindow,
      platformPresent: c.platformEvidencePresent !== false,
    });

    return {
      channelId:           c.channelId,
      channel:             c.channel ?? null,   // platform enum — grouping/staleness/styling
      name:                c.name ?? null,      // display identity (campaign name); null → view falls back
      currency:            blendedRatioUnit.currency,
      monetaryStatus:      blendedRatioUnit.monetaryStatus,
      monetaryReason:      blendedRatioUnit.monetaryReason,
      monetaryEvidence:    c.monetaryEvidence ?? null,
      spendMinor:          valid(spendUnit) ? c.spendMinor : null,
      platformRevenueMinor: valid(platformUnit) ? platformRevenueMinor : null,
      actualRevenueMinor:  hasActual && valid(c.monetaryEvidence?.actual) ? c.actualRevenueMinor : null,
      blendedRevenueMinor: valid(blendedUnit) ? blendedRevenueMinor : null,
      blendedRevenueWindow,
      platformRevenueWindow: c.platformRevenueWindow ?? unknownRevenueWindow(),
      spendWindow,
      blendedRevenueEfficiency,
      reconciliation,
      gapMinor:            reconciliation.gapMinor,
      gapPct:              reconciliation.gapPct,
      platformRoas:        platformRoasEvidence.value,
      blendedRoas:         blendedRevenueEfficiency.value, // deprecated API alias
      coverage:            hasActual ? COVERAGE.RECONCILED : COVERAGE.UNVERIFIED,
      confidence:          hasActual ? CONFIDENCE.HIGH : CONFIDENCE.LOW,
    };
  });

  const portfolio = channels.reduce(
    (acc, r) => {
      acc.spendMinor            += r.spendMinor;
      acc.platformRevenueMinor  += r.platformRevenueMinor;
      acc.blendedRevenueMinor   += r.actualRevenueMinor != null ? r.actualRevenueMinor : r.platformRevenueMinor;
      return acc;
    },
    { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0 },
  );
  portfolio.reconciliation = aggregateRevenueReconciliations(rows.map(r => r.reconciliation));
  for (const key of ['gapMinor', 'gapPct', 'reconciledCount', 'unverifiedCount', 'unavailableCount', 'totalChannelCount']) {
    portfolio[key] = portfolio.reconciliation[key];
  }
  portfolio.platformRoas = roas(portfolio.platformRevenueMinor, portfolio.spendMinor);
  portfolio.blendedRoas  = roas(portfolio.blendedRevenueMinor, portfolio.spendMinor);

  const spendUnit = aggregateUnit(channels, 'spendMinor', 'spend');
  const platformUnit = aggregateUnit(channels, 'platformRevenueMinor', 'platform');
  const blendedContributors = channels.map((c) => ({ ...c, _blended: c.actualRevenueMinor != null ? c.actualRevenueMinor : c.platformRevenueMinor }));
  const blendedUnit = aggregateUnit(blendedContributors, '_blended', 'blended');
  const platformComparison = sameMonetaryUnit(spendUnit, platformUnit);
  const blendedComparison = sameMonetaryUnit(spendUnit, blendedUnit);
  portfolio.currency = blendedComparison.currency;
  portfolio.monetaryStatus = blendedComparison.monetaryStatus;
  portfolio.monetaryReason = blendedComparison.monetaryReason;
  portfolio.monetaryEvidence = { spend: spendUnit, platform: platformUnit, blended: blendedUnit };
  portfolio.blendedRevenueWindow = combineRevenueWindows(rows.map((r) => r.blendedRevenueWindow));
  // Revenue-only channels do not contribute spend. Keep zero-valued platform
  // observations: they still represent a measured interval and must not vanish.
  portfolio.spendWindow = combineRevenueWindows(rows
    .filter((_r, i) => channels[i].spendEvidencePresent !== false)
    .map((r) => r.spendWindow));
  portfolio.blendedRevenueEfficiency = evaluateBlendedRevenueEfficiency({
    revenueMinor: portfolio.blendedRevenueMinor, spendMinor: portfolio.spendMinor,
    revenueMoney: blendedUnit, spendMoney: spendUnit,
    revenueWindow: portfolio.blendedRevenueWindow, spendWindow: portfolio.spendWindow,
  });
  portfolio.blendedRoas = portfolio.blendedRevenueEfficiency.value; // deprecated API alias
  portfolio.platformRoas = evaluateBlendedRevenueEfficiency({
    revenueMinor: portfolio.platformRevenueMinor, spendMinor: portfolio.spendMinor,
    revenueMoney: platformUnit, spendMoney: spendUnit,
    revenueWindow: combineRevenueWindows(rows.filter((_r, i) => channels[i].platformEvidencePresent !== false)
      .map((r) => r.platformRevenueWindow)),
    spendWindow: portfolio.spendWindow,
  }).value;
  if (!valid(spendUnit)) portfolio.spendMinor = null;
  if (!valid(platformUnit)) portfolio.platformRevenueMinor = null;
  if (!valid(blendedUnit)) portfolio.blendedRevenueMinor = null;
  if (!valid(platformComparison)) portfolio.platformRoas = null;
  if (!valid(blendedComparison)) portfolio.blendedRoas = null;

  logger.debug(
    { channels: rows.length, reconciled: portfolio.reconciledCount, unverified: portfolio.unverifiedCount, gapPct: portfolio.gapPct },
    '[BlendedTruthEngine] reconciled',
  );

  return { channels: rows, portfolio };
}
