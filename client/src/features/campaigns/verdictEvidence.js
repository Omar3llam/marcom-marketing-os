// ============================================================
// MARCOM / Lumi — verdictEvidence (pure)
// ------------------------------------------------------------
// Turns the verdict engine's EXISTING fields (rationale, confidence, verdict,
// roas, spendMinor) into the marketer-facing evidence strings the Campaigns UI
// shows. Surfacing only: every figure quoted here was written by the backend
// into the rationale, or is the campaign's own snapshot metric — nothing is
// recomputed or invented on the client.
// ============================================================
import { formatCurrency } from '@/lib/money';

// Shown whenever a KILL/SCALE was reached with no measured revenue.
export const NO_REVENUE_DISCLAIMER =
  'No revenue data found — recommendation based on CTR, Frequency and Spend only.';

// ── Reasoning vocabulary ─────────────────────────────────────
// The engine speaks ENUM KEYS and never prose — diagnosisTypes' taxonomy rule
// ("do not add dynamic labels") holds at every boundary it crosses, including
// the database as of the reasoning snapshot. This map is where a key becomes a
// sentence, and it is the ONLY such place on the client.
//
// THE TRAP THESE KEYS SIT ON. Observations carry the UPPERCASE display
// vocabulary ('CTR', 'CPC', 'CONV_RATE', 'CPL', 'SPEND', 'FREQUENCY') — NOT the
// lowercase signal-INPUT field names ('ctr', 'cpcMinor'). diagnosisTypes carries
// the same warning over MECHANISM_SUPPORT, because a lowercase key there matches
// no observation ever emitted and every lookup silently returns nothing. Here
// the failure is softer but the same shape: a mistyped key falls through to the
// raw metric name and the user reads "CONV_RATE" instead of a sentence.
//
// `mechanisms` and `metrics` are nested rather than two exports so the next
// vocabulary the engine grows (signal types, confidence bands) slots in as a
// third key instead of a third top-level map to keep in sync.
export const REASONING_LABELS = Object.freeze({
  // SIGNAL_TYPE, minus HEALTHY and UNDIAGNOSABLE — those are terminal states,
  // and projectHypotheses filters them out before a hypothesis is ever built.
  mechanisms: Object.freeze({
    CREATIVE_FATIGUE:    'Creative fatigue',
    AUDIENCE_MISMATCH:   'Audience mismatch',
    INEFFICIENT_SCALING: 'Inefficient scaling',
    LOW_CTR:             'Low click-through rate',
  }),
  // Two readings of the same metric. `rejected` is a HEALTHY measurement that
  // argued against an alternative; `preferred` is a WEAK one the primary rests
  // on. Same metric, opposite roles — one sentence for both would have to be so
  // vague it said nothing.
  metrics: Object.freeze({
    CTR: Object.freeze({
      rejected:  'Click-through rate was healthy',
      preferred: 'CTR is below benchmark',
    }),
    FREQUENCY: Object.freeze({
      rejected:  'Frequency was within normal range',
      preferred: 'Frequency is above the ceiling',
    }),
    CPC: Object.freeze({
      rejected:  'Cost per click was acceptable',
      preferred: 'CPC is above threshold',
    }),
    CONV_RATE: Object.freeze({
      rejected:  'Conversion rate was normal',
      preferred: 'Conversion rate is dropping',
    }),
    CPL: Object.freeze({
      rejected:  'Cost per lead was acceptable',
      preferred: 'Cost per lead is rising',
    }),
    // SPEND is ungraded by construction — signalRules emits it with a null
    // benchmark, so it never reaches a HEALTHY or WEAK status and cannot appear
    // in either list today. Kept because this map is a statement about the
    // domain's vocabulary, not about which comparisons currently get scored —
    // the same reasoning MECHANISM_SUPPORT gives for listing it.
    SPEND: Object.freeze({
      rejected:  'Spend distribution was balanced',
      preferred: 'Spend is concentrated on a weak performer',
    }),
  }),
});

