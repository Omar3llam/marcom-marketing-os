// ============================================================
// R10 · Phase B — learning truth
// ------------------------------------------------------------
// Four things had to become true for learning to mean anything, and each is
// pinned here by a control that names the mutation which breaks it:
//
//   I52  only executed decisions enter causal learning
//   I53  Proof and Learning share ONE definition of success
//   I54  no measured outcome → no ESTABLISHED, and no invented number
//   I49  extraction is idempotent and safe under concurrency
//
// The reason these need controls rather than review is that every one of them
// fails QUIETLY. A learning population that silently includes proposals nobody
// acted on still produces patterns, still renders percentages, and still reads
// as institutional knowledge — it is simply knowledge about things that never
// happened.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot:     { findMany: vi.fn() },
    decision:           { findMany: vi.fn() },
    testExperiment:     { findMany: vi.fn() },
    outcomeSnapshot:    { findMany: vi.fn() },
    accountPattern:     { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    patternObservation: { createMany: vi.fn() },
    $transaction:       vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBriefing, buildPatternInputs } from './PatternService.js';
import { extractPatterns } from './patternEngine.js';
import { PATTERN_STATUS, PATTERN_KIND } from './patternTypes.js';
import { DECISION_SUCCESS } from '../decision-accuracy/decisionSuccess.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source with COMMENTS STRIPPED.
 *
 * Every "this construct is gone" assertion below scans for the old code, and
 * both files explain what they removed by quoting it. Scanning the raw text
 * therefore matches the explanation and reports the defect as still present —
 * a false positive that would make these controls fire forever, and train
 * whoever hits them to delete the assertion rather than believe it.
 *
 * The rule this encodes: a source scan proves something about CODE, so it must
 * read code.
 */
