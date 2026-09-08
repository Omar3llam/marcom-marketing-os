// ============================================================
// useConnectorCampaigns — PARITY-04: the boundary parse
// ------------------------------------------------------------
// What stood at this seam was
//
//     setCampaigns(Array.isArray(res.data?.campaigns) ? res.data.campaigns : []);
//
// so a 200 whose shape had changed became an empty list with `error` null —
// a malformed response rendering as a measured empty account, which is the
// SUBJECT axis's version of the rule PARITY-01 established:
//
//     HTTP success ≠ semantic success
//
// The schema is proved in contracts/schemas/connectorCampaigns.schema.test.ts;
// the consequence in features/campaigns/__tests__/campaignsSubstrateParity.test.jsx.
// This file proves the hook runs the one and feeds the other.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useConnectorCampaigns } from './useConnectorCampaigns.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const row = (over = {}) => ({
  entityId: 'c1', name: 'Eid Sales', channel: 'META', adSetCount: 0,
  spendMinor: 100000, roas: 2, ctr: 0.02, frequency: 1.2, currency: 'EGP', ...over,
});
const payload = (over = {}) => ({
  workspaceId: 'ws', generatedAt: '2026-09-08T00:00:00.000Z', campaigns: [row()], ...over,
});

const load = async (data) => {
  api.get.mockResolvedValue({ data });
  const { result } = renderHook(() => useConnectorCampaigns());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

describe('useConnectorCampaigns · a malformed 200 is an error, never an empty account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a MISSING campaigns collection sets error and does not pretend to be empty', async () => {
    const { campaigns, ...noCollection } = payload();
    expect(campaigns).toBeDefined();
    const r = await load(noCollection);
    expect(r.current.error).toBeTruthy();
    expect(r.current.error.message).toMatch(/contract validation/i);
    expect(r.current.campaigns).toEqual([]);
  });

  it('a RENAMED collection is an error', async () => {
    const r = await load({ workspaceId: 'ws', generatedAt: 'now', rows: [row()] });
    expect(r.current.error).toBeTruthy();
  });

  it('a row missing its IDENTITY is an error', async () => {
    const { entityId, ...noId } = row();
    expect(entityId).toBeDefined();
    const r = await load(payload({ campaigns: [noId] }));
    expect(r.current.error).toBeTruthy();
  });

  it('a WRONG-TYPE metric is an error, not a rendered string', async () => {
    const r = await load(payload({ campaigns: [row({ spendMinor: '100000' })] }));
    expect(r.current.error).toBeTruthy();
  });

  // ── self-refutation: absence and emptiness are still allowed ──────────────
  it('a VALID empty payload is a measured empty account, with no error', async () => {
    const r = await load(payload({ campaigns: [] }));
    expect(r.current.error).toBeNull();
    expect(r.current.campaigns).toEqual([]);
  });

  it('an unsynced row — every metric null — is NOT an error', async () => {
    // Null-when-absent is the serializer's deliberate contract. Rejecting it
    // would turn honest absence into an outage, which is the opposite defect.
    const bare = row({ spendMinor: null, roas: null, ctr: null, frequency: null, currency: null });
    const r = await load(payload({ campaigns: [bare] }));
    expect(r.current.error).toBeNull();
    expect(r.current.campaigns).toHaveLength(1);
  });

  it('…and a valid populated payload still arrives intact', async () => {
    const r = await load(payload());
    expect(r.current.error).toBeNull();
    expect(r.current.campaigns[0].entityId).toBe('c1');
    expect(r.current.campaigns[0].spendMinor).toBe(100000);
  });
});