/** The engine's numeric confidence (0–1) → a marketer label. Null-safe. */
export const BAND = Object.freeze({ HIGH: 0.8, MEDIUM: 0.6 });

export function confidenceLabel(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (confidence >= BAND.HIGH) return 'High';
  if (confidence >= BAND.MEDIUM) return 'Medium';
  return 'Low';
}

/**
 * The measurable evidence the engine already wrote: the rationale's leading
 * clause (before the " — " commentary), e.g. "Lowest CTR in the conversion
 * group (0.85% vs 1.42% group average)". Null when there is no rationale —
 * the caller renders nothing rather than inventing a reason.
 */
export function evidenceClause(rationale) {
  if (typeof rationale !== 'string') return null;
  const clause = rationale.split(' — ')[0].trim().replace(/\.$/, '');
  return clause || null;
}

// ============================================================
// Structured provenance (PR #309)
// ------------------------------------------------------------
// The verdict engine emits `funnel` = { signal, stage, evidence[], diagnosis,
// counterfactual, action } and a machine-readable `rootCause`. Everything below
// reads those FIELDS. The string surgery above (evidenceClause/shortEvidence)
// remains only for verdicts that carry no funnel — a KILL or SCALE still has
// prose and nothing else, so deleting the parser outright would blank them.
//
// Why this matters beyond tidiness: the parser could only ever recover the
// leading clause. The counterfactual (what the problem is NOT) and the action
// were in the string and unreachable — so the panel showed "Traffic is not
// reaching the landing page" and no way to know the creative was fine.
// ============================================================

// How to render each evidence metric the engine can emit. CTR arrives ALREADY
// in percent (clicks/impressions × 100); the funnel rates arrive as ratios.
// Formatting the wrong one shows 0.40% where 40% was meant, so this map is the
// unit contract — an unknown metric renders its raw number rather than guessing.
// NOTE: this `kind` is the UNIT of the number ('percent' | 'ratio' | 'multiple' |
// 'count'). The evidence ITEM the engine emits also carries a `kind`, and that
// one means something else entirely ('benchmark' | 'context' — whether the figure
// was scored at all). They sit on different objects and never meet, but do not
// read one for the other.
const EVIDENCE_UNITS = {
  CTR:      { kind: 'percent', label: 'CTR' },
  LPV_RATE: { kind: 'ratio',   label: 'Landing page views / clicks' },
  ATC_RATE: { kind: 'ratio',   label: 'Add to cart / page views' },
  CO_RATE:  { kind: 'ratio',   label: 'Checkouts / add to cart' },
  // Ad-level evidence (evidenceProvider). SPEND_SHARE is a fraction of the
  // parent's spend, so it renders like the funnel rates. FREQUENCY is neither a
  // percent nor a ratio — it is "times seen per person", and running it through
  // the ratio branch would print a 3.5 frequency as "350.0%".
  SPEND_SHARE: { kind: 'ratio',    label: 'Share of parent spend' },
  FREQUENCY:   { kind: 'multiple', label: 'Frequency' },
  // Video quartile COUNTS from the ad-level actionMetrics bag — whole views, not
  // rates. No emitter ranks on these yet; the entries exist so that when one
  // does, the number arrives with its unit instead of falling through to raw.
  VIDEO_25: { kind: 'count', label: 'Video 25% views' },
  VIDEO_50: { kind: 'count', label: 'Video 50% views' },
};

/** PURE: an evidence number → display string, using the metric's known unit. */
export function formatEvidenceValue(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const unit = EVIDENCE_UNITS[metric];
  if (!unit) return String(value); // unknown metric: show the raw number, never a guessed unit
  if (unit.kind === 'percent')  return `${value.toFixed(2)}%`;
  if (unit.kind === 'multiple') return `${value.toFixed(1)}×`;
  if (unit.kind === 'count')    return `${Math.round(value)} views`;
  return `${(value * 100).toFixed(1)}%`;
}

/** PURE: the metric's marketer-facing name, or the raw key when unrecognised. */
export function evidenceLabel(metric) {
  return EVIDENCE_UNITS[metric]?.label ?? metric;
}

