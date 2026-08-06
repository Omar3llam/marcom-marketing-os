// ============================================================
// evidenceProvider — ranking, severity grading, and the unit trap
// ------------------------------------------------------------
// Three classes of failure are pinned here because each one produces a
// confidently WRONG statement rather than an absent one:
//   1. the ratio/percent boundary (understates every CTR by 100×)
//   2. direction-blind severity (grades the most exhausted ad "healthy")
//   3. a CONTEXT figure defaulting to 'weak' (accuses a row of failing a bar
//      that was never set)
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  analyzeEvidence, evidenceItem, computeSeverity, toPct,
  SEVERITY, EVIDENCE_KIND, EVIDENCE_METRIC, METRIC_DIRECTION,
  METRIC_THRESHOLDS, DEFAULT_THRESHOLD, MIN_IMPRESSIONS_FOR_RANKING, isRankable,
} from './evidenceProvider.js';
// From benchmarkProvider — the CANONICAL source. verdictEngine re-exports the
// same value, but asserting against the re-export tested the copy rather than
// the original, and would have gone on passing if the two ever drifted.
import { FATIGUE_FREQ } from './benchmarkProvider.js';

const NOW = Date.parse('2026-08-01T00:00:00.000Z');

// ctr arrives as a RATIO from the snapshot, exactly as toAdRow emits it.
const ad = (id, over = {}) => ({
  entityId: id, name: `Ad ${id}`, channel: 'META', status: 'ACTIVE',
  ctr: 0.02, roas: 2.0, frequency: 1.5, impressions: 10_000, clicks: 200,
  spendMinor: 10_000, actionMetrics: null, platformCreatedTime: null, ...over,
});
const baseline = { ctr: 0.02, roas: 2.0, frequency: 1.5, spendMinor: 100_000 };

// ── The trap ────────────────────────────────────────────────────────────────
describe('toPct — CTR 1.64% is stored as 0.0164 and must be multiplied, not divided', () => {
  it('toPct(0.0164) === 1.64, not 0.000164', () => {
    expect(toPct(0.0164)).toBeCloseTo(1.64, 10);
    expect(toPct(0.0164)).not.toBeCloseTo(0.000164, 10);
  });

  it('null/undefined become 0, never NaN', () => {
    expect(toPct(null)).toBe(0);
    expect(toPct(undefined)).toBe(0);
  });

  // The whole reason the conversion exists: an un-converted 0.008 would sit
  // below every objective's weak bar, so EVERY ad on EVERY account would grade
  // CRITICAL and the ranking would be pure noise wearing a severity label.
  it('a healthy 2% CTR grades HEALTHY once converted, and CRITICAL if not', () => {
    const converted = evidenceItem(EVIDENCE_METRIC.CTR, toPct(0.02), { benchmarkValue: 0.8 });
    expect(converted.severity).toBe(SEVERITY.HEALTHY);

    const raw = evidenceItem(EVIDENCE_METRIC.CTR, 0.02, { benchmarkValue: 0.8 });
    expect(raw.severity).toBe(SEVERITY.CRITICAL); // what the bug looks like
  });
});

