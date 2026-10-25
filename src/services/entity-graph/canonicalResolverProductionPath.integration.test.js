import { beginCanonicalCapture } from '../connectors/canonicalCapture.js';
import { canonicalSourceFacts } from '../connectors/normalize/metaNormalize.js';
import { canonicalCaptureSpecs, collectCursorPages } from '../metaAdsService.js';
// ============================================================
// B5-01E · §15 — canonical resolution on real persisted rows
// ============================================================
// The unit suite proves the selection logic with a mocked client. This one asks
// the question that only persistence can answer: when the rows come back from
// PostgreSQL — through the real selector, in the order the database returns them
// (`orderBy: { date: 'asc' }`) — does the production verdict path still choose
// the correct measurement?
//
// Test D is the one that matters most. It persists candidates such that ordering
// by sync timestamp picks the WRONG row, which is exactly the F-3A defect, and
// asserts the production path picks the right one anyway.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js) — a real
// gap in the default local baseline (B5 F-8), not a claim of coverage.
// ============================================================
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from './EntityGraphService.js';

const DB_OK = await dbAvailable();

describe.skipIf(!DB_OK)('B5-01E · canonical resolution on real PostgreSQL', () => {
  const ws = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();

  /** Persist one canonical candidate. */
  const persist = ({ period, syncedAt, spendMinor, window = 'CUMULATIVE_30D' }) =>
    persistCaptured({
      data: {
        workspaceId: ws, entityId: campaignId, entityLevel: 'CAMPAIGN',
        source: 'META', date: new Date(syncedAt), granularity: 'DAILY',
        measurementWindow: window,
        windowStart: period?.[0] ? new Date(period[0]) : null,
        windowEnd:   period?.[1] ? new Date(period[1]) : null,
        spendMinor, revenueMinor: spendMinor * 3, impressions: 10_000, clicks: 200,
        conversions: 10, roas: 3, ctr: 0.02, frequency: 2.2, currency: 'EGP',
      },
    });

  // Two real 30-day periods, expressed RELATIVE to the run.
  //
  // They were fixed dates until B5-01F, which made the verdict reader
  // time-relative: a hardcoded July window is fine in August and silently stale
  // by October, so a fixed fixture here is a test that passes until it doesn't.
  // Anchored to `now` instead, both stay inside the freshness bound forever —
  // and this suite goes on testing what it was written for, which is WHICH row
  // structural resolution picks.
  const DAY = 86_400_000;
  /** UTC midnight `ageDays` before now. */
  const dayAgo = (ageDays) =>
    `${new Date(Date.now() - ageDays * DAY).toISOString().slice(0, 10)}T00:00:00Z`;
  /** An inclusive 30-day period ending `endAgeDays` ago. */
  const period = (endAgeDays) => [dayAgo(endAgeDays + 29), dayAgo(endAgeDays)];

  const RECENT = period(0);   // ends today
  const EARLIER = period(1);  // ends yesterday — older measurement, still fresh

  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
    await prisma.workspace.create({ data: { id: ws, name: `b5-01e-${ws.slice(0, 8)}` } });
    await prisma.account.create({
      data: { id: accountId, workspaceId: ws, channel: 'META', name: 'B5E acct', externalId: `act-${accountId.slice(0, 8)}` },
    });
    await prisma.campaign.create({
      data: {
        id: campaignId, workspaceId: ws, accountId, channel: 'META',
        name: 'Always On', externalId: `c-${campaignId.slice(0, 8)}`, objective: 'OUTCOME_SALES',
      },
    });
  });


  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.account.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: ws } }).catch(() => {});
  });

  // ── A · a valid row is selected ─────────────────────────────────────────────
  it('A · a structurally valid persisted row becomes verdict evidence', async () => {
    await persist({ period: RECENT, syncedAt: new Date(), spendMinor: 999 });

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(noCanonicalWindow).toEqual([]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe(RECENT[1].replace('Z', '.000Z'));
  });

  // ── B · newer malformed vs older valid ──────────────────────────────────────
  it('B · a newer MALFORMED row does not beat an older VALID one', async () => {
    // 31 inclusive days — declared canonical, contradicted by its own dates.
    await persist({ period: [dayAgo(30), dayAgo(0)], syncedAt: new Date(), spendMinor: 111 });
    await persist({ period: EARLIER, syncedAt: new Date(Date.now() - 2 * DAY), spendMinor: 999 });

    const { campaigns } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe(EARLIER[1].replace('Z', '.000Z'));
  });

  // ── C · every candidate invalid ─────────────────────────────────────────────
  it('C · when every persisted candidate is invalid, the campaign has NO canonical evidence', async () => {
    await persist({ period: null, syncedAt: new Date(), spendMinor: 111 });
    await persist({ period: [dayAgo(6), dayAgo(0)], syncedAt: new Date(), spendMinor: 222 });

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0]).toMatchObject({ id: campaignId, reason: 'NO_CANONICAL_WINDOW' });
  });

  // ── D · re-sync promotion — THE F-3A DEFECT, ON REAL ROWS ───────────────────
  it('D · the newer MEASUREMENT wins over the newer SYNC (F-3A closed on the persistence path)', async () => {
    // The stale period, re-synced most recently → the highest `date` in the table.
    await persist({ period: EARLIER, syncedAt: new Date(), spendMinor: 111 });
    // The current period, synced earlier → a lower `date`.
    await persist({ period: RECENT, syncedAt: new Date(Date.now() - 3 * DAY), spendMinor: 999 });

    // Ordering by sync timestamp — what the old selector did — picks 111.
    const bySyncDesc = await prisma.metricSnapshot.findFirst({
      where: { workspaceId: ws, entityId: campaignId }, orderBy: { date: 'desc' }, select: { spendMinor: true },
    });
    expect(bySyncDesc.spendMinor).toBe(111);

    // The production path picks the row that measures the most recent period.
    const { campaigns } = await getCanonicalVerdictCampaigns(ws);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe(RECENT[1].replace('Z', '.000Z'));
  });

  it('D2 · rowCount reports every candidate the read consumed, not the one chosen', async () => {
    await persist({ period: EARLIER, syncedAt: new Date(), spendMinor: 111 });
    await persist({ period: RECENT, syncedAt: new Date(Date.now() - 3 * DAY), spendMinor: 999 });

    const { campaigns } = await getCanonicalVerdictCampaigns(ws);
    expect(campaigns[0].evidenceBasis.rowCount).toBe(2);
    expect(campaigns[0].evidenceBasis.reduction).toBe('canonical-resolved-per-entity');
  });

  // ── §14 · where structural validity stops, on real rows ─────────────────────
  // ADAPTED BY B5-01F. This asserted that a long-past window was still ACCEPTED,
  // because B5-01E deliberately left F-13 open. F-13 is now closed, so the row is
  // withheld — but the claim worth pinning is the one that survives the ruling:
  // it is withheld as STALE, never as "never measured", and the structural layer
  // is not what withheld it.
  it('§14 · a long-past window is withheld as STALE, not as missing evidence', async () => {
    await persist({ period: period(213), syncedAt: new Date(), spendMinor: 777 });

    const { campaigns, noCanonicalWindow, staleEvidence } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow).toEqual([]);
    expect(staleEvidence).toHaveLength(1);
    expect(staleEvidence[0]).toMatchObject({ id: campaignId, reason: 'CANONICAL_EVIDENCE_STALE', measurementAgeDays: 213 });
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
