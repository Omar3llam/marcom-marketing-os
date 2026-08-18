// ============================================================
// PatternEngine — per-account learning (truth-weighted)
// ============================================================
// Public API:
//   extractPatterns({ decisions, outcomes, memory, snapshots, tests, now, config })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB. `now` is
//   injected so recency is reproducible.
//
// Honesty is structural, per review:
//   • ACCURACY — every occurrence is an observation (predicted vs the
//     decision's realized outcome). A pattern reports "right X%", not
//     just "seen N times". support ≠ truth.
//   • RECENCY DECAY — each observation is weighted by age, so a stale
//     2023 pattern decays toward EMERGING instead of counting equal to
//     last week's evidence.
//   • CONFLICT RESOLUTION — patterns prescribing opposite actions on the
//     same (metric, scope, audience) are reconciled: higher recency-
//     weighted accuracy wins (loser SUPERSEDED); a genuine tie is
//     CONFLICTED and surfaced — never silently picked, never promoted.
// ============================================================
import { PATTERN_KIND, PATTERN_STATUS } from './patternTypes.js';
import { successToCorrect }             from '../decision-accuracy/decisionSuccess.js';
import { logger }                       from '../../utils/logger.js';

const DAY_MS = 86_400_000;

/**
 * What the audit trail records as the OBSERVED result, beside what was
 * predicted. Derived from the canonical evaluation, never from a raw column.
 *
 * `null` when the call has no established result: PatternObservation.actual is a
 * statement about what happened, and "we have not measured it" is not a value it
 * may carry. Writing 'regressed' there would be a fabricated observation.
 */
const describeOutcome = (correct) => (correct == null ? null : (correct ? 'held' : 'did not hold'));

// ── R10 (F10) — the audience dimension has no canonical source ──────────────
// These two lines used to read `d.audienceTag ?? null` off a Decision. `Decision`
// has no such column and never has, so the expression was always `null` and the
// dimension it appears to segment by does not exist. The same hole runs through
// the whole system: GuardrailSweepService hard-codes `audienceTag: null` on
// every entity it builds, so guardrailEngine's audience filter never narrows
// anything either. Nothing anywhere derives an audience tag from a campaign.
//
// So it is obsolete logic, not an unimplemented feature, and R10 does not add a
// column for it: a column with no populator would move the fiction one layer
// down. The dead read is gone and the value is stated for what it is.
//
// The KEY SHAPE is deliberately unchanged — `FATIGUE|ADSET|null|KILL`, exactly
// as before. patternKey is the durable identity of an AccountPattern row
// (@@unique([workspaceId, patternKey]), and promotedRuleId hangs off it), so
// re-spelling the key would orphan every pattern this workspace has learned and
// silently re-mint them as new, unpromoted rows.
//
// The day a real audience tag exists, it lands on Decision, flows in here, and
// the key gains a value where `null` sits today — with a deliberate migration
// for the re-keying, not as a side effect.
const UNPOPULATED_AUDIENCE = null;

// Frozen, env-overridable thresholds.
const DEFAULTS = Object.freeze({
  minSupport:     2,    // min recency-weighted support to surface a pattern at all
  minEstablished: 3,    // recency-weighted support to reach ESTABLISHED
  minAccuracy:    0.6,  // accuracy to reach ESTABLISHED / be promotable
  conflictEps:    0.1,  // accuracy gap below which opposite verdicts are a CONFLICT (vs supersede)
  seasonalDeltaPct: 0.2,// |period vs baseline| to flag a seasonal effect
});

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Recency weight: ≤90d→1.0, ≤180d→0.5, ≤365d→0.25, else 0.1. */
export function recencyWeight(now, at) {
  const days = (now.getTime() - new Date(at).getTime()) / DAY_MS;
  if (days <= 90)  return 1.0;
  if (days <= 180) return 0.5;
  if (days <= 365) return 0.25;
  return 0.1;
}

