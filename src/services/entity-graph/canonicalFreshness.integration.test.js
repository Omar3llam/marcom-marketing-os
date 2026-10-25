import { beginCanonicalCapture } from '../connectors/canonicalCapture.js';
import { canonicalSourceFacts } from '../connectors/normalize/metaNormalize.js';
import { canonicalCaptureSpecs, collectCursorPages } from '../metaAdsService.js';
// ============================================================
// B5-01F · §13 — the freshness gate on real persisted rows
// ============================================================
// §13 says mock-only coverage is insufficient for this slice, and it is right
// for a specific reason: the freshness clock reads `windowEnd`, which is a
// `timestamp WITHOUT time zone` column. A row that round-trips through
// PostgreSQL is the only way to prove the age we compute is the age we stored —
// a session-timezone coercion would shift the boundary by hours and, at exactly
// the wrong hour, by a whole day.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js) — a real
// gap in the default local baseline (B5 F-8), not a claim of coverage.
// ============================================================
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from './EntityGraphService.js';
import { CANONICAL_EVIDENCE_STALE, NO_CANONICAL_WINDOW } from '../verdict-engine/canonicalVerdictEvidence.js';
import { MAX_CANONICAL_EVIDENCE_AGE_DAYS } from '../verdict-engine/metricWindow.js';

const DB_OK = await dbAvailable();
const DAY = 86_400_000;

