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
import { logger }                       from '../../utils/logger.js';

const DAY_MS = 86_400_000;

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

  const supportFactor  = clamp01(effectiveSupport / cfg.minEstablished);
  const accuracyFactor = accuracy ?? 0.5;
  const confidence = round2(accuracyFactor * (0.5 + 0.5 * supportFactor));

  let status;
  if (effectiveSupport >= cfg.minEstablished && (accuracy == null || accuracy >= cfg.minAccuracy)) {
    status = PATTERN_STATUS.ESTABLISHED;
  } else {
    status = PATTERN_STATUS.EMERGING;
  }
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
    const audienceTag = d.audienceTag ?? null;
    const scopeLevel  = d.entityLevel ?? 'ADSET';
    const key = `FATIGUE|${scopeLevel}|${audienceTag}|${d.verdict}`;
    if (!groups.has(key)) groups.set(key, { scopeLevel, audienceTag, verdict: d.verdict, obs: [] });
    const sustained = outcomeById.get(d.id)?.sustained;
    groups.get(key).obs.push({
      value:    freq,
      weight:   recencyWeight(now, d.createdAt),
      correct:  sustained == null ? null : sustained === true, // KILL/REFRESH "right" if the lift held
      at:       new Date(d.createdAt),
      decisionId: d.id, entityId: d.entityId, predicted: d.verdict,
      actual:   sustained == null ? null : (sustained ? 'sustained' : 'regressed'),
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
    const audienceTag = d.audienceTag ?? null;
    const scopeLevel  = d.entityLevel ?? 'CAMPAIGN';
    const key = `SCALING|${scopeLevel}|${audienceTag}`;
    if (!groups.has(key)) groups.set(key, { scopeLevel, audienceTag, obs: [] });
    const sustained = outcomeById.get(d.id)?.sustained;
    groups.get(key).obs.push({
      value:   roas,
      weight:  recencyWeight(now, d.createdAt),
      correct: sustained == null ? null : sustained === true, // scale "right" if it held
      at:      new Date(d.createdAt),
      decisionId: d.id, entityId: d.entityId, predicted: 'SCALE',
      actual:  sustained == null ? null : (sustained ? 'sustained' : 'regressed'),
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
      const accGap = Math.abs((canonical.accuracy ?? 0.5) - (other.accuracy ?? 0.5));
      if (oppositeVerdict && accGap <= cfg.conflictEps) {
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

/**
 * Extract per-account patterns from a workspace's own history.
 *
 * @param {object} args
 * @param {Array}  args.decisions — [{ id, entityId, entityLevel, verdict, audienceTag?, createdAt }]
 * @param {Array}  args.outcomes  — [{ decisionId, sustained }]
 * @param {Array}  [args.memory]  — DecisionMemoryEntry rows (reserved)
 * @param {Array}  args.snapshots — [{ entityId, date, frequency, roas, ctr, spendMinor }]
 * @param {Array}  args.tests     — TestExperiment rows
 * @param {Date}   [args.now]
 * @param {object} [args.config]
 * @returns {Array} patterns (each with accuracy, status, promotable, supersededByKey)
 */
export function extractPatterns({ decisions = [], outcomes = [], memory = [], snapshots = [], tests = [], now = new Date(), config = {} } = {}) {
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
    (b.confidence - a.confidence) ||
    a.key.localeCompare(b.key));

  logger.debug({ count: patterns.length }, '[PatternEngine] extracted');
  return patterns;
}
