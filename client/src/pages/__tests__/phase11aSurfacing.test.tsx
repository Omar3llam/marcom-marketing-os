// ============================================================
// Phase 11A — Surfacing the Built Brain (role-gating + 2 STARs)
// ------------------------------------------------------------
// Tests the load-bearing honesty/gating guarantees as pure-component assertions
// (no network): RoleGate allow/deny/loading, the Proof RELIABLE hard gate, and
// the Blended single-channel honest state. Schemas safeParse representative
// fixtures (the contract seam).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoleContext } from '@/context/RoleContext.jsx';
import RoleGate, { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { ProofView } from '@/pages/Proof.jsx';
import { BlendedTruthView } from '@/pages/BlendedTruth.jsx';
import { DecisionAccuracySchema, AccuracySurfaceSchema, BlendedTruthSchema } from '@/contracts/schemas';

function withRole(role: string, loading = false) {
  // MemoryRouter so components that deep-link (BlendedTruthView's channel links)
  // have a Router context.
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <RoleContext.Provider value={{ role, visibleStates: null, loading, error: null, status: loading ? 'LOADING' : 'PRESENT' }}>
        {children}
      </RoleContext.Provider>
    </MemoryRouter>
  );
}

// ── Fixtures ─────────────────────────────────────────────────────
const RELIABLE = {
  coverage: { totalDecisions: 160, scored: 124, unscorable: 6, pendingMaturation: 9, dismissed: 21, notAPrediction: 0, scoredFraction: 0.95, verdict: 'RELIABLE', note: 'x' },
  calibration: { bins: [{ band: '80-90%', predicted: 0.85, observed: 0.79, count: 26, gap: 0.06 }], binEdges: [0, 1], expectedCalibrationError: 0.11, brierScore: 0.14, accuracy: 0.71, direction: 'OVERCONFIDENT', sampleSize: 124 },
  velocity: { periods: [{ label: '2026-01', calibrationError: 0.28, sampleSize: 34, includedInTrend: true }, { label: '2026-02', calibrationError: 0.16, sampleSize: 41, includedInTrend: true }], trend: 'IMPROVING', slope: -0.04 },
  accountLift: { earlyWindow: { calibrationError: 0.28, accuracy: 0.62, sampleSize: 50, span: { from: 'a', to: 'b' } }, recentWindow: { calibrationError: 0.11, accuracy: 0.78, sampleSize: 50, span: { from: 'a', to: 'b' } }, calibrationImprovementPct: 0.61, status: 'IMPROVING' },
};
const RELIABLE_SURFACE = { gated: false, headline: 'Lumi\'s calls on this account: calibration error 11% (was 28% in your first window) — improving', status: 'IMPROVING', calibrationErrorPct: 11, improvementPct: 61, scored: 124, needed: 30 };

const THIN = { ...RELIABLE, coverage: { ...RELIABLE.coverage, scored: 12, verdict: 'THIN' } };
const THIN_SURFACE = { gated: true, headline: 'Still learning this account (12 decisions scored, need 30)', status: null, calibrationErrorPct: null, improvementPct: null, scored: 12, needed: 30 };

