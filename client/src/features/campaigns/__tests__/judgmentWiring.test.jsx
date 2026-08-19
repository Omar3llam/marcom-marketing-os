// ============================================================
// R13-b — the wire, end to end on the client side
// ------------------------------------------------------------
// The component tests prove what each state looks like. This one proves the
// chain actually connects:
//
//   connector verdict row → decisionId → surface → DecisionJudgment
//                                                     ↓ click
//                                             PATCH /decisions/:id/judgment
//
// Nothing between the click and the HTTP layer is mocked — not the hook, not
// the signals module. Only `@/lib/api.js` is, and the assertion is on the exact
// URL and the exact body. That is what makes NC8 real: a change that severed
// the threading, dropped the reason, or sent a label instead of an enum code
// fails HERE rather than in production.
//
// The other half of the chain — PATCH → PostgreSQL → decisionLearning →
// byHumanResponse / byHumanReason — is proven against a real database in
// src/utils/decisionJudgmentContract.test.js and is deliberately not duplicated
// with mocks here. A mocked reimplementation of that half would assert our own
// fiction.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const patch = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));
vi.mock('@/lib/api.js', () => ({
  api: { patch, get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn() },
}));

const ev = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} } }));
vi.mock('@/hooks/useEvidence.js', () => ({
  evidenceKey: (id, metric = 'ctr') => `${id}:${metric}`,
  useEvidence: () => ({ load: ev.load, byId: ev.byId.current, loading: {}, errors: {} }),
}));
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
vi.mock('@/hooks/useAdsDrillDown.js', () => ({
  useAdsDrillDown: () => ({ byId: {}, loading: {}, errors: {}, load: vi.fn() }),
}));
vi.mock('@/hooks/useDecisionLearning.js', () => ({ useDecisionLearning: () => null }));
vi.mock('../decisionSignals.js', () => ({
  recordExplain: vi.fn(), recordIntent: vi.fn(),
  recordExecute: vi.fn(() => Promise.resolve()), recordDismiss: vi.fn(() => Promise.resolve()),
}));

import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';
import DecisionCard from '@/features/overview/components/DecisionCard.jsx';
import { decisionFeed } from '@/features/overview/overviewDerive.js';

const AT = '2026-08-19T12:41:00.000Z';
const DEC = 'dec_9a1';
const wrap = (ui) => render(ui, { wrapper: MemoryRouter });

beforeEach(() => {
  vi.clearAllMocks();
  ev.byId.current = {};
});

// ── The join: a verdict row carries the identity and the judgement ──────────
describe('overviewDerive threads decision identity, without a second lookup', () => {
  const verdictRow = (over = {}) => ({
    id: 'c1', rationale: 'CTR collapsed', decisionId: DEC,
    humanResponse: null, humanReasonCode: null, humanReasonNote: null, humanRespondedAt: null,
    ...over,
  });

  it('carries decisionId and all four judgement fields onto the card row', () => {
    const [row] = decisionFeed({
      healthCampaigns: [{ entityId: 'c1', name: 'Ramadan Cold', verdict: 'KILL', impactScore: 9 }],
      connectorCampaigns: [{ entityId: 'c1', ctr: 0.0164, spendMinor: 655_300, currency: 'USD' }],
      verdicts: [verdictRow({
        humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE',
        humanReasonNote: 'prospecting', humanRespondedAt: AT,
      })],
    });

    expect(row.decisionId).toBe(DEC);
    expect(row.humanResponse).toBe('OVERRIDE');
    expect(row.humanReasonCode).toBe('TOF_ROLE');
    expect(row.humanReasonNote).toBe('prospecting');
    expect(row.humanRespondedAt).toBe(AT);
  });

  it('leaves decisionId null for a campaign no sweep has written a decision for', () => {
    // NOT resolved from entityId. "The newest decision for this campaign" is a
    // query, and its answer is a call the operator may never have been shown.
    const [row] = decisionFeed({
      healthCampaigns: [{ entityId: 'c1', name: 'Ramadan Cold', verdict: 'KILL' }],
      connectorCampaigns: [],
      verdicts: [{ id: 'c1', rationale: 'x' }],
    });
    expect(row.decisionId).toBeNull();
    expect(row.humanResponse).toBeNull();
  });
});

