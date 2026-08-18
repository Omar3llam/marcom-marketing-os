import { describe, it, expect, vi, afterEach } from 'vitest';
import { CAMPAIGN_INSIGHT_FIELDS, fetchAccountCurrency } from './metaAdsService.js';
import { metaNormalize } from './connectors/normalize/metaNormalize.js';
import { toSnapshotRows } from './connectors/snapshotSink.js';

// Guards the revenue-honesty wiring: Meta must REQUEST action_values, or revenue
// lands 0 and every connector campaign reads "—" for ROAS. This is the exact
// regression we are fixing — pin it so it can't silently regress.
describe('CAMPAIGN_INSIGHT_FIELDS — revenue is actually requested', () => {
  it('requests action_values (the claimed revenue signal) alongside actions', () => {
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('action_values');
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('actions');
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('campaign_id'); // entity id the normalizer keys on
  });

  it('full chain: requested action_values → real revenue → real ROAS (not null)', () => {
    // A row shaped as Meta returns it once action_values is in the field list.
    const normalized = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: new Date('2026-06-01T00:00:00.000Z'),
      rows: [{
        campaign_id: 'c1', campaign_name: 'Eid', spend: '100.00', impressions: '1000', clicks: '50',
        actions: [{ action_type: 'purchase', value: '8' }],
        action_values: [{ action_type: 'purchase', value: '400.00' }],
      }],
    });
    const campaign = toSnapshotRows('ws1', 'META', normalized).find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.revenueMinor).toBe(40000);
    expect(campaign.roas).toBe(4); // 40000 / 10000 — a real derived number, not null
  });
});

// fetchAccountCurrency reads the act_<id> node's `currency` field. It must be
// failure-proof: a currency lookup can NEVER break a sync, so every error path
// returns null (the connector then falls back to workspace currency / USD).
describe('fetchAccountCurrency — the real account currency, never throwing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the ISO code Meta reports on the act_<id> node', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ id: 'act_123', currency: 'EGP' }) }));
    await expect(fetchAccountCurrency('tok', '123')).resolves.toBe('EGP');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('act_123?fields=currency'),
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  // ── NC-D4 · the control (R11 · I68) ────────────────────────
  it('NEVER puts the access token in the URL', async () => {
    // This call used to append `&access_token=…`, so a 60-day workspace
    // credential landed in every access log and APM span on the path.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ id: 'act_123', currency: 'EGP' }) }));
    await fetchAccountCurrency('super-secret-token', '123');

    const [url, init] = fetch.mock.calls[0];
    expect(url).not.toContain('access_token');
    expect(url).not.toContain('super-secret-token');
    expect(init.headers.Authorization).toBe('Bearer super-secret-token');
  });

  it('returns null on a Meta API error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ error: { message: 'bad token' } }) }));
    await expect(fetchAccountCurrency('tok', 'act_123')).resolves.toBeNull();
  });

  it('returns null when the currency field is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ id: 'act_123' }) }));
    await expect(fetchAccountCurrency('tok', 'act_123')).resolves.toBeNull();
  });

  it('returns null when the network call throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
    await expect(fetchAccountCurrency('tok', 'act_123')).resolves.toBeNull();
  });
});
