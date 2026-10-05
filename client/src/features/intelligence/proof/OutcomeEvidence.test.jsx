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
import { render, screen, within } from '@testing-library/react';

let evidenceState = { evidence: null, loading: false, error: null };

vi.mock('@/hooks/useOutcomeEvidence.js', () => ({
  useOutcomeEvidence: () => evidenceState,
}));
vi.mock('@/lib/money.ts', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, formatCurrency: vi.fn(actual.formatCurrency) };
});
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST' }),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
vi.mock('@/hooks/useRecordOutcome.js', () => ({
  useRecordOutcome: () => ({ record: vi.fn(), recordingId: null, error: null }),
}));

import OutcomeEvidence from './OutcomeEvidence.jsx';
import { OutcomeEvidenceResponseSchema } from '@/contracts/schemas';
import { formatCurrency } from '@/lib/money.ts';

const BASELINE_DAYS = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const OBSERVATION_DAYS = ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'];

const window_ = (days, over = {}) => ({
  days,
  spendMinor: 350_000,
  revenueMinor: 175_000,
  roas: 0.5,
  currency: 'USD',
  currencyProvenance: 'PLATFORM_REPORTED',
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
  delta: { spendMinor: -280_000, revenueMinor: -91_000, roas: 0.7, currency: 'USD', currencyProvenance: 'PLATFORM_REPORTED' },
  ...over,
});

const show = (over) => {
  evidenceState = { evidence: evidenceOf(over), loading: false, error: null };
  render(<OutcomeEvidence decisionId="dec-1" currency="USD" />);
};

beforeEach(() => { evidenceState = { evidence: null, loading: false, error: null }; vi.clearAllMocks(); });

