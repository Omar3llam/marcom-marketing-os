// ============================================================
// RecordOutcomePanel — R6 · what the form asks for, and what it never sends
// ============================================================
// The capture side of I19. Three claims:
//   • `measuredAt` is asked for, required, and sent as the operator gave it —
//     never filled in from the clock, which would record the moment of typing as
//     the moment of measurement;
//   • provenance is NOT sent. A browser cannot see MetricSnapshot rows, so
//     anything it attached would be a claim about a database it has never read;
//   • the copy does not present operator-reported numbers as measurements Lumi
//     made.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const record = vi.fn();
const pending = {
  decisions: [{
    id: 'dec-1', verdict: 'KILL', diagnosis: 'CPA 73% above target',
    entityId: 'ent-1', entityLevel: 'ADSET',
    createdAt: '2026-06-01T09:00:00.000Z', executedAt: '2026-06-01T10:00:00.000Z',
  }],
  currency: 'USD',
  loading: false,
  error: null,
  refetch: vi.fn(),
};

vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST' }),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
vi.mock('@/hooks/usePendingOutcomes.js', () => ({ usePendingOutcomes: () => pending }));
vi.mock('@/hooks/useRecordOutcome.js', () => ({
  useRecordOutcome: () => ({ record, recordingId: null, error: recordError }),
}));

import RecordOutcomePanel from './RecordOutcomePanel.jsx';

let recordError = null;

const openForm = () => {
  render(<RecordOutcomePanel />);
  fireEvent.click(screen.getByText(/CPA 73% above target/));
};

const fill = ({ measured = '2026-06-10' } = {}) => {
  fireEvent.change(screen.getByLabelText(/Spend change/), { target: { value: '-4200' } });
  fireEvent.change(screen.getByLabelText(/Revenue change/), { target: { value: '18200' } });
  fireEvent.change(screen.getByLabelText(/ROAS change/), { target: { value: '1.8' } });
  fireEvent.change(screen.getByLabelText(/Window start/), { target: { value: '2026-06-02' } });
  fireEvent.change(screen.getByLabelText(/Window end/), { target: { value: '2026-06-09' } });
  if (measured) fireEvent.change(screen.getByLabelText(/Measured on/), { target: { value: measured } });
};

const submitted = () => record.mock.calls[0][1];

beforeEach(() => {
  vi.clearAllMocks();
  recordError = null;
  record.mockResolvedValue({ outcome: { id: 'out-1' }, previousOutcomeId: null });
});

describe('R6 — the form captures when it was measured', () => {
  it('asks for it, and will not submit without it', () => {
    openForm();
    fill({ measured: null });
    const button = screen.getByRole('button', { name: /Record what actually happened/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(record).not.toHaveBeenCalled();
  });

  it('sends the operator\'s instant, not the browser\'s clock', () => {
    openForm();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Record what actually happened/ }));
    expect(submitted().measuredAt).toBe('2026-06-10T00:00:00.000Z');
    expect(submitted().measuredAt).not.toBe(new Date().toISOString());
  });

  it('does not prefill it — a defaulted date is a value nobody stated', () => {
    openForm();
    expect(screen.getByLabelText(/Measured on/)).toHaveValue('');
  });

  it('keeps it distinct from the window it reports on', () => {
    openForm();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Record what actually happened/ }));
    const body = submitted();
    expect(body.measuredAt).not.toBe(body.windowEnd);
    expect(body.windowStart).toBe('2026-06-02T00:00:00.000Z');
    expect(body.windowEnd).toBe('2026-06-09T00:00:00.000Z');
  });
});

describe('R6 — the form never claims provenance', () => {
  it('sends no evidenceReference — the server projects it from real rows', () => {
    openForm();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Record what actually happened/ }));
    expect(submitted()).not.toHaveProperty('evidenceReference');
    expect(submitted()).not.toHaveProperty('sources');
    expect(submitted()).not.toHaveProperty('observedAt');
  });

  it('shows no evidence summary before anything has been read', () => {
    // There is nothing honest to show at this point: the rows have not been
    // looked at. An empty "Evidence: —" block would imply one had.
    openForm();
    expect(screen.queryByText(/observed/i)).toBeNull();
    expect(screen.queryByText(/rows/i)).toBeNull();
  });

  it('says the numbers are the operator\'s', () => {
    openForm();
    expect(screen.getByText(/These are your numbers/)).toBeTruthy();
  });
});

describe('R6 — an impossible window is explained, not swallowed', () => {
  it('quotes the server\'s 422 so the operator can fix the dates', () => {
    recordError = {
      response: {
        status: 422,
        data: { message: 'recordOutcome: the measurement window opens before the decision was executed' },
      },
    };
    openForm();
    expect(screen.getByText(/before the decision was executed/)).toBeTruthy();
  });

  it('falls back to the generic line for anything the operator cannot fix', () => {
    recordError = { response: { status: 500, data: { message: 'Request failed' } } };
    openForm();
    expect(screen.getByText(/Couldn’t record that outcome/)).toBeTruthy();
  });
});
