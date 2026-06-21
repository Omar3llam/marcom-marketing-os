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
vi.mock('@/hooks/useCampaignFeed.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, useCampaignFeed: vi.fn() };
});

import ContentLabView from './ContentLabView.jsx';
import { useOnboardingContext } from '@/hooks/useOnboardingContext.js';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';

const ONBOARDING = {
  name: 'Acme', industry: 'ecommerce',
  ages: { '25-34': true }, gender: 'female', interests: { Fashion: true },
  language: 'both', dialect: 'egy', tone: 'bold',
  objective: 'roas', customObjective: '',
};

const CAMPAIGNS = [{
  campaign_id: 'camp-1', stage: 'TESTING',
  alerts: [{
    analysis: { root_cause: 'CTR decay from fatigue', verdict: 'OPTIMIZE' },
    metrics: [{ metric: 'CTR', raw: 1.85, value: '1.85%' }],
  }],
}];

const renderView = () => render(<MemoryRouter><ContentLabView /></MemoryRouter>);

beforeEach(() => {
  generateSpy.mockReset();
  useOnboardingContext.mockReturnValue({ context: ONBOARDING, loading: false, error: null });
  useCampaignFeed.mockReturnValue({ campaigns: CAMPAIGNS, loading: false, error: null });
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
  it('hands generateContent the resolved brand fields + the campaign’s real CTR', () => {
    renderView();

    // Pick the real campaign.
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /camp-1/i }));

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
    expect(args.campaignContext.ctr).toBe(1.85);
    expect(args.campaignContext.problem).toBe('CTR decay from fatigue');
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
