// ============================================================
// FE-03 — Attention may only report a failure of a substrate it READS
// ------------------------------------------------------------
// B8-02 made sure a failed read is never spelled as an empty account. This is
// the same law running the other way, and it was live at `d62bb11`:
//
//   readFailed = intelligenceError || connectorError || healthError
//                └── GET /api/lumi/feed, whose only consumed field
//                    (`campaigns`) S1-B deleted from the response
//
//   overviewState:81      !hasAnyData && unreadable → ACCOUNT_STATE.UNREADABLE
//   overviewInterrupts:55 when: !hasAnyData && !unreadable
//
// So on an account with nothing synced, where `/entities/campaigns` answered
// 200 with zero campaigns and `/lumi/feed` happened to 500, Attention said
//
//     "Lumi couldn't read this account just now."
//     "This is a problem on our side, not a verdict about your campaigns."
//
// and SUPPRESSED the connect-a-channel interrupt — the one instruction that
// would have helped. The account was read perfectly well. Lumi reported its own
// failure to read something it does not read.
//
// ── THIS FILE IS ALSO THE REPLACEMENT FOR A GUARD FE-03 DELETES ──────────────
// `useIntelligenceData.error.test.jsx` pinned B8-02's ruling that "an exported
// `error` state is not an error path". FE-03 deletes that hook, which makes the
// guard VACUOUS rather than violated — so, per C-16, this slice owns the
// invariant that replaces it: the honesty signal survives, sourced from the two
// substrates whose failure Attention can actually be wrong about.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ACCOUNT_STATE } from '../overviewState.js';

vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: vi.fn() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useHome.js', () => ({ useHome: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: vi.fn() }));
vi.mock('../useDismissals.js', () => ({ useDismissals: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useCollabRole: vi.fn(),
}));

import { useOverviewModel } from '../useOverviewModel.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useHome } from '@/hooks/useHome.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { useDismissals } from '../useDismissals.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';

// An account that has synced nothing, read SUCCESSFULLY. Both substrates
// answered; both are legitimately empty. Nothing here is a failure.
const readCleanlyAndEmpty = () => {
  useWorkspace.mockReturnValue({ workspace: { name: 'Acme', currency: 'USD' } });
  useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null });
  useConnections.mockReturnValue({ data: { connections: [] } });
  useAccountHealth.mockReturnValue({ health: null, loading: false, error: null });
  useHome.mockReturnValue({ home: null, isStale: false });
  useConnectorVerdicts.mockReturnValue({ verdicts: [] });
  useAccuracy.mockReturnValue({ surface: null });
  useDismissals.mockReturnValue({ firstRunFlag: false, dismissed: new Set(), dismiss: vi.fn() });
  useCollabRole.mockReturnValue({ role: 'STRATEGIST', loading: false });
};

beforeEach(() => { vi.clearAllMocks(); readCleanlyAndEmpty(); });

describe('FE-03 · a failure Attention cannot be wrong about', () => {
  it('does not call itself unreadable when both substrates answered', () => {
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.accountState).not.toBe(ACCOUNT_STATE.UNREADABLE);
  });

  it('still offers the connect instruction on a cleanly-empty account', () => {
    // The second half of the defect: `unreadable` SUPPRESSES this interrupt, so
    // a wrongly-claimed failure also withheld the correct next step.
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.plan.interrupt).toBeTruthy();
  });
});

describe('FE-03 · the honesty signal survives, on the substrates that feed claims', () => {
  it('a failed /entities/campaigns read IS unreadable', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: new Error('connector 500') });
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.accountState).toBe(ACCOUNT_STATE.UNREADABLE);
  });

  it('a failed /entities/health read IS unreadable', () => {
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: new Error('health 500') });
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.accountState).toBe(ACCOUNT_STATE.UNREADABLE);
  });

  it('and an unreadable account is NOT offered the connect instruction', () => {
    // Pinning the pairing itself: the instruction is withheld exactly when the
    // page genuinely does not know what it is looking at.
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: new Error('connector 500') });
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.plan.interrupt).toBeFalsy();
  });
});

describe('FE-03 · no KPI is computed from the retired substrate', () => {
  it('health is null — never the 0 that meant "nothing scored"', () => {
    // `summarize([])` returned `health: 0`, and `overviewKpis` guarded it with
    // `?? null` while guarding spend/wasted with `> 0 ? : null`. `0 ?? null` is
    // 0, so a non-live account carried a real number into
    // healthPresentation → { tone: 'danger', label: 'Needs attention' }, and
    // KpiStrip renders `${kpis.health}/100`.
    //
    // It never reached a pixel: KpiStrip is gated on `hasAnyData`, which equals
    // `live` exactly, which is the same condition that made the legacy branch
    // unreachable. This asserts the value itself so the claim stops depending
    // on a coincidence between two files.
    const { result } = renderHook(() => useOverviewModel());
    expect(result.current.kpis.health).toBeNull();
    expect(result.current.kpis.spend).toBeNull();
    expect(result.current.kpis.cpa).toBeNull();
  });
});
