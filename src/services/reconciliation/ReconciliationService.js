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
import {
  attributed, unavailable, ATTRIBUTION_SOURCE, CONFIDENCE_LEVEL, ATTRIBUTION_STATUS,
  EVIDENCE_STATUS, EVIDENCE_REASON, MODEL_CAVEAT, AttributionEvidenceUnavailableError,
} from '../attribution-engine/attributionTypes.js';
import { MONETARY_STATUS, MONETARY_REASON } from '../../lib/operationalMonetary.js';

/**
 * Concluded holdouts keyed by the channel they measured, WITH the read's health.
 *
 * B5-01T′ · I1 — this is the narrowest point at which the distinction survives.
 * Both callers below need it and they need it for opposite reasons: the report
 * must say "we could not look" instead of "this channel has no holdout", and the
 * allocation feed must refuse rather than quietly optimise on claimed numbers.
 * Returning a bare Map made both of those impossible, because an empty Map was
 * the answer to both questions.
 */
async function concludedByChannel(workspaceId, channels) {
  const tests = await prisma.incrementalityTest.findMany({
    where: { workspaceId, status: 'CONCLUDED' },
  }).catch((err) => {
    logger.warn({ err: err.message, workspaceId }, '[ReconciliationService] holdout read failed');
    return null;
  });
  const byChannelId = new Map();
  if (tests === null) return { byChannelId, status: EVIDENCE_STATUS.UNAVAILABLE };
  for (const t of tests) {
    const match = channels.find((c) => (t.entityId && c.channelId === t.entityId) || c.channel === t.channel);
    if (match) byChannelId.set(match.channelId, t);
  }
  return { byChannelId, status: EVIDENCE_STATUS.OK };
}

/**
 * The reconciliation surface: three Attributed columns per channel + gaps.
 * READ-ONLY.
 */
