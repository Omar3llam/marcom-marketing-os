// ============================================================
// creativeIntelligenceViewModel — it consumes a ranking, it never makes one
// ============================================================
// The whole risk in this file is that it starts deciding things. Ranking ads is
// analyzeEvidence's job, on the server, against benchmarks and thresholds this
// module must never learn. Almost every test below pins something the model
// does NOT do: no sorting, no picking, no ordinal, no zero-filling, and no
// upgrade of "furthest behind" into "kill this ad".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCreativeIntelligenceViewModel as buildModel } from './creativeIntelligenceViewModel.js';
const envelope = (over = {}) => ({ status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0, ...over });
const buildCreativeIntelligenceViewModel = (input) => buildModel({ comparisonEnvelope: envelope(), ...input });

/**
 * The module's CODE, with every comment stripped. The static checks below assert
 * that certain words never appear, and this file's header explains at length why
 * it holds no thresholds and computes no days-old figure — prose that would trip
 * the very greps meant to catch the behaviour returning.
 */
const codeOf = (file) => readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ad = (over = {}) => ({
  entityId: 'ad-2', name: 'Hook A · 9x16', channel: 'META', status: 'ACTIVE',
  platformCreatedTime: '2026-06-14T08:30:00.000Z',
  ctr: 0.0091, roas: 1.4, frequency: 3.9, spendMinor: 122_500, currency: 'USD',
  impressions: 42_000, clicks: 382, conversions: 6,
  actionMetrics: { videoView: 4000, video25: 1800, video50: 900, video95: 300, lpv: 200 },
  _gap: -0.34,
  ...over,
});

const payload = (over = {}) => ({
  dimension: 'AD', metric: 'ctr',
  ranked: [ad(), ad({ entityId: 'ad-1', ctr: 0.0138, _gap: 0.01 })],
  summary: { bottom: ad(), top: ad({ entityId: 'ad-1' }), outliers: [ad()] },
  dataConfidence: 0.72,
  ...over,
});

describe('P7-04B same-response comparison', () => {
  it('requires the server envelope instead of reconstructing one from the rows', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload(), comparisonEnvelope: null })).toBeNull();
  });
  it('contains no per-side comparison eligibility predicates in any reaching layer', () => {
    for (const file of ['ExecutionContext.jsx', 'creativeIntelligenceViewModel.js', 'CreativeIntelligenceBlock.jsx',
      '../../hooks/useEvidence.js', 'AdRows.jsx', 'ConnectorCampaignsPanel.jsx', '../overview/components/DecisionCard.jsx']) {
      // Null admission checks on the published envelope are schema validation,
      // not parent/child comparison predicates.
      expect(codeOf(file)).not.toMatch(/(?:windowStart|windowEnd|source|currencyProvenance)\s*===(?!\s*null\b)/);
      expect(codeOf(file)).not.toMatch(/isEntityComparisonEligible|entityComparisonPopulation|sameWindow/);
    }
  });
  it('carries the evidence parent and formats the published gap despite contradictory raw arithmetic', () => {
    const vm = buildCreativeIntelligenceViewModel({ parent: { ctr: 0.02 }, evidence: payload() });
    expect(vm.comparison).toMatchObject({ metricLabel: 'CTR', childValue: '0.91%', parentValue: '2.00%', gap: '-34%', relation: '34% below ad set' });
    expect(vm.ad.id).toBe('ad-2');
  });
  it('withholds unknown metrics instead of inventing a format', () => {
    expect(buildCreativeIntelligenceViewModel({ parent: { ctr: 0.02 }, evidence: payload({ metric: 'thumbstop' }) })).toBeNull();
  });
  it.each([['ctr', -0.34, '34% below ad set'], ['roas', -0.34, '34% below ad set'],
    ['frequency', 0.42, '42% above ad set'], ['frequency', 0, 'matches ad set']])(
    '%s preserves the server direction', (metric, gap, relation) => {
      const vm = buildCreativeIntelligenceViewModel({ parent: { ctr: 0.02, roas: 2, frequency: 2 },
        evidence: payload({ metric, summary: { bottom: ad({ _gap: gap }) } }) });
      expect(vm.comparison.relation).toBe(relation);
    });
});

