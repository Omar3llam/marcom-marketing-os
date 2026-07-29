// ============================================================
// The three clicks that record lifecycle signals
// ------------------------------------------------------------
// Wiring, not logic: the signals only mean anything if they actually fire from
// the controls a human uses. Three of them, and one thing each must NOT do —
// none may block or break the action the user actually took.
//
//   "Explain decision"  → explain  (opening the reasoning is not intent)
//   "Copy decision"     → intent   (only on a SUCCESSFUL copy)
//   "Open in {channel}" → intent
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { recordExplain, recordIntent } = vi.hoisted(() => ({
  recordExplain: vi.fn(), recordIntent: vi.fn(),
}));
vi.mock('../decisionSignals.js', () => ({ recordExplain, recordIntent }));

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('@/lib/clipboard.js', () => ({ copyToClipboard }));

import { CampaignDetailPanel } from '../CampaignDetailPanel.jsx';

const ENTITY = 'c1c1c1c1-0000-4000-8000-000000000001';

// KILL so the ActionBar renders — nextActionFor returns null for HOLD/WATCH.
const campaign = (over = {}) => ({
  entityId: ENTITY, name: 'Eid Sale', channel: 'META', externalId: '120200',
  objective: 'OUTCOME_SALES', spendMinor: 50_000, ctr: 0.0523,
  frequency: 2.04, roas: null, currency: 'EGP', ...over,
});

const renderPanel = (over) =>
  render(<CampaignDetailPanel campaign={campaign(over)} verdict="KILL" impact={9} />);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { reasoning: null, stale: false, generatedAt: null } });
  copyToClipboard.mockResolvedValue({ ok: true });
  recordIntent.mockResolvedValue(null);
  recordExplain.mockResolvedValue(null);
});

describe('Copy decision → intent', () => {
  it('records intent with the entity id', async () => {
    renderPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy the KILL/i })); });
    expect(recordIntent).toHaveBeenCalledWith(ENTITY);
  });

  // A failed copy means the recommendation never left the app, so treating it as
  // "the operator acted on this" would put an un-actionable decision into the
  // learning set.
  it('records nothing when the copy fails', async () => {
    copyToClipboard.mockResolvedValue({ ok: false });
    renderPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy the KILL/i })); });
    expect(recordIntent).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't copy/i)).toBeInTheDocument();
  });

  // Telemetry is worth losing; the copy is not.
  it('still reports a successful copy when the signal fails', async () => {
    recordIntent.mockRejectedValue(new Error('offline'));
    renderPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy the KILL/i })); });
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});

describe('Open in {channel} → intent', () => {
  it('records intent on the platform link', async () => {
    renderPanel();
    const link = screen.getByRole('link', { name: /open in META/i });
    await act(async () => { fireEvent.click(link); });
    expect(recordIntent).toHaveBeenCalledWith(ENTITY);
  });

  // No verified deep-link → no link at all, so nothing to record.
  it('no link, no signal, when the row has no platform id', async () => {
    renderPanel({ externalId: null });
    expect(screen.queryByRole('link', { name: /open in/i })).not.toBeInTheDocument();
    expect(recordIntent).not.toHaveBeenCalled();
  });
});

describe('the two signals stay distinct', () => {
  it('acting on a decision never records an explain', async () => {
    renderPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy the KILL/i })); });
    expect(recordExplain).not.toHaveBeenCalled();
  });
});