/**
 * PURE: the engine's evidence[] → rows ready to render.
 * Each row keeps the engine's own value AND the benchmark it was judged
 * against, so the screen shows the comparison rather than asserting a verdict.
 * A row whose value will not format is dropped, never rendered as "unknown".
 */
export function evidenceRows(funnel) {
  const items = Array.isArray(funnel?.evidence) ? funnel.evidence : [];
  return items
    .map((e) => ({
      metric:    e?.metric ?? null,
      label:     evidenceLabel(e?.metric),
      value:     formatEvidenceValue(e?.metric, e?.value),
      benchmark: formatEvidenceValue(e?.metric, e?.benchmark),
      status:    e?.status === 'healthy' || e?.status === 'weak' ? e.status : null,
    }))
    .filter((r) => r.metric && r.value);
}

// Data-quality causes the engine can report. These are NOT diagnoses — they say
// the campaign was not judged, and why. Rendering them as a normal verdict
// reason would tell a marketer their campaign is broken when the truth is that
// we have not seen enough of it yet.
const DATA_QUALITY_CAUSES = new Set(['INSUFFICIENT_DATA', 'TOO_EARLY']);

/** PURE: is this verdict a "we did not judge this yet" state? */
export function isDataQualityCause(rootCause) {
  return typeof rootCause === 'string' && DATA_QUALITY_CAUSES.has(rootCause);
}

/**
 * PURE: should the "Why?" block render at all, and under what heading?
 *
 * Previously this was `verdict === 'KILL' || verdict === 'SCALE'`. Every funnel
 * diagnosis is a WATCH — so the entire funnel layer would have rendered
 * NOTHING, which is why this predicate had to move out of the component.
 *
 * The verdict branch now DERIVES from nextActionFor rather than restating it.
 * It was a second hand-written copy of the same list, and it drifted the same
 * way: a verdict that asks for an intervention but has no block to render it in
 * is invisible on this panel — no reason, no next step, and (since the decision
 * lifecycle lives inside this block) no way to record that anyone acted. One
 * list, one place, so the next verdict added asks its question everywhere.
 *
 * @returns {{ show: boolean, heading: string|null }}
 */
export function whyBlock({ verdict, funnel = null, rootCause = null } = {}) {
  if (nextActionFor(verdict)) return { show: true, heading: `Why ${verdict.toLowerCase()}?` };
  if (funnel) return { show: true, heading: 'Where the money is going' };
  if (isDataQualityCause(rootCause)) return { show: true, heading: 'Not judged yet' };
  return { show: false, heading: null };
}

/** PURE: is this half of the confidence product what is holding it down? */
const below = (n) => typeof n === 'number' && Number.isFinite(n) && n < BAND.MEDIUM;

/**
 * PURE: the engine's confidence dimensions → a label plus the reason it is not
 * higher. `confidence` is the PRODUCT of the two halves below, so a middling
 * label never says which one cost it — "Low" reads as "the engine is unsure
 * about your campaign" when the truth is usually that it is unsure about its
 * own evidence.
 *
 * ── ONE LIMITING FACTOR, BY PRIORITY — NOT THE WORSE ONE ────────────────────
 * When both halves are thin the answer is `limitedByData`, even if the signal
 * scored lower. This is a priority rule and not `min()`, because the two are not
 * comparable advice: data availability is something the operator can FIX — run
 * it longer, spend more, connect the missing source — while signal quality is a
 * structural finding about how well the evidence converges, with no action
 * attached. Leading with the actionable one is the useful order, and surfacing
 * both at once turns one clear next step into a paragraph of hedging.
 *
 * Consequence worth knowing: a row limited by BOTH reports only data, so the
 * signal half stays hidden until the data half is fixed. That is intended — it
 * is also the order the operator would have to work in anyway.
 *
 * TODO: return a reasonCode enum ('DATA_LIMITED' | 'SIGNAL_WEAK' | 'NONE')
 * rather than booleans once this needs localising. The UI owns the wording
 * today, which is why the flags are shaped as facts and not as sentences.
 *
 * @param {number|null} confidence       — the composed number the caller acts on
 * @param {number|null} dataConfidence   — input quality: sample × completeness × recency
 * @param {number|null} signalConfidence — how well the evidence converges
 * @returns {{label, limitedByData, limitedBySignal}|null} null when there is no
 *   confidence to describe — never a fabricated band.
 */
