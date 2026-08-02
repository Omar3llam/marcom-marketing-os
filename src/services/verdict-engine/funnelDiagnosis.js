// ============================================================
// funnelDiagnosis — WHERE in the funnel the money is being lost
// ============================================================
// Public API: diagnoseFunnel({ ctr, actionMetrics, clicks, objective })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no time, no randomness.
//   (Mirrors DiagnosisEngine / VerdictEngine.)
//
// WHY THIS EXISTS:
//   Until the funnel landed, every below-target campaign was diagnosed from
//   CTR/CPC/conversions alone — so a broken landing page and a bad creative were
//   indistinguishable, and both were answered with "refresh the creative". The
//   domain model is explicit that this is the classic misdiagnosis: CTR high +
//   conversions low is a POST-CLICK problem, and changing the creative there
//   destroys the one thing that was working.
//
// SIGNAL PROVENANCE (the contract every signal here must honour):
//   evidence[]     — each item { metric, value, benchmark, status }: the real
//                    numbers the claim rests on, so the UI never has to restate
//                    the reasoning and a reader can check the arithmetic.
//   counterfactual — what this is NOT, and why. The domain model requires it on
//                    every consequential verdict, and it is the difference
//                    between "refresh the creative" and "the creative is fine".
//   action         — one specific thing to go do.
//
// GOVERNING LAW:
//   • NEVER diagnoses a stage it did not measure. A missing stage is null, and
//     null means "blind", not "zero". Reading an absent add-to-cart as a 0% rate
//     would report a catastrophic drop-off on every account without a cart.
//   • Rates are stage-to-stage, not stage-to-clicks, wherever the previous stage
//     was measured — a checkout rate against clicks would blame checkout for
//     losses that happened three steps earlier.
//   • Objective-aware: benchmarks come from benchmarkProvider, and a stage whose
//     benchmark is null for this objective is not evaluated at all.
// ============================================================
import { getBenchmarks } from './benchmarkProvider.js';

export const FUNNEL_SIGNAL = Object.freeze({
  POST_CLICK: 'FUNNEL_DROP_POST_CLICK',
  POST_LPV:   'FUNNEL_DROP_POST_LPV',
  CHECKOUT:   'FUNNEL_DROP_CHECKOUT',
});

// Stage-transition floors that are not objective-specific.
const F = Object.freeze({
  LPV_FLOOR:        0.5,  // click → landing-page-view; below this, leakage not creative
  LPV_HEALTHY:      0.6,  // enough of the traffic arrives to blame a later stage
  CTR_HEALTHY_MULT: 1.5,  // CTR must clear its weak bar by this much to be "healthy"
  ATC_HEALTHY:      0.02, // cart intent exists — enough to blame checkout
  CO_FLOOR:         0.25, // add-to-cart → checkout
  CONFIDENCE: Object.freeze({ POST_CLICK: 0.82, POST_LPV: 0.78, CHECKOUT: 0.75 }),
});

