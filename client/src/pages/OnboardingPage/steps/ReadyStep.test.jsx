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
  verdictsMock.mockReturnValue({ verdicts: [] });
  campaignsMock.mockReturnValue({ campaigns: [] });
});

describe('ReadyStep', () => {
  it('shows real counts + the KILL/SCALE breakdown', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }, { entityId: 'b' }] });
    verdictsMock.mockReturnValue({ verdicts: [{ verdict: 'KILL' }, { verdict: 'SCALE' }] });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/2 campaigns analyzed/i)).toBeInTheDocument();
    expect(screen.getByText(/2 verdicts ready · 1 to pause · 1 to scale/i)).toBeInTheDocument();
  });

  it('0 campaigns → honest "No campaigns found yet" (not an error)', () => {
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/no campaigns found yet/i)).toBeInTheDocument();
  });

  it('campaigns but 0 verdicts → honest "Verdicts will appear" state', () => {
    campaignsMock.mockReturnValue({ campaigns: [{ entityId: 'a' }] });
    verdictsMock.mockReturnValue({ verdicts: [] });
    render(<ReadyStep onEnterApp={vi.fn()} />);
    expect(screen.getByText(/1 campaign analyzed/i)).toBeInTheDocument();
    expect(screen.getByText(/verdicts will appear once campaigns sync/i)).toBeInTheDocument();
  });

  it('CTA navigates into the app', () => {
    const onEnterApp = vi.fn();
    render(<ReadyStep onEnterApp={onEnterApp} />);
    fireEvent.click(screen.getByRole('button', { name: /open campaigns/i }));
    expect(onEnterApp).toHaveBeenCalled();
  });
});