describe('P7-07C evidence-only money and labelled readouts', () => {
  it('never labels an unproved amount with the outer USD currency', () => {
    show({ baseline: window_(BASELINE_DAYS, { currency: null, currencyProvenance: null }),
      observation: window_(OBSERVATION_DAYS, { currency: null, currencyProvenance: null }),
      delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
    expect(document.body.textContent).not.toMatch(/\$|3,500|1,750|0\.50/);
    expect(formatCurrency).not.toHaveBeenCalled();
  });
  it('every money formatter call has its own explicit published currency', () => {
    show({ status: 'INSUFFICIENT_COVERAGE', observation: window_(OBSERVATION_DAYS, { currency: 'EGP' }),
      delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
    expect(formatCurrency.mock.calls).toEqual([[350000, 'USD'], [350000, 'EGP'], [175000, 'USD'], [175000, 'EGP']]);
  });
  it('each incomplete safe side uses its own currency without a delta', () => {
    show({ status: 'INSUFFICIENT_COVERAGE', observation: window_(OBSERVATION_DAYS, { currency: 'EGP' }),
      delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
    const records = screen.getByRole('region', { name: 'Observed performance records' });
    const spend = within(records).getByRole('article', { name: 'Spend evidence' });
    expect(spend.textContent).toMatch(/\$/);
    expect(spend.textContent).toMatch(/EGP|ج\.م/);
    expect(spend.textContent).not.toMatch(/Observed change/);
  });
  it('monetary refusal explains the basis without displaying a before/after comparison', () => {
    show({ status: 'NOT_MEASURABLE', reason: 'MONETARY_BASIS_UNAVAILABLE' });
    expect(screen.getByText(/authoritative denomination/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/3,500|Observed change|reconnect|conversion|FX/i);
  });
  it('desktop has a named table with row/column headers and associated windows', () => {
    show();
    const table = screen.getByRole('table', { name: 'Observed performance comparison' });
    for (const label of ['Spend', 'Revenue', 'ROAS']) expect(within(table).getByRole('rowheader', { name: label })).toHaveAttribute('scope', 'row');
    expect(within(table).getByRole('columnheader', { name: /Before.*2026-08-03.*2026-08-09/ })).toHaveAttribute('scope', 'col');
    expect(within(table).getByRole('columnheader', { name: /After.*2026-08-11.*2026-08-17/ })).toHaveAttribute('scope', 'col');
    expect(within(table).getByRole('columnheader', { name: 'Observed change' })).toHaveAttribute('scope', 'col');
  });
  it('mobile labelled records preserve the desktop presentation values/windows', () => {
    show();
    const table = screen.getByRole('table', { name: 'Observed performance comparison' });
    const records = screen.getByRole('region', { name: 'Observed performance records' });
    for (const label of ['Spend', 'Revenue', 'ROAS']) {
      const record = within(records).getByRole('article', { name: `${label} evidence` });
      const desktop = within(table).getByRole('rowheader', { name: label }).parentElement;
      const mobileValues = [...record.querySelectorAll('dd')].map(node => node.textContent);
      expect(mobileValues).toEqual([...desktop.querySelectorAll('td')].map(node => node.textContent));
      expect(record.textContent).toMatch(/Before.*2026-08-03.*2026-08-09/);
      expect(record.textContent).toMatch(/After.*2026-08-11.*2026-08-17/);
    }
  });
});

describe('MEASURABLE', () => {
  it('shows both windows and the observed change', () => {
    show();
    expect(screen.getByText(/What Lumi observed/)).toBeInTheDocument();
    expect(screen.getAllByText(/Observed change/)).toHaveLength(4);
    expect(screen.getAllByText(/2026-08-03 → 2026-08-09/)).toHaveLength(4);
    expect(screen.getAllByText(/2026-08-11 → 2026-08-17/)).toHaveLength(4);
    expect(screen.getAllByText(/2,800/)).toHaveLength(2);   // desktop and mobile spend change
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
    delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null },
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

  // RENAMED IN B5-01Y. This case was called "UNAVAILABLE" and never exercised
  // the UNAVAILABLE status — it drives the TRANSPORT path (a rejected request),
  // which is a different branch entirely. The name is why the real defect hid:
  // the suite looked like it covered the state. The status is covered below.
  it('a rejected REQUEST says the read failed and prints no number', () => {
    evidenceState = { evidence: null, loading: false, error: new Error('boom') };
    render(<OutcomeEvidence decisionId="dec-1" currency="USD" />);
    const text = document.body.textContent;
    expect(text).toMatch(/Evidence could not be read/i);
    expect(text).toMatch(/rather than a zero/i);
    expect(text).not.toMatch(/0\.00/);
  });

  it('AMBIGUOUS refuses to pick a reading', () => {
    show({ status: 'AMBIGUOUS', reason: 'AMBIGUOUS_OBSERVATION', delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
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
      delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null },
    });
    const text = document.body.textContent;
    expect(text).toMatch(/No usable evidence was observed/i);
    expect(text).toMatch(/holds none across the compared windows/i);
    expect(text).not.toMatch(/0\.00/);
  });
});

// ── B5-01Y · a failed read must not impersonate incompatible evidence ──
// The defect this section exists to keep closed: `readOutcomeEvidence` catches a
// failed evidence read and RETURNS a refusal, so the endpoint answers HTTP 200
// with `status: 'UNAVAILABLE'`. The component's `if (error || !evidence)` guard
// therefore does not fire — `error` is null and the payload is valid — and
// before this slice the status matched no branch and fell through to the
// NOT_MEASURABLE fallback, which told the operator Lumi "holds observations
// either side of the intervention". It held none; it never managed to look.
//
// Lumi must never tell an operator that observations are incompatible when it
// never successfully read them.
//
// EXACTLY what `refusal(EVIDENCE_STATUS.UNAVAILABLE, null, { ...base, source })`
// produces, serialised through res.json(): null windows, null deltas, a null
// reason, and the policy block (which is computed BEFORE the read is attempted).
const PRODUCTION_UNAVAILABLE = Object.freeze({
  workspaceId: 'ws', decisionId: 'dec-1', entityId: 'ent-1', entityLevel: 'CAMPAIGN',
  verdict: 'KILL', interventionAt: '2026-08-10T09:30:00.000Z', interventionDay: '2026-08-10',
  source: 'META',
  status: 'UNAVAILABLE', reason: null,
  policy: {
    comparisonWindowDays: 7,
    baselineWindow: { start: '2026-08-03T00:00:00.000Z', end: '2026-08-09T00:00:00.000Z' },
    observationWindow: { start: '2026-08-11T00:00:00.000Z', end: '2026-08-17T00:00:00.000Z' },
    interventionDayExcluded: true,
  },
  baseline: null, observation: null,
  delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null },
});

const renderPayload = (payload) => {
  evidenceState = { evidence: payload, loading: false, error: null };
  render(<OutcomeEvidence decisionId="dec-1" currency="USD" />);
  return document.body.textContent;
};

describe('B5-01Y · backend UNAVAILABLE reaches the operator as UNAVAILABLE', () => {
  // THE RATCHET'S FOUNDATION. A hand-written fixture can drift into a shape the
  // API could never return — which is exactly how the original "UNAVAILABLE"
  // test passed while testing nothing. Parsing it through the production
  // response contract means this suite fails the day the two disagree.
  it('the fixture is a payload the real API contract accepts', () => {
    const parsed = OutcomeEvidenceResponseSchema.safeParse(PRODUCTION_UNAVAILABLE);
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('UNAVAILABLE');
    // …and it is NOT the transport path: there is a valid payload and no error.
    expect(PRODUCTION_UNAVAILABLE.baseline).toBeNull();
    expect(PRODUCTION_UNAVAILABLE.observation).toBeNull();
  });

  it('T1 · renders the read-failure state, never the NOT_MEASURABLE fallback', () => {
    const text = renderPayload(PRODUCTION_UNAVAILABLE);
    expect(text).toMatch(/Evidence unavailable/i);
    // The exact sentence the defect produced, named so a regression is obvious.
    expect(text).not.toMatch(/can’t be compared/i);
    expect(text).not.toMatch(/holds observations either side/i);
  });

  it('T1 · does not borrow any other state’s meaning', () => {
    const text = renderPayload(PRODUCTION_UNAVAILABLE);
    expect(text).not.toMatch(/No usable evidence was observed/i); // NOT_OBSERVED
    expect(text).not.toMatch(/can’t measure this one automatically/i); // UNSUPPORTED
    expect(text).not.toMatch(/couldn’t be reconciled/i); // AMBIGUOUS
    expect(text).not.toMatch(/What Lumi observed/i); // MEASURABLE
    expect(text).not.toMatch(/incomplete evidence/i); // INSUFFICIENT_COVERAGE
  });

  it('T1 · shows no number at all — nothing was measured to report', () => {
    const text = renderPayload(PRODUCTION_UNAVAILABLE);
    // Deliberately strict. The policy windows ARE known here (they are computed
    // before the read is attempted), and printing them would imply Lumi looked
    // at those days. It did not.
    expect(text).not.toMatch(/[0-9]/);
    expect(text).not.toMatch(/Observed change/i);
  });

  it('T2 · every state still renders its own distinct heading', () => {
    const seen = new Map();
    const cases = [
      ['MEASURABLE', evidenceOf()],
      ['INSUFFICIENT_COVERAGE', evidenceOf({ status: 'INSUFFICIENT_COVERAGE', delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } })],
      ['NOT_OBSERVED', evidenceOf({ status: 'NOT_OBSERVED' })],
      ['AMBIGUOUS', evidenceOf({ status: 'AMBIGUOUS' })],
      ['UNSUPPORTED', evidenceOf({ status: 'UNSUPPORTED', reason: 'CHANNEL_HAS_NO_DAILY_CAPABILITY', baseline: null, observation: null })],
      ['NOT_MEASURABLE', evidenceOf({ status: 'NOT_MEASURABLE', reason: 'DIFFERENT_SOURCE' })],
      ['UNAVAILABLE', PRODUCTION_UNAVAILABLE],
    ];
    for (const [name, payload] of cases) {
      document.body.innerHTML = '';
      const heading = renderPayload(payload).slice(0, 60);
      // No two states may share the sentence an operator reads first.
      expect(seen.has(heading)).toBe(false);
      seen.set(heading, name);
    }
    expect(seen.size).toBe(cases.length);
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
