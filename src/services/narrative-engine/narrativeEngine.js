// ============================================================
// NarrativeEngine — the reasoned stakeholder narrative (no charts)
// ============================================================
// Public API: composeNarrative({ period, audience, decisions, allocationDeltas,
//                                blended, incrementality, goals, coverage, now })
//
// DETERMINISM CONTRACT:
//   Same input → byte-identical output. No randomness, no LLM, no DB, no
//   timestamps (`now` injected). Prose is composed from sentence templates;
//   every NUMBER is pulled from a real row via figure() and carries its
//   evidenceRef. The LLM never touches a number — that is the whole point.
//
// ISOLATION CONTRACT:
//   NarrativeService loads the real rows (decisions+outcomes, allocation/
//   blended deltas, concluded holdouts, goals, coverage signals) and feeds
//   this engine; nothing here reads the DB.
//
// THE GUARD:
//   This is a REASONED NARRATIVE, not a dashboard. Empty window → one honest
//   "no material changes" claim, never an invented story. Every figure is
//   evidence-bound (figure() throws otherwise). LEADERSHIP sees the outcome
//   story minus execution minutiae and minus any unproven claim.
// ============================================================
import { logger } from '../../utils/logger.js';
import { formatCurrency } from '../../lib/money.js';
import {
  NARRATIVE_AUDIENCE, SECTION, SECTION_TITLE, SECTION_BY_AUDIENCE, EVIDENCE_KIND,
  figure, claim, confidenceScore,
} from './narrativeTypes.js';

const VERDICT_VERB = Object.freeze({
  KILL: 'killed', HOLD: 'held', SCALE: 'scaled', WATCH: 'flagged for watch',
  REALLOCATE: 'reallocated', REFRESH: 'refreshed',
});

function validate(audience) {
  if (!Object.values(NARRATIVE_AUDIENCE).includes(audience)) {
    throw new Error(`composeNarrative: audience must be one of ${Object.values(NARRATIVE_AUDIENCE).join(', ')}`);
  }
}

/** "What we did" — grouped by verdict, figures bound to OutcomeSnapshot rows. */
function sectionDid(decisions) {
  if (decisions.length === 0) return null;
  const claims = [];

  // Summary line (leadership-safe): how many actions, and total spend freed.
  const byVerdict = new Map();
  let savedMinor = 0;
  let savedRef = null;
  let currency = null;
  for (const d of decisions) {
    byVerdict.set(d.verdict, (byVerdict.get(d.verdict) ?? 0) + 1);
    currency = d.currency ?? currency;
    // A negative spend delta = budget freed by the action.
    if (d.monetaryStatus === 'MONETARY_VALID' && typeof d.spendDeltaMinor === 'number' && d.spendDeltaMinor < 0 && d.outcomeId) {
      savedMinor += -d.spendDeltaMinor;
      savedRef = d.outcomeId; // any concrete row anchors the aggregate
    }
  }
  const verbCounts = [...byVerdict.entries()]
    .map(([v, n]) => `${VERDICT_VERB[v] ?? v.toLowerCase()} ${n}`)
    .join(', ');
  const summaryFigs = savedMinor > 0 && savedRef && currency
    ? [figure(savedMinor, currency, savedRef, { kind: EVIDENCE_KIND.OUTCOME })]
    : [];
  const savedText = savedMinor > 0 && savedRef && currency ? `, freeing ${formatCurrency(savedMinor, currency)} of spend` : '';
  claims.push(claim(`We acted on ${decisions.length} ${decisions.length === 1 ? 'entity' : 'entities'} this period — ${verbCounts}${savedText}.`, summaryFigs, { tier: 'exec' }));

  // Per-entity detail (buyer/strategist only — dropped for leadership).
  for (const d of decisions) {
    const label = d.entityLabel ?? d.entityId;
    const figs = [];
    let tail = '';
    if (d.monetaryStatus === 'MONETARY_VALID' && typeof d.spendDeltaMinor === 'number' && d.outcomeId && d.currency) {
      figs.push(figure(d.spendDeltaMinor, d.currency ?? currency, d.outcomeId, { kind: EVIDENCE_KIND.OUTCOME }));
      tail = ` (${d.spendDeltaMinor < 0 ? '−' : '+'}${formatCurrency(Math.abs(d.spendDeltaMinor), d.currency ?? currency)} spend)`;
    }
    claims.push(claim(`${VERDICT_VERB[d.verdict] ?? d.verdict} ${label}${tail}.`, figs, { tier: 'detail' }));
  }
  return { key: SECTION.DID, title: SECTION_TITLE.DID, claims };
}

