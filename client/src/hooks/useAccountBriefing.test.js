// ============================================================
// useAccountBriefing — ACROSS Tier 1: a parse failure is an inability to know
// ------------------------------------------------------------
// What stood at this seam was a SALVAGE: on a contract mismatch the hook
// console.warn'd, rebuilt a briefing out of the unvalidated raw payload, and
// left `error` null.
//
//     setBriefing({
//       patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
//       promotableCount: Number.isInteger(raw.promotableCount) ? raw.promotableCount : 0,
//       conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
//       network: raw.network ?? null,
//     });
//
// Its own header three lines above said "never fabricate".
//
// RULING (Omar): a contract parse failure is an inability to know, never an
// empty result. No salvage. No fabricated defaults.
//
// The CONSEQUENCE is proved in features/memory/__tests__/memorySubstrateParity
// .test.jsx — this file proves the seam that makes the consequence possible.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAccountBriefing } from './useAccountBriefing.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const pattern = (over = {}) => ({
  id: 'p1', kind: 'FATIGUE_CEILING', statement: 'Video creative fatigues after 9 days',
  support: 4, effectiveSupport: 3.2, accuracy: 0.8, confidence: 0.72, status: 'ESTABLISHED',
  ...over,
});

const payload = (over = {}) => ({
  workspaceId: 'ws', generatedAt: '2026-09-08T00:00:00.000Z',
  patterns: [pattern()], promotableCount: 1, conflicts: [],
  network: { status: 'NOT_CONSENTED' },
  ...over,
});

const load = async (data) => {
  api.get.mockResolvedValue({ data });
  const { result } = renderHook(() => useAccountBriefing());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

describe('useAccountBriefing · a malformed 200 is an error, never an empty memory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a MISSING patterns collection sets error and fabricates nothing', async () => {
    const { patterns, ...noPatterns } = payload();
    expect(patterns).toBeDefined();
    const r = await load(noPatterns);
    expect(r.current.error).toBeTruthy();
    expect(r.current.error.message).toMatch(/contract validation/i);
    // The salvage used to hand the view a briefing OBJECT here, which is what
    // made "No established patterns yet" renderable from an unreadable read.
    expect(r.current.briefing).toBeNull();
  });

  it('a missing promotableCount is an error, not a fabricated zero', async () => {
    const { promotableCount, ...noCount } = payload();
    expect(promotableCount).toBeDefined();
    const r = await load(noCount);
    expect(r.current.error).toBeTruthy();
    expect(r.current.briefing).toBeNull();
  });

  it('a pattern row missing its IDENTITY is an error', async () => {
    const { id, ...noId } = pattern();
    expect(id).toBeDefined();
    const r = await load(payload({ patterns: [noId] }));
    expect(r.current.error).toBeTruthy();
  });

  it('a WRONG-TYPE confidence is an error, not a rendered string', async () => {
    const r = await load(payload({ patterns: [pattern({ confidence: '0.72' })] }));
    expect(r.current.error).toBeTruthy();
  });

  it('a missing network object is an error — it is a required part of the contract', async () => {
    const { network, ...noNetwork } = payload();
    expect(network).toBeDefined();
    const r = await load(noNetwork);
    expect(r.current.error).toBeTruthy();
  });

  // ── the vocabulary the server actually publishes ──────────────────────────
  it('UNAVAILABLE is a first-class status, not a parse failure', async () => {
    // A CONSENTED workspace whose cohort cannot be established. Before this
    // slice the client enum had never heard of it, so the WHOLE briefing failed
    // to parse and the salvage silently took over.
    const r = await load(payload({ network: { status: 'UNAVAILABLE', knowledge: 'COULD_NOT_LOOK' } }));
    expect(r.current.error).toBeNull();
    expect(r.current.briefing.network.status).toBe('UNAVAILABLE');
  });

  it('…and the C-06 knowledge token survives the parse rather than being stripped', async () => {
    const r = await load(payload({ network: { status: 'UNAVAILABLE', knowledge: 'COULD_NOT_LOOK' } }));
    expect(r.current.briefing.network.knowledge).toBe('COULD_NOT_LOOK');
  });

  // ── self-refutation: absence and emptiness are still allowed ──────────────
  it('a VALID empty briefing is a measured empty memory, with no error', async () => {
    const r = await load(payload({ patterns: [], promotableCount: 0 }));
    expect(r.current.error).toBeNull();
    expect(r.current.briefing.patterns).toEqual([]);
  });

  it('…and a valid populated briefing still arrives intact', async () => {
    const r = await load(payload());
    expect(r.current.error).toBeNull();
    expect(r.current.briefing.patterns).toHaveLength(1);
    expect(r.current.briefing.promotableCount).toBe(1);
  });
});