describe('the ad it names is the one the server named', () => {
  it('reads summary.bottom, never a row it picked itself', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload() });
    expect(vm.ad.id).toBe('ad-2');
    expect(vm.ad.name).toBe('Hook A · 9x16');
    expect(vm.ad.status).toBe('ACTIVE');
  });

  // The list arrives sorted (index 0 = worst, by the engine's own contract). If
  // this model re-derived the pick from `ranked`, a payload whose summary and
  // list disagree would follow the list — and the surface would then name a
  // different ad than the engine scored.
  it('follows summary.bottom even when the ranked list would suggest another', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      ranked: [ad({ entityId: 'ad-9', name: 'Decoy' }), ad()],
      summary: { bottom: ad(), top: ad({ entityId: 'ad-1' }), outliers: [] },
    }) });
    expect(vm.ad.id).toBe('ad-2');
  });

  it('does no sorting, no ranking and holds no thresholds', () => {
    expect(codeOf('creativeIntelligenceViewModel.js'))
      .not.toMatch(/\.sort\(|localeCompare|minGap|threshold|benchmark/i);
  });
});

describe('the ranking is the server’s answer, not an ordinal', () => {
  it('carries the engine’s own word for the end of its list', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.rank).toBe('BOTTOM');
  });

  // "3rd of 7" is the tempting shape and the one the payload cannot support: the
  // engine publishes a sorted list and the two ends it will name, not a
  // leaderboard, and an index counted here would read as a standing it never
  // scored.
  it('manufactures no numeric position from array order', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload() });
    expect(typeof vm.ranking.rank).toBe('string');
    expect(vm.ranking).not.toHaveProperty('position');
    expect(vm.ranking).not.toHaveProperty('index');
  });

  it('uses the server comparable count even when a raw array is absent', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.comparedCount).toBe(2);
    expect(buildCreativeIntelligenceViewModel({ evidence: payload({ ranked: undefined }) }).ranking.comparedCount).toBe(2);
  });

  it('reports the metric the server ranked on', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.metric).toBe('ctr');
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.metricLabel).toBe('CTR');
    expect(buildCreativeIntelligenceViewModel({ evidence: payload({ metric: 'roas' }) }).ranking.metricLabel).toBe('ROAS');
  });

  it('withholds an unmapped ranking metric', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({ metric: 'thumbstop' }) });
    expect(vm).toBeNull();
  });

  it('rounds the server’s own gap into a percentage', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.gapPercent).toBe(-34);
  });

  it('is null, not 0, when the payload carries no gap', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ _gap: undefined }) },
    }) });
    expect(vm.ranking.gapPercent).toBeNull();
  });
});

describe('the finding, in words', () => {
  it('states what the number did and where it stood', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ranking.label)
      .toBe('CTR 34% below the ad set within 2 reporting ads with comparable evidence');
  });

  // The sign is a fact about the figure, not a judgement. A frequency over its
  // ad set reads "above" because that is what it did.
  it('reads a positive gap as above, without calling it good or bad', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      metric: 'frequency', summary: { bottom: ad({ _gap: 0.42 }) },
    }) });
    expect(vm.ranking.label).toBe('Frequency 42% above the ad set within 2 reporting ads with comparable evidence');
  });

  // `summary.bottom` is the WORST row, and for a ceiling metric the worst row is
  // the highest one — so the gapless fallback must not say "lowest".
  it('stays direction-neutral when there is no gap to state', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      metric: 'frequency', summary: { bottom: ad({ _gap: null }) },
    }) });
    expect(vm.ranking.label).toBe('Furthest behind on Frequency within 2 reporting ads with comparable evidence');
    expect(vm.ranking.label).not.toMatch(/lowest/i);
  });

  it('preserves the published cohort even when raw arrays disagree', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({ ranked: [ad()] }) });
    expect(vm.ranking.label).toBe('CTR 34% below the ad set within 2 reporting ads with comparable evidence');
  });
});

// ── The upgrade it must never make ──────────────────────────
describe('evidence is not a verdict', () => {
  it('emits no action, no recommendation and no severity', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload() });
    expect(vm).not.toHaveProperty('action');
    expect(vm).not.toHaveProperty('verdict');
    expect(vm).not.toHaveProperty('recommendation');
    expect(JSON.stringify(vm)).not.toMatch(/kill|pause|refresh|replace|rotate/i);
  });

  it('calls no creative tired, fatigued or dead', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ frequency: 9.4 }) },
    }) });
    expect(JSON.stringify(vm)).not.toMatch(/fatigue|tired|exhaust|dead|saturat/i);
  });
});

