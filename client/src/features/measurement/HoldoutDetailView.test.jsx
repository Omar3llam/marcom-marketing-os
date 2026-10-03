// ============================================================
// B8-05 — /app/measure/:id, the holdout as a destination
// ------------------------------------------------------------
// The route behind this (`GET /api/lumi/incrementality/:id`) has existed since
// Phase 7C for a middleware's benefit — "GET so the tier-gate middleware also
// has a route to attach to" — with no caller and no test. This is the surface
// that reaches it, and these are the rules it must not break.
//
// R-E3 is the one that matters most here. `exposedUsers` is `Int @default(0)`,
// NOT NULL: the wire always sends a number, so the COUNTER can never tell you
// whether anyone recorded anything. `status` can, and already does —
// `recordCounts` is what moves a holdout DESIGNED → RUNNING. So:
//
//     DESIGNED             → no results recorded yet   (a finding)
//     RUNNING / CONCLUDED  → these counts are measured (0 included)
//
// This is B8-04b's law one layer down: when a VALUE cannot decide an absence,
// something else must — and the something else must already be measured, not
// invented for the occasion.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { useHoldoutDetail } = vi.hoisted(() => ({ useHoldoutDetail: vi.fn() }));
vi.mock('@/hooks/useExperimentDetail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useHoldoutDetail: (...a) => useHoldoutDetail(...a),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ id: 'h1' }),
}));

import HoldoutDetailView from './HoldoutDetailView.jsx';
import { DETAIL_REFUSAL } from '@/hooks/useExperimentDetail.js';

const holdout = (over = {}) => ({
  id: 'h1', workspaceId: 'w1', name: 'Meta holdout', channel: 'META',
  holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 1000, durationDays: 14,
  status: 'DESIGNED',
  exposedUsers: 0, exposedConversions: 0, holdoutUsers: 0, holdoutConversions: 0,
  liftPct: null, ciLow: null, ciHigh: null, confidenceLabel: null,
  incrementalRevenueMinor: null, decisionId: null, sourceTest: null,
  startedAt: null, concludedAt: null,
  ...over,
});

function show({ test = null, refusal = null, reason = null, isLoading = false } = {}) {
  useHoldoutDetail.mockReturnValue({ test, refusal, reason, isLoading, refetch: vi.fn() });
  return render(<MemoryRouter><HoldoutDetailView /></MemoryRouter>);
}

beforeEach(() => { useHoldoutDetail.mockReset(); });