/** "Where it went" — reallocations, each bound to an AllocationPlan row. */
function sectionAllocated(allocationDeltas) {
  if (allocationDeltas.length === 0) return null;
  const claims = allocationDeltas
    .filter((a) => a.monetaryStatus === 'MONETARY_VALID' && typeof a.deltaMinor === 'number' && a.deltaMinor !== 0 && a.planId && a.currency)
    .map((a) => {
      const dir = a.deltaMinor > 0 ? 'into' : 'out of';
      const amt = Math.abs(a.deltaMinor);
      return claim(
        `Moved ${formatCurrency(amt, a.currency)} ${dir} ${a.channel ?? a.channelId}.`,
        [figure(a.deltaMinor, a.currency, a.planId, { kind: EVIDENCE_KIND.ALLOCATION })],
        { tier: 'exec' },
      );
    });
  if (claims.length === 0) return null;
  return { key: SECTION.ALLOCATED, title: SECTION_TITLE.ALLOCATED, claims };
}

/** "What it changed" — blended truth. Only states a delta when one is given. */
function sectionChanged(blended) {
  if (!blended || !blended.evidenceRef || blended.monetaryStatus !== 'MONETARY_VALID') return null;
  const claims = [];
  if (typeof blended.deltaPct === 'number') {
    const better = blended.deltaPct >= 0;
    claims.push(claim(
      `Blended revenue efficiency ${better ? 'improved' : 'softened'} ${Math.abs(blended.deltaPct).toFixed(1)}% vs the prior period.`,
      [figure(Number(blended.deltaPct.toFixed(1)), '%', blended.evidenceRef, { kind: EVIDENCE_KIND.BLENDED })],
      { tier: 'exec' },
    ));
  } else if (typeof blended.blendedRoas === 'number') {
    claims.push(claim(
      `Blended revenue efficiency stands at ${blended.blendedRoas.toFixed(2)}x (selected Blended Truth revenue over compatible paid-media spend).`,
      [figure(Number(blended.blendedRoas.toFixed(2)), 'x', blended.evidenceRef, { kind: EVIDENCE_KIND.BLENDED })],
      { tier: 'exec' },
    ));
  }
  if (typeof blended.gapPct === 'number' && Math.abs(blended.gapPct) >= 1) {
    claims.push(claim(
      `Platform-reported revenue over-states blended truth by ${blended.gapPct.toFixed(0)}%.`,
      [figure(Number(blended.gapPct.toFixed(0)), '%', blended.evidenceRef, { kind: EVIDENCE_KIND.BLENDED })],
      { tier: 'exec' },
    ));
  }
  if (claims.length === 0) return null;
  return { key: SECTION.CHANGED, title: SECTION_TITLE.CHANGED, claims };
}

/** "What we proved" — concluded holdouts. The only HIGH-confidence claims. */
function sectionProved(incrementality) {
  if (incrementality.length === 0) return null;
  const claims = incrementality
    .filter((t) => typeof t.liftPct === 'number' && t.testId)
    .map((t) => {
      const proven = t.ciExcludesZero === true && t.liftPct > 0;
      const ci = (typeof t.ciLow === 'number' && typeof t.ciHigh === 'number')
        ? ` (95% CI ${(t.ciLow * 100).toFixed(1)}–${(t.ciHigh * 100).toFixed(1)}%${t.ciExcludesZero ? ', excludes zero' : ', crosses zero — inconclusive'})`
        : '';
      const verb = proven ? 'proved a' : 'measured a (not yet conclusive)';
      return claim(
        `A ${t.channel ?? t.testId} holdout ${verb} ${t.liftPct > 0 ? '+' : ''}${t.liftPct.toFixed(1)}% causal lift${ci}.`,
        [figure(Number(t.liftPct.toFixed(1)), '%', t.testId, { kind: EVIDENCE_KIND.INCREMENTALITY })],
        { tier: 'exec', proven },
      );
    });
  if (claims.length === 0) return null;
  return { key: SECTION.PROVED, title: SECTION_TITLE.PROVED, claims };
}