/** Weight-weighted median of {value, weight} pairs. */
function weightedMedian(pairs) {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return sorted.length ? sorted[Math.floor(sorted.length / 2)].value : 0;
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

/** Index snapshots by entity, ascending by date, for nearest-date lookup. */
function indexSnapshots(snapshots) {
  const byEntity = new Map();
  for (const s of snapshots) {
    if (!byEntity.has(s.entityId)) byEntity.set(s.entityId, []);
    byEntity.get(s.entityId).push(s);
  }
  for (const arr of byEntity.values()) arr.sort((a, b) => new Date(a.date) - new Date(b.date));
  return byEntity;
}

/** Snapshot for an entity nearest (and preferably at/before) a date. */
function snapshotNear(byEntity, entityId, at) {
  const arr = byEntity.get(entityId);
  if (!arr || arr.length === 0) return null;
  const t = new Date(at).getTime();
  let best = null;
  let bestGap = Infinity;
  for (const s of arr) {
    const gap = Math.abs(new Date(s.date).getTime() - t);
    if (gap < bestGap) { bestGap = gap; best = s; }
  }
  return best;
}

/** accuracy + confidence + status from an observation set. */
function score(observations, cfg) {
  const effectiveSupport = observations.reduce((s, o) => s + o.weight, 0);
  const known = observations.filter((o) => o.correct != null);
  const knownWeight = known.reduce((s, o) => s + o.weight, 0);
  const accuracy = knownWeight > 0
    ? round2(known.reduce((s, o) => s + o.weight * (o.correct ? 1 : 0), 0) / knownWeight)
    : null;

  const supportFactor = clamp01(effectiveSupport / cfg.minEstablished);

  // ── R10 (I54): no measured outcome → no number ────────────────────
  // This was `const accuracyFactor = accuracy ?? 0.5`, and the 0.5 was invented.
  // A pattern nobody had ever checked was assigned a coin-flip accuracy, that
  // fabricated prior was multiplied by a support factor, and the product was
  // rendered as a confidence percentage on the briefing surface — a number
  // presented as measurement that no row in the database supported.
  //
  // null, not 0. Zero is a measurement meaning "never right"; this is "not
  // established", and the two must not render the same. Every consumer already
  // handles a null accuracy (pct() prints "—", promotion and scenario and
  // network all gate on `accuracy != null`), so null travels safely — a
  // fabricated 0 would not.
  const confidence = accuracy == null ? null : round2(accuracy * (0.5 + 0.5 * supportFactor));

  // ── R10 (I48/I54): support alone cannot establish a pattern ───────
  // The old condition read `(accuracy == null || accuracy >= cfg.minAccuracy)`,
  // so three executed decisions with no recorded outcome produced an ESTABLISHED
  // pattern — a claim of proven institutional knowledge derived from zero
  // measurements. Volume is not truth; that is the premise the whole engine was
  // built on, and this line contradicted it.
  //
  // EMERGING is the honest state for a pattern seen often and never checked, and
  // it already exists — no new status was invented for this.
  const status = (effectiveSupport >= cfg.minEstablished && accuracy != null && accuracy >= cfg.minAccuracy)
    ? PATTERN_STATUS.ESTABLISHED
    : PATTERN_STATUS.EMERGING;

  return { effectiveSupport: round2(effectiveSupport), accuracy, confidence, status };
}

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

// Map an internal observation to the persistable audit-trail shape.
function toObservation(o) {
  return {
    occurrenceKey: o.occurrenceKey,
    decisionId:    o.decisionId ?? null,
    entityId:      o.entityId ?? null,
    predicted:     o.predicted,
    actual:        o.actual ?? null,
    correct:       o.correct,
    observedAt:    o.at,
  };
}

// ── FATIGUE_CEILING — freq ≥ ceiling → KILL/REFRESH ──────────────
function fatiguePatterns(decisions, outcomeById, snapsByEntity, now, cfg) {
  const groups = new Map(); // key → observations
  for (const d of decisions) {
    if (d.verdict !== 'KILL' && d.verdict !== 'REFRESH') continue;
    const snap = snapshotNear(snapsByEntity, d.entityId, d.createdAt);
    const freq = snap?.frequency;
    if (freq == null || freq <= 0) continue;
    const audienceTag = UNPOPULATED_AUDIENCE;
    const scopeLevel  = d.entityLevel ?? 'ADSET';
    const key = `FATIGUE|${scopeLevel}|${audienceTag}|${d.verdict}`;
    if (!groups.has(key)) groups.set(key, { scopeLevel, audienceTag, verdict: d.verdict, obs: [] });
    // R10 (I53) — the canonical, verdict-relative answer, computed at the seam.
    const correct = successToCorrect(outcomeById.get(d.id)?.success);
    groups.get(key).obs.push({
      value:    freq,
      weight:   recencyWeight(now, d.createdAt),
      correct,
      at:       new Date(d.createdAt),
      decisionId: d.id, entityId: d.entityId, predicted: d.verdict,
      actual:   describeOutcome(correct),
      occurrenceKey: d.id,
    });
  }

  const out = [];
  for (const [key, g] of groups) {
    const s = score(g.obs, cfg);
    if (s.effectiveSupport < cfg.minSupport) continue;
    const ceiling = round1(weightedMedian(g.obs));
    const dates = g.obs.map((o) => o.at.getTime());
    const audience = g.audienceTag ? `${g.audienceTag} ` : '';
    out.push({
      key,
      kind: PATTERN_KIND.FATIGUE_CEILING,
      metric: 'frequency', scopeLevel: g.scopeLevel, audienceTag: g.audienceTag,
      statement: `On ${audience}${g.scopeLevel.toLowerCase()}s, ${g.verdict} once frequency passes ~${ceiling} ` +
                 `(${g.obs.length}× seen, right ${pct(s.accuracy)}).`,
      basis: `weighted-median frequency at ${g.verdict} across ${g.obs.length} decisions`,
      support: g.obs.length, ...s,
      comparator: 'GTE', threshold: ceiling, unit: 'RATIO', emitVerdict: g.verdict, sustainedDays: 1,
      firstObservedAt: new Date(Math.min(...dates)), lastObservedAt: new Date(Math.max(...dates)),
      supersededByKey: null,
      observations: g.obs.map(toObservation),
    });
  }
  return out;
}

// ── SCALING_WINDOW — ROAS ≥ X → SCALE held ───────────────────────
function scalingPatterns(decisions, outcomeById, snapsByEntity, now, cfg) {
  const groups = new Map();
  for (const d of decisions) {
    if (d.verdict !== 'SCALE') continue;
    const snap = snapshotNear(snapsByEntity, d.entityId, d.createdAt);
    const roas = snap?.roas;
    if (roas == null || roas <= 0) continue;
    const audienceTag = UNPOPULATED_AUDIENCE;
    const scopeLevel  = d.entityLevel ?? 'CAMPAIGN';
    const key = `SCALING|${scopeLevel}|${audienceTag}`;
    if (!groups.has(key)) groups.set(key, { scopeLevel, audienceTag, obs: [] });
    // R10 (I53) — same canonical evaluation as every other pattern kind.
    const correct = successToCorrect(outcomeById.get(d.id)?.success);
    groups.get(key).obs.push({
      value:   roas,
      weight:  recencyWeight(now, d.createdAt),
      correct,
      at:      new Date(d.createdAt),
      decisionId: d.id, entityId: d.entityId, predicted: 'SCALE',
      actual:  describeOutcome(correct),
      occurrenceKey: d.id,
    });
  }

  const out = [];
  for (const [key, g] of groups) {
    const s = score(g.obs, cfg);
    if (s.effectiveSupport < cfg.minSupport) continue;
    // Threshold = the ROAS floor at which scaling tended to hold (median of sustained scales,
    // else median of all).
    const held = g.obs.filter((o) => o.correct === true);
    const floor = round1(weightedMedian(held.length ? held : g.obs));
    const dates = g.obs.map((o) => o.at.getTime());
    const audience = g.audienceTag ? `${g.audienceTag} ` : '';
    out.push({
      key,
      kind: PATTERN_KIND.SCALING_WINDOW,
      metric: 'roas', scopeLevel: g.scopeLevel, audienceTag: g.audienceTag,
      statement: `Scaling ${audience}${g.scopeLevel.toLowerCase()}s held when ROAS was ≥ ${floor} ` +
                 `(${g.obs.length}× seen, held ${pct(s.accuracy)}).`,
      basis: `ROAS floor where SCALE decisions sustained across ${g.obs.length} decisions`,
      support: g.obs.length, ...s,
      comparator: 'GTE', threshold: floor, unit: 'RATIO', emitVerdict: 'SCALE', sustainedDays: 1,
      firstObservedAt: new Date(Math.min(...dates)), lastObservedAt: new Date(Math.max(...dates)),
      supersededByKey: null,
      observations: g.obs.map(toObservation),
    });
  }
  return out;
}

// ── CREATIVE_ANGLE_LONGEVITY — informational, from Phase-4 tests ─
function anglePatterns(tests, now, cfg) {
  const relevant = tests.filter((t) =>
    (t.dimension === 'HOOK' || t.dimension === 'CREATIVE_ANGLE') &&
    t.status === 'CONCLUDED' && t.winnerLabel);
  if (relevant.length === 0) return [];
  const obs = relevant.map((t) => {
    const at = new Date(t.concludedAt ?? t.createdAt ?? now);
    const correct = t.confidenceLabel === 'HIGH' || t.confidenceLabel === 'MODERATE';
    return {
      weight: recencyWeight(now, at), correct, at,
      decisionId: null, entityId: t.entityId ?? null, predicted: `winner:${t.winnerLabel}`,
      actual: t.confidenceLabel ?? null, occurrenceKey: t.id ?? `${t.dimension}:${at.getTime()}`,
    };
  });
  const s = score(obs, cfg);
  if (s.effectiveSupport < cfg.minSupport) return [];
  const dates = obs.map((o) => o.at.getTime());
  return [{
    key: 'ANGLE|account',
    kind: PATTERN_KIND.CREATIVE_ANGLE_LONGEVITY,
    metric: null, scopeLevel: null, audienceTag: null,
    statement: `Hook / creative-angle tests produced a confident winner in ${obs.filter((o) => o.correct).length} ` +
               `of ${obs.length} runs — keep refreshing the angle.`,
    basis: `concluded HOOK/CREATIVE_ANGLE tests with a called winner`,
    support: obs.length, ...s,
    comparator: null, threshold: null, unit: null, emitVerdict: null, sustainedDays: null,
    firstObservedAt: new Date(Math.min(...dates)), lastObservedAt: new Date(Math.max(...dates)),
    supersededByKey: null,
    observations: obs.map(toObservation),
  }];
}

// ── SEASONAL_EFFECT — informational, period vs baseline ─────────
function seasonalPatterns(snapshots, now, cfg) {
  const withRoas = snapshots.filter((s) => s.roas != null && s.spendMinor > 0);
  if (withRoas.length < 4) return [];
  const baseline = withRoas.reduce((s, r) => s + r.roas, 0) / withRoas.length;
  if (baseline <= 0) return [];

  const byMonth = new Map(); // 0-11 → {sum, n, lastAt, firstAt}
  for (const s of withRoas) {
    const m = new Date(s.date).getUTCMonth();
    if (!byMonth.has(m)) byMonth.set(m, { sum: 0, n: 0, last: 0, first: Infinity });
    const b = byMonth.get(m);
    b.sum += s.roas; b.n += 1;
    const t = new Date(s.date).getTime();
    b.last = Math.max(b.last, t); b.first = Math.min(b.first, t);
  }
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const out = [];
  for (const [m, b] of [...byMonth.entries()].sort((a, c) => a[0] - c[0])) {
    if (b.n < 2) continue;
    const avg = b.sum / b.n;
    const delta = (avg - baseline) / baseline;
    if (Math.abs(delta) < cfg.seasonalDeltaPct) continue;
    const obs = Array.from({ length: b.n }, () => ({ weight: recencyWeight(now, b.last), correct: null }));
    const s = score(obs, cfg);
    out.push({
      key: `SEASONAL|${m}`,
      kind: PATTERN_KIND.SEASONAL_EFFECT,
      metric: 'roas', scopeLevel: null, audienceTag: null,
      statement: `In ${MONTHS[m]}, ROAS ran ~${Math.round(Math.abs(delta) * 100)}% ${delta >= 0 ? 'above' : 'below'} the account baseline.`,
      basis: `${b.n} snapshots in month ${m + 1} vs baseline ROAS ${round2(baseline)}`,
      support: b.n, ...s,
      comparator: null, threshold: null, unit: null, emitVerdict: null, sustainedDays: null,
      firstObservedAt: new Date(b.first), lastObservedAt: new Date(b.last),
      supersededByKey: null,
      observations: [], // seasonal is an aggregate signal, not per-decision
    });
  }
  return out;
}

// ── Conflict resolution ──────────────────────────────────────────
// Patterns with an executable spec on the SAME (metric, scope, audience)
// but opposite verdicts are reconciled. Higher recency-weighted accuracy
// wins; a genuine tie is CONFLICTED. Never both shipped.
function resolveConflicts(patterns, cfg) {
  const groups = new Map();
  for (const p of patterns) {
    if (!p.emitVerdict) continue; // informational kinds never conflict
    const k = `${p.metric}|${p.scopeLevel}|${p.audienceTag}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    // Best first: accuracy desc (null last), then recency, then support.
    grp.sort((a, b) =>
      (b.accuracy ?? -1) - (a.accuracy ?? -1) ||
      b.lastObservedAt - a.lastObservedAt ||
      b.effectiveSupport - a.effectiveSupport ||
      a.key.localeCompare(b.key));
    const canonical = grp[0];
    for (let i = 1; i < grp.length; i++) {
      const other = grp[i];
      const oppositeVerdict = other.emitVerdict !== canonical.emitVerdict;
      // R10 (I54) — the last invented 0.5 in this file. It used to substitute a
      // coin flip for each missing accuracy and then compare the two, which
      // happened to land on CONFLICTED (the safe outcome) only because two
      // invented halves cancel. That was luck, not reasoning.
      //
      // Stated properly: when either side is unmeasured, the gap between them is
      // NOT ESTABLISHED, so neither can be declared the winner and both are
      // flagged. Same safe result, reached by an argument that holds.
      const gapEstablished = canonical.accuracy != null && other.accuracy != null;
      const tooCloseToCall = !gapEstablished
        || Math.abs(canonical.accuracy - other.accuracy) <= cfg.conflictEps;
      if (oppositeVerdict && tooCloseToCall) {
        // Genuine tie on opposite actions → both flagged, neither acts.
        canonical.status = PATTERN_STATUS.CONFLICTED;
        other.status = PATTERN_STATUS.CONFLICTED;
      } else {
        other.status = PATTERN_STATUS.SUPERSEDED;
        other.supersededByKey = canonical.key;
      }
    }
  }
}

const STATUS_RANK = { ESTABLISHED: 0, EMERGING: 1, CONFLICTED: 2, SUPERSEDED: 3 };

/** Sort key only — never displayed. An unmeasured pattern ranks below every
 *  measured one instead of comparing as NaN. */
const sortableConfidence = (p) => (p.confidence == null ? -1 : p.confidence);

/**
 * Extract per-account patterns from a workspace's own history.
 *
 * @param {object} args
 * @param {Array}  args.decisions — [{ id, entityId, entityLevel, verdict, createdAt }]
 *   R10 (I52): EXECUTED decisions only. The caller owns that filter — see
 *   PatternService — because "executed" is a DB predicate, not an engine one.
 * @param {Array}  args.outcomes  — [{ decisionId, success }] where `success` is
 *   a DECISION_SUCCESS state produced by evaluateDecisionSuccess.
 *
 *   R10 (I53): this used to be `{ decisionId, sustained }` and the engine
 *   decided for itself that `sustained === true` meant the call was right. It no
 *   longer decides: the canonical, verdict-relative predicates own that, and the
 *   engine receives their verdict. A KILL that correctly cut a losing campaign's
 *   spend is now counted right even though revenue fell with it — which
 *   `sustained` alone marked wrong, systematically, on the verdict Lumi is most
 *   decisive about.
 * @param {Array}  args.snapshots — [{ entityId, date, frequency, roas, ctr, spendMinor }]
 * @param {Array}  args.tests     — TestExperiment rows
 * @param {Date}   [args.now]
 * @param {object} [args.config]
 * @returns {Array} patterns (each with accuracy, status, promotable, supersededByKey)
 */
export function extractPatterns({ decisions = [], outcomes = [], snapshots = [], tests = [], now = new Date(), config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const outcomeById = new Map(outcomes.map((o) => [o.decisionId, o]));
  const snapsByEntity = indexSnapshots(snapshots);

  const patterns = [
    ...fatiguePatterns(decisions, outcomeById, snapsByEntity, now, cfg),
    ...scalingPatterns(decisions, outcomeById, snapsByEntity, now, cfg),
    ...anglePatterns(tests, now, cfg),
    ...seasonalPatterns(snapshots, now, cfg),
  ];

  resolveConflicts(patterns, cfg);

  // promotable: ESTABLISHED, has a spec, proven accuracy, not reconciled-away.
  for (const p of patterns) {
    p.promotable = p.status === PATTERN_STATUS.ESTABLISHED &&
                   !!p.emitVerdict && p.threshold != null &&
                   p.accuracy != null && p.accuracy >= cfg.minAccuracy;
  }

  patterns.sort((a, b) =>
    (STATUS_RANK[a.status] - STATUS_RANK[b.status]) ||
    // Null confidence sorts LAST within a status band rather than poisoning the
    // comparator: `b.confidence - a.confidence` yields NaN against a null, and a
    // NaN comparator silently leaves the array in input order — which would make
    // this "deterministic" sort depend on DB row order.
    (sortableConfidence(b) - sortableConfidence(a)) ||
    a.key.localeCompare(b.key));

  logger.debug({ count: patterns.length }, '[PatternEngine] extracted');
  return patterns;
}
