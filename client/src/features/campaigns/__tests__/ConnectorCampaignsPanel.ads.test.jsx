// ============================================================
// ConnectorCampaignsPanel — the third level, and what it costs to open
// ------------------------------------------------------------
// Campaign → ad sets → ADS. What this suite pins is the wiring, not the
// rendering (AdRows owns that): which control appears, what the click fetches,
// and that the two evidence dimensions never read each other's cache.
//
// Its own file rather than a block in the existing suites: these need
// useAdsDrillDown and BOTH useEvidence instances mocked, and adding module-level
// mocks to ConnectorCampaignsPanel.test.jsx would change what its existing
// tests exercise.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock('../decisionSignals.js', () => ({ recordExplain: vi.fn(), recordIntent: vi.fn() }));

const comparisonEnvelope = { status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0 };

const drill = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} } }));
vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: drill.byId.current, load: drill.load }),
}));

const ads = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} }, loading: { current: {} }, errors: { current: {} } }));
vi.mock('@/hooks/useAdsDrillDown.js', () => ({
  useAdsDrillDown: () => ({
    byId: ads.byId.current, loading: ads.loading.current, errors: ads.errors.current, load: ads.load,
  }),
}));

// ONE mock for both dimensions, dispatching on the option the panel passes —
// which is exactly the seam under test: an implementation that ignored the
// dimension would serve the ad-set answer to the ad-level question, and every
// assertion about which map was read would still pass without this split.
const ev = vi.hoisted(() => ({
  adset: { load: vi.fn(), byId: { current: {} } },
  ad:    { load: vi.fn(), byId: { current: {} } },
}));
vi.mock('@/hooks/useEvidence.js', () => ({
  evidenceKey: (id, metric = 'ctr') => `${id}:${metric}`,
  useEvidence: ({ dimension = 'adset' } = {}) => ({
    load: ev[dimension].load, byId: ev[dimension].byId.current, loading: {}, errors: {},
  }),
}));

import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';

const campaign = (over = {}) => ({
  entityId: 'c1', channel: 'META', name: 'Ramadan Cold', adSetCount: 2,
  spendMinor: 655_300, roas: 2.1, ctr: 0.0164, frequency: 2.4, currency: 'USD', ...over,
});

const adSet = (over = {}) => ({
  entityId: 'as-1', channel: 'META', name: 'Broad 25-45', status: 'ACTIVE',
  adCount: 4, spendMinor: 325_500, roas: 1.8, ctr: 0.0121, frequency: 3.1, currency: 'USD', ...over,
});

const ad = (over = {}) => ({
  entityId: 'ad-1', channel: 'META', name: 'Hook A · 9x16', status: 'ACTIVE',
  ctr: 0.0138, frequency: 2.1, spendMinor: 90_000, currency: 'USD', ...over,
});

const renderPanel = (props = {}) => render(
  <ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'HOLD' }} {...props} />,
  { wrapper: MemoryRouter },
);

const openAdSets = () => fireEvent.click(screen.getByLabelText('Toggle ad sets for Ramadan Cold'));
const openAds = () => fireEvent.click(screen.getByLabelText('Toggle ads for Broad 25-45'));

beforeEach(() => {
  vi.clearAllMocks();
  drill.byId.current = {};
  ads.byId.current = {}; ads.loading.current = {}; ads.errors.current = {};
  ev.adset.byId.current = {}; ev.ad.byId.current = {};
});

describe('the control that opens the ad level', () => {
  it('offers "View ads (N)" on an ad set that has ads', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    expect(screen.getByText('View ads (4)')).toBeInTheDocument();
  });

  // The count is the ad set's TRUE total from _count, not the length of the
  // returned list — MAX_ADS_PER_ADSET caps that list at 100, so a 140-ad ad set
  // would otherwise be told it has 100.
  it('counts with adCount, never with the rows it happens to have', () => {
    drill.byId.current = { c1: { adSets: [adSet({ adCount: 140 })] } };
    ads.byId.current = { 'as-1': { children: [ad(), ad({ entityId: 'ad-2' })] } };
    renderPanel();
    openAdSets();
    expect(screen.getByText('View ads (140)')).toBeInTheDocument();
    expect(screen.queryByText('View ads (2)')).not.toBeInTheDocument();
  });

  it.each([[0], [undefined]])('offers no toggle at all when adCount is %s', (adCount) => {
    drill.byId.current = { c1: { adSets: [adSet({ adCount })] } };
    renderPanel();
    openAdSets();
    expect(screen.queryByLabelText('Toggle ads for Broad 25-45')).not.toBeInTheDocument();
  });
});

