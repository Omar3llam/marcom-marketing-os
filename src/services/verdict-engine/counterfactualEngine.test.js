// ============================================================
// counterfactualEngine — why NOT the alternatives, and the two allowlists
// ------------------------------------------------------------
// What is pinned here:
//   1. contradictions are CARRIED from Stage 2, never re-derived — a second
//      implementation of "does this argue against that" would drift from the
//      first the moment either is tuned
//   2. `preferredBecause` excludes evidence the alternative also explains —
//      citing shared evidence makes a comparison look decisive on numbers that
//      point equally at both mechanisms
//   3. the primary is positional, NOT re-sorted on reasoning confidence (the
//      two genuinely disagree — there is a test built from the real engine)
//   4. all three reasoning fields survive BOTH hand-picked allowlists. They
//      existed on the verdict for two PRs and reached nothing, because the
//      first list dropped them silently.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns } = vi.hoisted(() => ({ getCanonicalVerdictCampaigns: vi.fn() }));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
// Phase D.4: the verdict path reads CANONICAL evidence and is handed an
// envelope — the campaigns that have a canonical row, plus the identities that
// have none. These tests are about the campaigns, so noCanonicalWindow is empty;
// the absence path has its own tests in canonicalVerdictEvidence.test.js.
const mockCampaigns = (rows) => getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: rows, noCanonicalWindow: [] });
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildCounterfactuals } from './counterfactualEngine.js';
import { rollupVerdicts } from './verdictEngine.js';
import { applyRelativeRanking } from './relativeRanking.js';
import { projectHypotheses } from './signalProjector.js';
import { getConnectorVerdicts } from './connectorVerdictService.js';
import { diagnoseSignals } from '../diagnosis-engine/DiagnosisEngine.js';
import { SIGNAL_TYPE, DIAGNOSIS } from '../diagnosis-engine/diagnosisTypes.js';
import { SEVERITY } from './evidenceProvider.js';
import { VERDICT } from './verdictTypes.js';

/** An observation row, as signalRules' obs() emits it. */
const ob = (metric, severity = SEVERITY.MEDIUM) =>
  ({ metric, value: 1, benchmark: 2, severity });

/** A hand-built hypothesis — full control over ranking and contradictions. */
const hyp = (id, { observed = [], contradicts = [], reasoning = 0.9 } = {}) => ({
  id,
  labelKey:   DIAGNOSIS[id],
  observed,
  supports:   observed.map((o) => o.metric),
  contradicts,
  confidence: { reasoning, data: 0.8 },
});

// ── Degenerate inputs ───────────────────────────────────────────────────────
describe('buildCounterfactuals — nothing to argue against', () => {
  it('returns [] for fewer than two hypotheses', () => {
    expect(buildCounterfactuals([])).toEqual([]);
    expect(buildCounterfactuals([hyp(SIGNAL_TYPE.CREATIVE_FATIGUE)])).toEqual([]);
  });

  it('returns [] rather than throwing on a missing or malformed list', () => {
    expect(buildCounterfactuals(null)).toEqual([]);
    expect(buildCounterfactuals(undefined)).toEqual([]);
    expect(buildCounterfactuals({ length: 5 })).toEqual([]);
  });

  it('takes hypotheses ONLY — declined is not a parameter', () => {
    expect(buildCounterfactuals.length).toBe(1);
  });
});

// ── rejectedBy: carried, never re-derived ───────────────────────────────────
describe('buildCounterfactuals — rejectedBy comes from Stage 2 verbatim', () => {
  it('carries the alternative\'s contradicts through untouched', () => {
    const contradicts = [
      { metric: 'CTR', value: 1.0, benchmark: 0.8, severity: SEVERITY.HEALTHY },
    ];
    const [cf] = buildCounterfactuals([
      hyp(SIGNAL_TYPE.CREATIVE_FATIGUE),
      hyp(SIGNAL_TYPE.LOW_CTR, { contradicts }),
    ]);
    expect(cf.rejectedBy).toEqual(contradicts);
  });

  // The behavioural proof that no re-derivation happens: 'ROAS' is in no
  // mechanism's support list, so anything rebuilding contradictions from
  // MECHANISM_SUPPORT would drop it. Carrying it through is the contract.
  it('does not re-filter contradicts against MECHANISM_SUPPORT', () => {
    const odd = [{ metric: 'ROAS', value: 4, benchmark: 3, severity: SEVERITY.HEALTHY }];
    const [cf] = buildCounterfactuals([
      hyp(SIGNAL_TYPE.CREATIVE_FATIGUE),
      hyp(SIGNAL_TYPE.LOW_CTR, { contradicts: odd }),
    ]);
    expect(cf.rejectedBy).toEqual(odd);
  });

  it('defaults to [] when the alternative carries no contradictions', () => {
    const [cf] = buildCounterfactuals([
      hyp(SIGNAL_TYPE.CREATIVE_FATIGUE),
      { id: SIGNAL_TYPE.LOW_CTR, labelKey: DIAGNOSIS.LOW_CTR },
    ]);
    expect(cf.rejectedBy).toEqual([]);
  });
});

