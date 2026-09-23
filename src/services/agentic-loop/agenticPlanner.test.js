import { describe, it, expect } from 'vitest';
import { planAgenda, NON_BUYER_VERDICTS } from './agenticPlanner.js';
import { AGENDA_BAND, AGENDA_TYPE, STAGE_STATE, LOOP_HEALTH, HUMAN_ACTION } from './agenticTypes.js';

const now = new Date('2026-06-09T00:00:00.000Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();

const verdicts = [
  { id: 'd1', entityId: 'as1', entityLevel: 'ADSET', verdict: 'KILL', rationale: 'Frequency 4.2 over ceiling', status: 'PROPOSED' },
  { id: 'd2', entityId: 'cmp1', entityLevel: 'CAMPAIGN', verdict: 'WATCH', rationale: 'ROAS softening', status: 'PROPOSED' },
];
const fatiguePredictions = [
  { id: 'f1', entityId: 'as2', metric: 'frequency', ceiling: 3.5, projectedBreachDate: daysAgo(-2) }, // 2 days out
];
const pacing = [
  { channelId: 'meta', channel: 'Meta', status: 'OVER', daysEarly: 4 },
  { channelId: 'google', channel: 'Google', status: 'UNDER' },
];
const planTracking = { goals: [{ goalId: 'g1', metric: 'blendedCac', landing: { status: 'OFF_TRACK', basis: 'trend' } }] };
const blended = { portfolio: { blendedRoas: 3.2, gapPct: 38 } };
const labelsById = new Map([['as1', 'Cold #1'], ['cmp1', 'PMax'], ['as2', 'Cold #2']]);

const fullLoop = {
  plans: [{ id: 'p1', createdAt: daysAgo(2) }],
  allocationPlans: [{ id: 'a1', createdAt: daysAgo(3) }],
  platformExecutions: [{ id: 'e1', platformExecutedAt: daysAgo(1) }],
  openTests: [{ id: 't1', dimension: 'HOOK', startedAt: daysAgo(2) }],
  recentOutcomes: [{ id: 'o1', createdAt: daysAgo(1) }],
  recentMemory: [{ id: 'm1', createdAt: daysAgo(1) }],
};

const base = { verdicts, fatiguePredictions, pacing, planTracking, blended, labelsById, now, ...fullLoop };

describe('agenticPlanner — banding', () => {
  const out = planAgenda(base);

  it('puts verdicts/fatigue/pacing-over/tests in the BUYER band', () => {
    const types = out.buyerBand.map((i) => i.type);
    expect(out.buyerBand.every((i) => i.band === AGENDA_BAND.BUYER)).toBe(true);
    expect(types).toContain(AGENDA_TYPE.VERDICT);
    expect(types).toContain(AGENDA_TYPE.FATIGUE);
    expect(types).toContain(AGENDA_TYPE.PACING);
  });

  it('puts goal drift / blended gap in the STRATEGIST band', () => {
    expect(out.strategistBand.every((i) => i.band === AGENDA_BAND.STRATEGIST)).toBe(true);
    expect(out.strategistBand.some((i) => i.type === AGENDA_TYPE.PLAN_ADJUSTMENT)).toBe(true);
  });

  it('a guardrail verdict becomes a REVIEW item citing the decision id', () => {
    const v = out.buyerBand.find((i) => i.evidenceRef === 'd1');
    expect(v.humanAction).toBe(HUMAN_ACTION.REVIEW);
    expect(v.title).toContain('Cold #1');
  });

  it('treats WATCH as HIGH severity, ranking it above medium/low buyer items', () => {
    const watch = out.buyerBand.find((i) => i.evidenceRef === 'd2');
    expect(watch.severity).toBe('HIGH');
    // HIGH tier sorts before the MEDIUM over-pacing item.
    const watchIdx = out.buyerBand.findIndex((i) => i.evidenceRef === 'd2');
    const pacingIdx = out.buyerBand.findIndex((i) => i.type === AGENDA_TYPE.PACING);
    expect(watchIdx).toBeLessThan(pacingIdx);
  });

  // The Phase-9 fix: connector verdicts (revenue + awareness) feed the same band
  // the guardrail verdicts do — the planner is source-agnostic about WHERE a
  // Decision came from.
  //
  // The awareness row is a WATCH rather than the HOLD it used to be. The point
  // being defended is that an awareness-track Decision is not silently dropped
  // for originating on that track, and WATCH proves that just as well — whereas
  // HOLD now tests two things at once (source AND actionability) and would
  // wrongly read as "HOLD belongs in the band". The verdict-level boundary has
  // its own tests below.
  it('renders connector + awareness verdicts as buyer items', () => {
    const connector = [
      { id: 'cv1', entityId: 'cmp2', entityLevel: 'CAMPAIGN', verdict: 'REFRESH', rationale: 'Creative fatigue detected', status: 'PROPOSED' },
      { id: 'cv2', entityId: 'cmp3', entityLevel: 'CAMPAIGN', verdict: 'WATCH', rationale: 'Awareness campaign (no revenue measured): frequency rising toward saturation — monitor.', status: 'PROPOSED' },
    ];
    const res = planAgenda({ verdicts: connector, now });
    const refresh = res.buyerBand.find((i) => i.evidenceRef === 'cv1');
    const awareness = res.buyerBand.find((i) => i.evidenceRef === 'cv2');
    expect(refresh).toMatchObject({ type: AGENDA_TYPE.VERDICT, humanAction: HUMAN_ACTION.REVIEW, entityId: 'cmp2' });
    // The awareness-track row is included (not skipped) and carries its own severity.
    expect(awareness).toMatchObject({ type: AGENDA_TYPE.VERDICT, severity: 'HIGH', entityId: 'cmp3' });
    expect(refresh.rationale).toContain('fatigue');
  });
});

// ── The verdict-level boundary ──────────────────────────────────
// "What needs a decision today" is a filtered surface, not a mirror of the
// persisted PROPOSED rows. HOLD is a real Decision — persisted, superseded,
// carried in Decision Memory — that asks the buyer for nothing.
describe('agenticPlanner — HOLD is not a buyer decision', () => {
  const hold = {
    id: 'h1', entityId: 'cmp9', entityLevel: 'CAMPAIGN', verdict: 'HOLD',
    rationale: 'Within healthy parameters — hold and keep monitoring.', status: 'PROPOSED',
  };

  it('drops a PROPOSED HOLD from the buyer band', () => {
    const res = planAgenda({ verdicts: [hold], now });
    expect(res.buyerBand.find((i) => i.evidenceRef === 'h1')).toBeUndefined();
    expect(res.buyerBand).toEqual([]);
  });

  // The count is the user-visible claim: a page that says "1 to decide" over a
  // campaign the rest of the product files under "Doing well" is the defect.
  it('does not count toward "N to decide" — an account of HOLDs reads as quiet', () => {
    const res = planAgenda({ verdicts: [hold, { ...hold, id: 'h2', entityId: 'cmp10' }], now });
    expect(res.buyerBand).toHaveLength(0);
    expect(res.summary).toMatch(/quiet/i);
  });

  it('drops only the HOLD when it sits beside a real decision', () => {
    const res = planAgenda({ verdicts: [hold, verdicts[0]], now });
    expect(res.buyerBand.map((i) => i.evidenceRef)).toEqual(['d1']);
  });
});

describe('agenticPlanner — every attention verdict stays admitted', () => {
  // Executability is the WRONG test for ADMISSION: WATCH has no Meta action
  // either, and is deliberately kept — it means "something is off, look at it".
  // The admission test is attention, not a button.
  //
  // It is not the right test for the VERB either (#354). The column below is back
  // to being shared — but this time because every row genuinely answers the same,
  // not because nobody checked: the destination is Campaigns, and Campaigns cannot
  // execute. SEVERITY is what still differs per verdict, and that is the column
  // this table exists to pin.
  it.each([
    ['KILL',       'HIGH',   HUMAN_ACTION.REVIEW],
    ['WATCH',      'HIGH',   HUMAN_ACTION.REVIEW],
    ['REALLOCATE', 'MEDIUM', HUMAN_ACTION.REVIEW],
    ['REFRESH',    'MEDIUM', HUMAN_ACTION.REVIEW],
    ['SCALE',      'MEDIUM', HUMAN_ACTION.REVIEW],
  ])('%s reaches the buyer band at %s severity asking the human to %s', (verdict, severity, humanAction) => {
    const res = planAgenda({
      verdicts: [{ id: 'v1', entityId: 'cmp1', entityLevel: 'CAMPAIGN', verdict, rationale: 'r', status: 'PROPOSED' }],
      now,
    });
    expect(res.buyerBand).toHaveLength(1);
    expect(res.buyerBand[0]).toMatchObject({
      type: AGENDA_TYPE.VERDICT, severity, humanAction, entityId: 'cmp1',
    });
  });

  it('excludes HOLD and nothing else', () => {
    expect(NON_BUYER_VERDICTS).toEqual(['HOLD']);
  });
});

// ── The verb-level boundary ─────────────────────────────────────
// Admission and the verb are different questions. HOLD fails the first (#349);
// WATCH passes it and fails the second. Conflating them is how WATCH ended up
// labelled "Confirm" over a campaign row that draws no ActionBar — the buyer was
// told to confirm something with nothing on it to confirm.
describe('agenticPlanner — WATCH asks to be reviewed, not confirmed', () => {
  const watch = {
    id: 'w1', entityId: 'cmp7', entityLevel: 'CAMPAIGN', verdict: 'WATCH',
    rationale: 'Traffic is not reaching the landing page (POST_CLICK)', status: 'PROPOSED',
  };

  // Three assertions in one, because the failure mode this guards against is
  // "fixed the verb by removing the row". The verb must change and the presence
  // must not.
  it('stays in the band, at HIGH severity, carrying REVIEW', () => {
    const res = planAgenda({ verdicts: [watch], now });
    expect(res.buyerBand).toHaveLength(1);
    expect(res.buyerBand[0]).toMatchObject({
      evidenceRef: 'w1', severity: 'HIGH', humanAction: HUMAN_ACTION.REVIEW,
    });
  });

  it('still counts toward "N to decide" — attention is a decision to look', () => {
    const res = planAgenda({ verdicts: [watch], now });
    expect(res.summary).toMatch(/1 to decide/);
  });

  // A guardrail rule the operator configured without naming a verdict emits WATCH
  // (GuardrailRule.emitVerdict defaults to WATCH), and reaches this band through
  // the `guardrail:` rootCause clause rather than the connector one. It must be
  // admitted for the same reason every other WATCH is, and asked for with the same
  // verb: a policy hit is something to look at, not something to execute.
  it('admits a guardrail-authored WATCH with the same verb', () => {
    const res = planAgenda({
      verdicts: [{
        id: 'g1', entityId: 'as5', entityLevel: 'ADSET', verdict: 'WATCH',
        rootCause: 'guardrail:ROAS floor', rationale: 'ROAS floor: roas < 1 for 1 day(s)',
        status: 'PROPOSED',
      }],
      now,
    });
    expect(res.buyerBand).toHaveLength(1);
    expect(res.buyerBand[0]).toMatchObject({
      evidenceRef: 'g1', severity: 'HIGH', humanAction: HUMAN_ACTION.REVIEW, entityId: 'as5',
    });
  });

  // The verb no longer varies by verdict OR by level (#354). Kept as a guard
  // anyway: entityLevel is exactly where a future execution wiring would start
  // branching, and AD level is where the Meta action matrix actually breaks
  // (verdictToActionType returns PAUSE_ADSET for an AD, which the execute route
  // rejects). If the verb ever becomes level-dependent, it should be a decision
  // someone made, not a silent fallback.
  it.each([['CAMPAIGN'], ['ADSET'], ['AD']])('answers the same at %s level', (entityLevel) => {
    const res = planAgenda({
      verdicts: [
        { ...watch, entityLevel },
        { id: 'k1', entityId: 'cmp8', entityLevel, verdict: 'KILL', rationale: 'r', status: 'PROPOSED' },
      ],
      now,
    });
    const byRef = Object.fromEntries(res.buyerBand.map((i) => [i.evidenceRef, i.humanAction]));
    expect(byRef.w1).toBe(HUMAN_ACTION.REVIEW);
    expect(byRef.k1).toBe(HUMAN_ACTION.REVIEW);
  });
});

// ── The destination boundary (#354) ─────────────────────────────
// agenticTypes defines CONFIRM as "confirm a proposed verdict/reallocation →
// execution motion". A VERDICT item navigates to Campaigns, and Campaigns cannot
// execute: ActionBar offers "Copy decision" and "Open in {channel}", and
// DecisionLifecycle asks "Did you act on this?". The marketer acts in Meta, by
// hand. The execution half of the system (POST /api/execute/meta →
// ExecutionRequest → executionQueue → executionWorker → Meta Graph API) is built
// and mounted but has zero production client callers, and nothing routes a
// verdict into it.
//
// So the guard is on the DESTINATION, not on any verdict list: whatever the engine
// starts emitting, a VERDICT item may not say "confirm" while its click only
// navigates. Written over the whole band rather than per verdict so a NEW verdict
// added later is covered the day it ships.
describe('agenticPlanner — no verdict claims an execution motion the destination lacks', () => {
  const now = new Date('2026-08-10T00:00:00Z');
  const ALL_VERDICTS = ['KILL', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH', 'HOLD'];

  const bandFor = (verdicts) => planAgenda({ verdicts, now }).buyerBand;

  it('every VERDICT item in the buyer band asks to REVIEW, never to CONFIRM', () => {
    const band = bandFor(ALL_VERDICTS.map((verdict, i) => ({
      id: `v${i}`, entityId: `cmp${i}`, entityLevel: 'CAMPAIGN', verdict,
      rationale: 'r', status: 'PROPOSED',
    })));
    const verdictItems = band.filter((i) => i.type === AGENDA_TYPE.VERDICT);

    // HOLD is excluded upstream (#349); the other five are all present.
    expect(verdictItems).toHaveLength(ALL_VERDICTS.length - 1);
    expect(verdictItems.map((i) => i.humanAction)).not.toContain(HUMAN_ACTION.CONFIRM);
    expect(new Set(verdictItems.map((i) => i.humanAction))).toEqual(new Set([HUMAN_ACTION.REVIEW]));
  });

  it('holds at every entity level — a deeper row cannot promise more', () => {
    for (const entityLevel of ['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD', 'CREATIVE']) {
      const band = bandFor(ALL_VERDICTS.map((verdict, i) => ({
        id: `v${i}`, entityId: `e${i}`, entityLevel, verdict, rationale: 'r', status: 'PROPOSED',
      })));
      const verbs = band.filter((i) => i.type === AGENDA_TYPE.VERDICT).map((i) => i.humanAction);
      expect(verbs, `${entityLevel} promised an execution motion`).not.toContain(HUMAN_ACTION.CONFIRM);
    }
  });

  // The severities are the thing that genuinely differs, and they must survive a
  // change that was only ever about the verb.
  it('severity is untouched — this changed what we ask for, not how loud it is', () => {
    const band = bandFor(ALL_VERDICTS.map((verdict, i) => ({
      id: `v${i}`, entityId: `cmp${i}`, entityLevel: 'CAMPAIGN', verdict,
      rationale: 'r', status: 'PROPOSED',
    })));
    const sevByRef = Object.fromEntries(band.map((i) => [i.title.split(' ')[0], i.severity]));
    expect(sevByRef).toMatchObject({
      KILL: 'HIGH', WATCH: 'HIGH', REALLOCATE: 'MEDIUM', REFRESH: 'MEDIUM', SCALE: 'MEDIUM',
    });
  });
});

describe('agenticPlanner — impact ranking', () => {
  const impactById = new Map([['as1', 3], ['cmp1', 9]]);

  it('attaches the per-entity impactScore to VERDICT items (null when unscored)', () => {
    const out = planAgenda({ ...base, impactById });
    const kill = out.buyerBand.find((i) => i.evidenceRef === 'd1');  // entity as1 → 3
    const watch = out.buyerBand.find((i) => i.evidenceRef === 'd2'); // entity cmp1 → 9
    expect(kill.impactScore).toBe(3);
    expect(watch.impactScore).toBe(9);
    // A pacing item is not a scored campaign → impactScore stays null (no fabrication).
    const pacingItem = out.buyerBand.find((i) => i.type === AGENDA_TYPE.PACING);
    expect(pacingItem.impactScore).toBeNull();
  });

  it('within a severity tier, ranks the higher-impact lever first', () => {
    // d1 (KILL, as1) and d2 (WATCH, cmp1) are BOTH HIGH severity → impact breaks the tie.
    const out = planAgenda({ ...base, impactById });
    const killIdx = out.buyerBand.findIndex((i) => i.evidenceRef === 'd1');  // impact 3
    const watchIdx = out.buyerBand.findIndex((i) => i.evidenceRef === 'd2'); // impact 9
    expect(watchIdx).toBeLessThan(killIdx); // 9 sorts before 3 within the HIGH tier
  });

  it('falls back to severity-only order (null impact) when no impact map is supplied', () => {
    const out = planAgenda(base); // no impactById
    for (const i of out.buyerBand) {
      if (i.type === AGENDA_TYPE.VERDICT) expect(i.impactScore).toBeNull();
    }
    // Deterministic: same-tier ties fall to the stable id tiebreak (d1 before d2).
    const killIdx = out.buyerBand.findIndex((i) => i.evidenceRef === 'd1');
    const watchIdx = out.buyerBand.findIndex((i) => i.evidenceRef === 'd2');
    expect(killIdx).toBeLessThan(watchIdx);
  });
});

describe('agenticPlanner — loop status', () => {
  it('reports CLOSED + HEALTHY when every stage has a recent row', () => {
    const out = planAgenda(base);
    expect(out.closed).toBe(true);
    expect(out.staleStages).toEqual([]);
    expect(out.loopHealth).toBe(LOOP_HEALTH.HEALTHY);
    expect(out.stageStatus).toHaveLength(6);
    expect(out.stageStatus.every((s) => s.state === STAGE_STATE.ACTIVE)).toBe(true);
  });

  it('marks a stage STALE when its row is old / missing, and the loop not closed', () => {
    const out = planAgenda({ ...base, platformExecutions: [], recentMemory: [{ id: 'm1', createdAt: daysAgo(90) }] });
    const execute = out.stageStatus.find((s) => s.stage === 'EXECUTE');
    const learn = out.stageStatus.find((s) => s.stage === 'LEARN');
    expect(execute.state).toBe(STAGE_STATE.STALE);
    expect(learn.state).toBe(STAGE_STATE.STALE);
    expect(out.closed).toBe(false);
    expect(out.staleStages).toContain('EXECUTE');
  });

  it('STALLED when buyers have proposals but EXECUTE has gone stale', () => {
    const out = planAgenda({ ...base, platformExecutions: [] }); // proposals exist, no recent platform execution

    expect(out.loopHealth).toBe(LOOP_HEALTH.STALLED);
  });
});

describe('agenticPlanner — honesty + determinism', () => {
  it('an empty account yields empty bands, never fabricated work', () => {
    const out = planAgenda({ now });
    expect(out.buyerBand).toEqual([]);
    expect(out.strategistBand).toEqual([]);
    expect(out.summary).toMatch(/quiet/i);
    // empty account: no rows anywhere → loop is not closed, honestly
    expect(out.closed).toBe(false);
  });

  it('same input → identical output', () => {
    expect(JSON.stringify(planAgenda(base))).toBe(JSON.stringify(planAgenda(base)));
  });

  it('frames the summary through the onboarding objective when set', () => {
    expect(planAgenda({ ...base, objective: 'roas' }).summary).toMatch(/optimizing for return on ad spend/i);
    expect(planAgenda({ ...base, objective: 'ltv' }).summary).toMatch(/optimizing for lifetime value/i);
  });

  it('leaves the summary unframed for an absent or unknown objective', () => {
    expect(planAgenda(base).summary).not.toMatch(/optimizing for/i);            // no objective
    expect(planAgenda({ ...base, objective: 'bogus' }).summary).not.toMatch(/optimizing for/i);
  });

  it('on-track goals do not clutter the strategist band', () => {
    const out = planAgenda({ ...base, planTracking: { goals: [{ goalId: 'g1', metric: 'roas', landing: { status: 'ON_TRACK' } }] }, blended: null, pacing: [] });
    expect(out.strategistBand).toEqual([]);
  });

  it('keeps an unavailable MER goal distinct from progress or success', () => {
    const out = planAgenda({ ...base, planTracking: { goals: [{
      goalId: 'mer-goal', metric: 'mer', status: 'INSUFFICIENT_EVIDENCE',
      unavailableReason: 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE', landing: null,
    }] }, blended: null, pacing: [] });
    expect(out.strategistBand).toHaveLength(1);
    expect(out.strategistBand[0]).toMatchObject({
      title: 'Goal mer is insufficient evidence',
      rationale: 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE',
    });
  });
});
