// ============================================================
// B8-05 — /app/testing/:id, the A/B experiment as a destination
// ------------------------------------------------------------
// `GET /api/lumi/tests/:id` shipped ahead of its consumer, and said so:
//
//     B7-03 named the consumer in advance and `testing.detail.test.js` is its
//     reader of record until B7 builds the destination.
//
// This is that destination. It buys addressability, not new data — the list
// already includes `variants` — and addressability is the point: one experiment
// a person can link to, return to, and open from outside a 100-row window.
//
// R-N4 governs the shape: ONE detail grammar across every by-id surface, while
// the LIST stays per-substrate. So this reads in the same sequence, with the
// same section behaviour, as `/app/decisions/:id` — including "no empty
// headings": a section whose facts do not exist does not appear under a title
// promising them.
//
// R-E1 governs the address: two destinations, not one. `/tests/:id` is PRO;
// `/incrementality/:id` is PRO *and* measurement-tier. A single shared address
// would have to satisfy the looser gate, which is how a by-id read becomes a
// way around the gate on the list it came from.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { useTestDetail } = vi.hoisted(() => ({ useTestDetail: vi.fn() }));
vi.mock('@/hooks/useExperimentDetail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useTestDetail: (...a) => useTestDetail(...a),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ id: 't1' }),
}));

import TestDetailView from './TestDetailView.jsx';
import { DETAIL_REFUSAL } from '@/hooks/useExperimentDetail.js';

const experiment = (over = {}) => ({
  id: 't1', workspaceId: 'w1', dimension: 'HOOK', metric: 'CTR',
  hypothesis: 'Static beats video', expectedSignal: 'CTR up 10%',
  status: 'RUNNING', currency: 'USD',
  winnerLabel: null, lift: null, confidence: null, confidenceLabel: null,
  sampleNote: null, decisionId: null,
  startedAt: null, concludedAt: null,
  variants: [
    { id: 'a', label: 'Control', isControl: true, isWinner: false, impressions: 2000, clicks: 40, conversions: 4 },
    { id: 'b', label: 'Variant B', isControl: false, isWinner: false, impressions: 2000, clicks: 60, conversions: 6 },
  ],
  ...over,
});

function show({ test = null, refusal = null, reason = null, isLoading = false } = {}) {
  useTestDetail.mockReturnValue({ test, refusal, reason, isLoading, refetch: vi.fn() });
  return render(<MemoryRouter><TestDetailView /></MemoryRouter>);
}

beforeEach(() => { useTestDetail.mockReset(); });

describe('B8-05 — the experiment opens as itself', () => {
  it('leads with the hypothesis, not with an instrument (B8-01)', () => {
    show({ test: experiment() });
    expect(screen.getByText(/Static beats video/)).toBeInTheDocument();
  });

  it('the arms are the evidence, and they travel with it (B7-04)', () => {
    // An Experiment's evidence lives on its own row, never on the Decision. A
    // detail that dropped `variants` would be addressable and useless.
    show({ test: experiment() });
    expect(screen.getByText(/Control/)).toBeInTheDocument();
    expect(screen.getByText(/Variant B/)).toBeInTheDocument();
  });

  it('an unrecorded arm renders "—", never a fabricated zero', () => {
    // The rule TestingView already holds itself to; one detail grammar means it
    // does not get re-litigated here.
    const { container } = show({ test: experiment({
      variants: [
        { id: 'a', label: 'Control', isControl: true, impressions: null, clicks: null, conversions: null },
        { id: 'b', label: 'Variant B', isControl: false, impressions: 2000, clicks: 60, conversions: 6 },
      ],
    }) });
    expect(container.textContent).toMatch(/—/);
  });
});

describe('B8-05 · R-E4 + no empty headings', () => {
  it('a RUNNING test has no conclusion section', () => {
    const { container } = show({ test: experiment({ status: 'RUNNING' }) });
    expect(container.textContent).not.toMatch(/what it concluded/i);
  });

  it('a CONCLUDED test states winner and lift from the persisted row', () => {
    const { container } = show({ test: experiment({
      status: 'CONCLUDED', winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'HIGH',
      sampleNote: 'Both arms above the CTR floor.',
    }) });
    // "Variant B" is legitimately on the page twice — as an arm and as the
    // winner — so this asserts the WINNER line, not merely the string.
    expect(screen.getByText(/Winner:/)).toBeInTheDocument();
    expect(container.textContent).toMatch(/Winner:\s*Variant B/);
    expect(screen.getByText(/\+12%/)).toBeInTheDocument();
    expect(screen.getByText(/high confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Both arms above the CTR floor/)).toBeInTheDocument();
  });

  it('MODERATE is presented on the MEDIUM rung — the holdout half’s word', () => {
    show({ test: experiment({ status: 'CONCLUDED', winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'MODERATE' }) });
    expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();
    expect(screen.queryByText(/moderate confidence/i)).not.toBeInTheDocument();
  });

  it('INCONCLUSIVE is a finding, and no winner is invented for it', () => {
    show({ test: experiment({ status: 'CONCLUDED', winnerLabel: null, lift: null, confidenceLabel: 'INCONCLUSIVE' }) });
    expect(screen.getByText(/no call could be made/i)).toBeInTheDocument();
    expect(screen.queryByText(/INCONCLUSIVE confidence/i)).not.toBeInTheDocument();
  });

  it('an unrecognised label claims nothing at all', () => {
    show({ test: experiment({ status: 'CONCLUDED', winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'WHATEVER' }) });
    expect(screen.queryByText(/no call could be made/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/WHATEVER/)).not.toBeInTheDocument();
  });
});

describe('B8-05 · E6 forward edge', () => {
  it('links to the Decision the experiment produced', () => {
    show({ test: experiment({ status: 'CONCLUDED', winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'HIGH', decisionId: 'd-42' }) });
    expect(screen.getByRole('link', { name: /decision/i })).toHaveAttribute('href', '/app/decisions/d-42');
  });

  it('a concluded test that produced no action offers no link', () => {
    const { container } = show({ test: experiment({ status: 'CONCLUDED', winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'LOW' }) });
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/app/decisions/'))).toHaveLength(0);
  });
});

describe('B8-05 — refusals stay apart', () => {
  it('404 is not permission and not failure', () => {
    show({ refusal: DETAIL_REFUSAL.NOT_FOUND });
    expect(screen.getByRole('heading', { name: /couldn’t find this experiment/i })).toBeInTheDocument();
  });

  it('a plan 403 offers the upgrade path', () => {
    show({ refusal: DETAIL_REFUSAL.NOT_PERMITTED, reason: 'PLAN_REQUIRED' });
    expect(screen.getByText(/plan/i)).toBeInTheDocument();
  });

  it('a failed read never renders as an experiment with no arms', () => {
    const { container } = show({ refusal: DETAIL_REFUSAL.UNREADABLE });
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Control/);
  });

  it('back-link returns to the list this was opened from', () => {
    show({ test: experiment() });
    const back = screen.getByRole('link', { name: /testing/i });
    expect(back).toHaveAttribute('href', '/app/testing');
  });
});
