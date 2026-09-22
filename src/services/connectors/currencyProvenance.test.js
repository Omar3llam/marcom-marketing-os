import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { workspace: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } } }));
vi.mock('./credentialStore.js', () => ({ resolveCredential: vi.fn(async () => ({ accessToken: 'test', accountId: '123' })) }));
vi.mock('../metaAdsService.js', async (original) => ({ ...(await original()), fetchAccountCurrency: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { fetchAccountCurrency } from '../metaAdsService.js';
import { MetaConnector } from './MetaConnector.js';
import { GoogleAdsConnector } from './GoogleAdsConnector.js';
import { GA4Connector } from './GA4Connector.js';
import { toSnapshotRows } from './snapshotSink.js';
import { toActualSnapshotRow } from './actualsSink.js';
import { restatementData } from './dailySnapshotSink.js';
import { CURRENCY_PROVENANCE as P, isAuthoritativeCurrency } from '../../lib/currencyProvenance.js';

const date = new Date('2026-09-22T09:00:00Z');
const raw = {
  campaign_id: 'c1', campaign_name: 'Campaign', spend: '12.50',
  impressions: '1000', clicks: '10', date_start: '2026-09-01', date_stop: '2026-09-21',
  action_values: [{ action_type: 'purchase', value: '25' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
});

describe('connector currency provenance through normalization and sinks', () => {
  it.each(['EGP', 'USD', 'SAR'])('Meta reported %s survives operational and canonical normalization at every level', async (currency) => {
    fetchAccountCurrency.mockResolvedValue(currency);
    const connector = new MetaConnector();
    const auth = await connector.authenticate('ws');
    const rows = [raw, { ...raw, adset_id: 's1' }, { ...raw, adset_id: 's1', ad_id: 'a1' }];
    for (const normalize of ['normalize', 'normalizeCanonical']) {
      const normalized = connector[normalize]({ ...auth, date, rows });
      expect(new Set(normalized.map((r) => r.entityLevel))).toEqual(new Set(['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD']));
      const stored = toSnapshotRows('ws', 'META', normalized);
      for (const row of stored) {
        expect(row).toMatchObject({ currency, currencyProvenance: P.PLATFORM_REPORTED, spendMinor: 1250, revenueMinor: 2500 });
        expect(isAuthoritativeCurrency(row)).toBe(true);
      }
    }
  });

  it.each([
    [null, 'EGP', 'EGP', P.WORKSPACE_INFERRED],
    ['???', 'SAR', 'SAR', P.WORKSPACE_INFERRED],
    [null, null, 'USD', P.FALLBACK_DEFAULT],
  ])('Meta missing/invalid response %s with workspace %s remains uncertain', async (reported, workspace, currency, currencyProvenance) => {
    fetchAccountCurrency.mockResolvedValue(reported);
    prisma.workspace.findUnique.mockResolvedValue({ currency: workspace });
    const connector = new MetaConnector();
    const auth = await connector.authenticate('ws');
    const stored = toSnapshotRows('ws', 'META', connector.normalize({ ...auth, date, rows: [raw] }));
    for (const row of stored) {
      expect(row).toMatchObject({ currency, currencyProvenance });
      expect(isAuthoritativeCurrency(row)).toBe(false);
    }
  });

  it('daily observation and restatement preserve origin alongside money', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    const connector = new MetaConnector();
    const auth = await connector.authenticate('ws');
    const { snapshots } = connector.normalizeDaily({ ...auth, date, rows: [{ ...raw, date_start: '2026-09-21' }] });
    const [stored] = toSnapshotRows('ws', 'META', snapshots);
    expect(restatementData(stored)).toMatchObject({ currency: 'EGP', currencyProvenance: P.PLATFORM_REPORTED, spendMinor: 1250 });
  });

  it.each([['EGP', P.WORKSPACE_INFERRED], [null, P.FALLBACK_DEFAULT]])('Google currency %s is tagged without a new currency query', async (workspace, provenance) => {
    prisma.workspace.findUnique.mockResolvedValue({ currency: workspace });
    const connector = new GoogleAdsConnector();
    const auth = await connector.authenticate('ws');
    for (const normalize of ['normalize', 'normalizeCanonical']) {
      const normalized = connector[normalize]({ ...auth, date, rows: [{ campaign: { id: 'g1' }, metrics: { cost_micros: 12500000 } }] });
      for (const row of toSnapshotRows('ws', 'GOOGLE', normalized)) {
        expect(row.currencyProvenance).toBe(provenance);
        expect(isAuthoritativeCurrency(row)).toBe(false);
      }
    }
  });

  it('GA4 hardcoded USD remains a fallback through the actuals sink', async () => {
    const connector = new GA4Connector();
    const auth = await connector.authenticate('ws');
    const [descriptor] = connector.normalize({ ...auth, date, rows: [{ source: 'google', medium: 'cpc', campaignName: 'C', revenue: 10 }] });
    const row = toActualSnapshotRow('ws', { entityId: 'c1', entityLevel: 'CAMPAIGN' }, descriptor);
    expect(row).toMatchObject({ currency: 'USD', currencyProvenance: P.FALLBACK_DEFAULT, revenueMinor: 1000 });
    expect(isAuthoritativeCurrency(row)).toBe(false);
  });

  it('unproven supplied codes stay unknown; sink fallback cannot inherit authority', () => {
    const connector = new MetaConnector();
    const normalized = connector.normalize({ accountExternalId: 'a1', date, currency: 'EGP', rows: [raw] });
    expect(toSnapshotRows('ws', 'META', normalized)[0].currencyProvenance).toBe(P.LEGACY_UNKNOWN);
    const row = toSnapshotRows('ws', 'META', [{ ...normalized[0], currency: null, currencyProvenance: P.PLATFORM_REPORTED }])[0];
    expect(row).toMatchObject({ currency: 'USD', currencyProvenance: P.FALLBACK_DEFAULT });
  });
});
