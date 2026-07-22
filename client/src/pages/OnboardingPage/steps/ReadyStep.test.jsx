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
  it('while loading, renders a skeleton (not a spinner or the real heading)', () => {
    verdictsMock.mockReturnValue({ verdicts: [], loading: true });
    campaignsMock.mockReturnValue({ campaigns: [], loading: true });
    const { container } = render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(/your first verdict is ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('leads with the verdict card, above the "What Lumi analyzed" checklist', () => {
    campaignsMock.mockReturnValue({
      campaigns: [{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }],
      loading: false,
    });
    verdictsMock.mockReturnValue({
      verdicts: [{ verdict: 'KILL', name: 'Alexandria Villas', confidence: 0.9, rationale: 'ROAS below break-even.', spendMinor: 500000 }],
      loading: false,
    });
    const { container } = render(<ReadyStep onEnterApp={vi.fn()} />);

    const verdictName = screen.getByText('Alexandria Villas');
    const checklistLabel = screen.getByText(/what lumi analyzed/i);
    // Verdict content precedes the checklist label in document order.
    expect(verdictName.compareDocumentPosition(checklistLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/pause this campaign today/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
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

  it('with no KILL/SCALE verdict, drops the card for an honest empty state', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }], loading: false });
    verdictsMock.mockReturnValue({ verdicts: [], loading: false });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.queryByText(/recommendation/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no campaigns need action yet/i)).toBeInTheDocument();
    expect(screen.getByText(/1 campaign analyzed/i)).toBeInTheDocument();
  });

  it('0 campaigns → honest "No campaigns found yet" (never an error)', () => {
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /no campaigns found yet/i })).toBeInTheDocument();
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
