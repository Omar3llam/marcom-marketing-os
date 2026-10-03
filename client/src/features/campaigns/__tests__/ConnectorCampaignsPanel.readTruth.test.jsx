import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api }));
vi.mock('../decisionSignals.js', () => ({ recordExplain: vi.fn(), recordIntent: vi.fn() }));

const campaign = { entityId: 'c1', name: 'Campaign', channel: 'META', adSetCount: 1, currency: 'EGP' };
const adSet = { entityId: 'as1', name: 'Ad set', channel: 'META', adCount: 2, currency: 'EGP' };
const ad = { entityId: 'ad1', name: 'Ad creative', channel: 'META', ctr: null, frequency: null };
const sets = { entity: campaign, adSets: [adSet], objective: 'OUTCOME_SALES' };
const ads = { entity: adSet, children: [ad], objective: 'OUTCOME_SALES' };
const refusal = { evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' };
const SETS = '/api/lumi/entities/c1/adsets'; const ADS = '/api/lumi/entities/as1/ads';
const EVIDENCE = '/api/lumi/entities/as1/evidence';
const replies = new Map();
const requests = (url) => api.get.mock.calls.filter(([path]) => path === url).length;
const show = () => render(<StrictMode><MemoryRouter><ConnectorCampaignsPanel campaigns={[campaign]} /></MemoryRouter></StrictMode>);
const toggleSets = () => fireEvent.click(screen.getByLabelText('Toggle ad sets for Campaign'));
const toggleAds = () => fireEvent.click(screen.getByLabelText('Toggle ads for Ad set'));
async function openAds() { show(); toggleSets(); await screen.findByText('Ad set'); toggleAds(); }
const deny = (shape) => shape === 'raw' ? { response: { status: 403 }, message: 'RoleForbidden' }
  : { httpStatus: 403, code: 'AUTH_ACCESS_DENIED', message: 'RoleForbidden' };
beforeEach(() => {
  vi.resetAllMocks(); replies.clear();
  replies.set(SETS, () => Promise.resolve(sets)); replies.set(ADS, () => Promise.resolve(ads));
  api.get.mockImplementation(async (url) => ({ data: await (replies.get(url)?.() ?? Promise.resolve(refusal)) }));
});

describe('Y10 real drill-down hooks and table contract truth', () => {
  it.each([{}, { entity: {}, adSets: null }])('malformed campaign success %j is unreadable and cannot loop', async (payload) => {
    replies.set(SETS, () => Promise.resolve(payload)); show(); toggleSets();
    expect(await screen.findByText('Couldn’t read the ad-set response.')).toBeInTheDocument();
    expect(screen.queryByText(/No ad sets synced/)).not.toBeInTheDocument();
    toggleSets(); toggleSets(); expect(requests(SETS)).toBe(1);
    expect(screen.queryByText(/collapse and try again/)).not.toBeInTheDocument();
  });
  it.each([{}, { entity: {}, children: 'bad' }])('malformed ads success %j is unreadable and cannot loop', async (payload) => {
    replies.set(ADS, () => Promise.resolve(payload)); await openAds();
    expect(await screen.findByText('Couldn’t read the ads response.')).toBeInTheDocument();
    expect(screen.queryByText(/No ads synced/)).not.toBeInTheDocument();
    toggleAds(); toggleAds(); expect(requests(ADS)).toBe(1);
    expect(screen.queryByText(/collapse and try again/)).not.toBeInTheDocument();
  });
  it('explicit childless campaign is genuinely empty', async () => {
    replies.set(SETS, () => Promise.resolve({ entity: campaign, adSets: [] })); show(); toggleSets();
    expect(await screen.findByText('No ad sets synced for this campaign yet.')).toBeInTheDocument();
  });
  it('explicit childless ad set is genuinely empty', async () => {
    replies.set(ADS, () => Promise.resolve({ entity: adSet, children: [] })); await openAds();
    expect(await screen.findByText('No ads synced for this ad set yet.')).toBeInTheDocument();
  });
});

describe('Y11 real expansion permission and recovery ownership', () => {
  it.each(['raw', 'mapped'])('%s ads refusal is neutral and never recommends retry', async (shape) => {
    replies.set(ADS, () => Promise.reject(deny(shape))); await openAds();
    expect(await screen.findByText('Ads aren’t available for this seat.')).toBeInTheDocument();
    expect(screen.queryByText(/collapse and try again/)).not.toBeInTheDocument();
  });
  it.each(['raw', 'mapped'])('%s evidence refusal is separate from analytical refusal', async (shape) => {
    replies.set(EVIDENCE, () => Promise.reject(deny(shape))); await openAds();
    expect(await screen.findByText('Evidence isn’t available for this seat.')).toBeInTheDocument();
    expect(screen.getByText('Ad creative')).toBeInTheDocument();
    expect(screen.queryByText(/collapse and try again/)).not.toBeInTheDocument();
  });
  it.each(['raw', 'mapped'])('%s paired 403s do not repeat either GET after collapse/re-expand', async (shape) => {
    replies.set(ADS, () => Promise.reject(deny(shape))); replies.set(EVIDENCE, () => Promise.reject(deny(shape)));
    await openAds(); await screen.findByText(/Couldn’t load ads|Ads aren’t available/);
    toggleAds(); toggleAds();
    expect(requests(ADS)).toBe(1); expect(requests(EVIDENCE)).toBe(1);
  });
  it('500 on ads and evidence remains recoverable through re-expansion', async () => {
    replies.set(ADS, () => Promise.reject({ httpStatus: 500, message: 'Unavailable' }));
    replies.set(EVIDENCE, () => Promise.reject({ httpStatus: 500, message: 'Unavailable' }));
    await openAds(); await screen.findByText('Couldn’t load ads — collapse and try again.');
    replies.set(ADS, () => Promise.resolve(ads)); replies.set(EVIDENCE, () => Promise.resolve(refusal));
    toggleAds(); toggleAds(); expect(await screen.findByText('Ad creative')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Couldn’t load evidence/)).not.toBeInTheDocument());
    expect(requests(ADS)).toBe(2); expect(requests(EVIDENCE)).toBe(2);
  });
  it('successful first expansion is load-once under StrictMode and preserves absent metrics', async () => {
    await openAds(); expect(await screen.findByText('Ad creative')).toBeInTheDocument();
    toggleAds(); toggleAds(); expect(requests(ADS)).toBe(1); expect(requests(EVIDENCE)).toBe(1);
    expect(requests(SETS)).toBe(1); expect(screen.getAllByLabelText('No data').length).toBeGreaterThan(0);
  });
});