const codeOf = (file) => readFileSync(path.join(HERE, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ENGINE_SRC  = codeOf('patternEngine.js');
const SERVICE_SRC = codeOf('PatternService.js');

const WS = 'ws-r10';
const NOW = new Date('2026-08-17T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
const killEvent = (freq = 3.5, at = daysAgo(30)) => {
  const id = `d-${seq++}`;
  const entityId = `e-${seq}`;
  return {
    id,
    decision: { id, entityId, entityLevel: 'ADSET', verdict: 'KILL', createdAt: at, humanExecutedAt: at },
    snapshot: { entityId, date: at, frequency: freq, roas: 0.7, ctr: 0.5, spendMinor: 100000 },
  };
};

const engineInput = (events, success) => ({
  decisions: events.map((e) => e.decision),
  snapshots: events.map((e) => e.snapshot),
  outcomes:  events.map((e) => ({ decisionId: e.id, success })),
  now: NOW,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.testExperiment.findMany.mockResolvedValue([]);
  prisma.outcomeSnapshot.findMany.mockResolvedValue([]);
  prisma.accountPattern.findMany.mockResolvedValue([]);
  prisma.patternObservation.createMany.mockResolvedValue({ count: 0 });
  prisma.accountPattern.upsert.mockImplementation(({ create }) =>
    Promise.resolve({ id: create?.id ?? 'row' }));
  prisma.$transaction.mockImplementation((arg) =>
    (typeof arg === 'function' ? arg(prisma) : Promise.resolve([])));
});

// ============================================================
describe('NC31/NC32 · I52 — only EXECUTED decisions enter causal learning', () => {
  // NC31 — remove the execution requirement from the population query and this
  // fails. Restoring it means a verdict nobody touched contributes the support
  // that decides ESTABLISHED, so the account "learns" from interventions that
  // were never performed.
  //
  // B4-A — the requirement is now an OR over BOTH provenance columns. An
  // intervention is an intervention whether the operator performed it or Lumi
  // did; what must stay excluded is a decision nobody acted on at all.
  it('NC31 · the population query requires an execution, by either route', async () => {
    await getBriefing(WS, { now: NOW });
    const where = prisma.decision.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { humanExecutedAt: { not: null } },
      { platformExecutedAt: { not: null } },
    ]);
    // And NOT a bare pass-through that would admit untouched verdicts.
    expect(where.OR.length).toBe(2);
  });

  // NC32 — a dismissal is a human saying NO. It is legitimate PROOF data
  // (survivorship) and illegitimate LEARNING data, because no intervention
  // happened. `humanExecutedAt: { not: null }` excludes it structurally: the two
  // signals are mutually exclusive at the write path, so a dismissed-only row
  // carries neither execution timestamp by construction and cannot match.
  it('NC32 · a dismissed-only decision cannot match the population predicate', async () => {
    await getBriefing(WS, { now: NOW });
    const where = prisma.decision.findMany.mock.calls[0][0].where;

    // A dismissed-only row carries neither execution timestamp, so it satisfies
    // no arm of the OR and cannot enter the learning population.
    const dismissedOnly = { humanExecutedAt: null, platformExecutedAt: null, dismissedAt: new Date() };
    const matches = where.OR.some((arm) => {
      const [field] = Object.keys(arm);
      return dismissedOnly[field] !== null;
    });
    expect(matches).toBe(false);
  });

  // The status enum must NOT be what gates this. Nothing in this system writes
  // DecisionStatus.EXECUTED, so `status: 'EXECUTED'` would match an empty set —
  // learning would silently stop entirely, and every surface would report zero
  // patterns as though the account had nothing to teach.
  it('gates on the timestamp, never on the unwritten status enum', () => {
    // The predicate moved to the canonical seam, so the source no longer spells
    // the union out — it spreads decisionProvenance.INTERVENED_WHERE, which is
    // the one place "somebody intervened" is defined. NC31 above still proves
    // the RESOLVED shape at runtime; this proves the source did not quietly
    // re-acquire a local copy or fall back to the status enum.
    expect(SERVICE_SRC).toMatch(/\.\.\.INTERVENED_WHERE/);
    expect(SERVICE_SRC).not.toMatch(/humanExecutedAt:\s*\{\s*not:\s*null\s*\}/);
    expect(SERVICE_SRC).not.toMatch(/status:\s*['"]EXECUTED['"]/);
  });


  it('selects humanExecutedAt — the outcome window opens there, not at createdAt', async () => {
    await getBriefing(WS, { now: NOW });
    expect(prisma.decision.findMany.mock.calls[0][0].select).toHaveProperty('humanExecutedAt', true);
  });

  it('remains workspace-scoped', async () => {
    await getBriefing(WS, { now: NOW });
    expect(prisma.decision.findMany.mock.calls[0][0].where.workspaceId).toBe(WS);
  });
});

// ============================================================
describe('NC33 · I53 — one canonical definition of success', () => {
  // NC33 as specified: make the engine decide `sustained === true` again and the
  // suite must fail. It fails on this source scan AND on the behaviour test
  // below, because the engine no longer receives a `sustained` field at all.
  it('NC33 · the engine never grades an outcome itself', () => {
    expect(ENGINE_SRC).not.toMatch(/sustained\s*===\s*true/);
    expect(ENGINE_SRC).not.toMatch(/\.sustained/);
    expect(ENGINE_SRC).toMatch(/successToCorrect/);
  });

  it('the service runs the canonical evaluation at the seam', () => {
    expect(SERVICE_SRC).toMatch(/evaluateDecisionSuccess/);
  });

  // The evaluation must be reached through the shared module, not re-derived.
  // A second copy would drift from SUCCESS_PREDICATES the first time a predicate
  // changed, and the drift would be invisible: both engines would keep
  // answering, just differently.
  it('buildPatternInputs emits the canonical tri-state, not a raw column', () => {
    const at = daysAgo(30);
    const decisions = [{ id: 'd1', entityId: 'e1', entityLevel: 'ADSET', verdict: 'KILL', createdAt: at, humanExecutedAt: at }];
    // A textbook correct KILL: spend fell and the cut held.
    const outcomes = [{ decisionId: 'd1', sustained: true, spendDeltaMinor: -5000, roasDelta: 0.1, windowEnd: at }];

    const inputs = buildPatternInputs({ decisions, outcomes, snapshots: [], tests: [], now: NOW });

    expect(inputs.outcomes).toEqual([{ decisionId: 'd1', success: DECISION_SUCCESS.SUCCESS }]);
    expect(inputs.outcomes[0]).not.toHaveProperty('sustained');
  });

  // THE DISCRIMINATING FIXTURE — and it has to be chosen with care. Most
  // outcomes are graded the same way by both rules, so a test built on one of
  // those passes whichever rule is in force and proves nothing. (A KILL cannot
  // discriminate: SUCCESS_PREDICATES.KILL requires `sustained !== false`, so it
  // and the old rule agree on every sustained value.)
  //
  // REALLOCATE is the clean separator: its predicate is `roasDelta >= 0` and
  // does not consult `sustained` at all. A reallocation whose new home returned
  // more, recorded with sustained:false, is:
  //
  //     canonical           → SUCCESS   (the budget moved somewhere better)
  //     sustained === true  → FAILURE
  //
  // Re-introduce the old rule anywhere on this path — engine or seam — and this
  // test fails. Verified by mutation, after an earlier version of this control
  // used a KILL and let exactly that mutation through.
  it('NC33b · grades REALLOCATE by roasDelta, not by `sustained`', () => {
    const at = daysAgo(30);
    const decisions = [{ id: 'd1', entityId: 'e1', entityLevel: 'CAMPAIGN', verdict: 'REALLOCATE', createdAt: at, humanExecutedAt: at }];
    const outcomes = [{
      decisionId: 'd1',
      roasDelta: 0.5,      // the freed budget's new home outperformed its old one
      sustained: false,    // …and the old rule would call that a failure
      spendDeltaMinor: 0,
      windowEnd: at,
    }];

    const { outcomes: evaluated } = buildPatternInputs({ decisions, outcomes, snapshots: [], tests: [], now: NOW });
    expect(evaluated[0].success).toBe(DECISION_SUCCESS.SUCCESS);
  });

  // The mirror: a KILL that stopped the bleed is right even though revenue fell
  // with it — the consequence a correct KILL is supposed to have.
  it('a correct KILL is graded right even when revenue fell with the spend', () => {
    const at = daysAgo(30);
    const decisions = [{ id: 'd1', entityId: 'e1', entityLevel: 'ADSET', verdict: 'KILL', createdAt: at, humanExecutedAt: at }];
    const outcomes = [{
      decisionId: 'd1',
      spendDeltaMinor: -12000,   // the bleed stopped
      revenueDeltaMinor: -3000,  // revenue fell too — expected for a KILL
      roasDelta: -0.2,           // and ROAS fell, which KILL is not graded on
      sustained: true,
      windowEnd: at,
    }];

    const { outcomes: evaluated } = buildPatternInputs({ decisions, outcomes, snapshots: [], tests: [], now: NOW });
    expect(evaluated[0].success).toBe(DECISION_SUCCESS.SUCCESS);
  });

  // The seam must not grow its own copy either — NC33's source half, applied to
  // the file that actually calls the evaluator.
  it('NC33c · the service reads no outcome column to decide correctness', () => {
    expect(SERVICE_SRC).not.toMatch(/sustained\s*===/);
    expect(SERVICE_SRC).not.toMatch(/\?\.sustained/);
  });

  // I46 — failures stay in the population. A mapping that turned FAILURE into
  // null would let a pattern accumulate only its wins and still call the result
  // an accuracy.
  it('I46 · a failed decision still counts, as a wrong observation', () => {
    const events = [killEvent(), killEvent(), killEvent(), killEvent()];
    const patterns = extractPatterns(engineInput(events, DECISION_SUCCESS.FAILURE));
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(fatigue.accuracy).toBe(0);          // measured, and measured as wrong
    expect(fatigue.support).toBe(4);           // still in the population
    expect(fatigue.status).toBe(PATTERN_STATUS.EMERGING);
    expect(fatigue.promotable).toBe(false);
  });
});

// ============================================================
describe('NC26 · I54 — no measured outcome, no established claim', () => {
  // NC26 exactly as specified: plenty of support, zero measurement.
  it('NC26 · support alone cannot reach ESTABLISHED', () => {
    const events = [killEvent(), killEvent(), killEvent(), killEvent(), killEvent()];
    const patterns = extractPatterns(engineInput(events, DECISION_SUCCESS.UNMEASURED));
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);

    expect(fatigue.effectiveSupport).toBeGreaterThanOrEqual(3); // support was never the problem
    expect(fatigue.accuracy).toBeNull();
    expect(fatigue.status).toBe(PATTERN_STATUS.EMERGING);
    expect(fatigue.promotable).toBe(false);
  });

  // The fabricated number. `accuracy ?? 0.5` produced a confidence of 0.5 here
  // and rendered it as "50%" on the briefing — a measurement claim backed by no
  // row in the database.
  it('NC26b · confidence is null when accuracy is unknown — never 0.5, never 0', () => {
    const events = [killEvent(), killEvent(), killEvent(), killEvent()];
    const patterns = extractPatterns(engineInput(events, DECISION_SUCCESS.UNMEASURED));
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);

    expect(fatigue.confidence).toBeNull();
    expect(fatigue.confidence).not.toBe(0.5);
    expect(fatigue.confidence).not.toBe(0); // zero is a measurement meaning "never right"
  });

  it('NC26c · no invented prior survives anywhere in the engine', () => {
    expect(ENGINE_SRC).not.toMatch(/accuracy\s*\?\?\s*0\.5/);
    expect(ENGINE_SRC).not.toMatch(/accuracy\s*\|\|\s*0\.5/);
    expect(ENGINE_SRC).not.toMatch(/accuracyFactor/);
  });

  // A measured pattern is unaffected — the fix must not cost real learning.
  it('a measured, accurate pattern still reaches ESTABLISHED and stays promotable', () => {
    const events = [killEvent(), killEvent(), killEvent(), killEvent()];
    const patterns = extractPatterns(engineInput(events, DECISION_SUCCESS.SUCCESS));
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);

    expect(fatigue.accuracy).toBe(1);
    expect(fatigue.confidence).toBeGreaterThan(0);
    expect(fatigue.status).toBe(PATTERN_STATUS.ESTABLISHED);
    expect(fatigue.promotable).toBe(true);
  });

  // Determinism must survive the null: a NaN comparator leaves Array.sort in
  // input order, which would silently make the output depend on DB row order.
  it('sorting stays deterministic with unmeasured patterns present', () => {
    const measured   = [killEvent(3.5), killEvent(3.5), killEvent(3.6), killEvent(3.4)];
    const input = engineInput(measured, DECISION_SUCCESS.SUCCESS);
    const a = extractPatterns(input).map((p) => p.key);
    const b = extractPatterns({ ...input, decisions: [...input.decisions] }).map((p) => p.key);
    expect(a).toEqual(b);
  });
});

