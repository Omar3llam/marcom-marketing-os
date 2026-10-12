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

describe('ReadyStep — read and connection truth', () => {
  it.each([
    ['campaign failure with successful empty verdicts', [], [], new Error('campaigns'), null],
    ['verdict failure with successful empty campaigns', [], [], null, new Error('verdicts')],
    ['campaign failure with successful populated verdicts', [], [{ verdict: 'KILL', name: 'Winner', spendMinor: 100 }], new Error('campaigns'), null],
    ['verdict failure with successful populated campaigns', [{ entityId: 'a' }], [], null, new Error('verdicts')],
    ['both reads fail', [], [], new Error('campaigns'), new Error('verdicts')],
    ['failed reads retain stale data', [{ entityId: 'a' }], [{ verdict: 'SCALE', name: 'Old verdict' }], new Error('campaigns'), new Error('verdicts')],
  ])('%s cannot publish completed, empty or numeric results', (_name, campaigns, verdicts, campaignError, verdictError) => {
    campaignsMock.mockReturnValue({ campaigns, loading: false, error: campaignError });
    verdictsMock.mockReturnValue({ verdicts, loading: false, error: verdictError });
    const onEnterApp = vi.fn();
    render(<ReadyStep onEnterApp={onEnterApp} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/results.*couldn.t be loaded/i);
    expect(screen.queryByText(/analysis complete|your first verdict/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no campaigns found|no verdicts requiring/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verdicts appear|Lumi scored|recommendation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ (Campaigns?|Verdicts?)$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^(KILL|SCALE)$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open campaigns/i }));
    expect(onEnterApp).toHaveBeenCalledTimes(1);
  });

  it.each(['campaigns', 'verdicts'])('%s still loading cannot publish final results', (pending) => {
    campaignsMock.mockReturnValue({ campaigns: [], loading: pending === 'campaigns', error: null });
    verdictsMock.mockReturnValue({ verdicts: [], loading: pending === 'verdicts', error: null });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText(/analysis complete|no campaigns found|0 campaigns/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['no connections', { data: { connections: [] }, loading: false, error: null }],
    ['Meta disconnected', { data: { connections: [{ platform: 'META', connected: false }] }, loading: false, error: null }],
    ['different provider connected', { data: { connections: [{ platform: 'GOOGLE', connected: true }] }, loading: false, error: null }],
    ['connection read pending with old Meta data', { data: { connections: [{ platform: 'META', connected: true, isActive: true }] }, loading: true, error: null }],
    ['connection read failed with old Meta data', { data: { connections: [{ platform: 'META', connected: true, isActive: true }] }, loading: false, error: new Error('connections') }],
  ])('%s does not certify Meta or block valid campaign results', (_name, connectionRead) => {
    connectionsMock.mockReturnValue(connectionRead);
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText('Meta')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /no campaigns in the assessment result/i })).toBeInTheDocument();
    expect(screen.queryByText(/0.*campaign/i)).not.toBeInTheDocument();
  });

  it('a successful connection read certifies only a connected Meta entry', () => {
    connectionsMock.mockReturnValue({ data: { workspaceId: 'ws_1', connections: [{ platform: 'META', connected: true, isActive: true }] }, loading: false, error: null });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText('Meta').querySelector('svg')).toHaveClass('lucide-circle-check');
    expect(screen.queryByText(/0.*campaign/i)).not.toBeInTheDocument();
  });

  it('a recovered required read replaces the error with the successful verdict summary', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }], loading: false, error: null });
    verdictsMock.mockReturnValue({ verdicts: [], loading: false, error: new Error('verdicts') });
    const view = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'SCALE', name: 'Recovered', confidence: 0.9 }], loading: false, error: null });
    view.rerender(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('SCALE')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.getByText('1 returned campaign')).toBeInTheDocument();
    expect(screen.getByText('1 returned verdict')).toBeInTheDocument();
  });
});