// ── preferredBecause: what the alternative cannot explain ───────────────────
describe('buildCounterfactuals — preferredBecause excludes shared evidence', () => {
  const primary = hyp(SIGNAL_TYPE.CREATIVE_FATIGUE, {
    observed: [ob('FREQUENCY'), ob('CTR', SEVERITY.HIGH)],
  });

  it('drops the primary evidence the alternative also covers', () => {
    // LOW_CTR is evidenced by CTR, so CTR separates nothing. FREQUENCY does.
    const [cf] = buildCounterfactuals([primary, hyp(SIGNAL_TYPE.LOW_CTR)]);
    expect(cf.preferredBecause.map((o) => o.metric)).toEqual(['FREQUENCY']);
  });

  it('keeps everything when the alternative shares no metric', () => {
    // AUDIENCE_MISMATCH rests on CPC / CONV_RATE — neither is the primary's.
    const [cf] = buildCounterfactuals([primary, hyp(SIGNAL_TYPE.AUDIENCE_MISMATCH)]);
    expect(cf.preferredBecause.map((o) => o.metric)).toEqual(['FREQUENCY', 'CTR']);
  });

  it('returns full evidence rows, not metric names', () => {
    const [cf] = buildCounterfactuals([primary, hyp(SIGNAL_TYPE.AUDIENCE_MISMATCH)]);
    expect(cf.preferredBecause[0]).toEqual({
      metric: 'FREQUENCY', value: 1, benchmark: 2, severity: SEVERITY.MEDIUM,
    });
  });

  it('is [] when the alternative explains everything the primary rests on', () => {
    // A real state, stated as empty rather than filled with a plausible reason.
    const narrow = hyp(SIGNAL_TYPE.LOW_CTR, { observed: [ob('CTR')] });
    const [cf] = buildCounterfactuals([narrow, hyp(SIGNAL_TYPE.CREATIVE_FATIGUE)]);
    expect(cf.preferredBecause).toEqual([]);
  });
});

// ── Shape + the primary is positional ───────────────────────────────────────
describe('buildCounterfactuals — one counterfactual per alternative', () => {
  const [a, b, c] = [SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.AUDIENCE_MISMATCH, SIGNAL_TYPE.LOW_CTR];

  it('builds from hypotheses[0], in the order given', () => {
    const out = buildCounterfactuals([hyp(a), hyp(b), hyp(c)]);
    expect(out.map((x) => x.mechanism)).toEqual([b, c]);
  });

  it('re-anchors when the caller\'s ranking changes', () => {
    const out = buildCounterfactuals([hyp(b), hyp(a), hyp(c)]);
    expect(out.map((x) => x.mechanism)).toEqual([a, c]);
  });

  it('reports the alternative\'s own confidence, unrecomputed', () => {
    const alt = hyp(c, { reasoning: 0.42 });
    const [cf] = buildCounterfactuals([hyp(a), alt]);
    expect(cf.confidence).toBe(alt.confidence);
    expect(cf.confidence.reasoning).toBe(0.42);
  });

  it('carries the label key for the UI', () => {
    const [cf] = buildCounterfactuals([hyp(a), hyp(c)]);
    expect(cf.labelKey).toBe(DIAGNOSIS.LOW_CTR);
  });
});

// ── The ranking the engine actually produces ────────────────────────────────
describe('buildCounterfactuals — primary is NOT re-sorted on reasoning confidence', () => {
  // Built from the real engine: CREATIVE_FATIGUE ranks first (rule confidence
  // 0.85 > 0.75) while scoring LOWER on derived reasoning confidence, because a
  // declined LOW_CTR leaves a healthy CTR that contradicts it and nothing
  // contradicts INEFFICIENT_SCALING. The two orderings genuinely disagree.
  const dx = diagnoseSignals({ frequency: 4.0, ctr: 1.0, spendMinor: 60_000, conversions: 2 });
  const hypotheses = projectHypotheses(dx, 0.8);

  it('reproduces the disagreement', () => {
    expect(hypotheses.map((h) => h.id))
      .toEqual([SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.INEFFICIENT_SCALING]);
    expect(hypotheses[0].confidence.reasoning).toBe(0.55);
    expect(hypotheses[1].confidence.reasoning).toBe(0.95);
  });

  it('anchors on hypotheses[0] anyway — this file ranks nothing', () => {
    const out = buildCounterfactuals(hypotheses);
    expect(out).toHaveLength(1);
    expect(out[0].mechanism).toBe(SIGNAL_TYPE.INEFFICIENT_SCALING);
    // The primary's CTR + FREQUENCY are outside CPL/SPEND, so both survive.
    expect(out[0].preferredBecause.map((o) => o.metric)).toEqual(['FREQUENCY', 'CTR']);
    // Nothing contradicts INEFFICIENT_SCALING — no rule sharing its metrics declined.
    expect(out[0].rejectedBy).toEqual([]);
  });
});