describe('RoleGate', () => {
  it('renders children for an allowed role', () => {
    render(<RoleGate role={['STRATEGIST']}><span>secret</span></RoleGate>, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
  it('renders the fallback for a denied role', () => {
    render(<RoleGate role={['STRATEGIST']} fallback={<span>nope</span>}><span>secret</span></RoleGate>, { wrapper: withRole('CLIENT') });
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('nope')).toBeInTheDocument();
  });
  it('renders NOTHING while loading — never the fallback (a redirect fallback must not fire mid-load)', () => {
    const { container } = render(
      <RoleGate role={['STRATEGIST']} fallback={<span>nope</span>}><span>secret</span></RoleGate>,
      { wrapper: withRole('STRATEGIST', true) },
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument(); // no flash of gated content
    expect(screen.queryByText('nope')).not.toBeInTheDocument();   // and no premature fallback/redirect
    expect(container).toBeEmptyDOMElement();
  });
  it('renders children once the role RESOLVES to an allowed role (post-load)', () => {
    render(<RoleGate role={['STRATEGIST']} fallback={<span>nope</span>}><span>secret</span></RoleGate>, { wrapper: withRole('STRATEGIST', false) });
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
  it('roleAllowed: empty/absent constraint is visible to all', () => {
    expect(roleAllowed('CLIENT', undefined)).toBe(true);
    expect(roleAllowed('CLIENT', ['STRATEGIST'])).toBe(false);
    expect(roleAllowed('BUYER', ['STRATEGIST', 'BUYER'])).toBe(true);
  });
});

describe('Proof RELIABLE hard gate (acceptance #3)', () => {
  it('a THIN account renders NO improvement % and NO calibration number — only "still learning"', () => {
    render(<ProofView data={THIN} surface={THIN_SURFACE} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText(/still learning/i)).toBeInTheDocument();
    expect(screen.queryByText(/calibration error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reliability|Confidence band/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it('a RELIABLE account renders the headline + the reliability table for a STRATEGIST', () => {
    render(<ProofView data={RELIABLE} surface={RELIABLE_SURFACE} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText(/calibration error 11%/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence band/i)).toBeInTheDocument();
  });
  it('a CLIENT sees the narrative line only — never the reliability table', () => {
    render(<ProofView data={RELIABLE} surface={RELIABLE_SURFACE} role="CLIENT" />, { wrapper: withRole('CLIENT') });
    expect(screen.getByText(/calibration error 11%/i)).toBeInTheDocument();
    expect(screen.queryByText(/Confidence band/i)).not.toBeInTheDocument();
  });
});

describe('Blended Truth honest single-channel state (acceptance #4)', () => {
  const oneChannel = {
    channels: [{ channelId: 'meta', channel: 'Meta', currency: 'USD', spendMinor: 100000, platformRevenueMinor: 420000, actualRevenueMinor: null, blendedRevenueMinor: 420000, gapMinor: 0, gapPct: 0, platformRoas: 4.2, blendedRoas: 4.2, coverage: 'UNVERIFIED', confidence: 'LOW' }],
    portfolio: { spendMinor: 100000, platformRevenueMinor: 420000, blendedRevenueMinor: 420000, gapMinor: 0, gapPct: 0, platformRoas: 4.2, blendedRoas: 4.2, reconciledCount: 0, unverifiedCount: 1 },
  };
  it('renders the honest "needs ≥2 channels" notice, NOT a reconciliation hero', () => {
    render(<BlendedTruthView data={oneChannel} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText(/reconciles across ≥2 channels/i)).toBeInTheDocument();
    expect(screen.queryByText(/over-reported by/i)).not.toBeInTheDocument();
  });
  it('renders the empty state when no channels are connected', () => {
    render(<BlendedTruthView data={{ channels: [], portfolio: null }} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText(/no connected channels/i)).toBeInTheDocument();
  });
});

describe('contract seam — schemas safeParse the fixtures', () => {
  it('accuracy core + surface', () => {
    expect(DecisionAccuracySchema.safeParse(RELIABLE).success).toBe(true);
    expect(AccuracySurfaceSchema.safeParse(RELIABLE_SURFACE).success).toBe(true);
    expect(AccuracySurfaceSchema.safeParse(THIN_SURFACE).success).toBe(true);
  });
  it('blended truth', () => {
    const ok = { channels: [], portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 0, platformRoas: 0, blendedRoas: 0, reconciledCount: 0, unverifiedCount: 0 } };
    Object.assign(ok.portfolio, { gapMinor: null, gapPct: null, unavailableCount: 0, totalChannelCount: 0,
      reconciliation: { status: 'UNVERIFIED', reason: 'ACTUAL_REVENUE_UNAVAILABLE', windowCompatibility: 'UNKNOWN',
        window: { windowStatus: 'UNKNOWN', windowStart: null, windowEnd: null }, currency: null, platformRevenueMinor: null, actualRevenueMinor: null,
        gapMinor: null, gapPct: null, gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE', reconciledCount: 0, unverifiedCount: 0, unavailableCount: 0, totalChannelCount: 0 } });
    expect(BlendedTruthSchema.safeParse(ok).success).toBe(true);
  });
});
