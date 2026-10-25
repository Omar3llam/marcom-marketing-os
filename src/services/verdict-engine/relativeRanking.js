// ============================================================
// relativeRanking — portfolio-relative verdict post-pass
// ============================================================
// Runs AFTER rollupVerdicts, over the SAME annotated connector tree, inside the
// engine's pure/deterministic path (no DB, no LLM, no time, no randomness). It
// upgrades an UNDECIDED engagement verdict (HOLD / WATCH) using how a campaign
// ranks against its cohort siblings — the bottom of a group becomes KILL, the top
// becomes SCALE — and rewrites that node's rationale to cite the real group
// average. Everything else is left exactly as the absolute engine decided.
//
// WHY A POST-PASS (not folded into evaluateVerdict): evaluateVerdict sees ONE
// node's metrics against frozen ABSOLUTE thresholds; it has no sibling context. A
// "relative to portfolio" verdict is inherently cross-campaign, so it can only be
// computed once every sibling in the tree is annotated. This function is that seam
// and nothing else calls it — both the read path (getConnectorVerdicts) and the
// write twin (persistConnectorVerdicts) apply it to the tree they already build,
// so the two never disagree and no second Decision row is ever minted.
//
// GOVERNING LAW (load-bearing):
//   • NEVER overrides a measured verdict. Only HOLD / WATCH are open to a relative
//     upgrade; an absolute KILL / SCALE / REFRESH / REALLOCATE is a stronger,
//     threshold-backed signal and is left untouched.
//   • NEVER ranks a revenue campaign. Measured revenue → the ROAS track is more
//     accurate; those campaigns are excluded (revenueMeasured === true).
//   • Ranks WITHIN a cohort only (awareness vs conversion, via revenueExpected) —
//     a low CTR only means "worst" against like campaigns, never across objectives.
//   • Needs a real cohort: ≥ MIN_COHORT siblings, or the group is left as-is (no
//     fabricated "relative to portfolio" claim over one or two campaigns).
//   • No fabricated numbers: the rationale quotes the campaign's own CTR and the
//     real cohort average — both derived from the annotated tree.
// ============================================================
import { VERDICT, VERDICT_TO_REC_TYPES } from './verdictTypes.js';
import { composeConfidence }             from './confidenceEngine.js';

// Only these verdicts are open to a relative upgrade (see governing law above).
const UPGRADABLE = new Set([VERDICT.HOLD, VERDICT.WATCH]);

const RR = Object.freeze({
  MIN_COHORT:      3,     // fewer siblings than this → "relative" means nothing
  QUARTILE:        0.25,  // bottom/top 25% of a cohort
  MIN_SPEND_MINOR: 1000,  // ~10 currency units — skip roster-only / trivial rows
  CONFIDENCE:      0.6,   // softer than an absolute-threshold KILL/SCALE (0.8–0.9)
});

/** PURE: arithmetic mean, 0 for an empty list. */
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * PURE: is this annotated campaign node eligible for relative ranking? A
 * no-revenue engagement campaign with an undecided verdict, real spend, and a
 * positive CTR to rank on.
 */
function isCandidate(node) {
  return (
    node.level === 'CAMPAIGN' &&
    UPGRADABLE.has(node.verdict) &&
    node.signalInput?.revenueMeasured === false &&
    (node.metrics?.spendMinor ?? 0) >= RR.MIN_SPEND_MINOR &&
    (node.signalInput?.ctr ?? 0) > 0
  );
}

/**
 * PURE: rank one cohort by CTR and record the extremes' upgrades into `upgrades`
 * (entityId → { verdict, confidence, rationale, rank }).
 */
function rankCohort(label, group, upgrades) {
  // Deterministic order: CTR desc, ties broken by id so equal-CTR rows are stable.
  const sorted = [...group].sort((a, b) => {
    const d = (b.signalInput.ctr ?? 0) - (a.signalInput.ctr ?? 0);
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
  });

  // Kept as a NUMBER as well as the display string. The rationale below has
  // always been the only place the cohort figures existed, which left a UI that
  // wanted them with a choice between parsing prose and going without.
  const avgCtr = mean(sorted.map((c) => c.signalInput.ctr ?? 0));
  const avgStr = avgCtr.toFixed(2);
  const n = Math.max(1, Math.floor(sorted.length * RR.QUARTILE));

  /**
   * The cohort comparison, as data rather than a sentence. Every figure here is
   * already in the rationale one line below — this publishes them structurally
   * so nothing downstream has to regex them back out.
   *
   * UNITS: `signalInput.ctr` is ALREADY a percent (clicks/impressions × 100 —
   * see verdictEngine's signalInput), so these are rounded, never converted. The
   * ratio convention (0.007) belongs to the client's campaign row, a different
   * field with the same name; multiplying here would publish a 0.70% CTR as 70%.
   */
  const contextFor = (c, rank) => ({
    rank,
    group: label,
    cohortSize: sorted.length,
    ctrPct:    Math.round((c.signalInput.ctr ?? 0) * 100) / 100,
    avgCtrPct: Math.round(avgCtr * 100) / 100,
  });

  // Top n → SCALE.
  for (const c of sorted.slice(0, n)) {
    upgrades.set(c.id, {
      verdict: VERDICT.SCALE,
      confidence: RR.CONFIDENCE,
      rank: 'TOP',
      relativeContext: contextFor(c, 'TOP'),
      rationale: `Highest CTR in the ${label} group (${(c.signalInput.ctr ?? 0).toFixed(2)}% vs ${avgStr}% group average) — strongest engagement in your portfolio. Based on engagement signals only; add revenue data for ROAS-based scoring.`,
    });
  }
  // Bottom n → KILL. In a small cohort the top and bottom slices can overlap; a
  // campaign already marked TOP must not be re-marked BOTTOM.
  for (const c of sorted.slice(-n)) {
    if (upgrades.get(c.id)?.rank === 'TOP') continue;
    upgrades.set(c.id, {
      verdict: VERDICT.KILL,
      confidence: RR.CONFIDENCE,
      rank: 'BOTTOM',
      relativeContext: contextFor(c, 'BOTTOM'),
      rationale: `Lowest CTR in the ${label} group (${(c.signalInput.ctr ?? 0).toFixed(2)}% vs ${avgStr}% group average) — weakest engagement in your portfolio. Based on engagement signals only; add revenue data for ROAS-based scoring.`,
    });
  }
}

