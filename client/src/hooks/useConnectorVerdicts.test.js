// ============================================================
// useConnectorVerdicts — C-03: the history's availability survives the hook
// ------------------------------------------------------------
// This file exists for one seam. `decisionHistoryStatus` is the answer to "did
// we manage to read this campaign's past decisions", and a hook that drops it
// would leave the backend telling a truth nobody hears — the exact failure this
// programme keeps finding, where a distinction is written with care and read by
// no one.
//
// Scope is deliberately narrow: the rest of this hook's payload is covered by
// the surfaces that consume it, and widening here would turn one seam into a
// second contract for the whole verdict feed.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConnectorVerdicts } from './useConnectorVerdicts.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const payload = (over = {}) => ({
  budgetDistribution: { status: 'EMPTY', reason: 'NO_SCORED_SPEND', currency: null,
    totalSpendMinor: null, killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null,
    killPct: null, holdPct: null, scalePct: null },
  verdicts: [{ id: 'c1', name: 'Campaign', verdict: 'KILL' }],
  gatedOut: [],
  account: { verdict: 'WATCH', confidence: 0.5 },
  memoryByEntityId: {},
  decisionHistoryStatus: 'OK',
  status: 'OK',
  ...over,
});

describe('SC-17A distribution contract and recovery', () => {
  beforeEach(() => vi.clearAllMocks());
  const distribution = { status: 'AVAILABLE', reason: null, currency: 'EGP', totalSpendMinor: 1000,
    killSpendMinor: 250, holdSpendMinor: 500, scaleSpendMinor: 250,
    killPct: 24.99, holdPct: 50.02, scalePct: 24.99 };
  it('exposes the backend projection without reinterpreting amounts or percentages', async () => {
    const result = await load(payload({ budgetDistribution: distribution }));
    expect(result.current.budgetDistribution).toEqual(distribution);
  });
  it.each([undefined, {}, { ...distribution, killPct: null }, { ...distribution, status: 'EMPTY' }])
  ('missing/malformed projection is a contract error: %j', async (budgetDistribution) => {
    const result = await load(payload({ budgetDistribution }));
    expect(result.current.error?.message).toMatch(/contract validation/i);
    expect(result.current.budgetDistribution).toBeNull();
  });
  it('clears prior truth immediately at retry and keeps it cleared after failure', async () => {
    api.get.mockResolvedValueOnce({ data: payload({ budgetDistribution: distribution }) });
    const { result } = renderHook(() => useConnectorVerdicts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.budgetDistribution).toEqual(distribution);
    let reject;
    api.get.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    let pending;
    act(() => { pending = result.current.refetch(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.budgetDistribution).toBeNull();
    await act(async () => { reject(new Error('network')); await pending; });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.budgetDistribution).toBeNull();
  });
});

const load = async (data) => {
  api.get.mockResolvedValue({ data });
  const { result } = renderHook(() => useConnectorVerdicts());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

describe('useConnectorVerdicts · history availability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes the status the server sent', async () => {
    const result = await load(payload());
    expect(result.current.decisionHistoryStatus).toBe('OK');
    expect(result.current.memory).toEqual({});
  });

  // The pair the whole slice is about. Identical `memory`, different truth —
  // so a consumer reading only `memory` is reading a coin flip.
  it('carries HISTORY_UNAVAILABLE through unchanged', async () => {
    const result = await load(payload({ decisionHistoryStatus: 'HISTORY_UNAVAILABLE' }));
    expect(result.current.decisionHistoryStatus).toBe('HISTORY_UNAVAILABLE');
    expect(result.current.memory).toEqual({});
    // History is context, not the call: the verdicts still arrive.
    expect(result.current.verdicts).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  // Additive on the wire. A response from before the field existed, or one that
  // lost it in transit, must not start claiming an outage — null is "no answer
  // to that question", which the view model treats exactly as OK.
  it('is null when the server said nothing about it', async () => {
    const { decisionHistoryStatus, ...older } = payload();
    const result = await load(older);
    expect(result.current.decisionHistoryStatus).toBeNull();
  });

  // A failed REQUEST is a different failure, already owned by `error`. The
  // status describes a read that the server performed and reported on; there is
  // no server answer to report here, and inventing one would name the wrong
  // outage on screen.
  it('a dead request leaves the status null and sets error', async () => {
    api.get.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useConnectorVerdicts());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.decisionHistoryStatus).toBeNull();
  });
});

