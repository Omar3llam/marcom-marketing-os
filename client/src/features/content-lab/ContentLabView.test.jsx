// ============================================================
// ContentLabView — grounds generation in real onboarding + campaign data
// ------------------------------------------------------------
// Asserts the UI now (1) defaults tone to the onboarding tone and lets the user
// override it for this piece, and (2) hands generateContent the REAL resolved
// brand voice / industry / objective / audience and the picked campaign's real
// CTR — the front half of the chain the backend test finishes.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const generateSpy = vi.fn();

vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { id: 'ws' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: vi.fn() }));
vi.mock('@/hooks/useContentGeneration.js', () => ({
  useContentGeneration: () => ({
    generate: generateSpy, content: null, loading: false, error: null, progress: null, reset: vi.fn(),
  }),
}));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useContentHistory.js', () => ({ useContentHistory: vi.fn() }));

import ContentLabView from './ContentLabView.jsx';
import { useOnboardingContext } from '@/hooks/useOnboardingContext.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useContentHistory } from '@/hooks/useContentHistory.js';

const ONBOARDING = {
  name: 'Acme', industry: 'ecommerce',
  ages: { '25-34': true }, gender: 'female', interests: { Fashion: true },
  language: 'both', dialect: 'egy', tone: 'bold',
  objective: 'roas', customObjective: '',
};

// Connector shape (entity graph + MetricSnapshot): CTR is a FRACTION (0.0185).
const CAMPAIGNS = [{
  entityId: 'c1', name: 'Eid Sale', channel: 'META',
  ctr: 0.0185, frequency: 1.4, roas: 2.1, spendMinor: 50000,
}];

const renderView = () => render(<MemoryRouter><ContentLabView /></MemoryRouter>);

beforeEach(() => {
  generateSpy.mockReset();
  useOnboardingContext.mockReturnValue({ context: ONBOARDING, loading: false, error: null });
  useConnectorCampaigns.mockReturnValue({ campaigns: CAMPAIGNS, loading: false, error: null, refetch: vi.fn() });
  useContentHistory.mockReturnValue({ generations: [], isLoading: false, error: null, refetch: vi.fn() });
});

describe('ContentLabView — tone is grounded in onboarding and overridable', () => {
  it('defaults the tone to the onboarding tone, labelled "from onboarding"', () => {
    renderView();
    expect(screen.getByRole('button', { name: /bold & rebellious/i })).toBeInTheDocument();
    expect(screen.getByText(/from onboarding/i)).toBeInTheDocument();
  });

  it('lets the user override the tone for this piece, dropping the onboarding label', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /bold & rebellious/i }));
    fireEvent.click(screen.getByRole('button', { name: /warm & familial/i }));
    expect(screen.getByRole('button', { name: /warm & familial/i })).toBeInTheDocument();
    expect(screen.queryByText(/from onboarding/i)).not.toBeInTheDocument();
  });
});

describe('ContentLabView — generate sends real grounded data', () => {
  it('hands generateContent the resolved brand fields + the connector campaign’s real CTR', () => {
    renderView();

    // Pick the real connector campaign (labelled by name).
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));

    // Generate.
    fireEvent.click(screen.getByRole('button', { name: /generate content/i }));

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const args = generateSpy.mock.calls[0][0];
    expect(args.brandVoice).toContain('Bold & rebellious');
    expect(args.brandVoice).toContain('Egyptian dialect');
    expect(args.industry).toBe('E-commerce / Retail');
    expect(args.objective).toBe('Maximize ROAS, minimize bleed');
    expect(args.targetAudience).toContain('Fashion');
    expect(args.tone).toBe('Bold & rebellious');
    expect(args.campaignContext.name).toBe('Eid Sale');
    expect(args.campaignContext.ctr).toBe(1.85);        // 0.0185 fraction → 1.85%
    expect(args.campaignContext.problem).toBeUndefined(); // connector rows carry no per-campaign diagnosis
  });

  it('shows the honest sync prompt when no connector campaign has synced', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    expect(screen.getByText(/sync your meta account first/i)).toBeInTheDocument();
  });

  it('sends no fabricated brand fields when the user has not onboarded', () => {
    useOnboardingContext.mockReturnValue({ context: null, loading: false, error: null });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /generate content/i }));

    const args = generateSpy.mock.calls[0][0];
    expect(args.brandVoice).toBeUndefined();
    expect(args.industry).toBeUndefined();
    expect(args.objective).toBeUndefined();
    expect(args.targetAudience).toBeUndefined();
  });
});

describe('ContentLabView — visual format picker drives format + dimensions', () => {
  it('shows the format picker (default Meta Feed · Square) when a visual brief is requested', () => {
    renderView();
    expect(screen.getByRole('button', { name: /meta feed · square/i })).toBeInTheDocument();
    expect(screen.getByText(/1080×1080/)).toBeInTheDocument();
  });

  it('sends the picked format + its real dimensions to generate', () => {
    renderView();
    // Open the format picker and choose Story / Reel.
    fireEvent.click(screen.getByRole('button', { name: /meta feed · square/i }));
    fireEvent.click(screen.getByRole('button', { name: /story \/ reel/i }));

    fireEvent.click(screen.getByRole('button', { name: /generate content/i }));
    const args = generateSpy.mock.calls[0][0];
    expect(args.format).toBe('Story / Reel (9:16)');
    expect(args.dimensions).toBe('1080×1920');
  });

  it('omits format/dimensions entirely when the visual brief is toggled off', () => {
    renderView();
    // Toggle the "Visual brief" option off.
    fireEvent.click(screen.getByText('Visual brief'));
    // The format picker is gone…
    expect(screen.queryByRole('button', { name: /meta feed · square/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate content/i }));
    const args = generateSpy.mock.calls[0][0];
    expect(args.format).toBeUndefined();
    expect(args.dimensions).toBeUndefined();
  });
});

describe('ContentLabView — history rail integration', () => {
  const SAVED = [{
    id: 'g1',
    content: { copy: [{ tag: 'STORY', text: 'a saved story line' }] },
    context: { campaignContext: { name: 'Folla Campaign' }, options: { copy: true }, tone: 'Warm & familial' },
    createdAt: new Date().toISOString(),
    createdBy: { email: 'me@ws.com' },
  }];

  it('empty history → the rail shows the honest empty state', () => {
    renderView();
    expect(screen.getByText(/Your generations will appear here/i)).toBeInTheDocument();
  });

  it('renders saved generations in the rail', () => {
    useContentHistory.mockReturnValue({ generations: SAVED, isLoading: false, error: null, refetch: vi.fn() });
    renderView();
    expect(screen.getByRole('button', { name: /Folla Campaign/i })).toBeInTheDocument();
  });

  it('clicking a saved item populates the output panel with a HISTORICAL badge', () => {
    useContentHistory.mockReturnValue({ generations: SAVED, isLoading: false, error: null, refetch: vi.fn() });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Folla Campaign/i }));
    expect(screen.getByText('HISTORICAL')).toBeInTheDocument();
    expect(screen.getByText('a saved story line')).toBeInTheDocument(); // the saved content renders
    expect(screen.getByRole('button', { name: /back to live/i })).toBeInTheDocument();
  });
});