/**
 * PURE: apply portfolio-relative ranking to an annotated ACCOUNT node (the output
 * of rollupVerdicts). Returns a NEW node (input is not mutated); campaign children
 * that earn a relative upgrade get a new verdict / confidence / rationale /
 * recommendationTypes and a `relativeRank` tag ('TOP' | 'BOTTOM') the UI can badge.
 * Every other node is returned unchanged.
 *
 * @param {object} node — annotated ACCOUNT node with CAMPAIGN children
 * @returns {object} node with possibly-upgraded children
 */
const hasApprovedCohortAuthority = () => false; // No positive authority exists in capture-v1.

export function applyRelativeRanking(node) {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) return node;

  // Capture-v1 has no approved positive membership authority, including when a
  // traversal exhausted or the bounded identity query returned fewer than 200.
  if (!hasApprovedCohortAuthority()) return { ...node, relativeRefusal: { reason: 'COHORT_COMPLETENESS_UNPROVEN',
    membershipCoverage: node.cohort?.membershipCoverage ?? 'UNKNOWN',
    evaluationCoverage: node.cohort?.evaluationCoverage ?? 'UNKNOWN' } };

  // The existing ranking mathematics remain unchanged below. Admission requires
  // separately approved positive cohort authority, which capture-v1 cannot supply.

  // Split candidates into cohorts on the engine's own awareness/conversion axis.
  const cohorts = { awareness: [], conversion: [] };
  for (const c of node.children) {
    if (!isCandidate(c)) continue;
    (c.revenueExpected ? cohorts.conversion : cohorts.awareness).push(c);
  }

  const upgrades = new Map();
  for (const [label, group] of Object.entries(cohorts)) {
    if (group.length < RR.MIN_COHORT) continue; // too few to rank honestly
    rankCohort(label, group, upgrades);
  }

  if (upgrades.size === 0) return node;

  return {
    ...node,
    children: node.children.map((c) => {
      const up = upgrades.get(c.id);
      if (!up) return c;
      return {
        ...c,
        verdict: up.verdict,
        // RR.CONFIDENCE is this RULE's strength (softer than an absolute
        // threshold), not the verdict's confidence. Composing it against the
        // node's own data-quality score keeps the "confidence is a function of
        // the evidence, never a frozen literal" contract intact through this
        // pass — stamping the bare 0.6 here would have re-frozen every relative
        // verdict, regardless of whether it was ranked off 2k or 2M impressions.
        // dataConfidence is null only for a caller that never supplied a sample
        // size, in which case the rule's own strength stands alone.
        verdictConfidence: c.dataConfidence == null
          ? up.confidence
          : composeConfidence(up.confidence, c.dataConfidence),
        // The signal half must name the source that produced the CURRENT
        // verdict, not the one that produced the verdict this replaced.
        //
        //   absolute verdict — the mechanism's derived reasoning confidence
        //   relative upgrade — the cohort ranking's own strength (RR.CONFIDENCE)
        //
        // Leaving the absolute pass's number here published a triple that did
        // not multiply out: `verdictConfidence` was recomposed from 0.6 while
        // `signalConfidence` still read the diagnosis engine's assessment of a
        // verdict that no longer exists. A reader decomposing the confidence
        // would attribute a cohort-rank KILL to a creative-fatigue score.
        //
        // The DIAGNOSTIC artifacts are deliberately NOT touched: hypotheses,
        // counterfactuals, declined, rootCause and signalType all still describe
        // what the absolute pass found, and each hypothesis says so
        // (`source: 'absolute'`). Those are observations about the entity and
        // remain true; `signalConfidence` is a property of the verdict, and the
        // verdict changed.
        signalConfidence: up.confidence,
        rationale: up.rationale,
        recommendationTypes: [...VERDICT_TO_REC_TYPES[up.verdict]],
        relativeRank: up.rank,
        // The same ranking, as the figures it was decided on. `relativeRank`
        // alone says a cohort decided this and nothing about the cohort — so the
        // one verdict class that CANNOT show a mechanism (its reasoning belongs
        // to the absolute pass, and the honesty gate hides it) also had nothing
        // structured to show instead.
        relativeContext: up.relativeContext,
      };
    }),
  };
}