// ============================================================
describe('NC28 · F10 — the audience dimension is not pretended into existence', () => {
  // The spec's alternative branch: the field was found to be obsolete legacy
  // logic (no column on Decision, no producer anywhere in the system), so the
  // control proves no dead reference remains rather than proving it flows.
  it('NC28 · nothing reads audienceTag off a decision', () => {
    expect(ENGINE_SRC).not.toMatch(/d\.audienceTag/);
    expect(ENGINE_SRC).not.toMatch(/decision\.audienceTag/);
    expect(SERVICE_SRC).not.toMatch(/d\.audienceTag/);
  });

  // The KEY SHAPE is preserved on purpose. patternKey is the durable identity of
  // an AccountPattern row; re-spelling it would orphan every learned pattern and
  // silently re-mint them as new, unpromoted rows.
  it('NC28b · the pattern key keeps its audience segment, so existing rows are not orphaned', () => {
    const events = [killEvent(), killEvent(), killEvent()];
    const patterns = extractPatterns(engineInput(events, DECISION_SUCCESS.SUCCESS));
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(fatigue.key).toBe('FATIGUE|ADSET|null|KILL');
  });
});

// ============================================================
describe('NC27 · I49 — extraction is idempotent and concurrency-safe', () => {
  const twoKills = [
    { id: 'd1', entityId: 'e1', entityLevel: 'ADSET', verdict: 'KILL', createdAt: daysAgo(30), humanExecutedAt: daysAgo(30) },
    { id: 'd2', entityId: 'e2', entityLevel: 'ADSET', verdict: 'KILL', createdAt: daysAgo(28), humanExecutedAt: daysAgo(28) },
    { id: 'd3', entityId: 'e3', entityLevel: 'ADSET', verdict: 'KILL', createdAt: daysAgo(26), humanExecutedAt: daysAgo(26) },
  ];
  const snaps = twoKills.map((d, i) => ({
    entityId: d.entityId, date: d.createdAt, frequency: 3.5 + i * 0.1, roas: 0.7, ctr: 0.5, spendMinor: 1000,
  }));

  const primeReal = () => {
    prisma.decision.findMany.mockResolvedValue(twoKills);
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps);
    prisma.outcomeSnapshot.findMany.mockResolvedValue(
      twoKills.map((d) => ({ decisionId: d.id, sustained: true, spendDeltaMinor: -100, roasDelta: 0.1, windowEnd: daysAgo(20) })),
    );
  };

  // NC27 — the P2002 control. The old shape read the existing rows, minted a
  // randomUUID for every key it did not find, then createMany'd. Two overlapping
  // extractions both saw the key as absent, both minted a DIFFERENT id, and the
  // second insert violated @@unique([workspaceId, patternKey]) — a 500 on the
  // briefing. upsert on the natural key removes the race instead of catching it.
  it('NC27 · persists patterns by their natural key, never by a freshly minted id', async () => {
    primeReal();
    await getBriefing(WS, { now: NOW });

    expect(prisma.accountPattern.upsert).toHaveBeenCalled();
    const call = prisma.accountPattern.upsert.mock.calls[0][0];
    expect(call.where).toHaveProperty('workspaceId_patternKey');
    expect(call.where.workspaceId_patternKey.workspaceId).toBe(WS);
    // The identity that survives a race is the KEY, not the uuid.
    expect(typeof call.where.workspaceId_patternKey.patternKey).toBe('string');
  });

  // `skipDuplicates` on the pattern rows was rejected deliberately: it would
  // resolve the crash by DISCARDING the newer derived state the losing run had
  // just computed — a pattern frozen at its first-ever accuracy, forever.
  it('NC27b · does not paper over the collision with skipDuplicates on pattern rows', () => {
    expect(SERVICE_SRC).not.toMatch(/accountPattern\.createMany/);
    // Observations are a different case and legitimately use it — a repeated
    // observation of the same occurrence carries no new information.
    expect(SERVICE_SRC).toMatch(/patternObservation\.createMany\([^)]*skipDuplicates/s);
  });

  it('NC27c · two sequential extractions produce the same pattern identity', async () => {
    primeReal();
    await getBriefing(WS, { now: NOW });
    const first = prisma.accountPattern.upsert.mock.calls.map(([c]) => c.where.workspaceId_patternKey.patternKey);

    prisma.accountPattern.upsert.mockClear();
    await getBriefing(WS, { now: NOW });
    const second = prisma.accountPattern.upsert.mock.calls.map(([c]) => c.where.workspaceId_patternKey.patternKey);

    expect(second).toEqual(first);
  });

  // Re-extraction must never unlink a pattern an operator promoted to a
  // guardrail: promotedRuleId is the provenance the Playbook depends on.
  it('NC27d · re-extraction never overwrites promotion provenance', async () => {
    primeReal();
    await getBriefing(WS, { now: NOW });
    for (const [args] of prisma.accountPattern.upsert.mock.calls) {
      expect(args.update).not.toHaveProperty('promotedRuleId');
      expect(args.create).not.toHaveProperty('promotedRuleId');
    }
  });

  it('the whole persistence pass runs inside one transaction', async () => {
    primeReal();
    await getBriefing(WS, { now: NOW });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});