export function confidenceDetail({
  confidence = null,
  dataConfidence = null,
  signalConfidence = null,
} = {}) {
  const label = confidenceLabel(confidence);
  if (!label) return null;

  const limitedByData = below(dataConfidence);
  return {
    label,
    limitedByData,
    // Named for the CAUSE, not the symptom: `weakSignal` reads as a claim about
    // the campaign, and this is a claim about our evidence for it.
    limitedBySignal: !limitedByData && below(signalConfidence),
  };
}

/**
 * Compact form for the table badge: the evidence clause without its
 * parenthetical numbers, with the engine's cohort label shortened
 * ("the conversion group" → "its group"). String surgery on the backend's
 * own words only — never a synthesized claim.
 */
export function shortEvidence(rationale) {
  const clause = evidenceClause(rationale);
  if (!clause) return null;
  return clause
    .replace(/\s*\(.*\)$/, '')
    .replace(/\bthe (awareness|conversion) group\b/, 'its group');
}

/**
 * The decision as shareable plain text (Slack / email / a ticket). Assembled
 * from the SAME strings the panel renders — every line is the engine's own
 * output or a real snapshot metric, so what the marketer pastes is exactly what
 * Lumi showed. A missing field drops its line rather than printing "unknown".
 */
export function buildRecommendationText({
  verdict, name, rationale = null, nextAction = null,
  confidence = null, spendMinor = null, currency = 'USD',
} = {}) {
  const lines = ['Recommendation', '', `Campaign: ${name}`, `Verdict: ${verdict}`];

  if (nextAction) lines.push('', `Recommended action:\n${nextAction}`);

  const evidence = evidenceClause(rationale);
  if (evidence) lines.push('', `Evidence:\n${evidence}.`);

  const conf = confidenceLabel(confidence);
  if (conf) lines.push('', `Confidence: ${conf}`);

  // The synced-window total, quoted as-is — the window varies per sync, so it is
  // never presented as a rate (see ignoreCostFor).
  if (spendMinor != null) lines.push('', `Spend analyzed: ${formatCurrency(spendMinor, currency || 'USD')}`);

  return lines.join('\n');
}

