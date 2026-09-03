// ============================================================
// useGrowthStrategySummary — connector-substrate composition
// ------------------------------------------------------------
// The Active Campaigns tile's numbers must trace to the connector roster
// (total) + the connector engine verdicts (breakdown) + gatedOut, grouped by
// the REASON each campaign was gated (C-07) — NOT the legacy pending-Action
// feed, and never one count over three reasons. Asserts the counting
// rules, the stable non-null shape under loading/error, and the invariant
// that buckets never double-count or exceed the roster.
//
// Composes two hooks → mock them (not the api) so the test pins THIS layer.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GATING_REASON } from '@marcom/runtime-contracts';
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

  it('groups gatedOut BY REASON - surfaced, never folded into a verdict', () => {
    // C-07 - this used to assert needsRevenue == gatedOut.length: one number
    // over three unrelated problems, rendered as "N need revenue data".
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(5) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [mkVerdict('HOLD')],
      gatedOut: [
        { id: 'g1', reason: GATING_REASON.NO_MEASURABLE_DELIVERY },
        { id: 'g2', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 9, maxAgeDays: 3 },
        { id: 'g3', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 40, maxAgeDays: 3 },
      ],
    }));
    const { summary } = run();
    expect(summary.gatedTotal).toBe(3);
    expect(summary.gated).toHaveLength(2);
    expect(summary.gated.find((g) => g.reason === GATING_REASON.CANONICAL_EVIDENCE_STALE).count).toBe(2);
    // Exactly one group speaks about revenue - the only one revenue would fix.
    expect(summary.gated.filter((g) => /revenue/i.test(g.sentence))).toHaveLength(1);
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
    expect(out.summary).toEqual({ total: 0, scaling: 0, holding: 0, watching: 0, killing: 0, gated: [], gatedTotal: 0 });
  });

  it('error → stable EMPTY_SUMMARY (not null) + error surfaced', () => {
    const err = new Error('boom');
    useConnectorCampaigns.mockReturnValue(campaignsHook({ error: err }));
    useConnectorVerdicts.mockReturnValue(verdictsHook());
    const out = run();
    expect(out.error).toBe(err);
    expect(out.summary).toEqual({ total: 0, scaling: 0, holding: 0, watching: 0, killing: 0, gated: [], gatedTotal: 0 });
  });

  it('INVARIANT: scaling+holding+watching+killing+gatedTotal <= total', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(10) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [
        mkVerdict('SCALE'), mkVerdict('HOLD'), mkVerdict('WATCH'), mkVerdict('KILL'),
        mkVerdict('REALLOCATE'), // in total, in no bucket
      ],
      gatedOut: [
        { id: 'g1', reason: GATING_REASON.NO_MEASURABLE_DELIVERY },
        { id: 'g2', reason: GATING_REASON.NO_CANONICAL_WINDOW },
      ],
    }));
    const { summary } = run();
    const summed =
      summary.scaling + summary.holding + summary.watching + summary.killing + summary.gatedTotal;
    expect(summed).toBeLessThanOrEqual(summary.total);
  });
});