// ── Allowlist 1: the rollupVerdicts node return ─────────────────────────────
describe('rollupVerdicts — the reasoning artifacts reach the node', () => {
  // ctr 0.7% (350/50 000) with frequency 4.0 and a high CPC: CREATIVE_FATIGUE,
  // AUDIENCE_MISMATCH and LOW_CTR all fire.
  const leaf = (id, over = {}) => ({
    id, level: 'CAMPAIGN', currency: 'USD',
    metrics: {
      spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000,
      clicks: 350, conversions: 0, frequency: 4.0, ...over,
    },
  });
  const tree = { id: 'acct', level: 'ACCOUNT', children: [leaf('c1')] };

  it('carries declined, hypotheses and counterfactuals off the verdict', () => {
    const [node] = rollupVerdicts(tree).children;
    expect(node.hypotheses.map((h) => h.id)).toEqual([
      SIGNAL_TYPE.CREATIVE_FATIGUE, SIGNAL_TYPE.AUDIENCE_MISMATCH, SIGNAL_TYPE.LOW_CTR,
    ]);
    expect(node.counterfactuals.map((c) => c.mechanism)).toEqual([
      SIGNAL_TYPE.AUDIENCE_MISMATCH, SIGNAL_TYPE.LOW_CTR,
    ]);
    expect(Array.isArray(node.declined)).toBe(true);
  });

  it('defaults all three to [] rather than undefined', () => {
    // A thin campaign returns from the minimum-sample gate, before any rule runs.
    const thin = { id: 'acct', level: 'ACCOUNT', children: [leaf('c1', { impressions: 100 })] };
    const [node] = rollupVerdicts(thin).children;
    expect(node.verdict).toBe(VERDICT.WATCH);
    expect(node.declined).toEqual([]);
    expect(node.hypotheses).toEqual([]);
    expect(node.counterfactuals).toEqual([]);
  });
});

// ── applyRelativeRanking is spread-transparent ──────────────────────────────
describe('applyRelativeRanking — the artifacts survive an upgrade', () => {
  // Three awareness siblings (no revenue), all HOLD on the absolute pass, all
  // with two fired mechanisms. A cohort of three is the minimum that ranks.
  const sibling = (id, clicks) => ({
    id, level: 'CAMPAIGN', currency: 'USD',
    metrics: {
      spendMinor: 100_000, revenueMinor: 0, impressions: 50_000,
      clicks, conversions: 0, frequency: 2.0,
    },
  });
  const tree = {
    id: 'acct', level: 'ACCOUNT',
    children: [sibling('lo', 250), sibling('mid', 300), sibling('hi', 350)],
  };

  it('upgrades the verdict and keeps the absolute pass\'s reasoning', () => {
    const before = rollupVerdicts(tree);
    expect(before.children.every((c) => c.verdict === VERDICT.HOLD)).toBe(true);

    const after = applyRelativeRanking(before);
    const bottom = after.children.find((c) => c.id === 'lo');

    expect(bottom.verdict).toBe(VERDICT.KILL);
    expect(bottom.relativeRank).toBe('BOTTOM');
    // Spread-transparent: the fields ride through untouched. Note the verdict is
    // now cohort-derived while the hypotheses are still the absolute pass's —
    // the pre-existing condition PR#319's `source` tag addresses.
    expect(bottom.hypotheses.length).toBeGreaterThan(0);
    expect(bottom.counterfactuals.length).toBeGreaterThan(0);
    expect(bottom.hypotheses).toEqual(
      before.children.find((c) => c.id === 'lo').hypotheses,
    );
  });
});

// ── Allowlist 2: the connector payload projection ───────────────────────────
describe('getConnectorVerdicts — the artifacts reach the payload', () => {
  beforeEach(() => vi.clearAllMocks());

  const row = (over = {}) => ({
    entityId: 'c1', name: 'Campaign', channel: 'META', objective: null,
    spendMinor: 100_000, revenueMinor: 0, impressions: 50_000, clicks: 350,
    conversions: 0, frequency: 4.0, currency: 'USD', ...over,
  });

  it('projects hypotheses and counterfactuals onto every verdict', async () => {
    mockCampaigns([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].hypotheses.map((h) => h.id))
      .toContain(SIGNAL_TYPE.CREATIVE_FATIGUE);
    expect(verdicts[0].counterfactuals.length).toBeGreaterThan(0);
    expect(Array.isArray(verdicts[0].declined)).toBe(true);
  });

  it('projects [] — never undefined — when there was nothing to reason about', async () => {
    // One fired mechanism: hypotheses is non-empty, but there is no alternative
    // to argue against.
    mockCampaigns([row({ frequency: 2.0, clicks: 20, impressions: 1_000 })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');

    expect(verdicts[0].counterfactuals).toEqual([]);
    expect(verdicts[0].hypotheses).toBeDefined();
    expect(verdicts[0].declined).toBeDefined();
  });
});
