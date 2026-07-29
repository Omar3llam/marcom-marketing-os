// ============================================================
// Where the track record actually appears
// ------------------------------------------------------------
// Wiring, not logic: both surfaces must ask for the record with the right
// entity, render it under the recommendation, and — the part that matters —
// render NOTHING when there is no defensible sample, which is the common case.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { useDecisionLearning } = vi.hoisted(() => ({ useDecisionLearning: vi.fn() }));
vi.mock('@/hooks/useDecisionLearning.js', () => ({ useDecisionLearning }));

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
vi.mock('../decisionSignals.js', () => ({ recordExplain: vi.fn(), recordIntent: vi.fn() }));

import { ExecutionContext } from '../ExecutionContext.jsx';
import { CampaignDetailPanel } from '../CampaignDetailPanel.jsx';

const ENTITY = 'c1c1c1c1-0000-4000-8000-000000000001';
const TALLY = { total: 12, improved: 9, unchanged: 2, worsened: 1, unscored: 0 };

// Campaign CTR 2.0%; the worst ad set is 80% below it, so ExecutionContext has
// a real pick to render (it is silent otherwise).
const campaign = (over = {}) => ({
  entityId: ENTITY, name: 'Eid Sale', channel: 'META', externalId: '120200',
  objective: 'OUTCOME_SALES', spendMinor: 500_000, ctr: 0.02,
  frequency: 2.0, roas: null, currency: 'USD', ...over,
});
const adSets = [
  { entityId: 'a1', name: 'Broad', channel: 'META', ctr: 0.004, spendMinor: 300_000, impressions: 90_000, frequency: 2.0, status: 'ACTIVE' },
  { entityId: 'a2', name: 'Lookalike', channel: 'META', ctr: 0.025, spendMinor: 200_000, impressions: 80_000, frequency: 1.8, status: 'ACTIVE' },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { reasoning: null, stale: false, generatedAt: null } });
  useDecisionLearning.mockReturnValue(TALLY);
});

describe('ExecutionContext', () => {
  const setup = () => render(<ExecutionContext campaign={campaign()} adSets={adSets} verdict="KILL" />);

  it('asks for the record with the campaign entity id', () => {
    setup();
    expect(useDecisionLearning).toHaveBeenCalledWith(ENTITY);
  });

  it('renders the record under the recommended action', () => {
    setup();
    expect(screen.getByText('9 of 12')).toBeInTheDocument();
    expect(screen.getByText(/Recommended action/i)).toBeInTheDocument();
  });

  it('renders no record section when there is no track record', () => {
    useDecisionLearning.mockReturnValue(null);
    setup();
    expect(screen.queryByText(/similar decisions improved/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Recommended action/i)).toBeInTheDocument(); // the rest survives
  });
});

describe('CampaignDetailPanel', () => {
  // KILL so the ActionBar renders — the record sits directly under it.
  const setup = () => render(<CampaignDetailPanel campaign={campaign()} verdict="KILL" impact={9} />);

  it('asks for the record with the campaign entity id', () => {
    setup();
    expect(useDecisionLearning).toHaveBeenCalledWith(ENTITY);
  });

  it('renders the record below the action bar', () => {
    setup();
    expect(screen.getByText('9 of 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy the KILL/i })).toBeInTheDocument();
  });

  it('renders nothing when there is no track record', () => {
    useDecisionLearning.mockReturnValue(null);
    setup();
    expect(screen.queryByText(/similar decisions improved/i)).not.toBeInTheDocument();
  });

  // HOLD/WATCH get no ActionBar, so there is no action for a track record to
  // sit under — it must not appear on its own.
  it('is absent on a verdict with no action bar', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="HOLD" impact={3} />);
    expect(screen.queryByText(/similar decisions improved/i)).not.toBeInTheDocument();
  });
});