// ── Severity ────────────────────────────────────────────────────────────────
describe('computeSeverity', () => {
  it('grades the ladder for a metric where higher is better', () => {
    expect(computeSeverity(1.0, 1.0)).toBe(SEVERITY.HEALTHY);
    expect(computeSeverity(1.2, 1.0)).toBe(SEVERITY.HEALTHY);
    expect(computeSeverity(0.97, 1.0)).toBe(SEVERITY.LOW);      // -3%
    expect(computeSeverity(0.90, 1.0)).toBe(SEVERITY.MEDIUM);   // -10%
    expect(computeSeverity(0.70, 1.0)).toBe(SEVERITY.HIGH);     // -30%
    expect(computeSeverity(0.50, 1.0)).toBe(SEVERITY.CRITICAL); // -50%
  });

  it('boundaries land on the gentler grade', () => {
    expect(computeSeverity(0.95, 1.0)).toBe(SEVERITY.LOW);    // exactly -5%
    expect(computeSeverity(0.80, 1.0)).toBe(SEVERITY.MEDIUM); // exactly -20%
    expect(computeSeverity(0.60, 1.0)).toBe(SEVERITY.HIGH);   // exactly -40%
  });

  // The bug a direction-blind ladder produces: frequency 7.0 against a 3.5
  // ceiling is +100%, which reads as HEALTHY — on the single most exhausted ad.
  it('flips for a ceiling metric: 7.0 against a 3.5 ceiling is CRITICAL, not HEALTHY', () => {
    expect(computeSeverity(7.0, 3.5, METRIC_DIRECTION.LOWER_IS_BETTER)).toBe(SEVERITY.CRITICAL);
    expect(computeSeverity(7.0, 3.5, METRIC_DIRECTION.HIGHER_IS_BETTER)).toBe(SEVERITY.HEALTHY);
  });

  it('a frequency comfortably under the ceiling is HEALTHY', () => {
    expect(computeSeverity(1.8, 3.5, METRIC_DIRECTION.LOWER_IS_BETTER)).toBe(SEVERITY.HEALTHY);
  });

  it('returns null with no bar to grade against — ungraded, never passing', () => {
    expect(computeSeverity(1.0, null)).toBeNull();
    expect(computeSeverity(1.0, 0)).toBeNull();
    expect(computeSeverity(NaN, 1.0)).toBeNull();
  });
});

// ── evidenceItem ────────────────────────────────────────────────────────────
describe('evidenceItem', () => {
  it('a BENCHMARK item carries benchmark, status, severity and deltaPercent', () => {
    expect(evidenceItem(EVIDENCE_METRIC.CTR, 0.5, { benchmarkValue: 1.0 })).toEqual({
      metric: 'CTR', value: 0.5, benchmark: 1.0, status: 'weak',
      deltaPercent: -50, severity: SEVERITY.CRITICAL, kind: EVIDENCE_KIND.BENCHMARK,
    });
  });

  it('status is healthy at or above the bar', () => {
    expect(evidenceItem(EVIDENCE_METRIC.CTR, 1.0, { benchmarkValue: 1.0 }).status).toBe('healthy');
    expect(evidenceItem(EVIDENCE_METRIC.CTR, 2.0, { benchmarkValue: 1.0 }).status).toBe('healthy');
  });

  // The client whitelists exactly these two and nulls anything else, so a third
  // word would be silently dropped rather than loudly rejected.
  it('status is only ever healthy, weak, or null — the live consumer whitelist', () => {
    const values = [
      evidenceItem(EVIDENCE_METRIC.CTR, 0.5, { benchmarkValue: 1.0 }).status,
      evidenceItem(EVIDENCE_METRIC.CTR, 2.0, { benchmarkValue: 1.0 }).status,
      evidenceItem(EVIDENCE_METRIC.SPEND_SHARE, 0.4, { kind: EVIDENCE_KIND.CONTEXT }).status,
    ];
    for (const v of values) expect([null, 'healthy', 'weak']).toContain(v);
  });

  // A spend share is a fact about scale. Scoring it would accuse the row of
  // failing a bar nobody set.
  it('a CONTEXT item is stated, never scored', () => {
    expect(evidenceItem(EVIDENCE_METRIC.SPEND_SHARE, 0.4, { kind: EVIDENCE_KIND.CONTEXT })).toEqual({
      metric: 'SPEND_SHARE', value: 0.4, benchmark: null, status: null,
      deltaPercent: null, severity: null, kind: EVIDENCE_KIND.CONTEXT,
    });
  });

  it('a BENCHMARK item with no benchmark degrades to ungraded, not to weak', () => {
    const it_ = evidenceItem(EVIDENCE_METRIC.CTR, 1.0, { benchmarkValue: null });
    expect(it_.status).toBeNull();
    expect(it_.severity).toBeNull();
    expect(it_.deltaPercent).toBeNull();
  });

  // Two independent comparisons could disagree; one derived from the other cannot.
  it('status can never contradict severity', () => {
    for (const [value, bench] of [[0.5, 1.0], [1.0, 1.0], [0.97, 1.0], [3.0, 1.0]]) {
      const e = evidenceItem(EVIDENCE_METRIC.CTR, value, { benchmarkValue: bench });
      expect(e.status).toBe(e.severity === SEVERITY.HEALTHY ? 'healthy' : 'weak');
    }
  });

  it('deltaPercent keeps the OBSERVED sign even for a ceiling metric', () => {
    const e = evidenceItem(EVIDENCE_METRIC.FREQUENCY, 7.0, {
      benchmarkValue: 3.5, direction: METRIC_DIRECTION.LOWER_IS_BETTER,
    });
    expect(e.deltaPercent).toBe(100);        // what the number actually did
    expect(e.severity).toBe(SEVERITY.CRITICAL); // direction lives here instead
  });
});

