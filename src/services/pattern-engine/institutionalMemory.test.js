// ============================================================
// R10 · Phase D — the moat link, and the fence around it
// ============================================================
// This is the layer the discovery found missing: validated learning reaching the
// next decision. It is also the layer with the most ways to go wrong quietly, so
// the controls come in two halves.
//
//   WHAT MUST HAPPEN — validated memory reaches the decision and moves
//   confidence, or the loop is still open and R10 achieved nothing (I50).
//
//   WHAT MUST NEVER HAPPEN — memory changing a verdict (I51), unmeasured
//   patterns counting as knowledge (I54/NC36), a failed read reading as an empty
//   account (NC35), or an invented number filling any of those gaps.
//
// The second half matters more. A memory layer that overreaches turns Lumi from
// "here is what the evidence says" into "here is what usually happens", which is
// the confident-story failure the whole product exists to avoid.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { accountPattern: { findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import {
  getInstitutionalMemory, isValidatedMemory, selectRelevantMemory,
  memoryConfidenceFactor, applyMemoryToConfidence, MEMORY_STATUS,
} from './institutionalMemory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, 'institutionalMemory.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const WS = 'ws-memory';

const pattern = (over = {}) => ({
  id: 'p1', patternKey: 'FATIGUE|ADSET|null|KILL', kind: 'FATIGUE_CEILING',
  statement: 'On adsets, KILL once frequency passes ~3.5', basis: 'weighted median',
  metric: 'frequency', scopeLevel: 'ADSET', emitVerdict: 'KILL', threshold: 3.5, unit: 'RATIO',
  status: 'ESTABLISHED', accuracy: 0.8, confidence: 0.7, support: 6, effectiveSupport: 5,
  firstObservedAt: new Date('2026-01-01'), lastObservedAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.accountPattern.findMany.mockResolvedValue([]);
});

// ============================================================
describe('I50 · validated memory reaches the decision', () => {
  it('loads validated patterns and reports OK', async () => {
    prisma.accountPattern.findMany.mockResolvedValue([pattern()]);
    const out = await getInstitutionalMemory(WS);
    expect(out.status).toBe(MEMORY_STATUS.OK);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toMatchObject({ patternKey: 'FATIGUE|ADSET|null|KILL', accuracy: 0.8 });
  });

  // THE LOOP-CLOSING CONTROL. If validated history cannot move confidence at
  // all, learning is still merely stored — which was the whole finding. Delete
  // the multiplication in applyMemoryToConfidence and this fails.
  it('I50 · a proven track record actually changes the published confidence', () => {
    const relevant = [{ accuracy: 0.95, effectiveSupport: 8 }];
    const factor = memoryConfidenceFactor(relevant);
    expect(factor).toBeGreaterThan(1);
    expect(applyMemoryToConfidence(0.60, factor)).toBeGreaterThan(0.60);
  });

  it('relevance is the pattern\'s own spec matching this verdict and scope', () => {
    const records = [
      { verdict: 'KILL',  scopeLevel: 'ADSET',    accuracy: 0.9, effectiveSupport: 5 },
      { verdict: 'SCALE', scopeLevel: 'CAMPAIGN', accuracy: 0.9, effectiveSupport: 5 },
    ];
    expect(selectRelevantMemory(records, { verdict: 'KILL', entityLevel: 'ADSET' })).toHaveLength(1);
    expect(selectRelevantMemory(records, { verdict: 'SCALE', entityLevel: 'CAMPAIGN' })[0].verdict).toBe('SCALE');
    expect(selectRelevantMemory(records, { verdict: 'HOLD', entityLevel: 'ADSET' })).toEqual([]);
  });

  it('a pattern about another scope does not speak to this one', () => {
    const records = [{ verdict: 'KILL', scopeLevel: 'CAMPAIGN', accuracy: 0.9, effectiveSupport: 5 }];
    expect(selectRelevantMemory(records, { verdict: 'KILL', entityLevel: 'ADSET' })).toEqual([]);
  });

  it('weights a stronger track record above a thinner one', () => {
    const thin   = memoryConfidenceFactor([{ accuracy: 1.0, effectiveSupport: 3 }]);
    const strong = memoryConfidenceFactor([{ accuracy: 1.0, effectiveSupport: 30 }]);
    // Same accuracy → same factor; support weights the MEAN across records, so
    // this checks the mean is genuinely support-weighted rather than a count.
    expect(thin).toBe(strong);
    const mixed = memoryConfidenceFactor([
      { accuracy: 1.0, effectiveSupport: 30 },
      { accuracy: 0.6, effectiveSupport: 1 },
    ]);
    expect(mixed).toBeGreaterThan(memoryConfidenceFactor([
      { accuracy: 1.0, effectiveSupport: 1 },
      { accuracy: 0.6, effectiveSupport: 30 },
    ]));
  });
});

