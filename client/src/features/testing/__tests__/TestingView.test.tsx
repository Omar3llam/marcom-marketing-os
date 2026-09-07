// ============================================================
// Phase 4-A — Testing OS readout: honesty + the thin-sample gate
// ------------------------------------------------------------
// Pure-component assertions (no network): a CONCLUDED test shows the real
// persisted readout; an inconclusive one refuses to invent a winner; the
// Conclude action is gated until the smaller arm clears the metric floor; and
// a non-operator role never sees the control. The contract seam safeParses a
// representative row.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestingView, thinGate, SAMPLE_FLOOR } from '../TestingView.jsx';
import { TestExperimentSchema } from '@/contracts/schemas';

const base = {
  workspaceId: 'ws-1', dimension: 'HOOK', hypothesis: 'Hook B lifts CTR',
  metric: 'CTR', expectedSignal: 'CTR up', priority: 1, currency: 'USD',
};
const variant = (id, label, isControl, impressions, clicks) => ({
  id, testId: 'x', label, isControl, impressions, clicks,
});

const CONCLUDED_WINNER = {
  ...base, id: 't-win', status: 'CONCLUDED',
  winnerLabel: 'Hook B', lift: 31, confidence: 0.98, confidenceLabel: 'HIGH',
  sampleNote: '50,000 impressions on the smaller arm.', decisionId: 'dec-1',
  variants: [variant('v-a', 'Hook A', true, 50000, 800), variant('v-b', 'Hook B', false, 50000, 1050)],
};
const CONCLUDED_INCONCLUSIVE = {
  ...base, id: 't-inc', status: 'CONCLUDED',
  winnerLabel: null, lift: 0, confidence: 0, confidenceLabel: 'INCONCLUSIVE',
  sampleNote: 'Only 180 impressions on the smaller arm — too thin to call (need 1000).', decisionId: null,
  variants: [variant('v-a', 'A', true, 180, 3), variant('v-b', 'B', false, 180, 4)],
};
const RUNNING_THIN = {
  ...base, id: 't-thin', status: 'RUNNING',
  variants: [variant('v-a', 'A', true, 200, 5), variant('v-b', 'B', false, 180, 6)],
};
const RUNNING_READY = {
  ...base, id: 't-ready', status: 'RUNNING',
  variants: [variant('v-a', 'A', true, 5000, 120), variant('v-b', 'B', false, 5200, 160)],
};

const renderView = (props) =>
  render(<MemoryRouter><TestingView {...props} /></MemoryRouter>);

describe('thinGate — mirrors the readout engine sample floor', () => {
  it('a below-floor running test is not ready, with the right shortfall', () => {
    const g = thinGate(RUNNING_THIN);
    expect(g.ready).toBe(false);
    expect(g.floor).toBe(SAMPLE_FLOOR.CTR);
    expect(g.minSample).toBe(180); // min of 200/180
  });
  it('a test past the floor is ready', () => {
    expect(thinGate(RUNNING_READY).ready).toBe(true);
  });
  it('an unknown metric does not fabricate a gate (ready, backend stays arbiter)', () => {
    expect(thinGate({ metric: 'XYZ', variants: [] }).ready).toBe(true);
  });
});

describe('TestingView — CONCLUDED readouts are honest', () => {
  it('renders the real winner, lift, confidence and a link to the proposed decision', () => {
    const { container } = renderView({ experiments: [CONCLUDED_WINNER], role: 'BUYER' });
    expect(screen.getByText('Hook B')).toBeInTheDocument();
    expect(screen.getByText(/\+31% CTR/)).toBeInTheDocument();
    expect(screen.getByText(/HIGH confidence/i)).toBeInTheDocument();
    // B8-05 · E6 — this asserted the copy "review on Overview". The assertion
    // was REPLACED rather than re-spelled: what it should have been pinning all
    // along is that the link resolves to the DECISION, whose id the experiment
    // is already holding. Overview shows `status: 'PROPOSED'` only, so the old
    // sentence stopped being true the moment anybody acted on the decision.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/app/decisions/${CONCLUDED_WINNER.decisionId}`);
  });
  it('refuses to invent a winner when inconclusive — shows WHY, not a fake call', () => {
    const { container } = renderView({ experiments: [CONCLUDED_INCONCLUSIVE], role: 'BUYER' });
    expect(screen.getByText(/No winner called/i)).toBeInTheDocument();
    expect(screen.getByText(/too thin to call/i)).toBeInTheDocument();
    // Also replaced, and for a sharper reason: once the old copy was gone this
    // assertion would have passed vacuously — a query for a string that exists
    // nowhere is satisfied by any page at all. It now names the real
    // requirement: an experiment that produced no decision offers no decision.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/app/decisions/'))).toHaveLength(0);
  });
});