describe.skipIf(!DB_OK)('B5-01F · canonical freshness on real PostgreSQL', () => {
  const ws = randomUUID();
  const accountId = randomUUID();
  const fresh = randomUUID();
  const stale = randomUUID();
  const never = randomUUID();

  /** UTC midnight of the day `ageDays` before now — relative, so it never rots. */
  const dayAgo = (ageDays) =>
    new Date(`${new Date(Date.now() - ageDays * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

  const persist = ({ entityId, ageDays, syncedAt, spendMinor }) => {
    const windowEnd = dayAgo(ageDays);
    return persistCaptured({
      data: {
        workspaceId: ws, entityId, entityLevel: 'CAMPAIGN',
        source: 'META', date: syncedAt ?? windowEnd, granularity: 'DAILY',
        measurementWindow: 'CUMULATIVE_30D',
        windowStart: new Date(windowEnd.getTime() - 29 * DAY), windowEnd,
        spendMinor, revenueMinor: spendMinor * 2, impressions: 200_000, clicks: 3_000,
        conversions: 25, roas: 2, ctr: 0.015, frequency: 3.1, currency: 'EGP',
      },
    });
  };

  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
    await prisma.workspace.create({ data: { id: ws, name: `b5-01f-${ws.slice(0, 8)}` } });
    await prisma.account.create({
      data: { id: accountId, workspaceId: ws, channel: 'META', name: 'B5F acct', externalId: `act-${accountId.slice(0, 8)}` },
    });
    for (const [id, name] of [[fresh, 'Fresh'], [stale, 'Stale'], [never, 'Never measured']]) {
      await prisma.campaign.create({
        data: {
          id, workspaceId: ws, accountId, channel: 'META',
          name, externalId: `c-${id.slice(0, 8)}`, objective: 'OUTCOME_SALES',
        },
      });
    }
  });


  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.account.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: ws } }).catch(() => {});
  });

  it('a FRESH persisted row remains eligible', async () => {
    await persist({ entityId: fresh, ageDays: 0, spendMinor: 999_000 });

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns.map((c) => c.entityId)).toEqual([fresh]);
    expect(campaigns[0].spendMinor).toBe(999_000);
    expect(staleEvidence).toEqual([]);
  });

  it('the boundary survives the round-trip: exactly MAX days old is still eligible', async () => {
    await persist({ entityId: fresh, ageDays: MAX_CANONICAL_EVIDENCE_AGE_DAYS, spendMinor: 500_000 });

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(ws);

    // If the stored timestamp had drifted by a session timezone, this is the
    // assertion that would fail — the day either side of the boundary.
    expect(campaigns.map((c) => c.entityId)).toEqual([fresh]);
    expect(staleEvidence).toEqual([]);
  });

  it('one day past the boundary is CANONICAL_EVIDENCE_STALE', async () => {
    await persist({ entityId: stale, ageDays: MAX_CANONICAL_EVIDENCE_AGE_DAYS + 1, spendMinor: 500_000 });

    const { campaigns, staleEvidence, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toEqual([]);
    expect(staleEvidence).toHaveLength(1);
    expect(staleEvidence[0]).toMatchObject({
      id: stale, reason: CANONICAL_EVIDENCE_STALE,
      measurementAgeDays: MAX_CANONICAL_EVIDENCE_AGE_DAYS + 1,
    });
    // Stale is NOT missing, on the real path too. The other two campaigns in this
    // workspace genuinely have no canonical row and correctly appear here; the
    // claim is that the STALE one does not.
    expect(noCanonicalWindow.map((c) => c.id)).not.toContain(stale);
  });

  it('a long-stale row is gated, and its windowEnd survives to explain why', async () => {
    await persist({ entityId: stale, ageDays: 213, spendMinor: 500_000 });

    const { staleEvidence } = await getCanonicalVerdictCampaigns(ws);
    const stored = await prisma.metricSnapshot.findFirst({ where: { workspaceId: ws, entityId: stale }, select: { windowEnd: true } });

    expect(staleEvidence[0].measurementAgeDays).toBe(213);
    // The age we report is the age of the row the DATABASE holds — not of the
    // value we happened to pass in.
    expect(staleEvidence[0].windowEnd.toISOString()).toBe(stored.windowEnd.toISOString());
  });

  it('THE SYNC-TIME TRAP on real rows — synced now, measuring January, still stale', async () => {
    await persist({ entityId: stale, ageDays: 213, syncedAt: new Date(), spendMinor: 500_000 });

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(ws);
    const stored = await prisma.metricSnapshot.findFirst({
      where: { workspaceId: ws, entityId: stale }, select: { date: true, windowEnd: true },
    });

    // The row's sync timestamp really is today, in the database.
    expect(stored.date.getTime()).toBeGreaterThan(stored.windowEnd.getTime());
    expect(campaigns).toEqual([]);
    expect(staleEvidence[0].reason).toBe(CANONICAL_EVIDENCE_STALE);
  });

  it('fresh, stale and never-measured coexist on one real workspace', async () => {
    await persist({ entityId: fresh, ageDays: 1, spendMinor: 700_000 });
    await persist({ entityId: stale, ageDays: 90, spendMinor: 300_000 });
    // `never` gets no snapshot at all.

    const { campaigns, staleEvidence, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns.map((c) => c.entityId)).toEqual([fresh]);
    expect(staleEvidence.map((c) => c.id)).toEqual([stale]);
    expect(noCanonicalWindow.map((c) => c.id)).toEqual([never]);
    expect(noCanonicalWindow[0].reason).toBe(NO_CANONICAL_WINDOW);
  });
});

let captureVaultReady = false;
/** Create a NEW synthetic source and its snapshot/observation in one transaction.
 * Legacy, operational and wrong-level controls deliberately stay capture-less.
 * No existing snapshot is read back and relabelled as provider evidence. */
async function persistCaptured({ data }) {
  if (data.source !== 'META' || data.measurementWindow !== 'CUMULATIVE_30D'
    || data.entityLevel !== 'CAMPAIGN') return prisma.metricSnapshot.create({ data });
  const campaign = await prisma.campaign.findFirst({ where: { workspaceId: data.workspaceId, id: data.entityId }, include: { account: true } });
  if (!campaign) throw new Error('Synthetic capture requires its workspace-owned campaign');
  if (!captureVaultReady) {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.marcom_credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id text NOT NULL,user_id text NOT NULL,platform text NOT NULL,access_token_enc text,refresh_token_enc text,account_id text,scopes text,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,platform))`);
    await prisma.$executeRawUnsafe('ALTER TABLE public.marcom_credentials ADD COLUMN IF NOT EXISTS workspace_id text');
    await prisma.$executeRawUnsafe('ALTER TABLE public.marcom_credentials ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true');
    await prisma.$executeRawUnsafe(`DO $$BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='lumi_canonical_owner') THEN GRANT SELECT(workspace_id,platform,account_id,is_active,updated_at),UPDATE(account_id) ON public.marcom_credentials TO lumi_canonical_owner; END IF; END $$`);
    captureVaultReady = true;
  }
  const auth = { accountExternalId: campaign.account.externalId, currency: data.currency, currencyProvenance: data.currencyProvenance ?? 'LEGACY_UNKNOWN' };
  await prisma.$executeRaw`INSERT INTO public.marcom_credentials(project_id,user_id,workspace_id,platform,account_id,is_active)
    VALUES(${data.workspaceId},'synthetic-t3-test',${data.workspaceId},'meta_ads',${auth.accountExternalId},true)
    ON CONFLICT(project_id,platform) DO UPDATE SET account_id=excluded.account_id,is_active=true,updated_at=clock_timestamp()`;
  const day = (value) => value == null ? undefined : new Date(value).toISOString().slice(0, 10);
  const source = { campaign_id: campaign.externalId, date_start: day(data.windowStart), date_stop: day(data.windowEnd),
    spend: String(data.spendMinor / 100), impressions: String(data.impressions), clicks: String(data.clicks),
    frequency: data.frequency == null ? undefined : String(data.frequency),
    reach: data.reach == null ? undefined : String(data.reach),
    actions: data.conversions == null ? undefined : [{ action_type: 'purchase', value: String(data.conversions) }],
    action_values: data.revenueMinor == null ? undefined : [{ action_type: 'purchase', value: String(data.revenueMinor / 100) }] };
  const now = new Date(data.date), capture = await beginCanonicalCapture(data.workspaceId, auth, now);
  const spec = canonicalCaptureSpecs(now).find((s) => s.level === 'campaign');
  await capture.hooks.start(spec);
  const cursor = [source]; cursor.hasNext = () => false;
  const observed = await collectCursorPages(cursor, { onProgress: (p) => capture.hooks.page('campaign', p) });
  await capture.hooks.finish('campaign', { rows: observed.rows, outcome: 'SUCCESS' });
  await capture.sealSources(); await capture.admitWrite();
  const normalized = [{ entityLevel: 'CAMPAIGN', externalId: campaign.externalId, objective: campaign.objective,
    canonicalFacts: canonicalSourceFacts(source, auth, 0) }];
  try {
    return await prisma.$transaction(async (tx) => {
      const stored = await tx.metricSnapshot.create({ data });
      await capture.commit(tx, [{ ...data, canonicalExternalId: campaign.externalId }], normalized);
      return stored;
    });
  } catch (err) { await capture.failWrite(); throw err; }
}