// ── Thresholds ──────────────────────────────────────────────────────────────
describe('METRIC_THRESHOLDS', () => {
  it('each metric carries its own floor and direction', () => {
    expect(METRIC_THRESHOLDS.ctr).toEqual({ minGap: -0.20, direction: 'higher' });
    expect(METRIC_THRESHOLDS.roas).toEqual({ minGap: -0.15, direction: 'higher' });
    expect(METRIC_THRESHOLDS.frequency).toEqual({ minGap: 0.30, direction: 'lower' });
  });

  it('an unknown metric falls to DEFAULT_THRESHOLD rather than throwing', () => {
    expect(DEFAULT_THRESHOLD).toEqual({ minGap: -0.20, direction: 'higher' });
    const out = analyzeEvidence({
      dimension: 'AD', metric: 'someFutureMetric', objective: 'OUTCOME_SALES', now: NOW,
      baseline: { ...baseline, someFutureMetric: 1.0 },
      entities: [ad('a', { someFutureMetric: 0.5 }), ad('b', { someFutureMetric: 1.0 })],
    });
    expect(out).not.toBeNull();          // DEFAULT's -0.20 catches the -50% row
    expect(out.summary.bottom.entityId).toBe('a');
  });

  it('the ranking floor is its own constant, well below the verdict gate of 1000', () => {
    expect(MIN_IMPRESSIONS_FOR_RANKING).toBe(100);
  });
});

// ── isRankable: the eligibility test, shared with whoever explains the null ──
describe('isRankable', () => {
  it('admits a row that reported the metric and delivered enough to compare', () => {
    expect(isRankable(ad('a'), 'ctr')).toBe(true);
  });

  it('excludes an unreported figure — null is not a zero, and ranking it would invent one', () => {
    expect(isRankable(ad('a', { ctr: null }), 'ctr')).toBe(false);
    // A measured 0 IS a finding and stays in.
    expect(isRankable(ad('a', { ctr: 0 }), 'ctr')).toBe(true);
  });

  it('excludes a row below the delivery floor, and admits one exactly on it', () => {
    expect(isRankable(ad('a', { impressions: MIN_IMPRESSIONS_FOR_RANKING - 1 }), 'ctr')).toBe(false);
    expect(isRankable(ad('a', { impressions: MIN_IMPRESSIONS_FOR_RANKING }), 'ctr')).toBe(true);
  });

  it('treats missing impressions as no delivery rather than assuming enough', () => {
    expect(isRankable(ad('a', { impressions: null }), 'ctr')).toBe(false);
  });

  it('reads the metric it is asked about, not always ctr', () => {
    const row = ad('a', { ctr: 0.02, roas: null });
    expect(isRankable(row, 'ctr')).toBe(true);
    expect(isRankable(row, 'roas')).toBe(false);
  });

  it('survives a null row — a caller filtering a sparse list must not have to pre-check', () => {
    expect(isRankable(null, 'ctr')).toBe(false);
    expect(isRankable(undefined, 'ctr')).toBe(false);
  });

  // The whole reason it is exported: analyzeEvidence answers "can I rank this?"
  // with a bare null, so a caller that must EXPLAIN the null has to apply the
  // identical test. If these two ever disagree, a surface will blame the parent
  // baseline for what was really a thin set of children.
  it('agrees with the filter analyzeEvidence actually applies', () => {
    const entities = [
      ad('ok1'),
      ad('ok2'),
      ad('thin',       { impressions: 10 }),
      ad('unreported', { ctr: null }),
    ];
    const out = analyzeEvidence({
      dimension: 'AD', objective: 'OUTCOME_SALES', now: NOW, metric: 'ctr',
      baseline: { ...baseline, ctr: 0.05 }, entities,
    });
    expect(out.ranked.map((r) => r.entityId).sort())
      .toEqual(entities.filter((e) => isRankable(e, 'ctr')).map((e) => e.entityId).sort());
  });
});

