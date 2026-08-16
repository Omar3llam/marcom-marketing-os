// ============================================================
// R7 — the sidebar states what the server decided, and nothing else
// ============================================================
// This file used to pin the OPPOSITE behaviour, and it is worth being explicit
// about what it asserted, because it passed the whole time:
//
//   expect(decision.campaign).toBe('Unknown');
//   expect(decision.verdict).toBe('TEST');
//   expect(decision.timestamp).toBe('recent');
//
// A malformed row produced a campaign called "Unknown", a verdict of TEST that
// no engine issued, and a timestamp asserting recency nobody measured. The test
// called this "falls back safely". It was a test for fabrication.
//
// What replaces it: every field comes off a real Decision row, and an absent
// field stays absent.
// ============================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ api: { get } }));

import { toSidebarDecision, fetchRecentDecisions } from './services.js';

describe('R7 — the sidebar reads the canonical endpoint', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: { decisions: [] } });
  });

  it('calls GET /api/lumi/decisions/recent', async () => {
    await fetchRecentDecisions();
    expect(get).toHaveBeenCalledWith('/api/lumi/decisions/recent');
  });

  it('NEVER calls the retired memory endpoints', async () => {
    // Without this, repointing the URL back to /api/memory/patterns passes every
    // other test in this file — they all exercise the pure mapper and never see
    // the request. The endpoint is the whole migration.
    await fetchRecentDecisions();
    const url = get.mock.calls[0][0];
    expect(url).not.toContain('/api/memory');
    expect(url).not.toContain('/api/decision-memory');
  });

  it('maps the `decisions` payload, not a `narratives` one', async () => {
    get.mockResolvedValue({ data: { decisions: [
      { id: 'd1', campaign: 'Summer', verdict: 'KILL', decidedAt: new Date().toISOString() },
    ] } });
    const out = await fetchRecentDecisions();
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('KILL');
  });

  it('an absent payload is an empty list, never a placeholder row', async () => {
    get.mockResolvedValue({ data: {} });
    expect(await fetchRecentDecisions()).toEqual([]);
    get.mockResolvedValue({});
    expect(await fetchRecentDecisions()).toEqual([]);
  });
});

describe('R7 — toSidebarDecision maps a canonical Decision row', () => {
  it('states the row: id, campaign name, engine verdict, relative time', () => {
    const decision = toSidebarDecision({
      id: 'dec-1',
      entityId: '11111111-1111-1111-1111-111111111111',
      entityLevel: 'CAMPAIGN',
      campaign: 'Summer Launch',
      verdict: 'SCALE',
      status: 'PROPOSED',
      decidedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    expect(decision).toEqual({
      id: 'dec-1',
      campaign: 'Summer Launch',
      verdict: 'SCALE',
      timestamp: '30m ago',
    });
  });

  it('NEVER derives a verdict — an absent one stays absent', () => {
    // The old code returned 'TEST' here. A verdict is the single most
    // consequential word on the surface; inventing one is not a fallback.
    const decision = toSidebarDecision({ id: 'dec-2', campaign: 'Winter', decidedAt: null });
    expect(decision.verdict).toBeNull();
    expect(decision.verdict).not.toBe('TEST');
  });

  it('NEVER invents a campaign name', () => {
    const decision = toSidebarDecision({ id: 'dec-3', verdict: 'KILL', campaign: null });
    expect(decision.campaign).toBeNull();
    expect(decision.campaign).not.toBe('Unknown');
  });

  it('NEVER claims recency it cannot measure', () => {
    for (const bad of [null, undefined, 'not-a-date']) {
      expect(toSidebarDecision({ id: 'x', decidedAt: bad }).timestamp).toBeNull();
    }
    expect(toSidebarDecision({ id: 'x', decidedAt: 'not-a-date' }).timestamp).not.toBe('recent');
  });

  it('reads the verdict from the field, not from any text on the row', () => {
    // The defect in one line: a row whose PROSE says KILL while its verdict
    // says HOLD. The old parser read the prose. This reads the row.
    const decision = toSidebarDecision({
      id: 'dec-4',
      campaign: 'KILL the losers — Q3 push',
      verdict: 'HOLD',
      decidedAt: new Date().toISOString(),
    });
    expect(decision.verdict).toBe('HOLD');
  });

  it('formats real elapsed time across the three bands', () => {
    const at = (ms) => toSidebarDecision({ id: 'x', decidedAt: new Date(Date.now() - ms).toISOString() }).timestamp;
    expect(at(5 * 60_000)).toBe('5m ago');
    expect(at(3 * 3_600_000)).toBe('3h ago');
    expect(at(2 * 86_400_000)).toBe('2d ago');
  });
});