// ── C-06 · the token travels, and the name is no longer rewritten ───────────
describe('useConnectorVerdicts · epistemic knowledge (C-06)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes the knowledge token beside the status', async () => {
    const result = await load(payload({
      decisionHistoryStatus: 'HISTORY_UNAVAILABLE',
      decisionHistoryKnowledge: 'COULD_NOT_LOOK',
    }));
    expect(result.current.decisionHistoryStatus).toBe('HISTORY_UNAVAILABLE');
    expect(result.current.decisionHistoryKnowledge).toBe('COULD_NOT_LOOK');
  });

  it('does not rename the field to memoryStatus', async () => {
    // THE DEFECT THIS SLICE WAS SHAPED ON. The server spells this out in full
    // because two different things in that payload wear the word "memory"; the
    // hook used to shorten it back to `memoryStatus` on arrival, re-collapsing
    // the distinction three files downstream of the comment forbidding it.
    const result = await load(payload());
    expect(result.current).not.toHaveProperty('memoryStatus');
    expect(result.current).toHaveProperty('decisionHistoryStatus');
  });

  it('leaves the token null when the server sent none, and does not infer one', async () => {
    // An older payload has made no claim about knowledge. Deriving KNOWN from
    // a bare 'OK' here would be this client inventing an epistemic assertion
    // the server never made.
    const result = await load(payload());
    expect(result.current.decisionHistoryStatus).toBe('OK');
    expect(result.current.decisionHistoryKnowledge).toBeNull();
  });
});

// ── PARITY-04 · the boundary parse, at the hook ─────────────────────────────
// The middle link of the chain. The schema is proved in
// contracts/schemas/connectorCampaigns.schema.test.ts and the consequence in
// features/campaigns/__tests__/campaignsSubstrateParity.test.jsx; this proves
// the hook actually runs the one and produces the input for the other.
describe('useConnectorVerdicts · a malformed 200 is an error, never an empty verdict set', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a MISSING verdicts collection sets error and does not pretend to be empty', async () => {
    const { verdicts, ...noCollection } = payload();
    expect(verdicts).toBeDefined();
    const r = await load(noCollection);
    expect(r.current.error).toBeTruthy();
    expect(r.current.error.message).toMatch(/contract validation/i);
    expect(r.current.verdicts).toEqual([]);
  });

  it('a MISSING gatedOut collection is its own error', async () => {
    const { gatedOut, ...noGated } = payload();
    expect(gatedOut).toBeDefined();
    const r = await load(noGated);
    expect(r.current.error).toBeTruthy();
  });

  it('an UNKNOWN verdict value is an error, not a silently dropped row', async () => {
    const r = await load(payload({ verdicts: [{ id: 'c1', name: 'C', verdict: 'PAUSE' }] }));
    expect(r.current.error).toBeTruthy();
    expect(r.current.verdicts).toEqual([]);
  });

  it('a WRONG-TYPE field is an error', async () => {
    const r = await load(payload({ verdicts: [{ id: 'c1', verdict: 'KILL', confidence: 'high' }] }));
    expect(r.current.error).toBeTruthy();
  });

  // ── self-refutation: the genuine empty is NOT an error ────────────────────
  it('a VALID empty payload is a measured empty set, with no error', async () => {
    const r = await load(payload({ verdicts: [], gatedOut: [] }));
    expect(r.current.error).toBeNull();
    expect(r.current.verdicts).toEqual([]);
    expect(r.current.gatedOut).toEqual([]);
  });

  it('…and a valid populated payload still arrives intact', async () => {
    const r = await load(payload());
    expect(r.current.error).toBeNull();
    expect(r.current.verdicts).toHaveLength(1);
    expect(r.current.verdicts[0].verdict).toBe('KILL');
  });
});