describe('creative age', () => {
  // The year is load-bearing: "14 Jun" beside an ad running since last year
  // reads as two weeks old, which is the one wrong answer a fatigue reader acts on.
  it('is the real date, with its year', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).ad.creativeAge)
      .toBe('14 Jun 2026');
  });

  it('does not vary with the machine locale', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ platformCreatedTime: '2025-12-25T23:00:00.000Z' }) },
    }) });
    expect(vm.ad.creativeAge).toBe('25 Dec 2025');
  });

  // Fix 3's rule, as a test. There is no canonical date-age formatter in this
  // client, so a "3 days old" here would be arithmetic against the reader's
  // clock wearing a stored fact's clothes.
  it('computes no days-old figure', () => {
    expect(codeOf('creativeIntelligenceViewModel.js'))
      .not.toMatch(/Date\.now\(\)|daysSince|86_?400|days old/i);
  });

  it('uses platformCreatedTime, never our own write time', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ platformCreatedTime: null, createdAt: '2026-08-01T00:00:00.000Z' }) },
    }) });
    expect(vm.ad.creativeAge).toBeNull();
  });

  it.each([[null], [undefined], ['not-a-date']])('is null for %s, never a guessed date', (t) => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ platformCreatedTime: t }) },
    }) });
    expect(vm.ad.creativeAge).toBeNull();
    expect(JSON.stringify(vm)).not.toMatch(/new\b/i);
  });
});

describe('null stays null', () => {
  it.each(['ctr', 'roas', 'frequency', 'spendMinor', 'impressions', 'clicks', 'conversions'])(
    'an unreported %s does not become 0', (field) => {
      const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
        summary: { bottom: ad({ [field]: null }) },
      }) });
      expect(vm.metrics[field]).toBeNull();
    },
  );

  it('rejects a non-finite figure rather than rendering NaN', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ ctr: NaN, roas: Infinity }) },
    }) });
    expect(vm.metrics.ctr).toBeNull();
    expect(vm.metrics.roas).toBeNull();
  });

  it('keeps a real zero, which is not the same as no data', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ conversions: 0 }) },
    }) });
    expect(vm.metrics.conversions).toBe(0);
  });
});

describe('video signals', () => {
  it('maps the keys the ingestion actually emits', () => {
    expect(buildCreativeIntelligenceViewModel({ evidence: payload() }).videoSignals)
      .toEqual({ videoView: 4000, video25: 1800, video50: 900, video95: 300 });
  });

  // Fix 8: the shape is whatever metaNormalize's ACTION_MAP landed. No aliases,
  // no guessed keys — an alias that does not exist would render as an absence,
  // and one that exists under another name would be silently dropped twice over.
  it('invents no key that was not in the bag', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ actionMetrics: { videoView: 500 } }) },
    }) });
    expect(vm.videoSignals).toEqual({ videoView: 500 });
    expect(vm.videoSignals).not.toHaveProperty('video25');
  });

  // An image ad has no quartiles at all, and neither does a video ad Meta has
  // not reported on. Four zeros would say nobody watched it.
  it.each([[null], [undefined], [{}], [{ lpv: 200, atc: 4 }]])('is null for %s, never zeros', (bag) => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ actionMetrics: bag }) },
    }) });
    expect(vm.videoSignals).toBeNull();
  });

  it('carries the funnel keys through untouched — they are not video signals', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload() });
    expect(vm.videoSignals).not.toHaveProperty('lpv');
  });

  it('keeps a measured zero quartile, which is a real reading', () => {
    const vm = buildCreativeIntelligenceViewModel({ evidence: payload({
      summary: { bottom: ad({ actionMetrics: { videoView: 900, video95: 0 } }) },
    }) });
    expect(vm.videoSignals).toEqual({ videoView: 900, video95: 0 });
  });
});

describe('nothing to show', () => {
  it.each([
    [undefined],
    [{ evidence: null }],
    [{ evidence: {} }],
    [{ evidence: { summary: {} } }],
    [{ evidence: { summary: { bottom: null } } }],
  ])('%s becomes null, never an empty card', (input) => {
    expect(buildCreativeIntelligenceViewModel(input)).toBeNull();
  });

  it('does not mutate the payload it was handed', () => {
    const input = { evidence: payload() };
    const before = JSON.stringify(input);
    buildCreativeIntelligenceViewModel(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
