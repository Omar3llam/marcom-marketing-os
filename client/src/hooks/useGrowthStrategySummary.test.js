// ============================================================
// useGrowthStrategySummary — connector-substrate composition
// ------------------------------------------------------------
// The Active Campaigns tile's numbers must trace to the connector roster
// (total) + the connector engine verdicts (breakdown) + gatedOut
// (needsRevenue) — NOT the legacy pending-Action feed. Asserts the counting
// rules, the stable non-null shape under loading/error, and the invariant
// that buckets never double-count or exceed the roster.
//
// Composes two hooks → mock them (not the api) so the test pins THIS layer.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGrowthStrategySummary } from './useGrowthStrategySummary.js';
import { useConnectorCampaigns } from './useConnectorCampaigns.js';
import { useConnectorVerdicts } from './useConnectorVerdicts.js';

vi.mock('./useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('./useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));

const campaignsHook = (over = {}) => ({ campaigns: [], loading: false, error: null, ...over });
const verdictsHook  = (over = {}) => ({ verdicts: [], gatedOut: [], loading: false, error: null, ...over });

const mkCampaigns = (n) => Array.from({ length: n }, (_, i) => ({ entityId: `c${i}`, name: `C${i}` }));
const mkVerdict   = (verdict) => ({ id: verdict, verdict });

const run = () => renderHook(() => useGrowthStrategySummary()).result.current;

describe('useGrowthStrategySummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('total == connector campaigns.length (no revenue/verdict filter)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(44) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({ verdicts: [mkVerdict('SCALE')] }));
    expect(run().summary.total).toBe(44);
  });

  it('keeps SCALE/HOLD/WATCH/KILL as separate buckets (no merging)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(6) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [
        mkVerdict('SCALE'), mkVerdict('SCALE'),
        mkVerdict('HOLD'),
        mkVerdict('WATCH'),
        mkVerdict('KILL'), mkVerdict('KILL'),
      ],
    }));
    const { summary } = run();
    expect(summary.scaling).toBe(2);
    expect(summary.holding).toBe(1);
    expect(summary.watching).toBe(1);
    expect(summary.killing).toBe(2);
  });

  it('needsRevenue == gatedOut.length (surfaced, never folded into a verdict)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(5) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [mkVerdict('HOLD')],
      gatedOut: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }],
    }));
    const { summary } = run();
    expect(summary.needsRevenue).toBe(3);
    expect(summary.holding).toBe(1); // gatedOut did NOT become a HOLD
  });

  it('silently ignores verdicts outside the four buckets (REALLOCATE/REFRESH)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(4) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [mkVerdict('REALLOCATE'), mkVerdict('REFRESH'), mkVerdict('SCALE')],
    }));
    const { summary } = run();
    expect(summary.scaling).toBe(1);
    expect(summary.holding + summary.watching + summary.killing).toBe(0);
  });

  it('loading (either hook) → loading:true + stable EMPTY_SUMMARY (never null)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(9), loading: false }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({ loading: true }));
    const out = run();
    expect(out.loading).toBe(true);
    expect(out.summary).toEqual({ total: 0, scaling: 0, holding: 0, watching: 0, killing: 0, needsRevenue: 0 });
  });

  it('error → stable EMPTY_SUMMARY (not null) + error surfaced', () => {
    const err = new Error('boom');
    useConnectorCampaigns.mockReturnValue(campaignsHook({ error: err }));
    useConnectorVerdicts.mockReturnValue(verdictsHook());
    const out = run();
    expect(out.error).toBe(err);
    expect(out.summary).toEqual({ total: 0, scaling: 0, holding: 0, watching: 0, killing: 0, needsRevenue: 0 });
  });

  it('INVARIANT: scaling+holding+watching+killing+needsRevenue <= total', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(10) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [
        mkVerdict('SCALE'), mkVerdict('HOLD'), mkVerdict('WATCH'), mkVerdict('KILL'),
        mkVerdict('REALLOCATE'), // in total, in no bucket
      ],
      gatedOut: [{ id: 'g1' }, { id: 'g2' }],
    }));
    const { summary } = run();
    const summed =
      summary.scaling + summary.holding + summary.watching + summary.killing + summary.needsRevenue;
    expect(summed).toBeLessThanOrEqual(summary.total);
  });
});
