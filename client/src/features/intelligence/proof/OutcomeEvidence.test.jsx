// ============================================================
// OutcomeEvidence — B5-01X' · the states must not collapse into each other
// ============================================================
// The product claim being defended is narrow and load-bearing: an operator must
// be able to tell "we looked and saw nothing" from "we cannot look here" from
// "the read failed", and must never be shown a number Lumi did not measure.
//
// The last test is the one that matters most — evidence appears beside the form
// and fills none of it.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let evidenceState = { evidence: null, loading: false, error: null };

vi.mock('@/hooks/useOutcomeEvidence.js', () => ({
  useOutcomeEvidence: () => evidenceState,
}));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST' }),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
vi.mock('@/hooks/useRecordOutcome.js', () => ({
  useRecordOutcome: () => ({ record: vi.fn(), recordingId: null, error: null }),
}));

import OutcomeEvidence from './OutcomeEvidence.jsx';

const BASELINE_DAYS = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const OBSERVATION_DAYS = ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'];

const window_ = (days, over = {}) => ({
  days,
  spendMinor: 350_000,
  revenueMinor: 175_000,
  roas: 0.5,
  currency: 'USD',
  coverage: { required: 7, observed: days.length, missing: [], complete: true },
  refs: [],
  ...over,
});

const evidenceOf = (over = {}) => ({
  workspaceId: 'ws', decisionId: 'dec-1', entityId: 'ent-1', entityLevel: 'CAMPAIGN',
  verdict: 'KILL', interventionAt: '2026-08-10T09:30:00.000Z', interventionDay: '2026-08-10',
  source: 'META', status: 'MEASURABLE', reason: null,
  policy: {
    comparisonWindowDays: 7,
    baselineWindow: { start: '2026-08-03T00:00:00.000Z', end: '2026-08-09T00:00:00.000Z' },
    observationWindow: { start: '2026-08-11T00:00:00.000Z', end: '2026-08-17T00:00:00.000Z' },
    interventionDayExcluded: true,
  },
  baseline: window_(BASELINE_DAYS),
  observation: window_(OBSERVATION_DAYS, { spendMinor: 70_000, revenueMinor: 84_000, roas: 1.2 }),
  delta: { spendMinor: -280_000, revenueMinor: -91_000, roas: 0.7 },
  ...over,
});

const show = (over) => {
  evidenceState = { evidence: evidenceOf(over), loading: false, error: null };
  render(<OutcomeEvidence decisionId="dec-1" currency="USD" />);
};

beforeEach(() => { evidenceState = { evidence: null, loading: false, error: null }; });

describe('MEASURABLE', () => {
  it('shows both windows and the observed change', () => {
    show();
    expect(screen.getByText(/What Lumi observed/)).toBeInTheDocument();
    expect(screen.getByText(/Observed change/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-03 → 2026-08-09/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-11 → 2026-08-17/)).toBeInTheDocument();
    expect(screen.getByText(/2,800/)).toBeInTheDocument();   // the spend change
  });

  it('names the excluded intervention day', () => {
    show();
    expect(screen.getByText(/2026-08-10 itself is in neither window/)).toBeInTheDocument();
  });

  it('never claims the decision caused the change', () => {
    show();
    const text = document.body.textContent;
    expect(text).toMatch(/not a finding that the decision caused it/i);
    expect(text).not.toMatch(/successful|worked|proved|because of the decision/i);
  });
});

describe('INSUFFICIENT_COVERAGE', () => {
  const partial = () => show({
    status: 'INSUFFICIENT_COVERAGE',
    observation: window_(OBSERVATION_DAYS, {
      spendMinor: 40_000,
      revenueMinor: 48_000,
      coverage: { required: 7, observed: 4, missing: ['2026-08-15', '2026-08-16', '2026-08-17'], complete: false },
    }),
    delta: { spendMinor: null, revenueMinor: null, roas: null },
  });

  it('states the coverage and names the missing dates', () => {
    partial();
    expect(screen.getByText(/observed 4 of 7 required days/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-15, 2026-08-16, 2026-08-17/)).toBeInTheDocument();
  });

  it('shows no derived change at all', () => {
    partial();
    expect(screen.queryByText(/Observed change/)).not.toBeInTheDocument();
  });
});

