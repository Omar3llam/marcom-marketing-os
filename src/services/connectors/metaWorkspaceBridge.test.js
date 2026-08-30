// ============================================================
// Phase 12c — Meta Workspace Bridge: the boundary is actually crossed
// ------------------------------------------------------------
// Proves the relate fix on SEEDED rows (network mocked), BEFORE any backfill
// touches real data — so the three failure domains stay separable:
//   logic (this test) · data (the backfill census) · environment (live creds).
//
// One workspace key resolves BOTH Meta and Google credentials; runConnectorSync
// enumerates both channels; and the unchanged blended-truth engine reconciles a
// real 2-channel portfolio. This is the moment the 11A panel can leave its
// single-channel honest state on real data.
// ============================================================
import { describe, it, expect, vi, beforeAll } from 'vitest';

// A 64-hex key so the AES helpers encrypt/decrypt in-process.
process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);

import { encrypt } from '../../models/credential.js';
import { buildChannelInputs } from '../blended-truth/BlendedTruthService.js';
import { reconcile } from '../blended-truth/blendedTruthEngine.js';
import { detId } from './connectorTypes.js';

const WS = 'ws-bridge-1';
const META_TOKEN = 'meta-access-live';
const GOOGLE_TOKEN = 'ya29.google-live';

// Encrypt exactly as the OAuth callbacks would have stored them.
const encMeta = encrypt(META_TOKEN);
const encGoogle = encrypt(GOOGLE_TOKEN);
const encGoogleRefresh = encrypt('1//refresh');

// ── Content-routed DB mock: returns rows by the SQL it sees, not call order, so
//    resolveCredential and runConnectorSync can interleave freely. ───────────
const sqlMock = (strings, ...vals) => {
  const q = Array.isArray(strings) ? strings.join(' ') : String(strings);
  // resolveCredential: SELECT access_token_enc ... WHERE workspace_id AND platform ... LIMIT 1
  if (q.includes('access_token_enc') && q.includes('LIMIT 1') && q.includes('workspace_id')) {
    const platform = vals.find((v) => v === 'meta_ads' || v === 'google_ads');
    if (platform === 'meta_ads') return Promise.resolve([{ access_token_enc: encMeta, refresh_token_enc: null, account_id: 'act_meta', expires_at: null }]);
    if (platform === 'google_ads') return Promise.resolve([{ access_token_enc: encGoogle, refresh_token_enc: encGoogleRefresh, account_id: 'cust_g', expires_at: null }]);
    return Promise.resolve([]);
  }
  // listActiveSyncable: SELECT workspace_id, platform, access_token_enc ... — BOTH channels.
  if (q.includes('SELECT workspace_id, platform, access_token_enc')) {
    return Promise.resolve([
      { workspace_id: WS, platform: 'meta_ads', access_token_enc: encMeta, refresh_token_enc: null, account_id: 'act_meta', health: null },
      { workspace_id: WS, platform: 'google_ads', access_token_enc: encGoogle, refresh_token_enc: encGoogleRefresh, account_id: 'cust_g', health: null },
    ]);
  }
  // recordSync SELECT health
  if (q.includes('SELECT health FROM marcom_credentials')) return Promise.resolve([{ health: null }]);
  return Promise.resolve([]); // UPDATEs etc.
};
sqlMock.json = (v) => v;
vi.mock('../../utils/db.js', () => ({ getDb: () => sqlMock }));

// authenticate() now reads Workspace.currency via prisma — mock it (the test
// workspace ids are not UUIDs). 'USD' keeps the bridge focused on routing, not
// currency. The whole prisma layer is otherwise unused here (sink is mocked).
vi.mock('../../lib/prisma.js', () => ({
  prisma: { workspace: { findUnique: vi.fn(async () => ({ currency: 'USD' })), update: vi.fn(async () => ({})) } },
}));

