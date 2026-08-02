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

/** The engine's numeric confidence (0–1) → a marketer label. Null-safe. */
export function confidenceLabel(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Medium';
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
const EVIDENCE_UNITS = {
  CTR:      { kind: 'percent', label: 'CTR' },
  LPV_RATE: { kind: 'ratio',   label: 'Landing page views / clicks' },
  ATC_RATE: { kind: 'ratio',   label: 'Add to cart / page views' },
  CO_RATE:  { kind: 'ratio',   label: 'Checkouts / add to cart' },
};

/** PURE: an evidence number → display string, using the metric's known unit. */
export function formatEvidenceValue(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const unit = EVIDENCE_UNITS[metric];
  if (!unit) return String(value); // unknown metric: show the raw number, never a guessed unit
  return unit.kind === 'percent' ? `${value.toFixed(2)}%` : `${(value * 100).toFixed(1)}%`;
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
 * @returns {{ show: boolean, heading: string|null }}
 */
export function whyBlock({ verdict, funnel = null, rootCause = null } = {}) {
  if (verdict === 'KILL' || verdict === 'SCALE') return { show: true, heading: `Why ${verdict.toLowerCase()}?` };
  if (funnel) return { show: true, heading: 'Where the money is going' };
  if (isDataQualityCause(rootCause)) return { show: true, heading: 'Not judged yet' };
  return { show: false, heading: null };
}

/**
 * PURE: the engine's two confidence halves → a label plus the reason it is not
 * higher. `dataConfidence` is the input-quality score; when it is what is
 * holding the number down, saying so is more useful than a bare "Low".
 */
export function confidenceDetail({ confidence = null, dataConfidence = null } = {}) {
  const label = confidenceLabel(confidence);
  if (!label) return null;
  const thin = typeof dataConfidence === 'number' && Number.isFinite(dataConfidence) && dataConfidence < 0.6;
  return { label, limitedByData: thin };
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

/** The next step a KILL/SCALE asks for. Null for every other verdict. */
export function nextActionFor(verdict) {
  if (verdict === 'KILL') return 'Pause and reallocate budget';
  if (verdict === 'SCALE') return 'Increase budget or expand audience';
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