describe.skipIf(!DB_OK)('T3 legacy provenance negative control', () => {
  it('does not qualify a structurally valid snapshot without a captured observation', async () => {
    const ws = randomUUID(), account = randomUUID(), campaign = randomUUID();
    const end = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    try {
      await prisma.workspace.create({ data: { id: ws, name: 'T3 capture-less control' } });
      await prisma.account.create({ data: { id: account, workspaceId: ws, channel: 'META', name: 'legacy', externalId: account } });
      await prisma.campaign.create({ data: { id: campaign, workspaceId: ws, accountId: account, channel: 'META', name: 'legacy', externalId: campaign } });
      await prisma.metricSnapshot.create({ data: { workspaceId: ws, entityId: campaign, entityLevel: 'CAMPAIGN', source: 'META',
        date: new Date(), granularity: 'DAILY', measurementWindow: 'CUMULATIVE_30D', windowEnd: end,
        windowStart: new Date(end.getTime() - 29 * 86400000), currency: 'USD', currencyProvenance: 'PLATFORM_REPORTED',
        spendMinor: 10000, revenueMinor: 30000, impressions: 10000, clicks: 200, conversions: 10 } });
      const { selectCanonicalVerdictSnapshots } = await import('../verdict-engine/canonicalVerdictEvidence.js');
      expect(await selectCanonicalVerdictSnapshots(ws, [campaign])).toEqual([]);
      expect(await prisma.metricSnapshot.count({ where: { workspaceId: ws } })).toBe(1);
    } finally {
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.workspace.deleteMany({ where: { id: ws } });
    }
  });
});