describe('what opening it fetches', () => {
  it('loads the ads and their ranking, once each', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    openAds();
    expect(ads.load).toHaveBeenCalledWith('as-1');
    expect(ev.ad.load).toHaveBeenCalledWith('as-1');
    expect(ads.load).toHaveBeenCalledTimes(1);
  });

  // The ad-set level asks about the CAMPAIGN's children; the ad level asks about
  // the AD SET's. One hook instance serving both would send the ad-set id down
  // the campaign route and cache the answer under a colliding key.
  it('asks the ad dimension, not the ad-set one', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    expect(ev.adset.load).toHaveBeenCalledWith('c1');
    openAds();
    expect(ev.ad.load).toHaveBeenCalledWith('as-1');
    expect(ev.adset.load).not.toHaveBeenCalledWith('as-1');
  });

  it('fetches nothing on collapse', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    openAds();
    openAds();
    expect(ads.load).toHaveBeenCalledTimes(1);
    expect(ev.ad.load).toHaveBeenCalledTimes(1);
  });

  it('fetches nothing until the ad set is actually expanded', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    expect(ads.load).not.toHaveBeenCalled();
    expect(ev.ad.load).not.toHaveBeenCalled();
  });

  it('lets a failed load be retried by collapsing and reopening', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    ads.errors.current = { 'as-1': 'Network Error' };
    renderPanel();
    openAdSets();
    openAds();
    expect(screen.getByText(/Couldn’t load ads/)).toBeInTheDocument();
    openAds();
    openAds();
    // The hook's own `seen` ref clears on error; the panel's job is to ask again.
    expect(ads.load).toHaveBeenCalledTimes(2);
  });
});

describe('what appears under the ad set', () => {
  it('the ads themselves', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    ads.byId.current = { 'as-1': { children: [ad(), ad({ entityId: 'ad-2', name: 'Hook B · 1x1' })] } };
    renderPanel();
    openAdSets();
    openAds();
    expect(screen.getByText('Hook A · 9x16')).toBeInTheDocument();
    expect(screen.getByText('Hook B · 1x1')).toBeInTheDocument();
  });

  it('an honest empty state, not a silent nothing', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    ads.byId.current = { 'as-1': { children: [] } };
    renderPanel();
    openAdSets();
    openAds();
    expect(screen.getByText(/No ads synced for this ad set yet/)).toBeInTheDocument();
  });

  it('the Creative Intelligence finding, when the server produced one', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    ads.byId.current = { 'as-1': { children: [ad()] } };
    ev.ad.byId.current = { 'as-1:ctr': {
      evidence: {
        dimension: 'AD', metric: 'ctr', ranked: [ad(), ad({ entityId: 'ad-2' })],
        summary: { bottom: ad({ entityId: 'ad-2', name: 'Hook B · 1x1', ctr: 0.0091, _gap: -0.34 }) },
      },
      comparisonEnvelope, insufficientData: false, reasonKey: null,
    } };
    renderPanel();
    openAdSets();
    openAds();
    expect(screen.getByText('Creative intelligence')).toBeInTheDocument();
    expect(screen.getByText(/34% below the ad set/)).toBeInTheDocument();
  });

  it('a refusal instead, when it declined — and no finding', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    ads.byId.current = { 'as-1': { children: [ad()] } };
    ev.ad.byId.current = { 'as-1:ctr': { evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' } };
    renderPanel();
    openAdSets();
    openAds();
    expect(screen.getByText('No ad is measurably behind the others')).toBeInTheDocument();
    expect(screen.queryByText('Creative intelligence')).not.toBeInTheDocument();
  });

  // Two ad sets open at once must each read their own answer. A scalar here
  // would show one ad set's creative finding under the other.
  it('keeps two open ad sets on their own data', () => {
    drill.byId.current = { c1: { adSets: [adSet(), adSet({ entityId: 'as-2', name: 'Lookalike 3%' })] } };
    ads.byId.current = {
      'as-1': { children: [ad({ name: 'Ad in one' })] },
      'as-2': { children: [ad({ entityId: 'ad-9', name: 'Ad in two' })] },
    };
    renderPanel();
    openAdSets();
    openAds();
    fireEvent.click(screen.getByLabelText('Toggle ads for Lookalike 3%'));
    expect(screen.getByText('Ad in one')).toBeInTheDocument();
    expect(screen.getByText('Ad in two')).toBeInTheDocument();
  });
});

// ── Nothing above this level moved ──────────────────────────
describe('the two levels above are untouched', () => {
  it('the campaign verdict and its ad sets still render', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel({ verdicts: { c1: 'KILL' } });
    expect(screen.getByText('KILL')).toBeInTheDocument();
    openAdSets();
    expect(screen.getByText('Broad 25-45')).toBeInTheDocument();
  });

  it('"Explain decision" still opens the campaign panel', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Toggle details for Ramadan Cold'));
    expect(screen.getByText(/Ramadan Cold/)).toBeInTheDocument();
  });

  it('the campaign-level evidence request is unchanged', () => {
    drill.byId.current = { c1: { adSets: [adSet()] } };
    renderPanel();
    openAdSets();
    expect(drill.load).toHaveBeenCalledWith('c1');
    expect(ev.adset.load).toHaveBeenCalledWith('c1');
  });
});