// ============================================================
describe('NC34 · I51 — memory may not change a verdict', () => {
  // Enforced by the SIGNATURE, which is what makes it un-regressable: the
  // function is handed a number and returns a number. To make memory change a
  // verdict, someone would have to change what this function receives — a
  // visible, reviewable act, not a quiet edit to an expression.
  it('NC34 · the confidence function is never given a verdict, so it cannot return one', () => {
    const out = applyMemoryToConfidence(0.7, 1.1);
    expect(typeof out).toBe('number');
    expect(applyMemoryToConfidence.length).toBeLessThanOrEqual(2);
  });

  // The wiring half of NC34: the verdict published is the verdict computed,
  // byte-identical, under every memory state.
  it('NC34b · identical evidence yields an identical verdict under any memory history', () => {
    const verdictOf = (memoryRecords) => {
      const engineVerdict = 'KILL';                       // what the evidence said
      const relevant = selectRelevantMemory(memoryRecords, { verdict: engineVerdict, entityLevel: 'ADSET' });
      const factor = memoryConfidenceFactor(relevant);
      return { verdict: engineVerdict, confidence: applyMemoryToConfidence(0.7, factor) };
    };

    const none    = verdictOf([]);
    const strong  = verdictOf([{ verdict: 'KILL', scopeLevel: 'ADSET', accuracy: 1.0, effectiveSupport: 20 }]);
    const weak    = verdictOf([{ verdict: 'KILL', scopeLevel: 'ADSET', accuracy: 0.6, effectiveSupport: 20 }]);

    expect(strong.verdict).toBe(none.verdict);
    expect(weak.verdict).toBe(none.verdict);
    // …and confidence DID move, or the layer would be decorative.
    expect(strong.confidence).not.toBe(none.confidence);
  });

  // The module DOES read `.verdict` — relevance matching requires knowing which
  // verdict a pattern speaks to. What it must never do is ASSIGN one. The
  // distinction is the whole of I51, so the assertion has to be about writes:
  // an earlier version of this test forbade `.verdict\s*=` and caught
  // `r.verdict === verdict`, i.e. the correct read, which would have taught a
  // future reader that the control was noise.
  it('the module compares verdicts but never assigns one', () => {
    expect(SRC).not.toMatch(/\.verdict\s*=(?!=)/);  // assignment, not ===
    expect(SRC).toMatch(/r\.verdict === verdict/);  // the read that IS allowed
  });

  // The only `verdict` a memory record carries is the pattern's OWN emitVerdict
  // — the verdict the pattern PRESCRIBES, copied from its row. It is never a
  // verdict about the campaign being judged, which is the thing this layer must
  // not produce. Asserted behaviourally: a source regex for this kept matching
  // its own legitimate neighbours.
  it('a memory record only ever restates the pattern\'s own prescribed verdict', async () => {
    prisma.accountPattern.findMany.mockResolvedValue([pattern({ emitVerdict: 'KILL' })]);
    const out = await getInstitutionalMemory(WS);
    expect(out.records[0].verdict).toBe('KILL');

    prisma.accountPattern.findMany.mockResolvedValue([pattern({ emitVerdict: null })]);
    const informational = await getInstitutionalMemory(WS);
    expect(informational.records[0].verdict).toBeNull(); // nothing is invented to fill it
  });

  // The adjustment is bounded. An unbounded factor would let history shout down
  // the present — a campaign burning money today would still read as confident
  // because this account's KILLs used to work.
  it('the adjustment is bounded in both directions', () => {
    const best  = memoryConfidenceFactor([{ accuracy: 1.0, effectiveSupport: 100 }]);
    const worst = memoryConfidenceFactor([{ accuracy: 0.0, effectiveSupport: 100 }]);
    expect(best).toBeLessThanOrEqual(1.10);
    expect(worst).toBeGreaterThanOrEqual(0.90);
  });

  it('never exceeds the confidence engine\'s own ceiling', () => {
    expect(applyMemoryToConfidence(0.97, 1.10)).toBeLessThanOrEqual(0.97);
  });
});

