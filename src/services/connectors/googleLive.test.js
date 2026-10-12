import { describe, it, expect, vi, beforeAll } from 'vitest';

// A 64-hex test key so the credential AES helpers work in-process.
process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
// R11 (E7): OAuth state is signed with its own key now, not the webhook secret.
// Set explicitly rather than leaning on the development fallback, so this test
// exercises the key the production code actually uses.
process.env.OAUTH_STATE_SECRET = 'r11-test-oauth-state-secret-0123456789abcdef';

import { buildGaqlReportQuery, mapGoogleAdsResponse } from './google/googleAdsClient.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { assertNormalized } from './ChannelConnector.js';
import { buildState, parseState } from '../../routes/auth/oauthState.js';

describe('googleAdsClient — pure seams', () => {
  it('buildGaqlReportQuery is a stable campaign report for a date range', () => {
    const q = buildGaqlReportQuery({ since: '2026-05-01', until: '2026-05-31' });
    expect(q).toContain('FROM campaign');
    expect(q).toContain("segments.date BETWEEN '2026-05-01' AND '2026-05-31'");
    expect(q).toContain('metrics.cost_micros');
  });

  it('mapGoogleAdsResponse → the shape googleNormalize consumes (camelCase → snake_case)', () => {
    const apiRows = [{ campaign: { id: 'g1', name: 'G Camp' }, metrics: { costMicros: '1230000', impressions: '2000', clicks: '40', conversions: 3.5, conversionsValue: '200' } }];
    const raw = mapGoogleAdsResponse(apiRows);
    expect(raw[0]).toEqual({ campaign: { id: 'g1', name: 'G Camp' }, metrics: { cost_micros: 1230000, impressions: 2000, clicks: 40, conversions: 3.5, conversions_value: 200 } });
    // end-to-end: mapper output feeds the already-tested normalizer.
    const out = googleNormalize({ accountExternalId: 'cust_1', currency: 'USD', date: new Date('2026-06-01'), rows: raw });
    const campaign = out.find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign).toMatchObject({ channel: 'GOOGLE', source: 'GOOGLE', spendMinor: 123, revenueMinor: 20000, conversions: 3.5, frequency: null });
    assertNormalized(out);
  });
});

describe('Google OAuth state (HMAC) — reused meta.js pattern', () => {
  it('round-trips workspaceId + userId', () => {
    const s = buildState('ws-1', 'user-1');
    expect(parseState(s)).toEqual({ workspaceId: 'ws-1', userId: 'user-1' });
  });
  it('rejects a tampered state', () => {
    const s = buildState('ws-1', 'user-1');
    const tampered = Buffer.from(Buffer.from(s, 'base64url').toString('utf8').replace('ws-1', 'ws-2')).toString('base64url');
    expect(parseState(tampered)).toBeNull();
  });
});

// ── The Real Credential Smoke Test (architect-required) ─────────
// Proves OAuth → credentialStore → connector → sync worker is ONE live wire, not
// four disconnected parts. getDb + the network module are mocked; the credential
// is encrypted exactly as the OAuth callback would write it.
const enc = (await import('../../models/credential.js')).encrypt;
const GOOGLE_TOKEN = 'ya29.live-access';
const GOOGLE_REFRESH = '1//refresh';

// Mocked DB: returns queued rows per query, in call order.
const dbQueue = [];
const sqlMock = (...args) => Promise.resolve(dbQueue.length ? dbQueue.shift() : []);
sqlMock.json = (v) => v;
vi.mock('../../utils/db.js', () => ({ getDb: () => sqlMock }));

// authenticate() now reads Workspace.currency via prisma — mock it (the test
// workspace id 'ws-1' is not a UUID, so a real query would throw).
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    workspace: { findUnique: vi.fn(async () => ({ currency: 'USD' })), update: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ id: 'ws-1', health: null }]),
    $executeRaw: vi.fn(async () => 1),
  };
  prisma.$transaction = vi.fn(async (operation) => operation(prisma));
  return { prisma };
});

// Mock the sink (DB write) and the live Google network call.
vi.mock('./snapshotSink.js', () => ({ landSnapshots: vi.fn(async () => ({ entities: 2, snapshots: 2 })) }));
// Partial mock: keep the real pure seams, override ONLY the live network call.
vi.mock('./google/googleAdsClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchGoogleCustomerTimezone: vi.fn(async () => null),
  fetchGoogleCampaignMetrics: vi.fn(async () => ([
    { campaign: { id: 'g1', name: 'G Camp' }, metrics: { cost_micros: 1230000, impressions: 2000, clicks: 40, conversions: 3, conversions_value: 200 } },
  ])),
}));

describe('Real Credential Smoke Test — the whole chain wires', () => {
  let runConnectorSync; let landSnapshots; let googleAdsConnector; let fetchRawSpy;

  beforeAll(async () => {
    ({ landSnapshots } = await import('./snapshotSink.js'));
    ({ googleAdsConnector } = await import('./GoogleAdsConnector.js'));
    ({ runConnectorSync } = await import('./ConnectorSyncService.js'));
    fetchRawSpy = vi.spyOn(googleAdsConnector, 'fetchRaw');
  });

  it('resolveCredential → sync picks it up → fetchRaw invoked → landSnapshots → committed health', async () => {
    const encAccess = enc(GOOGLE_TOKEN);
    const encRefresh = enc(GOOGLE_REFRESH);
    // Queue the rows each query returns, in execution order:
    dbQueue.push(
      [{ workspace_id: 'ws-1', platform: 'google_ads', access_token_enc: encAccess, refresh_token_enc: encRefresh, account_id: '123-456', health: null }], // listActiveSyncable
      [{ access_token_enc: encAccess, refresh_token_enc: encRefresh, account_id: '123-456', expires_at: null }], // resolveCredential (authenticate)
    );

    const result = await runConnectorSync('ws-1', { now: new Date('2026-06-10') });

    expect(fetchRawSpy).toHaveBeenCalledTimes(1);                 // connector reached
    expect(fetchRawSpy.mock.calls[0][0].accessToken).toBe(GOOGLE_TOKEN); // decrypted creds flowed in
    expect(landSnapshots).toHaveBeenCalledTimes(1);              // snapshots landed
    expect(landSnapshots.mock.calls[0][0]).toBe('ws-1');
    expect(landSnapshots.mock.calls[0][1]).toBe('GOOGLE');
    expect(result).toMatchObject({ synced: 1, failed: 0 });
  });
});