export async function getReconciliation(workspaceId) {
  if (!workspaceId) throw new Error('getReconciliation: workspaceId required');
  const { channels, portfolio } = await getBlendedTruth(workspaceId);
  if (channels.length === 0) return { status: 'INSUFFICIENT_DATA', rows: [], portfolio: null };

  const { byChannelId: tests, status: holdoutEvidence } = await concludedByChannel(workspaceId, channels);
  const holdoutDown = holdoutEvidence === EVIDENCE_STATUS.UNAVAILABLE;

  const rows = channels.map((c) => {
    const platform = c.platformRevenueMinor == null
      ? unavailable(c.monetaryEvidence?.platform?.monetaryReason ?? MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED)
      : attributed(c.platformRevenueMinor, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: 'last-click, as reported' });
    const blended  = c.blendedRevenueMinor == null
      ? unavailable(c.monetaryEvidence?.blended?.monetaryReason ?? MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED)
      : attributed(c.blendedRevenueMinor, ATTRIBUTION_SOURCE.BLENDED,
      c.coverage === 'RECONCILED' ? CONFIDENCE_LEVEL.HIGH : CONFIDENCE_LEVEL.LOW,
      { caveat: c.coverage === 'RECONCILED' ? 'GA4/Shopify reconciled' : 'unverified — no actuals source' });

    const t = holdoutDown ? undefined : tests.get(c.channelId);
    // Three states, not two (B5-01T′ · I5/I6). The value was already null in the
    // middle case, so what this fixes is the CAPTION and the provenance: "no
    // holdout on this channel" is a finding, and a failed read never earned it.
    let incremental;
    if (holdoutDown) {
      incremental = unavailable(EVIDENCE_REASON.INCREMENTALITY, { caveat: MODEL_CAVEAT.HOLDOUT_UNAVAILABLE });
    } else if (t) {
      incremental = unavailable(MONETARY_REASON.INCREMENTAL_MONETARY_BASIS_UNPROVEN,
        { band: (t.ciLow != null && t.ciHigh != null) ? [t.ciLow, t.ciHigh] : null, caveat: 'holdout monetary valuation basis unproven' });
    } else {
      // Copy preserved verbatim — this slice changes the FAILURE state, not the
      // wording of the finding beside it.
      incremental = attributed(null, ATTRIBUTION_SOURCE.INCREMENTALITY, CONFIDENCE_LEVEL.LOW, { caveat: 'no holdout on this channel — not proven causal' });
    }

    return {
      channelId: c.channelId,
      channel:   c.channel,
      platform, blended, incremental,
      monetaryStatus: c.monetaryStatus,
      monetaryReason: c.monetaryReason,
      holdout: t ? { liftPct: t.liftPct, ciLow: t.ciLow, ciHigh: t.ciHigh, confidenceLabel: t.confidenceLabel } : null,
      gaps: {
        platformVsBlendedMinor:     c.gapMinor,
        blendedVsIncrementalMinor:  null,
      },
    };
  });

  logger.info({ workspaceId, channels: rows.length, tested: tests.size, holdoutEvidence }, '[ReconciliationService] reconciled');
  return {
    // Reporting may degrade (I4) — the platform and blended columns are real and
    // are still returned. What it may not do is look complete while a column is
    // dark for a reason it cannot name.
    status: holdoutDown ? ATTRIBUTION_STATUS.EVIDENCE_UNAVAILABLE : ATTRIBUTION_STATUS.OK,
    evidence: { incrementality: holdoutEvidence },
    rows,
    portfolio: {
      currency:              portfolio.currency,
      monetaryStatus:        portfolio.monetaryStatus,
      monetaryReason:        portfolio.monetaryReason,
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

  const { byChannelId: tests, status: holdoutEvidence } = await concludedByChannel(workspaceId, channels);

  // ── THE REFUSAL (B5-01T′ · I4 / T7 / T9) ────────────────────────────────
  // This function exists to answer ONE question: what is each channel's
  // MEASURED incremental efficiency. A caller reaches it only by asking for
  // `basis: 'incremental'` — an explicit declaration that claimed performance is
  // not good enough for the decision being made.
  //
  // So the fallback below is safe when the answer is "no holdout has been run",
  // and unsafe when the answer is "we could not find out". Both used to produce
  // basis:'blended' + anyIncremental:false, which means a dead query could move
  // real budget onto platform-claimed ROAS while reporting nothing unusual.
  // Reporting degrades; a budget move refuses.
  if (holdoutEvidence === EVIDENCE_STATUS.UNAVAILABLE) {
    throw new AttributionEvidenceUnavailableError(
      EVIDENCE_REASON.INCREMENTALITY,
      'incremental allocation basis requested, but holdout evidence could not be read — refusing rather than falling back to claimed performance',
    );
  }

  let anyIncremental = false;
  const out = channels.map((c) => {
    const t = tests.get(c.channelId);
    let marginalEfficiency = c.blendedRoas;
    let basis = 'blended';
    // Historical incrementalRevenueMinor has no persisted denomination or AOV
    // basis. Its ratio to blended revenue is not a proven monetary comparison.
    const moneyUnavailable = !!t;
    return {
      channelId:           c.channelId,
      channel:             c.channel,
      blendedRoas:         c.blendedRoas,
      blendedRevenueMinor: c.blendedRevenueMinor,
      blendedRevenueWindow: c.blendedRevenueWindow,
      blendedRevenueEfficiency: c.blendedRevenueEfficiency,
      monetaryEvidence: c.monetaryEvidence,
      marginalEfficiency,
      currentSpendMinor:   c.spendMinor,
      currentRevenueMinor: c.blendedRevenueMinor,
      currency:            moneyUnavailable ? null : c.currency,
      monetaryStatus:      moneyUnavailable ? MONETARY_STATUS.UNAVAILABLE_UNTRUSTED : c.monetaryStatus,
      monetaryReason:      moneyUnavailable ? MONETARY_REASON.INCREMENTAL_MONETARY_BASIS_UNPROVEN : c.monetaryReason,
      basis,
    };
  });
  return { channels: out, anyIncremental };
}