/** "Against the goal" — north-star status; trend-based landing (honest est.). */
function sectionGoal(goals) {
  if (goals.length === 0) return null;
  const claims = goals
    .filter((g) => g.goalId)
    .map((g) => {
      const figs = [];
      let tail = '';
      if (typeof g.targetValue === 'number') {
        figs.push(figure(g.targetValue, g.unit ?? '', g.goalId, { kind: EVIDENCE_KIND.GOAL }));
        tail = ` (target ${g.targetValue}${g.unit ? ` ${g.unit}` : ''})`;
      }
      const status = (g.status ?? 'INSUFFICIENT_EVIDENCE').replace(/_/g, ' ').toLowerCase();
      if (g.status === 'INSUFFICIENT_EVIDENCE' || !g.status) {
        const unavailable = g.unavailableReason === 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE'
          ? 'cannot currently be measured from authoritative business-revenue data'
          : 'has insufficient measurement evidence';
        return claim(`North-star "${g.name}" ${unavailable}${tail}.`, figs, { tier: 'exec' });
      }
      const landing = g.landingEstimate != null
        ? ` Trend-based landing estimate: ${g.landingEstimate}${g.unit ? ` ${g.unit}` : ''}.`
        : '';
      return claim(`North-star "${g.name}" is ${status}${tail}.${landing}`, figs, { tier: 'exec' });
    });
  if (claims.length === 0) return null;
  return { key: SECTION.GOAL, title: SECTION_TITLE.GOAL, claims };
}

/** Drop sections/claims this audience shouldn't see. */
function filterForAudience(sections, audience) {
  const allowed = new Set(SECTION_BY_AUDIENCE[audience] ?? SECTION_BY_AUDIENCE.STRATEGIST);
  const isLeadership = audience === NARRATIVE_AUDIENCE.LEADERSHIP;
  return sections
    .filter((s) => allowed.has(s.key))
    .map((s) => ({
      ...s,
      claims: s.claims.filter((c) => {
        if (isLeadership && c.tier === 'detail') return false; // no execution minutiae
        if (isLeadership && c.proven === false) return false;  // no unproven claims
        return true;
      }),
    }))
    .filter((s) => s.claims.length > 0);
}

/**
 * Compose a stakeholder narrative — reasoned prose grounded in real rows.
 *
 * @param {object} args
 * @param {string} args.period — NARRATIVE_PERIOD
 * @param {string} args.audience — NARRATIVE_AUDIENCE
 * @param {Date}   args.periodStart
 * @param {Date}   args.periodEnd
 * @param {Array<{id, verdict, entityId, entityLabel?, outcomeId?, spendDeltaMinor?, revenueDeltaMinor?, currency?}>} [args.decisions]
 * @param {Array<{planId, channel?, channelId?, deltaMinor, currency?}>} [args.allocationDeltas]
 * @param {{evidenceRef, blendedRoas?, deltaPct?, gapPct?}} [args.blended]
 * @param {Array<{testId, channel?, liftPct, ciLow?, ciHigh?, ciExcludesZero?}>} [args.incrementality]
 * @param {Array<{goalId, name, status?, targetValue?, unit?, landingEstimate?}>} [args.goals]
 * @param {{memoryCoverage?, incrementalityCoverage?, blendedConfidence?, attributionConfidence?}} [args.coverage]
 * @returns {{ period, audience, periodStart, periodEnd, headline, reportConfidence, sections, evidenceRefs }}
 */
export function composeNarrative({
  period, audience, periodStart = null, periodEnd = null,
  decisions = [], allocationDeltas = [], blended = null, incrementality = [], goals = [],
  coverage = {}, now,
} = {}) {
  validate(audience);
  void now;

  const built = [
    sectionDid(decisions),
    sectionAllocated(allocationDeltas),
    sectionChanged(blended),
    sectionProved(incrementality),
    sectionGoal(goals),
  ].filter(Boolean);

  const sections = filterForAudience(built, audience);
  const reportConfidence = confidenceScore(coverage);

  // Empty window → one honest claim, never a fabricated story.
  let headline;
  if (sections.length === 0) {
    headline = 'No material changes this period.';
    sections.push({
      key: SECTION.DID, title: SECTION_TITLE.DID,
      claims: [claim('Lumi made no material moves this period — nothing to report rather than something to invent.', [], { tier: 'exec' })],
    });
  } else {
    const provedN = (built.find((s) => s.key === SECTION.PROVED)?.claims.filter((c) => c.proven).length) ?? 0;
    headline = provedN > 0
      ? `${decisions.length} action${decisions.length === 1 ? '' : 's'} this period, ${provedN} causally proven.`
      : `${decisions.length} action${decisions.length === 1 ? '' : 's'} this period.`;
  }

  // Every evidenceRef cited, de-duplicated — the audit trail of the prose.
  const evidenceRefs = [...new Set(
    sections.flatMap((s) => s.claims.flatMap((c) => c.figures.map((f) => f.evidenceRef))),
  )];

  logger.debug({ audience, period, sections: sections.length, confidence: reportConfidence.score }, '[NarrativeEngine] composed');
  return { period, audience, periodStart, periodEnd, headline, reportConfidence, sections, evidenceRefs };
}