// Mock the sink (DB write) and BOTH live network calls — keep the pure seams real.
vi.mock('./snapshotSink.js', () => ({ landSnapshots: vi.fn(async () => ({ entities: 2, snapshots: 2 })) }));
vi.mock('../metaAdsService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAccountCurrency: vi.fn(async () => null), // no real network for the currency probe
  fetchCampaignInsights: vi.fn(async () => ([
    { _data: { campaign_id: 'c1', campaign_name: 'M Camp', spend: '100.00', impressions: '1000', clicks: '50', actions: [], action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '420.00' }] } },
  ])),
  // ── B5-01P″′ — the rest of the reachable network surface ──────────────────
  // "Mock BOTH live network calls" was true when this file was written and
  // stopped being true as fetchRaw grew. runConnectorSync drives authenticate →
  // fetchRaw → fetchCanonicalRaw, which between them reach SEVEN network-capable
  // metaAdsService functions; only two were stubbed. The other five ran for
  // real against graph.facebook.com every time this suite executed, and
  // fetchRaw's softFail swallowed each rejection so the test still passed.
  //
  // Shapes are the ones fetchRaw's own softFail fallbacks declare: a bare array
  // for campaigns, `{ rows, truncated }` for the ad-set and ad edges.
  fetchAllCampaigns: vi.fn(async () => ([])),
  fetchAdSetInsights: vi.fn(async () => ({ rows: [], truncated: false })),
  fetchAllAdSets: vi.fn(async () => ({ rows: [], truncated: false })),
  fetchAdInsights: vi.fn(async () => ({ rows: [], truncated: false })),
  fetchAllAds: vi.fn(async () => ({ rows: [], truncated: false })),
  // The canonical 30-day refresh runs on EVERY sync, so it is reachable here
  // even though nothing in this file asserts on it.
  fetchCanonicalAllLevels: vi.fn(async () => ({ rows: [], windowStart: new Date('2026-05-12'), windowEnd: new Date('2026-06-11') })),
  fetchDailyInsights: vi.fn(async () => ({ rows: [], days: 0, truncated: false })),
}));
vi.mock('./google/googleAdsClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchGoogleCampaignMetrics: vi.fn(async () => ([
    { campaign: { id: 'g1', name: 'G Camp' }, metrics: { cost_micros: 800000, impressions: 2000, clicks: 40, conversions: 3, conversions_value: 300 } },
  ])),
  // B5-01P″′ — Google's canonical refresh, reached through a DYNAMIC import in
  // GoogleAdsConnector.fetchCanonicalRaw and therefore invisible to a static
  // read of this file's imports. Left real it was failing on every run and being
  // swallowed by the same best-effort catch that hid Meta's.
  fetchGoogleCanonicalMetrics: vi.fn(async () => ({
    rows: [], windowStart: new Date('2026-05-12'), windowEnd: new Date('2026-06-11'),
  })),
}));

describe('Meta Workspace Bridge — one key resolves both channels', () => {
  let resolveCredential; let runConnectorSync; let landSnapshots;

  beforeAll(async () => {
    ({ resolveCredential } = await import('./credentialStore.js'));
    ({ runConnectorSync } = await import('./ConnectorSyncService.js'));
    ({ landSnapshots } = await import('./snapshotSink.js'));
  });

  it('resolveCredential(ws, …) decrypts BOTH Meta and Google under one workspace key', async () => {
    const meta = await resolveCredential(WS, 'META');
    const google = await resolveCredential(WS, 'GOOGLE');
    expect(meta).toMatchObject({ accessToken: META_TOKEN, accountId: 'act_meta' });
    expect(google).toMatchObject({ accessToken: GOOGLE_TOKEN, accountId: 'cust_g' });
  });

  it('runConnectorSync enumerates BOTH channels → dual-source ingestion', async () => {
    const result = await runConnectorSync(WS, { now: new Date('2026-06-11') });
    expect(result).toMatchObject({ synced: 2, failed: 0 });
    const landedChannels = landSnapshots.mock.calls.map((c) => c[1]);
    expect([...new Set(landedChannels)].sort()).toEqual(['GOOGLE', 'META']);
    // ── B5-01P″′ — each channel lands TWICE, and that is the point ──────────
    // runConnectorSync performs a second, separate canonical 30-day fetch on
    // every sync. This assertion used to read ['GOOGLE','META'] — not because
    // the canonical pass did not run, but because fetchCanonicalAllLevels and
    // fetchGoogleCanonicalMetrics were unstubbed, failed every time, and were
    // swallowed by the best-effort catch around them. The suite was asserting
    // the shape of a fetch that never worked. Counting the landings is what
    // makes the canonical refresh visible instead of merely absent.
    expect(landedChannels.filter((c) => c === 'META')).toHaveLength(2);
    expect(landedChannels.filter((c) => c === 'GOOGLE')).toHaveLength(2);
    expect(landSnapshots.mock.calls.every((c) => c[0] === WS)).toBe(true);
  });

  it('the payoff — both channels reconcile into a real 2-channel portfolio (engine unchanged)', () => {
    const metaAcct = detId(WS, 'META', 'ACCOUNT', 'act_meta');
    const googleAcct = detId(WS, 'GOOGLE', 'ACCOUNT', 'cust_g');
    const snapshots = [
      { entityId: metaAcct, source: 'META', spendMinor: 100000, revenueMinor: 420000, currency: 'USD' },
      { entityId: metaAcct, source: 'GA4', spendMinor: 0, revenueMinor: 210000, currency: 'USD' },
      { entityId: googleAcct, source: 'GOOGLE', spendMinor: 80000, revenueMinor: 300000, currency: 'USD' },
    ];
    const labels = new Map([[metaAcct, { channel: 'META' }], [googleAcct, { channel: 'GOOGLE' }]]);
    const result = reconcile({ channels: buildChannelInputs(snapshots, labels) });
    expect(result.channels.length).toBe(2); // NOT the single-channel honest state
  });
});