describe('ReadyStep — verdict-first', () => {
  it('while loading, renders a meaningful heading and one static waiting status, never invented content', () => {
    verdictsMock.mockReturnValue({ verdicts: [], loading: true });
    campaignsMock.mockReturnValue({ campaigns: [], loading: true });
    const { container } = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your results' })).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for campaign and verdict results.');
    expect(container.querySelector('.animate-pulse, .animate-spin')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByText(/recommendation|confidence|analysis complete|\d+ campaigns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your first verdict/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['KILL', 'SCALE'])('populated %s makes the supplied call the only h1 without a verdict live region', (verdict) => {
    verdictsMock.mockReturnValue({ verdicts: [{ verdict, name: 'Supplied campaign', confidence: 0.8 }], loading: false });
    const { container } = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: verdict })).toBeInTheDocument();
    expect(screen.getByText(verdict)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('names the current assessment tense without creating a stored Decision or executable action', () => {
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'KILL', name: 'Supplied', confidence: 0.8,
      rationale: 'Supplied grounds.', recommendation: 'Supplied recommendation.' }], loading: false, status: 'OK', gatedOut: [] });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/NOW.*Current assessment/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reason', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recommendation', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/AT DECISION|Record decision|Execute|Outcome|Memory/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it.each(['campaigns', 'verdicts'])('pending %s keeps one h1/status and does not move focus when data arrives', (pending) => {
    campaignsMock.mockReturnValue({ campaigns: [], loading: pending === 'campaigns' });
    verdictsMock.mockReturnValue({ verdicts: [], loading: pending === 'verdicts' });
    const view = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
    campaignsMock.mockReturnValue({ campaigns: [], loading: false });
    verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [], status: 'NO_CAMPAIGNS', loading: false });
    view.rerender(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'No campaigns in the assessment result.' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it('leads with the verdict: eyebrow → verdict → CTA → status chips', () => {
    campaignsMock.mockReturnValue({
      campaigns: [{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }],
      loading: false,
    });
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'KILL', name: 'Alexandria Villas', confidence: 0.9, rationale: 'ROAS below break-even.', spendMinor: 500000 }],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);

    expect(screen.getByText(/your first verdict/i)).toBeInTheDocument();
    const verdictHero = screen.getByText('KILL');
    const chip = screen.getByText('3 returned campaigns');
    // The verdict precedes the status chips in document order.
    expect(verdictHero.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Alexandria Villas')).toBeInTheDocument();
    expect(screen.getByText(/ROAS below break-even/i)).toBeInTheDocument();
  });

  it('falls back to the deterministic per-verdict recommendation', () => {
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'KILL', name: 'X', confidence: 0.9, spendMinor: 100 }],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/pause this campaign today/i)).toBeInTheDocument();
  });

  it('prefers a backend-authored recommendation when one exists', () => {
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'KILL', name: 'X', confidence: 0.9, spendMinor: 100, recommendation: 'Shift budget to Ad Set B.' }],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText('Shift budget to Ad Set B.')).toBeInTheDocument();
    expect(screen.queryByText(/pause this campaign today/i)).not.toBeInTheDocument();
  });

  it('ranks the highest-spend KILL/SCALE verdict first', () => {
    verdictsMock.mockReturnValue({
      verdicts: [
        { verdict: 'SCALE', name: 'Small Spend', confidence: 0.8, spendMinor: 10000 },
        { verdict: 'KILL', name: 'Big Spend', confidence: 0.9, spendMinor: 900000 },
      ],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText('Big Spend')).toBeInTheDocument();
    expect(screen.queryByText('Small Spend')).not.toBeInTheDocument();
  });

  it('shows confidence as a percentage, never a word like "High"', () => {
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'SCALE', name: 'Winner', confidence: 0.94, spendMinor: 20000 }],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/94% confidence/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bHigh\b/)).not.toBeInTheDocument();
  });

  it('no KILL/SCALE → honest copy, no claim that campaigns are healthy', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }], loading: false });
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'HOLD', name: 'a' }], gatedOut: [], status: 'OK', loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText(/recommendation/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /no KILL or SCALE call returned/i })).toBeInTheDocument();
    expect(screen.queryByText(/healthy parameters/i)).not.toBeInTheDocument();
  });

  it('campaign rows without a published status do not prove missing revenue', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }], loading: false });
    verdictsMock.mockReturnValue({ verdicts: [], gatedOut: [], loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /assessment availability is unknown/i })).toBeInTheDocument();
    expect(screen.queryByText(/revenue data|after your first sync|analysis complete/i)).not.toBeInTheDocument();
  });

  it('published NO_CAMPAIGNS states the assessment population without zero chips', () => {
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /no campaigns in the assessment result/i })).toBeInTheDocument();
    expect(screen.queryByText(/0.*campaign|0.*verdict/i)).not.toBeInTheDocument();
  });

  it('CTA says "See all verdicts" when there are verdicts', () => {
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'KILL', name: 'X', confidence: 0.9, spendMinor: 100 }],
      loading: false,
    });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('button', { name: /see all verdicts/i })).toBeInTheDocument();
  });

  it('CTA says "Open Campaigns" when there are no verdicts', () => {
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('button', { name: /open campaigns/i })).toBeInTheDocument();
  });

  it('CTA fires onEnterApp', () => {
    const onEnterApp = vi.fn();
    render(<ReadyStep onEnterApp={onEnterApp} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onEnterApp).toHaveBeenCalled();
  });
});
