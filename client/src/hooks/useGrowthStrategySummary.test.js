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
    expect(summary.byVerdict.SCALE).toBe(2);
    expect(summary.byVerdict.HOLD).toBe(1);
    expect(summary.byVerdict.WATCH).toBe(1);
    expect(summary.byVerdict.KILL).toBe(2);
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
    expect(summary.byVerdict.HOLD).toBe(1); // gatedOut did NOT become a HOLD
  });

  // This test was called "silently ignores verdicts outside the four buckets
  // (REALLOCATE/REFRESH)" and asserted exactly that. The disappearance was
  // SPECIFIED here, not merely unnoticed — which is why no drift guard could
  // have caught it. It now asserts the opposite, on the same fixture.
  it('counts REALLOCATE and REFRESH beside SCALE — none of the three is ignored', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(4) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [mkVerdict('REALLOCATE'), mkVerdict('REFRESH'), mkVerdict('SCALE')],
    }));
    const { summary } = run();
    expect(summary.byVerdict.SCALE).toBe(1);
    expect(summary.byVerdict.REALLOCATE).toBe(1);
    expect(summary.byVerdict.REFRESH).toBe(1);
    expect(summary.scored).toBe(3);
  });

  it('loading (either hook) → loading:true + stable EMPTY_SUMMARY (never null)', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(9), loading: false }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({ loading: true }));
    const out = run();
    expect(out.loading).toBe(true);
    expect(out.summary).toEqual({ total: 0, byVerdict: {}, scored: 0, gated: [], gatedTotal: 0 });
  });

  it('error → stable EMPTY_SUMMARY (not null) + error surfaced', () => {
    const err = new Error('boom');
    useConnectorCampaigns.mockReturnValue(campaignsHook({ error: err }));
    useConnectorVerdicts.mockReturnValue(verdictsHook());
    const out = run();
    expect(out.error).toBe(err);
    expect(out.summary).toEqual({ total: 0, byVerdict: {}, scored: 0, gated: [], gatedTotal: 0 });
  });

  it('INVARIANT: every verdict counted + gatedTotal <= total', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(10) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [
        mkVerdict('SCALE'), mkVerdict('HOLD'), mkVerdict('WATCH'), mkVerdict('KILL'),
        // This line read "in total, in no bucket" — the drop, documented as
        // intended. It is in a bucket now, and the invariant still holds.
        mkVerdict('REALLOCATE'),
      ],
      gatedOut: [
        { id: 'g1', reason: GATING_REASON.NO_MEASURABLE_DELIVERY },
        { id: 'g2', reason: GATING_REASON.NO_CANONICAL_WINDOW },
      ],
    }));
    const { summary } = run();
    const summed = summary.scored + summary.gatedTotal;
    expect(summed).toBeLessThanOrEqual(summary.total);
    // …and the sum is over EVERY verdict now, not the four that had buckets.
    expect(summary.scored).toBe(Object.values(summary.byVerdict).reduce((n, c) => n + c, 0));
    expect(summary.byVerdict.REALLOCATE).toBe(1);
  });
});

// ── A canonical verdict cannot disappear because this file forgot it ────────
// The counter was `{ SCALE: 0, HOLD: 0, WATCH: 0, KILL: 0 }` over a SIX-member
// vocabulary, and its comment called REALLOCATE/REFRESH "future verdict values".
// They are emitted today — verdictEngine.js reaches REFRESH at 375/431/435 and
// REALLOCATE at 439/443 — so two live, actionable calls were skipped silently.
//
// RULING (Omar): a canonical verdict cannot disappear because a downstream
// consumer forgot that it exists.
//
// The counts are now discovered FROM THE DATA rather than declared as a bucket
// list, so the class of defect is closed structurally: there is no list left to
// forget a member of.
import { VERDICT_URGENCY_ORDER } from '@/lib/verdictRank.js';

describe('useGrowthStrategySummary · every published verdict is counted', () => {
  const withVerdicts = (...tokens) => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(10) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({ verdicts: tokens.map(mkVerdict) }));
    return run().summary;
  };

  it('REALLOCATE alone is counted — it used to vanish', () => {
    const s = withVerdicts('REALLOCATE', 'REALLOCATE');
    expect(s.byVerdict.REALLOCATE).toBe(2);
    expect(s.scored).toBe(2);
  });

  it('REFRESH alone is counted — it used to vanish', () => {
    const s = withVerdicts('REFRESH');
    expect(s.byVerdict.REFRESH).toBe(1);
    expect(s.scored).toBe(1);
  });

  it('a mixed REALLOCATE/REFRESH account is fully counted', () => {
    const s = withVerdicts('REALLOCATE', 'REFRESH', 'REFRESH');
    expect(s.byVerdict.REALLOCATE).toBe(1);
    expect(s.byVerdict.REFRESH).toBe(2);
    expect(s.scored).toBe(3);
  });

  it('all six of the published vocabulary survive, one bucket each', () => {
    // Driven from VERDICT_URGENCY_ORDER — which is itself derived from
    // VERDICT_RANK — so this cannot pass by agreeing with a second hand-typed
    // list of the same six words.
    const s = withVerdicts(...VERDICT_URGENCY_ORDER);
    for (const v of VERDICT_URGENCY_ORDER) expect(s.byVerdict[v]).toBe(1);
    expect(s.scored).toBe(VERDICT_URGENCY_ORDER.length);
  });

  it('a verdict this client has never seen is counted, not skipped', () => {
    // The old bucket list would have dropped it, which is how the empty-state
    // came to say "Awaiting verdicts" over real decisions. Nothing is dropped.
    const s = withVerdicts('SCALE', 'SOME_FUTURE_VERDICT');
    expect(s.byVerdict.SOME_FUTURE_VERDICT).toBe(1);
    expect(s.scored).toBe(2);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('zero verdicts is genuinely zero — nothing invented', () => {
    const s = withVerdicts();
    expect(s.scored).toBe(0);
    expect(s.byVerdict).toEqual({});
  });

  it('a row with no verdict field is not counted as a verdict', () => {
    useConnectorCampaigns.mockReturnValue(campaignsHook({ campaigns: mkCampaigns(3) }));
    useConnectorVerdicts.mockReturnValue(verdictsHook({ verdicts: [{ id: 'x' }, mkVerdict('KILL')] }));
    const s = run().summary;
    expect(s.scored).toBe(1);
    expect(s.byVerdict.KILL).toBe(1);
  });
});
