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
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useContentHistory.js', () => ({ useContentHistory: vi.fn() }));

import ContentLabView from './ContentLabView.jsx';
import { useOnboardingContext } from '@/hooks/useOnboardingContext.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
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
  useConnectorVerdicts.mockReturnValue({ verdicts: [], gatedOut: [], loading: false, error: null, refetch: vi.fn() });
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

describe('ContentLabView — decision-first diagnosis + recommendations', () => {
  // The engine verdict for the connector campaign 'c1' (Eid Sale).
  const KILL_VERDICT = {
    id: 'c1', name: 'Eid Sale', verdict: 'KILL', confidence: 0.9,
    rationale: 'ROAS 0.40 below break-even with frequency 4.2 past the 3 ceiling.',
    signalType: 'CREATIVE_FATIGUE', relativeRank: null,
  };

  it('renders the engine verdict + rationale + deterministic recs when a scored campaign is picked', () => {
    useConnectorVerdicts.mockReturnValue({ verdicts: [KILL_VERDICT], gatedOut: [], loading: false, error: null, refetch: vi.fn() });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));

    // Verdict badge + confidence + the verdict's own rationale (NOT prose reasoning).
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText(/high confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/below break-even/i)).toBeInTheDocument();
    // Deterministic recommendation for KILL + CREATIVE_FATIGUE.
    expect(screen.getByText(/rotate the creative/i)).toBeInTheDocument();
  });

  it('hides the diagnosis section entirely when no campaign is selected', () => {
    renderView();
    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
    expect(screen.queryByText('Lumi recommends')).not.toBeInTheDocument();
  });

  it('a picked-but-unscored campaign shows an honest "no verdict yet", no fabricated recs', () => {
    // verdicts is empty → the picked campaign has no engine verdict.
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));

    expect(screen.getByText('Diagnosis')).toBeInTheDocument();
    expect(screen.getByText(/no verdict yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Lumi recommends')).not.toBeInTheDocument();
  });
});

describe('ContentLabView — product brief (PR #254)', () => {
  it('clears the product field when a campaign is selected (stale product guard)', () => {
    renderView();
    const productInput = screen.getByPlaceholderText(/golf villa/i);
    fireEvent.change(productInput, { target: { value: 'Typed Product' } });
    expect(productInput.value).toBe('Typed Product');

    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));
    expect(screen.getByPlaceholderText(/golf villa/i).value).toBe('');
  });

  it('does NOT gate Generate on the product field; shows a soft hint that disappears once filled', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));

    // Empty product + a campaign → hint shown, button still enabled.
    expect(screen.getByText(/add a product or service/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate content/i })).not.toBeDisabled();

    // Typing a product hides the hint.
    fireEvent.change(screen.getByPlaceholderText(/golf villa/i), { target: { value: 'Villa' } });
    expect(screen.queryByText(/add a product or service/i)).not.toBeInTheDocument();
  });

  it('sends the product brief to generate; product name is the campaign name when left blank', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /select a campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /eid sale/i }));
    fireEvent.change(screen.getByPlaceholderText(/5% down/i), { target: { value: 'Half price' } });

    fireEvent.click(screen.getByRole('button', { name: /generate content/i }));
    const args = generateSpy.mock.calls[0][0];
    expect(args.campaignContext.offer).toBe('Half price');
    expect(args.campaignContext.product).toBeUndefined(); // left blank → backend falls back to name
    expect(args.campaignContext.name).toBe('Eid Sale');
  });

  it('regenerating from history restores the saved product brief', () => {
    const saved = [{
      id: 'g1',
      content: { copy: [{ tag: 'STORY', text: 'x' }] },
      context: {
        campaignContext: { name: 'Folla', product: 'Saved Villa', offer: 'Half price', keyFacts: 'Move now' },
        options: { copy: true }, tone: 'Warm & familial',
      },
      createdAt: new Date().toISOString(),
      createdBy: { email: 'me@ws.com' },
    }];
    useContentHistory.mockReturnValue({ generations: saved, isLoading: false, error: null, refetch: vi.fn() });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Folla/i }));       // view it
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));  // restore into the form
    expect(screen.getByPlaceholderText(/golf villa/i).value).toBe('Saved Villa');
    expect(screen.getByPlaceholderText(/5% down/i).value).toBe('Half price');
    expect(screen.getByPlaceholderText(/ready to move/i).value).toBe('Move now');
  });

  it('shows the "coming soon" landing-page auto-fill affordance (not wired)', () => {
    renderView();
    const autofill = screen.getByText(/auto-fill from landing page/i);
    expect(autofill).toBeInTheDocument();
    // Its sibling badge (same row) reads "Coming soon" — scoped, since the page
    // has other "Coming soon" labels (video toggle, learning-history band).
    expect(autofill.parentElement).toHaveTextContent(/coming soon/i);
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
