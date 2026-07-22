import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { verdictsMock, campaignsMock } = vi.hoisted(() => ({
  verdictsMock: vi.fn(),
  campaignsMock: vi.fn(),
}));

vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: () => verdictsMock() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: () => campaignsMock() }));

import { ReadyStep } from './ReadyStep.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  verdictsMock.mockReturnValue({ verdicts: [], loading: false });
  campaignsMock.mockReturnValue({ campaigns: [], loading: false });
});

describe('ReadyStep — verdict-first', () => {
  it('while loading, renders a skeleton (not a spinner or the real content)', () => {
    verdictsMock.mockReturnValue({ verdicts: [], loading: true });
    campaignsMock.mockReturnValue({ campaigns: [], loading: true });
    const { container } = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(/your first verdict/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
    const chip = screen.getByText('3 Campaigns');
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
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'HOLD', name: 'a' }], loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText(/recommendation/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /no verdicts requiring immediate action/i })).toBeInTheDocument();
    expect(screen.queryByText(/healthy parameters/i)).not.toBeInTheDocument();
  });

  it('campaigns but 0 verdicts → says verdicts need revenue data', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }], loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/verdicts appear once your campaigns have revenue data/i)).toBeInTheDocument();
  });

  it('0 campaigns → honest "No campaigns found yet" (never an error)', () => {
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /no campaigns found yet/i })).toBeInTheDocument();
    expect(screen.getByText('0 Campaigns')).toBeInTheDocument();
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