// ── analyzeEvidence: null contract ──────────────────────────────────────────
describe('analyzeEvidence — when it declines to answer', () => {
  const call = (over) => analyzeEvidence({ dimension: 'AD', objective: 'OUTCOME_SALES', now: NOW, baseline, entities: [], ...over });

  it('no entities → null', () => {
    expect(call({ entities: [] })).toBeNull();
    expect(call({ entities: null })).toBeNull();
  });

  it('no baseline → null', () => {
    expect(call({ entities: [ad('a'), ad('b')], baseline: null })).toBeNull();
  });

  it('a baseline of 0 or null on the ranked metric → null, never a divide-by-zero gap', () => {
    expect(call({ entities: [ad('a'), ad('b')], baseline: { ...baseline, ctr: 0 } })).toBeNull();
    expect(call({ entities: [ad('a'), ad('b')], baseline: { ...baseline, ctr: null } })).toBeNull();
  });

  it('one comparable entity → null (it is trivially both best and worst)', () => {
    expect(call({ entities: [ad('a', { ctr: 0.001 })] })).toBeNull();
    expect(call({ entities: [ad('a', { ctr: 0.001 }), ad('b', { ctr: null })] })).toBeNull();
  });

  it('rows under the ranking floor are excluded from the comparison', () => {
    expect(call({ entities: [ad('a', { ctr: 0.001, impressions: 50 }), ad('b')] })).toBeNull();
  });

  it('every entity within its floor → null, never a spurious finding', () => {
    // -10% spread on ctr, whose floor is -20%: ordinary variance.
    expect(call({ entities: [ad('a', { ctr: 0.018 }), ad('b', { ctr: 0.02 })] })).toBeNull();
  });
});

// ── analyzeEvidence: shape and ranking ──────────────────────────────────────
describe('analyzeEvidence — ranking', () => {
  const entities = [
    ad('good', { ctr: 0.03 }),
    ad('mid',  { ctr: 0.02 }),
    ad('bad',  { ctr: 0.005, spendMinor: 40_000 }), // -75%
  ];
  const run = (over = {}) => analyzeEvidence({
    dimension: 'AD', entities, baseline, objective: 'OUTCOME_SALES', metric: 'ctr', now: NOW, ...over,
  });

  it('returns the full documented shape', () => {
    expect(Object.keys(run()).sort())
      .toEqual(['dataConfidence', 'dimension', 'evidence', 'metric', 'ranked', 'summary']);
  });

  it('ranks worst-first and names top and bottom', () => {
    const out = run();
    expect(out.ranked.map((r) => r.entityId)).toEqual(['bad', 'mid', 'good']);
    expect(out.summary.bottom.entityId).toBe('bad');
    expect(out.summary.top.entityId).toBe('good');
  });

  it('outliers are only the rows past the floor, not the whole list', () => {
    const out = run();
    expect(out.summary.outliers.map((o) => o.entityId)).toEqual(['bad']);
  });

  it('a ceiling metric sorts the HIGHEST value worst', () => {
    const out = analyzeEvidence({
      dimension: 'AD', metric: 'frequency', objective: 'OUTCOME_SALES', now: NOW,
      baseline: { ...baseline, frequency: 2.0 },
      entities: [ad('calm', { frequency: 1.5 }), ad('hot', { frequency: 5.0 })],
    });
    expect(out.summary.bottom.entityId).toBe('hot');  // +150% over baseline
    expect(out.summary.top.entityId).toBe('calm');
    expect(out.summary.outliers.map((o) => o.entityId)).toEqual(['hot']);
  });

  it('does not mutate the caller\'s array or rows', () => {
    const input = [ad('a', { ctr: 0.005 }), ad('b')];
    const snapshot = JSON.parse(JSON.stringify(input));
    analyzeEvidence({ dimension: 'AD', entities: input, baseline, objective: 'OUTCOME_SALES', now: NOW });
    expect(input).toEqual(snapshot);
  });
});

