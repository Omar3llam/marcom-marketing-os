// ============================================================
// C-07 · test 9 — a different reason produces a different next action
// ============================================================
// THE LOCK OF THE SLICE. Before C-07 the client discarded `reason` at the door
// and printed one sentence — "N campaigns need revenue data" — over three
// absences whose fixes are add revenue / run a first sync / re-sync. Two of the
// three operators were told to do the wrong thing. These tests make that
// unrepeatable.
// ============================================================
import { describe, it, expect } from 'vitest';
import { GATING_REASON, GATING_REASON_VALUES } from '@marcom/runtime-contracts';
import { gatingCopyFor, summarizeGatedOut, gatedRationale } from './gatingReasonCopy.js';

const GUIDANCE = 'connect GA4 so revenue lands with the spend';

describe('C-07 · every reason speaks for itself', () => {
  it('gives each reason its own sentence and its own next action', () => {
    const sentences = GATING_REASON_VALUES.map((r) => gatingCopyFor(r, { revenueGuidance: GUIDANCE }));
    expect(new Set(sentences.map((s) => s.label)).size).toBe(GATING_REASON_VALUES.length);
    expect(new Set(sentences.map((s) => s.action)).size).toBe(GATING_REASON_VALUES.length);
  });

  it('names revenue for exactly ONE reason — the only one revenue would fix', () => {
    const mentionsRevenue = GATING_REASON_VALUES.filter((r) => {
      const { label, action } = gatingCopyFor(r, { revenueGuidance: GUIDANCE });
      return /revenue/i.test(`${label} ${action}`);
    });
    expect(mentionsRevenue).toEqual([GATING_REASON.NO_MEASURABLE_DELIVERY]);
  });

  it('points the two measurement gates at a sync, and only one of them at a FIRST sync', () => {
    const first = gatingCopyFor(GATING_REASON.NO_CANONICAL_WINDOW, {});
    const fresh = gatingCopyFor(GATING_REASON.CANONICAL_EVIDENCE_STALE, {});
    expect(first.action).toMatch(/sync/i);
    expect(fresh.action).toMatch(/sync/i);
    expect(first.action).not.toBe(fresh.action);
  });

  it('invents no instruction for a reason it does not recognise', () => {
    // An older or newer payload must degrade to silence about the fix, never to
    // a confident wrong one. This is the C-03/C-04 rule applied to reasons.
    const unknown = gatingCopyFor('SOMETHING_THIS_BUILD_HAS_NEVER_SEEN', { revenueGuidance: GUIDANCE });
    expect(unknown.action).toBeNull();
    expect(unknown.label).toBeTruthy();
    expect(unknown.label).not.toMatch(/revenue/i);
  });
});

describe('C-07 · the summary groups by reason instead of counting to one number', () => {
  const gatedOut = [
    { id: '1', name: 'A', reason: GATING_REASON.NO_MEASURABLE_DELIVERY },
    { id: '2', name: 'B', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 42, maxAgeDays: 3 },
    { id: '3', name: 'C', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 9, maxAgeDays: 3 },
    { id: '4', name: 'D', reason: GATING_REASON.NO_CANONICAL_WINDOW },
  ];

  it('returns one group per reason, with its own count and sentence', () => {
    const groups = summarizeGatedOut(gatedOut, { revenueGuidance: GUIDANCE });
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.reason === GATING_REASON.CANONICAL_EVIDENCE_STALE).count).toBe(2);
    expect(new Set(groups.map((g) => g.sentence)).size).toBe(3);
  });

  it('never produces a single undifferentiated total', () => {
    const groups = summarizeGatedOut(gatedOut, {});
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(4);
    expect(groups.length).toBeGreaterThan(1);
  });

  it('groups an unrecognised reason on its own rather than folding it into a known one', () => {
    const groups = summarizeGatedOut([...gatedOut, { id: '5', name: 'E', reason: 'NEW_GATE' }], {});
    expect(groups).toHaveLength(4);
  });

  it('is empty for an empty or absent list', () => {
    expect(summarizeGatedOut([], {})).toEqual([]);
    expect(summarizeGatedOut(undefined, {})).toEqual([]);
  });
});

describe('C-07 · the PDF rationale carries the reason, and the stale row carries its age', () => {
  it('states the age and the threshold the backend already published', () => {
    const line = gatedRationale({
      id: '2', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 42, maxAgeDays: 3,
    });
    expect(line).toMatch(/42/);
    expect(line).toMatch(/3/);
    expect(line).not.toMatch(/revenue/i);
  });

  it('says "add revenue" only for the reason revenue would fix', () => {
    expect(gatedRationale({ id: '1', reason: GATING_REASON.NO_MEASURABLE_DELIVERY })).toMatch(/revenue/i);
    expect(gatedRationale({ id: '4', reason: GATING_REASON.NO_CANONICAL_WINDOW })).not.toMatch(/revenue/i);
  });

  it('degrades honestly on an unknown reason', () => {
    const line = gatedRationale({ id: '9', reason: 'NEW_GATE' });
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/revenue/i);
  });
});