/** PURE: a ratio, or null when either side was never measured. */
function rate(numerator, denominator) {
  if (numerator == null || !Number.isFinite(numerator)) return null;
  if (denominator == null || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** PURE: one evidence row. `status` is the claim this number supports. */
const ev = (metric, value, benchmark, status) => ({ metric, value, benchmark, status });

/**
 * Locate the funnel stage that is leaking, with the evidence and the
 * counterfactual that make the call auditable.
 *
 * Rules are ordered top-of-funnel first and FIRST MATCH WINS: the earliest
 * broken stage is the one to fix, because every later rate is computed off
 * traffic that already leaked and cannot be trusted until it is closed.
 *
 * @param {object} args
 * @param {number} args.ctr — percent (clicks/impressions × 100)
 * @param {object|null} [args.actionMetrics] — the funnel bag; null = blind
 * @param {number} args.clicks
 * @param {string|null} [args.objective]
 * @returns {{signal,stage,confidence,evidence,diagnosis,counterfactual,action}|null}
 *   null when nothing is diagnosable — no clicks, no funnel data, or every
 *   measured stage is healthy. null is a real answer here, never a fallback.
 */
export function diagnoseFunnel({ ctr, actionMetrics = null, clicks, objective = null } = {}) {
  if (!Number.isFinite(clicks) || clicks <= 0) return null;
  if (!actionMetrics || typeof actionMetrics !== 'object') return null;

  const b = getBenchmarks(objective);
  const ctrPct = Number.isFinite(ctr) ? ctr : 0;

  const lpvRate = rate(actionMetrics.lpv, clicks);
  // Each stage measures against the PREVIOUS stage when we have it, falling back
  // to clicks only when the previous stage was never reported.
  const atcRate = rate(actionMetrics.atc, actionMetrics.lpv ?? clicks);
  const coRate  = rate(actionMetrics.checkout, actionMetrics.atc ?? clicks);

  // ── 1. Click bought, page never loaded ────────────────────────────────────
  // Only meaningful where a landing page exists (lpvRate benchmark non-null).
  if (b.lpvRate != null && ctrPct > b.ctr.weak * F.CTR_HEALTHY_MULT && lpvRate !== null && lpvRate < F.LPV_FLOOR) {
    return {
      signal: FUNNEL_SIGNAL.POST_CLICK,
      stage:  'LPV',
      confidence: F.CONFIDENCE.POST_CLICK,
      evidence: [
        ev('CTR',      ctrPct,  b.ctr.weak,  'healthy'),
        ev('LPV_RATE', lpvRate, b.lpvRate,   'weak'),
      ],
      diagnosis:      'Traffic is not reaching the landing page',
      counterfactual: `Not a creative problem — CTR ${ctrPct.toFixed(2)}% is above the ${b.ctr.weak}% bar for this objective, so the ad is earning the click. The loss is after it.`,
      action:         'Check pixel installation, page redirects, and mobile page speed',
    };
  }

  // ── 2. Page loaded, nobody wanted it ──────────────────────────────────────
  if (b.atcRate != null && lpvRate !== null && lpvRate > F.LPV_HEALTHY && atcRate !== null && atcRate < b.atcRate) {
    return {
      signal: FUNNEL_SIGNAL.POST_LPV,
      stage:  'ATC',
      confidence: F.CONFIDENCE.POST_LPV,
      evidence: [
        ev('LPV_RATE', lpvRate, F.LPV_HEALTHY, 'healthy'),
        ev('ATC_RATE', atcRate, b.atcRate,     'weak'),
      ],
      diagnosis:      'Visitors are reaching the page but not adding to cart',
      counterfactual: `Not an audience problem — ${(lpvRate * 100).toFixed(0)}% of clicks reach the page, so the right people are arriving. The offer is what they are declining.`,
      action:         'Review price, product images, description, and trust signals',
    };
  }

  // ── 3. Wanted it, could not buy it ────────────────────────────────────────
  if (b.atcRate != null && atcRate !== null && atcRate > F.ATC_HEALTHY && coRate !== null && coRate < F.CO_FLOOR) {
    return {
      signal: FUNNEL_SIGNAL.CHECKOUT,
      stage:  'CHECKOUT',
      confidence: F.CONFIDENCE.CHECKOUT,
      evidence: [
        ev('ATC_RATE', atcRate, b.atcRate, 'healthy'),
        ev('CO_RATE',  coRate,  F.CO_FLOOR, 'weak'),
      ],
      diagnosis:      'Carts are being filled but checkout is not completing',
      counterfactual: 'Not a creative or audience problem — purchase intent is already proven by the add-to-cart. The friction is in the checkout itself.',
      action:         'Check payment methods, shipping cost visibility, and checkout length',
    };
  }

  return null;
}

/** The thresholds, exported for tests and audit. Frozen — never mutate. */
export { F as FUNNEL_THRESHOLDS };