// Deep links back to the ad platform, keyed by the campaign's platform-native
// externalId. Only channels whose documented parameter genuinely identifies a
// CAMPAIGN are listed:
//   • TIKTOK is deliberately absent — its `aadvid` parameter is the ADVERTISER
//     id, so passing a campaign id builds a link that resolves to nothing. A
//     button that lands the marketer on an error page is worse than no button.
//   • SNAP / LINKEDIN have no verified campaign deep-link format here.
// Both simply return null, so the UI renders nothing for them.
const PLATFORM_URLS = {
  META:   (externalId) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${encodeURIComponent(externalId)}`,
  GOOGLE: (externalId) => `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(externalId)}`,
};

/** Channels this build can deep-link into (uppercase Channel enum values). */
export const LINKABLE_CHANNELS = Object.freeze(Object.keys(PLATFORM_URLS));

/**
 * The campaign-specific platform URL, or null when it can't be built honestly —
 * unknown channel, or no externalId (a row that predates the connector). NEVER
 * falls back to a generic account URL: "open this campaign" that opens something
 * else is a broken promise, and a dead link is worse than an absent one.
 */
export function platformUrl(channel, externalId) {
  if (!channel || !externalId) return null;
  const builder = PLATFORM_URLS[String(channel).toUpperCase()];
  return builder ? builder(externalId) : null;
}

// The engine's own saturation ceiling (verdictEngine.js V.FATIGUE_FREQ). Mirrored
// here so the row highlights Frequency on exactly the campaigns the engine treats
// as fatigued — a lower client-side threshold would call Freq "decisive" on a
// campaign the engine considers fine, which is a judgment the client can't make.
export const FATIGUE_FREQ = 3.5;

/**
 * The ONE metric that carries this campaign's verdict, chosen from the data
 * itself. The UI never reads signalType, so a new backend signal type never
 * requires a frontend release:
 *
 *   revenue measured          → ROAS  (the verdict was scored on return)
 *   no revenue, freq ≥ 3.5    → Freq  (past the engine's fatigue ceiling)
 *   no revenue                → CTR   (the engagement track's scoring input)
 *
 * Returns null when none of the three was reported — the caller renders "—"
 * rather than picking a metric it doesn't have.
 */
export function decisiveMetric({ roas = null, ctr = null, frequency = null, revenueMinor = null } = {}) {
  // Revenue track: a measured revenue figure is what makes ROAS meaningful. A
  // real 0 revenue is NOT revenue data (nothing was measured), matching the
  // engine's own `revenueMinor > 0` gate.
  if (revenueMinor > 0 && roas != null) return { label: 'ROAS', value: roas, format: 'roas' };
  // Engagement track: fatigue outranks click-through — a saturated audience is
  // the reason the CTR fell, so it's the more decisive of the two.
  if (frequency != null && frequency >= FATIGUE_FREQ) return { label: 'Freq', value: frequency, format: 'freq' };
  if (ctr != null) return { label: 'CTR', value: ctr, format: 'ctr' };
  return null;
}

/**
 * The next step an actionable verdict asks for. Null for every other verdict —
 * a campaign that is fine to keep running has no step, and inventing one would
 * manufacture an ask the engine never made.
 *
 * THIS IS ALSO THE LIFECYCLE GATE. Since the decision action moved onto the
 * campaign detail panel, a verdict with no next action gets no "Did you act on
 * this?" either — which is correct (nothing to have acted on) and is why the
 * three entries here are exactly the three verdicts that ask for an
 * intervention. REALLOCATE was missing, so the one verdict whose whole content
 * is "move the money" had no way to record that anyone did.
 *
 * REALLOCATE IS NOT SCALE, and the wording keeps them apart on purpose:
 *   SCALE      — this is winning; put MORE behind it.
 *   REALLOCATE — this is not converting; move what it has ELSEWHERE.
 * Nor is it KILL, whose step pauses the campaign first. A REALLOCATE campaign
 * keeps running on a smaller share. Collapsing any two of these into one
 * sentence would lose a distinction the verdict itself is made of.
 *
 * The REALLOCATE sentence is the imperative of this product's own one-liner for
 * the verdict (helpContent.REALLOCATE_VERDICT, "Budget is better spent
 * elsewhere — move spend to stronger campaigns"), not new copy.
 */
export function nextActionFor(verdict) {
  if (verdict === 'KILL') return 'Pause and reallocate budget';
  if (verdict === 'SCALE') return 'Increase budget or expand audience';
  if (verdict === 'REALLOCATE') return 'Move spend to stronger campaigns';
  return null;
}

/**
 * "What happens if I ignore it?" — phrased only from real figures. spendMinor
 * is the synced-window total (the window varies per sync), so it is quoted as
 * spend-so-far, never extrapolated into a per-month rate the data can't support.
 */
export function ignoreCostFor({ verdict, roas = null, spendMinor = null, currency = 'USD' } = {}) {
  if (verdict === 'KILL') {
    if (roas != null) {
      return `Continuing to spend here returns ${roas.toFixed(2)}x — below break-even, so every unit spent loses money.`;
    }
    return spendMinor != null
      ? `Continuing to spend here grows the ${formatCurrency(spendMinor, currency)} already spent with no revenue measured.`
      : 'Continuing to spend here wastes budget with no revenue measured.';
  }
  if (verdict === 'SCALE') {
    return roas != null
      ? 'Not scaling misses the highest-return opportunity in your portfolio.'
      : 'Not scaling misses the strongest-engagement campaign in your portfolio.';
  }
  return null;
}