describe('TestingView — Conclude action + thin-sample gate', () => {
  it('disables Conclude with a shortfall note while below the floor', () => {
    renderView({ experiments: [RUNNING_THIN], role: 'BUYER', onConclude: vi.fn() });
    const btn = screen.getByRole('button', { name: /conclude/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/820 more impressions/)).toBeInTheDocument(); // 1000 - 180
  });
  it('enables Conclude past the floor and fires onConclude with the test id', () => {
    const onConclude = vi.fn();
    renderView({ experiments: [RUNNING_READY], role: 'BUYER', onConclude });
    const btn = screen.getByRole('button', { name: /conclude/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConclude).toHaveBeenCalledWith('t-ready');
  });
  it('a non-operator role (CLIENT) never sees the Conclude control', () => {
    renderView({ experiments: [RUNNING_READY], role: 'CLIENT', onConclude: vi.fn() });
    expect(screen.queryByRole('button', { name: /conclude/i })).not.toBeInTheDocument();
  });
});

describe('TestingView — record observed metrics on a RUNNING test', () => {
  it('an operator opens the form and Save fires onRecord with the exact handler fields (money → minor)', async () => {
    const onRecord = vi.fn().mockResolvedValue({ updated: 2 });
    renderView({ experiments: [RUNNING_READY], role: 'BUYER', onRecord });

    fireEvent.click(screen.getByRole('button', { name: /record metrics/i }));
    // Edit one arm: impressions + spend (entered in major USD → minor on submit).
    fireEvent.change(screen.getByLabelText(/A Impressions/i), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText(/A Spend/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /save metrics/i }));

    expect(onRecord).toHaveBeenCalledWith(
      't-ready',
      expect.arrayContaining([
        expect.objectContaining({ variantId: 'v-a', impressions: 6000, spendMinor: 5000 }),
      ]),
    );
    // honest confirmation, and the form collapses (no navigation away)
    expect(await screen.findByText(/Recorded — updated 2 variants/i)).toBeInTheDocument();
  });

  it('reflects the in-flight record (disabled + Recording…)', () => {
    renderView({ experiments: [RUNNING_READY], role: 'BUYER', onRecord: vi.fn(), recordingId: 't-ready' });
    fireEvent.click(screen.getByRole('button', { name: /record metrics/i }));
    const btn = screen.getByRole('button', { name: /recording/i });
    expect(btn).toBeDisabled();
  });

  it('surfaces the real record error inline, not a generic message', () => {
    renderView({
      experiments: [RUNNING_READY], role: 'BUYER', onRecord: vi.fn(),
      recordError: new Error('variants[] is required'),
    });
    fireEvent.click(screen.getByRole('button', { name: /record metrics/i }));
    expect(screen.getByText(/variants\[\] is required/i)).toBeInTheDocument();
  });

  it('a non-operator (CLIENT) never sees the Record metrics control', () => {
    renderView({ experiments: [RUNNING_READY], role: 'CLIENT', onRecord: vi.fn() });
    expect(screen.queryByRole('button', { name: /record metrics/i })).not.toBeInTheDocument();
  });
});

describe('TestingView — honest empty state', () => {
  it('shows the honest empty message and the proposed agenda', () => {
    renderView({ experiments: [], agenda: [{ id: 'a1', hypothesis: 'Try a softer hook' }], role: 'BUYER' });
    expect(screen.getByText(/No experiments yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Try a softer hook/i)).toBeInTheDocument();
  });
});