describe('B8-05 · R-E3 — the counter is not the answer; the status is', () => {
  it('DESIGNED says no results have been recorded — never "0 exposed users"', () => {
    const { container } = show({ test: holdout({ status: 'DESIGNED' }) });
    expect(screen.getByText(/no results recorded yet/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0 exposed/i);
  });

  it('RUNNING with the same zeroes reports a MEASURED zero', () => {
    // Identical bytes on the wire, opposite meanings. Only `status` separates
    // them, which is exactly why the value may not be asked.
    show({ test: holdout({ status: 'RUNNING', exposedUsers: 0, holdoutUsers: 0 }) });
    expect(screen.queryByText(/no results recorded yet/i)).not.toBeInTheDocument();
  });

  it('the two states are different on screen', () => {
    const { container: designed } = show({ test: holdout({ status: 'DESIGNED' }) });
    const { container: running } = show({ test: holdout({ status: 'RUNNING' }) });
    expect(designed.textContent).not.toEqual(running.textContent);
  });

  it('real counts are stated as recorded', () => {
    show({ test: holdout({ status: 'RUNNING', exposedUsers: 5000, exposedConversions: 250 }) });
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });
});

describe('B8-05 · R-E2 — provenance reaches the destination', () => {
  it('a promoted holdout names the A/B test it came from', () => {
    show({ test: holdout({ sourceTest: { id: 't1', dimension: 'HOOK', hypothesis: 'Static beats video' } }) });
    expect(screen.getByText(/Static beats video/)).toBeInTheDocument();
  });

  it('a directly-designed holdout claims no origin at all', () => {
    // Silence is the answer when there is no source. What must never happen is
    // the opposite: a promoted holdout reading as directly designed because the
    // read forgot to ask for `sourceTest`.
    const { container } = show({ test: holdout({ sourceTest: null }) });
    expect(container.textContent).not.toMatch(/promoted from|from A\/B test/i);
  });
});

describe('B8-05 · R-E4 — the readout section, and no empty headings', () => {
  it('a DESIGNED holdout has no conclusion section — there is nothing in it', () => {
    const { container } = show({ test: holdout({ status: 'DESIGNED' }) });
    expect(container.textContent).not.toMatch(/what it concluded/i);
  });

  it('a CONCLUDED holdout states lift with its interval, never a bare point', () => {
    show({ test: holdout({ status: 'CONCLUDED', liftPct: 12.4, ciLow: 3.1, ciHigh: 21.7, confidenceLabel: 'MEDIUM' }) });
    expect(screen.getByText(/12\.4/)).toBeInTheDocument();
    expect(screen.getByText(/3\.1/)).toBeInTheDocument();
    expect(screen.getByText(/21\.7/)).toBeInTheDocument();
  });

  it('MEDIUM lands on the same rung the A/B half calls MODERATE', () => {
    show({ test: holdout({ status: 'CONCLUDED', liftPct: 12.4, ciLow: 3.1, ciHigh: 21.7, confidenceLabel: 'MEDIUM' }) });
    expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();
  });

  it('a concluded holdout with a null label says no call could be made', () => {
    show({ test: holdout({ status: 'CONCLUDED', liftPct: null, confidenceLabel: null }) });
    expect(screen.getByText(/no call could be made/i)).toBeInTheDocument();
  });
});

describe('B8-05 · E6 forward edge', () => {
  it('links to the Decision this holdout produced', () => {
    show({ test: holdout({ status: 'CONCLUDED', decisionId: 'd-7', liftPct: 9, ciLow: 1, ciHigh: 17, confidenceLabel: 'HIGH' }) });
    expect(screen.getByRole('link', { name: /decision/i })).toHaveAttribute('href', '/app/decisions/d-7');
  });

  it('offers no decision link when the holdout produced none', () => {
    const { container } = show({ test: holdout({ status: 'CONCLUDED', decisionId: null }) });
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/app/decisions/'))).toHaveLength(0);
  });
});

describe('B8-05 · R-E1 — a refusal is a measured state, and they are not one state', () => {
  it('generic permission refusal does not claim plan or measurement depth and offers no retry', () => {
    const { container } = show({ refusal: DETAIL_REFUSAL.NOT_PERMITTED, reason: 'NOT_PERMITTED' });
    expect(screen.getByText('Access to this holdout was refused for this request.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/upgrade|Agency|Enterprise|enabled|Pro plan/i);
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
  });
  it('404 says it could not be found, and does not claim it never existed', () => {
    show({ refusal: DETAIL_REFUSAL.NOT_FOUND });
    expect(screen.getByRole('heading', { name: /couldn’t find this holdout/i })).toBeInTheDocument();
  });

  it('a plan 403 offers the upgrade, not a retry', () => {
    show({ refusal: DETAIL_REFUSAL.NOT_PERMITTED, reason: 'PLAN_REQUIRED' });
    expect(screen.getByText(/plan/i)).toBeInTheDocument();
  });

  it('a tier 403 says the workspace is not enabled — a different fix', () => {
    // C-07: a token cannot replace a reason. Both refusals are NOT_PERMITTED;
    // "upgrade your plan" and "measurement isn't enabled here" are two
    // different things for the reader to do.
    const { container: plan } = show({ refusal: DETAIL_REFUSAL.NOT_PERMITTED, reason: 'PLAN_REQUIRED' });
    const { container: tier } = show({ refusal: DETAIL_REFUSAL.NOT_PERMITTED, reason: 'NOT_ENTITLED' });
    expect(plan.textContent).not.toEqual(tier.textContent);
  });

  it('a failed read blames itself, and never renders an empty holdout', () => {
    const { container } = show({ refusal: DETAIL_REFUSAL.UNREADABLE });
    expect(container.textContent).not.toMatch(/no results recorded yet/i);
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
  });

  it('loading is loading — not an absence', () => {
    const { container } = show({ isLoading: true });
    expect(container.textContent).not.toMatch(/couldn’t|no results recorded/i);
  });
});
