import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GATING_REASONS } from '@marcom/runtime-contracts';

const { verdictsMock, campaignsMock, connectionsMock } = vi.hoisted(() => ({
  verdictsMock: vi.fn(),
  campaignsMock: vi.fn(),
  connectionsMock: vi.fn(),
}));

vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: () => verdictsMock() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: () => campaignsMock() }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: () => connectionsMock() }));

import { ReadyStep } from './ReadyStep.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [], status: 'NO_CAMPAIGNS', loading: false });
  campaignsMock.mockReturnValue({ campaigns: [], loading: false });
  connectionsMock.mockReturnValue({ data: { workspaceId: 'ws_1', connections: [] }, loading: false, error: null });
});

describe('P9-06 — published Ready states', () => {
  const gate = (reason) => ({ id: reason, name: 'Supplied gated campaign', ...GATING_REASONS.declarationOf(reason) });
  it.each([
    ['NO_WORKSPACE', /workspace unavailable for assessment/i],
    ['NO_CAMPAIGNS', /no campaigns in the assessment result/i],
    ['NO_ELIGIBLE_CAMPAIGNS', /no eligible campaign assessment/i],
    ['OK', /no KILL or SCALE call returned/i],
    [null, /assessment availability is unknown/i],
    ['FUTURE_STATUS', /assessment availability is unknown/i],
  ])('%s is expressed from the published status, never inferred from empty arrays', (status, heading) => {
    verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [], status, loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
    expect(screen.queryByText(/after your first sync|revenue data|analysis complete|0.*campaign|0.*verdict/i)).not.toBeInTheDocument();
  });

  it.each([
    ['NO_MEASURABLE_DELIVERY', /no measurable delivery/i, /measurable delivery and a revenue source/i],
    ['NO_CANONICAL_WINDOW', /no canonical measurement window/i, /first canonical measurement/i],
    ['CANONICAL_EVIDENCE_STALE', /canonical evidence is stale/i, /fresh canonical measurement/i],
  ])('%s keeps the supplied campaign, reason and prerequisite', (reason, copy, prerequisite) => {
    verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [gate(reason)], status: 'NO_ELIGIBLE_CAMPAIGNS', loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText('Supplied gated campaign')).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument(); expect(screen.getByText(prerequisite)).toBeInTheDocument();
    expect(screen.queryByText(/after your first sync|analysis complete|0.*verdict/i)).not.toBeInTheDocument();
  });

  it.each([
    { id: 'future', name: 'Unmapped campaign', reason: 'NEW_REASON', knowledge: 'NOT_ENOUGH', prerequisite: 'FRESH_MEASUREMENT' },
    { ...gate('NO_CANONICAL_WINDOW'), knowledge: 'KNOWN' },
    { ...gate('CANONICAL_EVIDENCE_STALE'), prerequisite: 'FIRST_MEASUREMENT' },
    { id: 'missing', name: 'Unmapped campaign', reason: 'NO_CANONICAL_WINDOW' },
  ])('unknown or inconsistent gating evidence fails closed: %j', (row) => {
    verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [row], status: 'NO_ELIGIBLE_CAMPAIGNS', loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/this campaign.s assessment availability could not be confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/first canonical measurement|fresh canonical measurement|measurable delivery and a revenue source/i)).not.toBeInTheDocument();
  });

  it.each([null, 'FUTURE_STATUS', 'OK'])('a legitimate supplied verdict stays visible alongside mixed gates and %s status', (status) => {
    verdictsMock.mockReturnValue({ verdicts: [{ id: 'live-call', verdict: 'SCALE', name: 'Supplied winner', confidence: 0.87, spendMinor: 99, rationale: 'Supplied grounds.' }], gatedOut: [gate('NO_CANONICAL_WINDOW'), gate('CANONICAL_EVIDENCE_STALE')], status, loading: false });
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'winner' }, { entityId: 'gated' }], loading: false });
    const onEnterApp = vi.fn(); render(<ReadyStep onEnterApp={onEnterApp} />);
    expect(screen.getByText('SCALE')).toBeInTheDocument(); expect(screen.getByText('Supplied winner')).toBeInTheDocument();
    expect(screen.getByText('Supplied grounds.')).toBeInTheDocument(); expect(screen.getByText('87% confidence')).toBeInTheDocument();
    expect(screen.getByText('2 returned campaigns')).toBeInTheDocument(); expect(screen.getByText('1 returned verdict')).toBeInTheDocument();
    expect(screen.getByText(/no canonical measurement window/i)).toBeInTheDocument(); expect(screen.getByText(/canonical evidence is stale/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'See all verdicts' })); expect(onEnterApp).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { workspaceId: null, connections: [{ platform: 'META', connected: true, isActive: true }] }, loading: false, error: null },
    { data: { workspaceId: ' ', connections: [{ platform: 'META', connected: true, isActive: true }] }, loading: false, error: null },
    { data: { workspaceId: 'ws_1', connections: [{ platform: 'META', connected: true, isActive: true }, { platform: 'META', connected: true, isActive: true }] }, loading: false, error: null },
  ])('unresolved or ambiguous connection evidence never certifies META: %j', (read) => {
    connectionsMock.mockReturnValue(read); render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText('Meta')).not.toBeInTheDocument();
    expect(screen.queryByText(/not connected|connect a channel/i)).not.toBeInTheDocument();
  });

  it('one active META plus inactive historical rows certifies only the current source', () => {
    connectionsMock.mockReturnValue({ data: { workspaceId: 'ws_1', connections: [
      { platform: 'META', connected: true, isActive: true, connection: 'CONNECTED' },
      { platform: 'META', connected: false, isActive: false, connection: 'DISCONNECTED' },
    ] }, loading: false, error: null });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText('Meta').querySelector('svg')).toHaveClass('lucide-circle-check');
  });

  it.each(['loading', 'failed'])('%s takes precedence over retained verdicts, gates and published OK', (state) => {
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'KILL', name: 'Old call' }], gatedOut: [gate('NO_CANONICAL_WINDOW')], status: 'OK', loading: state === 'loading', error: state === 'failed' ? new Error('read') : null });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText('Old call')).not.toBeInTheDocument();
    expect(screen.queryByText(/first canonical measurement|returned verdict|analysis complete/i)).not.toBeInTheDocument();
    expect(screen.getByRole(state === 'loading' ? 'status' : 'alert')).toBeInTheDocument();
  });
});