// ── Overview: DecisionCard ──────────────────────────────────────────────────
describe('Overview · DecisionCard', () => {
  const card = (over = {}) => (
    <DecisionCard entityId="c1" name="Ramadan Cold" verdict="KILL" decisionId={DEC} {...over} />
  );

  it('asks the question when a decision id is threaded through', () => {
    wrap(card());
    expect(screen.getByText('What did you decide?')).toBeInTheDocument();
  });

  it('asks NOTHING when the threading is absent', () => {
    // NC1: sever the threading and this is the test that notices.
    wrap(card({ decisionId: null }));
    expect(screen.queryByText('What did you decide?')).not.toBeInTheDocument();
  });

  it('renders a judgement persisted by the READ path — the reload case', () => {
    wrap(card({
      humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE',
      humanReasonNote: 'prospecting budget', humanRespondedAt: AT,
    }));
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
    expect(screen.getByText('Top-of-funnel role')).toBeInTheDocument();
    // And no way back to the question.
    expect(screen.queryByText('What did you decide?')).not.toBeInTheDocument();
  });

  it('CONFIRM reaches the API as exactly { response }', async () => {
    patch.mockResolvedValueOnce({ data: { ok: true, recorded: true, humanResponse: 'CONFIRM', humanRespondedAt: AT } });
    wrap(card());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`/api/lumi/decisions/${DEC}/judgment`, { response: 'CONFIRM' });
    await screen.findByText('Your decision');
  });

  it('OVERRIDE reaches the API with the canonical reason code', async () => {
    patch.mockResolvedValueOnce({
      data: { ok: true, recorded: true, humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE', humanRespondedAt: AT },
    });
    wrap(card());
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    // Nothing has been sent yet — the reason is required.
    expect(patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Top-of-funnel role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record Override' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      `/api/lumi/decisions/${DEC}/judgment`,
      { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' },
    );
  });

  it('ADJUST + reason + note reaches the API verbatim', async () => {
    patch.mockResolvedValueOnce({
      data: { ok: true, recorded: true, humanResponse: 'ADJUST', humanReasonCode: 'SEASONALITY', humanRespondedAt: AT },
    });
    wrap(card());
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seasonality' }));
    fireEvent.change(screen.getByPlaceholderText('Optional note'), { target: { value: 'Eid week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Adjust' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      `/api/lumi/decisions/${DEC}/judgment`,
      { response: 'ADJUST', reasonCode: 'SEASONALITY', reasonNote: 'Eid week' },
    );
  });

  it('a 409 shows the judgement the server holds, and never claims success', async () => {
    // NC4: swallow the conflict and this fails — the card would otherwise show
    // the CONFIRM that was refused.
    patch.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          error: 'JudgmentAlreadyRecorded',
          humanResponse: 'OVERRIDE', humanReasonCode: 'BRAND_ROLE',
          humanReasonNote: null, humanRespondedAt: AT,
        },
      },
    });
    wrap(card());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/already recorded/i)).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
    expect(screen.getByText('Brand role')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('a 500 fails honestly and records nothing', async () => {
    patch.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    wrap(card());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Couldn't record your judgment/i)).toBeInTheDocument();
    expect(screen.queryByText('Your decision')).not.toBeInTheDocument();
  });
});

// ── Campaigns: ConnectorCampaignsPanel → CampaignDetailPanel ────────────────
describe('Campaigns · the decision surface', () => {
  const campaign = (over = {}) => ({
    entityId: 'c1', channel: 'META', name: 'Ramadan Cold', adSetCount: 3,
    spendMinor: 655_300, roas: null, ctr: 0.0164, frequency: 2.4, currency: 'USD', ...over,
  });
  const open = () => fireEvent.click(screen.getByLabelText('Toggle details for Ramadan Cold'));

  const panel = (info) => wrap(
    <ConnectorCampaignsPanel
      campaigns={[campaign()]}
      verdicts={{ c1: 'KILL' }}
      verdictInfo={{ c1: info }}
    />,
  );

  it('asks for judgement BELOW the lifecycle question, on the same decision', () => {
    panel({ decisionId: DEC, rationale: 'CTR collapsed' });
    open();
    // Both axes are present, and they are different questions.
    expect(screen.getByText('Did you act on this?')).toBeInTheDocument();
    expect(screen.getByText('What did you decide?')).toBeInTheDocument();
  });

  it('asks nothing when the campaign has no stored decision', () => {
    panel({ decisionId: null, rationale: 'CTR collapsed' });
    open();
    expect(screen.getByText('Did you act on this?')).toBeInTheDocument();
    expect(screen.queryByText('What did you decide?')).not.toBeInTheDocument();
  });

  it('renders a judgement persisted on the verdict row after a reload', () => {
    panel({
      decisionId: DEC, rationale: 'CTR collapsed',
      humanResponse: 'CONFIRM', humanReasonCode: null,
      humanReasonNote: null, humanRespondedAt: AT,
    });
    open();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByText('What did you decide?')).not.toBeInTheDocument();
  });

  it('records an OVERRIDE at the decision the row is showing', async () => {
    patch.mockResolvedValueOnce({
      data: { ok: true, recorded: true, humanResponse: 'OVERRIDE', humanReasonCode: 'BUSINESS_CONSTRAINT', humanRespondedAt: AT },
    });
    panel({ decisionId: DEC, rationale: 'CTR collapsed' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    fireEvent.click(screen.getByRole('button', { name: 'Business constraint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record Override' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      `/api/lumi/decisions/${DEC}/judgment`,
      { response: 'OVERRIDE', reasonCode: 'BUSINESS_CONSTRAINT' },
    );
  });

  it('never sends the verdict, the status or a lifecycle field with a judgement', async () => {
    // NC7: the judgement axis writes four columns and touches nothing else.
    patch.mockResolvedValueOnce({ data: { humanResponse: 'CONFIRM', humanRespondedAt: AT } });
    panel({ decisionId: DEC, rationale: 'CTR collapsed' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [url, body] = patch.mock.calls[0];
    expect(url).toContain('/judgment');
    for (const forbidden of ['verdict', 'status', 'executedAt', 'dismissedAt', 'confidence']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });
});