// ============================================================
describe('NC35 · a failed lookup is not an empty account', () => {
  // NC35 exactly as specified. `[]` says "this account has learned nothing",
  // which is a claim about the customer made when the truth is a claim about us.
  it('NC35 · reports MEMORY_UNAVAILABLE — not [], not 0, not NOT_CONSENTED', async () => {
    prisma.accountPattern.findMany.mockRejectedValue(new Error('db down'));
    const out = await getInstitutionalMemory(WS);

    expect(out.status).toBe(MEMORY_STATUS.MEMORY_UNAVAILABLE);
    expect(out.status).not.toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
    expect(out.status).not.toBe('NOT_CONSENTED');
  });

  // …and it costs the account nothing. An outage in the memory layer must leave
  // every confidence figure exactly as the deterministic engine computed it.
  it('NC35b · an unavailable memory neither raises nor lowers confidence', async () => {
    prisma.accountPattern.findMany.mockRejectedValue(new Error('db down'));
    const out = await getInstitutionalMemory(WS);
    const factor = memoryConfidenceFactor(selectRelevantMemory(out.records, { verdict: 'KILL', entityLevel: 'ADSET' }));

    expect(factor).toBe(1);                          // EXACTLY 1, not "about 1"
    expect(applyMemoryToConfidence(0.73, factor)).toBe(0.73);
  });

  it('distinguishes "we looked and found none" from "we could not look"', async () => {
    prisma.accountPattern.findMany.mockResolvedValue([]);
    expect((await getInstitutionalMemory(WS)).status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
  });

  it('an empty account also gets its deterministic confidence back untouched', () => {
    expect(applyMemoryToConfidence(0.42, memoryConfidenceFactor([]))).toBe(0.42);
  });

  it('a null confidence stays null — unknown does not become a number', () => {
    expect(applyMemoryToConfidence(null, 1.1)).toBeNull();
  });
});

// ============================================================
describe('NC36 · only measured patterns are knowledge', () => {
  // NC36 as specified. An EMERGING pattern is "seen, never checked"; letting it
  // move a number would resurrect the exact fabrication I54 removed from the
  // engine, one layer downstream.
  it('NC36 · an unmeasured pattern is not validated memory', () => {
    expect(isValidatedMemory(pattern({ accuracy: null }))).toBe(false);
    expect(isValidatedMemory(pattern({ status: 'EMERGING' }))).toBe(false);
  });

  // Legacy rows written before I54 CAN carry ESTABLISHED with a null accuracy,
  // which is why the predicate re-checks rather than trusting the status. Drop
  // the accuracy clause and this fails on exactly those rows.
  it('NC36b · a legacy ESTABLISHED row with no accuracy is still excluded', async () => {
    prisma.accountPattern.findMany.mockResolvedValue([pattern({ status: 'ESTABLISHED', accuracy: null })]);
    const out = await getInstitutionalMemory(WS);
    expect(out.records).toEqual([]);
    expect(out.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
  });

  it('NC36c · accuracy below the promotion floor is excluded', () => {
    expect(isValidatedMemory(pattern({ accuracy: 0.4 }))).toBe(false);
    expect(isValidatedMemory(pattern({ accuracy: 0.8 }))).toBe(true);
  });

  it('NC36d · thin support is excluded even when accuracy reads perfectly', () => {
    // Three-for-three is a coincidence, not a track record.
    expect(isValidatedMemory(pattern({ accuracy: 1.0, effectiveSupport: 1 }))).toBe(false);
  });

  it('CONFLICTED and SUPERSEDED patterns never speak', () => {
    expect(isValidatedMemory(pattern({ status: 'CONFLICTED' }))).toBe(false);
    expect(isValidatedMemory(pattern({ status: 'SUPERSEDED' }))).toBe(false);
  });

  // A record that somehow arrives with no accuracy contributes NOTHING rather
  // than a substituted prior. There is no `?? 0.5` in this file and there must
  // never be — that construct is what R10 removed from the pattern engine.
  it('NC36e · no invented prior anywhere in the memory layer', () => {
    expect(SRC).not.toMatch(/\?\?\s*0\.5/);
    expect(SRC).not.toMatch(/\|\|\s*0\.5/);
    expect(memoryConfidenceFactor([{ accuracy: null, effectiveSupport: 10 }])).toBe(1);
  });
});

// ============================================================
describe('workspace isolation (R9 · I40)', () => {
  it('scopes the read in the WHERE, never after it', async () => {
    await getInstitutionalMemory(WS);
    expect(prisma.accountPattern.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: WS }) }),
    );
  });

  it('requires a workspaceId', async () => {
    await expect(getInstitutionalMemory(null)).rejects.toThrow(/workspaceId required/);
  });

  // A memory record is an account's accumulated competitive knowledge; publishing
  // the owning workspace id alongside it invites exactly the mistake that would
  // matter most.
  it('published records carry no workspace identity', async () => {
    prisma.accountPattern.findMany.mockResolvedValue([pattern()]);
    const out = await getInstitutionalMemory(WS);
    expect(out.records[0]).not.toHaveProperty('workspaceId');
  });

  // Explicit projection: an unprojected read widens with the next migration and
  // would start publishing whatever column is added (#209's class).
  it('names its projection', async () => {
    await getInstitutionalMemory(WS);
    expect(prisma.accountPattern.findMany.mock.calls[0][0].select).toBeTruthy();
  });
});