// ── analyzeEvidence: evidence payload ───────────────────────────────────────
describe('analyzeEvidence — evidence for the bottom row', () => {
  const run = () => analyzeEvidence({
    dimension: 'AD', metric: 'ctr', objective: 'OUTCOME_SALES', now: NOW, baseline,
    entities: [ad('good', { ctr: 0.03 }), ad('bad', { ctr: 0.005, spendMinor: 40_000, frequency: 6.0 })],
  });

  it('every item carries a kind', () => {
    for (const e of run().evidence) {
      expect([EVIDENCE_KIND.BENCHMARK, EVIDENCE_KIND.CONTEXT]).toContain(e.kind);
    }
  });

  it('CTR is normative and arrives in PERCENT, matching the client unit contract', () => {
    const ctr = run().evidence.find((e) => e.metric === 'CTR');
    expect(ctr.kind).toBe(EVIDENCE_KIND.BENCHMARK);
    expect(ctr.value).toBeCloseTo(0.5, 10);   // 0.005 ratio → 0.5 percent
    expect(ctr.benchmark).toBe(0.8);          // OUTCOME_SALES weak bar
    expect(ctr.severity).toBe(SEVERITY.HIGH); // -37.5%
  });

  it('SPEND_SHARE is context: a real fraction of the parent, with no verdict on it', () => {
    const share = run().evidence.find((e) => e.metric === 'SPEND_SHARE');
    expect(share.kind).toBe(EVIDENCE_KIND.CONTEXT);
    expect(share.value).toBeCloseTo(0.4, 10); // 40000 / 100000
    expect(share.benchmark).toBeNull();
    expect(share.status).toBeNull();
  });

  it('FREQUENCY is graded against the verdict engine\'s own ceiling', () => {
    const freq = run().evidence.find((e) => e.metric === 'FREQUENCY');
    expect(freq.benchmark).toBe(FATIGUE_FREQ);
    expect(freq.severity).toBe(SEVERITY.CRITICAL); // 6.0 over a 3.5 ceiling
  });

  it('drops the items whose inputs are absent rather than reporting a 0', () => {
    const out = analyzeEvidence({
      dimension: 'AD', metric: 'ctr', objective: 'OUTCOME_SALES', now: NOW,
      baseline: { ...baseline, spendMinor: 0 },
      entities: [ad('good', { ctr: 0.03 }), ad('bad', { ctr: 0.005, frequency: null })],
    });
    expect(out.evidence.map((e) => e.metric)).toEqual(['CTR']);
  });
});