describe('the states that are NOT about the account', () => {
  it('UNSUPPORTED explains the limit and does not imply zero performance', () => {
    show({ status: 'UNSUPPORTED', reason: 'CHANNEL_HAS_NO_DAILY_CAPABILITY', baseline: null, observation: null });
    const text = document.body.textContent;
    expect(text).toMatch(/doesn’t collect daily observations for this channel/i);
    expect(text).toMatch(/not a statement about this campaign/i);
    expect(text).not.toMatch(/no performance|0\.00/);
  });

  it('UNSUPPORTED distinguishes an entity level from a channel', () => {
    show({ status: 'UNSUPPORTED', reason: 'LEVEL_NOT_INGESTED', baseline: null, observation: null });
    expect(screen.getByText(/campaign level only/i)).toBeInTheDocument();
  });

  it('UNAVAILABLE says the read failed and prints no number', () => {
    evidenceState = { evidence: null, loading: false, error: new Error('boom') };
    render(<OutcomeEvidence decisionId="dec-1" currency="USD" />);
    const text = document.body.textContent;
    expect(text).toMatch(/Evidence could not be read/i);
    expect(text).toMatch(/rather than a zero/i);
    expect(text).not.toMatch(/0\.00/);
  });

  it('AMBIGUOUS refuses to pick a reading', () => {
    show({ status: 'AMBIGUOUS', reason: 'AMBIGUOUS_OBSERVATION', delta: { spendMinor: null, revenueMinor: null, roas: null } });
    expect(screen.getByText(/won’t pick one/i)).toBeInTheDocument();
  });
});

describe('NOT_OBSERVED', () => {
  it('is a statement about Lumi’s observations, not the campaign', () => {
    show({
      status: 'NOT_OBSERVED',
      baseline: window_(BASELINE_DAYS, {
        spendMinor: null, revenueMinor: null, roas: null, currency: null,
        coverage: { required: 7, observed: 0, missing: BASELINE_DAYS, complete: false },
      }),
      observation: window_(OBSERVATION_DAYS, {
        spendMinor: null, revenueMinor: null, roas: null, currency: null,
        coverage: { required: 7, observed: 0, missing: OBSERVATION_DAYS, complete: false },
      }),
      delta: { spendMinor: null, revenueMinor: null, roas: null },
    });
    const text = document.body.textContent;
    expect(text).toMatch(/No usable evidence was observed/i);
    expect(text).toMatch(/holds none across the compared windows/i);
    expect(text).not.toMatch(/0\.00/);
  });
});

// ── the boundary this whole slice exists to hold ────────────────
describe('evidence never becomes the operator’s answer', () => {
  it('a MEASURABLE comparison leaves every outcome field empty', async () => {
    evidenceState = { evidence: evidenceOf(), loading: false, error: null };
    vi.doMock('@/hooks/usePendingOutcomes.js', () => ({
      usePendingOutcomes: () => ({
        decisions: [{
          id: 'dec-1', verdict: 'KILL', diagnosis: 'CPA 73% above target',
          entityId: 'ent-1', entityLevel: 'CAMPAIGN',
          createdAt: '2026-08-09T09:00:00.000Z', executedAt: '2026-08-10T09:30:00.000Z',
        }],
        currency: 'USD', loading: false, error: null, refetch: vi.fn(),
      }),
    }));
    const { default: RecordOutcomePanel } = await import('./RecordOutcomePanel.jsx');
    const { fireEvent } = await import('@testing-library/react');

    render(<RecordOutcomePanel />);
    fireEvent.click(screen.getByText(/CPA 73% above target/));

    // The evidence is on screen…
    expect(screen.getByText(/What Lumi observed/)).toBeInTheDocument();
    // …and not one field was filled from it.
    expect(screen.getByLabelText(/Spend change/)).toHaveValue(null);
    expect(screen.getByLabelText(/Revenue change/)).toHaveValue(null);
    expect(screen.getByLabelText(/ROAS change/)).toHaveValue(null);
    expect(screen.getByLabelText(/Window start/)).toHaveValue('');
    expect(screen.getByLabelText(/Window end/)).toHaveValue('');
    expect(screen.getByLabelText(/Measured on/)).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /sustained/i })).not.toBeChecked();
  });
});