describe('TestingView — start a PROPOSED experiment (completes the #108 loop)', () => {
  const PROPOSED = { ...base, id: 't-prop', status: 'PROPOSED', variants: [] };

  it('an operator sees Start on a PROPOSED card; clicking fires onStart with the test id', () => {
    const onStart = vi.fn();
    renderView({ experiments: [PROPOSED], role: 'BUYER', onStart });
    const btn = screen.getByRole('button', { name: /start test/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledWith('t-prop');
  });

  it('a non-operator (CLIENT) sees the PROPOSED card but no Start control', () => {
    renderView({ experiments: [PROPOSED], role: 'CLIENT', onStart: vi.fn() });
    expect(screen.getByText(/not started yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start test/i })).not.toBeInTheDocument();
  });

  it('reflects the in-flight start (disabled + Starting…)', () => {
    renderView({ experiments: [PROPOSED], role: 'BUYER', onStart: vi.fn(), startingId: 't-prop' });
    const btn = screen.getByRole('button', { name: /starting/i });
    expect(btn).toBeDisabled();
  });

  it('surfaces the real start error, not a generic message', () => {
    renderView({
      experiments: [PROPOSED], role: 'BUYER', onStart: vi.fn(),
      startError: new Error('No resolvable workspace.'),
    });
    expect(screen.getByText(/No resolvable workspace/i)).toBeInTheDocument();
  });
});

describe('TestingView — commit the proposed agenda', () => {
  const AGENDA = [
    { id: 'a1', entityId: 'e1', dimension: 'HOOK', hypothesis: 'Sharper hook' },
    { id: 'a2', entityId: 'e2', dimension: 'OFFER', hypothesis: 'Stronger offer' },
  ];

  it('an operator sees Commit, the true count, and clicking fires onCommit with the full agenda', () => {
    const onCommit = vi.fn();
    renderView({ experiments: [], agenda: AGENDA, role: 'BUYER', onCommit });
    expect(screen.getByText(/Creates 2 proposed experiments/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /commit agenda/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onCommit).toHaveBeenCalledWith(AGENDA);
  });

  it('a non-operator (CLIENT) sees the agenda but never the Commit control', () => {
    renderView({ experiments: [], agenda: AGENDA, role: 'CLIENT', onCommit: vi.fn() });
    expect(screen.getByText(/Sharper hook/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /commit agenda/i })).not.toBeInTheDocument();
  });

  it('reflects the in-flight commit (disabled + Committing…)', () => {
    renderView({ experiments: [], agenda: AGENDA, role: 'BUYER', onCommit: vi.fn(), committing: true });
    const btn = screen.getByRole('button', { name: /committing/i });
    expect(btn).toBeDisabled();
  });

  it('surfaces the real commit error, not a generic message', () => {
    renderView({
      experiments: [], agenda: AGENDA, role: 'BUYER', onCommit: vi.fn(),
      commitError: new Error('picks[] is required'),
    });
    expect(screen.getByText(/picks\[\] is required/i)).toBeInTheDocument();
  });

  it('shows no Commit control when there is no agenda to commit', () => {
    renderView({ experiments: [], agenda: [], role: 'BUYER', onCommit: vi.fn() });
    expect(screen.queryByRole('button', { name: /commit agenda/i })).not.toBeInTheDocument();
  });
});

describe('TestingView — promote a concluded test into a holdout (Phase 7C bridge)', () => {
  it('a STRATEGIST opens the design form; submitting fires onPromote with the derived payload (% → fraction, channel upper)', () => {
    const onPromote = vi.fn().mockResolvedValue({ id: 'inc-1' });
    renderView({ experiments: [CONCLUDED_WINNER], role: 'STRATEGIST', onPromote });
    fireEvent.click(screen.getByRole('button', { name: /promote to holdout/i }));
    fireEvent.change(screen.getByLabelText(/daily eligible users/i), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText(/minimum detectable lift percent/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/^channel$/i), { target: { value: 'meta' } });
    fireEvent.click(screen.getByRole('button', { name: /design holdout/i }));
    expect(onPromote).toHaveBeenCalledWith('t-win', { dailyEligible: 4000, mde: 0.2, channel: 'META' });
  });

  it('omits the optional fields when left blank (backend derives baseline + seeds mde)', () => {
    const onPromote = vi.fn().mockResolvedValue({ id: 'inc-1' });
    renderView({ experiments: [CONCLUDED_WINNER], role: 'STRATEGIST', onPromote });
    fireEvent.click(screen.getByRole('button', { name: /promote to holdout/i }));
    fireEvent.change(screen.getByLabelText(/daily eligible users/i), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: /design holdout/i }));
    expect(onPromote).toHaveBeenCalledWith('t-win', { dailyEligible: 4000 });
  });

  it('a BUYER sees the affordance but is told it needs a strategist — promote never fires', () => {
    const onPromote = vi.fn();
    renderView({ experiments: [CONCLUDED_WINNER], role: 'BUYER', onPromote });
    fireEvent.click(screen.getByRole('button', { name: /promote to holdout/i }));
    expect(screen.getByText(/Holdout design requires STRATEGIST role/i)).toBeInTheDocument();
    expect(onPromote).not.toHaveBeenCalled();
  });

  it('reflects the in-flight promote (disabled + Promoting…)', () => {
    renderView({ experiments: [CONCLUDED_WINNER], role: 'STRATEGIST', onPromote: vi.fn(), promotingId: 't-win' });
    fireEvent.click(screen.getByRole('button', { name: /promote to holdout/i }));
    expect(screen.getByRole('button', { name: /promoting/i })).toBeDisabled();
  });

  it('surfaces the real promote error (e.g. tier lock) inline, not a generic message', () => {
    const err = new Error('Holdout testing requires Enterprise tier — upgrade in Settings.');
    renderView({ experiments: [CONCLUDED_WINNER], role: 'STRATEGIST', onPromote: vi.fn(), promoteError: err });
    fireEvent.click(screen.getByRole('button', { name: /promote to holdout/i }));
    expect(screen.getByText(/requires Enterprise tier/i)).toBeInTheDocument();
  });

  it('offers no promote control on a RUNNING test — only CONCLUDED', () => {
    renderView({ experiments: [RUNNING_READY], role: 'STRATEGIST', onPromote: vi.fn() });
    expect(screen.queryByRole('button', { name: /promote to holdout/i })).not.toBeInTheDocument();
  });
});

describe('contract seam — TestExperimentSchema safeParses a real row', () => {
  it('validates the concluded fixture', () => {
    expect(TestExperimentSchema.safeParse(CONCLUDED_WINNER).success).toBe(true);
  });
});