// ── Confidence ──────────────────────────────────────────────────────────────
describe('analyzeEvidence — dataConfidence', () => {
  const run = (over = {}) => analyzeEvidence({
    dimension: 'AD', metric: 'ctr', objective: 'OUTCOME_SALES', now: NOW, baseline,
    entities: [ad('good', { ctr: 0.03 }), ad('bad', { ctr: 0.005, ...over })],
  });

  it('is named dataConfidence — input quality, not belief in a conclusion', () => {
    const out = run();
    expect(out.dataConfidence).toBeGreaterThan(0);
    expect(out).not.toHaveProperty('confidence');
    expect(out).not.toHaveProperty('reasoningConfidence');
  });

  it('rises with the bottom row\'s sample', () => {
    expect(run({ impressions: 20_000 }).dataConfidence)
      .toBeGreaterThan(run({ impressions: 500 }).dataConfidence);
  });

  it('rises when the funnel bag and creative age are present', () => {
    const blind = run();
    const full  = run({ actionMetrics: { lpv: 400, atc: 20 }, platformCreatedTime: '2026-06-01T00:00:00.000Z' });
    expect(full.dataConfidence).toBeGreaterThan(blind.dataConfidence);
  });

  // The determinism contract: a stored analysis must be reproducible from its
  // own inputs forever, which a Date.now() read inside would break.
  it('reads the clock only through the injected `now`', () => {
    const early = run({ platformCreatedTime: '2026-07-30T00:00:00.000Z' }); // 2 days at NOW
    const later = analyzeEvidence({
      dimension: 'AD', metric: 'ctr', objective: 'OUTCOME_SALES', baseline,
      now: Date.parse('2026-09-01T00:00:00.000Z'),                          // 33 days
      entities: [ad('good', { ctr: 0.03 }), ad('bad', { ctr: 0.005, platformCreatedTime: '2026-07-30T00:00:00.000Z' })],
    });
    expect(later.dataConfidence).toBeGreaterThan(early.dataConfidence);
  });

  it('is identical across repeated calls with identical inputs', () => {
    expect(run().dataConfidence).toBe(run().dataConfidence);
  });
});

// ── Extensibility ───────────────────────────────────────────────────────────
describe('analyzeEvidence — dimension and metric are parameters, not branches', () => {
  it('ADSET behaves exactly as AD', () => {
    const entities = [ad('x', { ctr: 0.03 }), ad('y', { ctr: 0.005 })];
    const asAd    = analyzeEvidence({ dimension: 'AD',    entities, baseline, objective: 'OUTCOME_SALES', now: NOW });
    const asAdSet = analyzeEvidence({ dimension: 'ADSET', entities, baseline, objective: 'OUTCOME_SALES', now: NOW });
    expect(asAdSet.dimension).toBe('ADSET');
    expect(asAdSet.summary.bottom.entityId).toBe(asAd.summary.bottom.entityId);
    expect(asAdSet.ranked.map((r) => r.entityId)).toEqual(asAd.ranked.map((r) => r.entityId));
  });

  it('ranks on roas with its own tighter floor', () => {
    const out = analyzeEvidence({
      dimension: 'AD', metric: 'roas', objective: 'OUTCOME_SALES', now: NOW, baseline,
      entities: [ad('rich', { roas: 3.0 }), ad('poor', { roas: 1.6 })], // -20%
    });
    expect(out.metric).toBe('roas');
    expect(out.summary.bottom.entityId).toBe('poor');
    // -20% clears roas's -0.15 floor but would also have cleared ctr's -0.20;
    // this one proves the tighter floor is actually the one consulted.
    const nearMiss = analyzeEvidence({
      dimension: 'AD', metric: 'roas', objective: 'OUTCOME_SALES', now: NOW, baseline,
      entities: [ad('rich', { roas: 2.0 }), ad('poor', { roas: 1.8 })], // -10%
    });
    expect(nearMiss).toBeNull();
  });

  it('objective selects the CTR bar — the same ad is graded differently', () => {
    const entities = [ad('good', { ctr: 0.03 }), ad('bad', { ctr: 0.006 })]; // 0.6%
    const sales     = analyzeEvidence({ dimension: 'AD', entities, baseline, objective: 'OUTCOME_SALES', now: NOW });
    const awareness = analyzeEvidence({ dimension: 'AD', entities, baseline, objective: 'OUTCOME_AWARENESS', now: NOW });
    expect(sales.evidence.find((e) => e.metric === 'CTR').status).toBe('weak');      // vs 0.8
    expect(awareness.evidence.find((e) => e.metric === 'CTR').status).toBe('healthy'); // vs 0.5
  });
});
