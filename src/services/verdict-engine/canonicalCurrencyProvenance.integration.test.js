import { beginCanonicalCapture } from '../connectors/canonicalCapture.js';
import { canonicalSourceFacts } from '../connectors/normalize/metaNormalize.js';
import { canonicalCaptureSpecs, collectCursorPages } from '../metaAdsService.js';
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { selectCanonicalVerdictSnapshots } from './canonicalVerdictEvidence.js';
import { evaluateConnectorVerdicts, getConnectorVerdicts } from './connectorVerdictService.js';

const DB_OK = await dbAvailable();
describe.skipIf(!DB_OK)('SC-17A real PostgreSQL → canonical reader → distribution', () => {
  const ws = randomUUID(), accountId = randomUUID(), campaignId = randomUUID();
  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
    await prisma.workspace.create({ data: { id: ws, name: 'SC-17A isolated test' } });
    await prisma.account.create({ data: { id: accountId, workspaceId: ws, channel: 'META', name: 'Test', externalId: accountId } });
    await prisma.campaign.create({ data: { id: campaignId, workspaceId: ws, accountId, channel: 'META', name: 'Test', externalId: campaignId, objective: 'OUTCOME_SALES' } });
  });
  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } });
    await prisma.account.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
  });
  it.each(['PLATFORM_REPORTED', 'LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED'])
  ('stored %s is selected exactly and only real platform origin authorizes publication', async (origin) => {
    const end = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await persistCaptured({ data: {
      workspaceId: ws, entityId: campaignId, entityLevel: 'CAMPAIGN', source: 'META',
      date: new Date(), granularity: 'DAILY', measurementWindow: 'CUMULATIVE_30D',
      windowStart: new Date(end.getTime() - 29 * 86400000), windowEnd: end,
      currency: 'EGP', currencyProvenance: origin,
      spendMinor: 10000, revenueMinor: 30000, impressions: 10000, clicks: 200, conversions: 10, frequency: 2,
    } });
    const selected = await selectCanonicalVerdictSnapshots(ws, [campaignId]);
    expect(selected).toHaveLength(1);
    expect(selected[0].currencyProvenance).toBe(origin);
    const evaluation = await evaluateConnectorVerdicts(ws);
    expect(evaluation.status).toBe('OK');
    expect(evaluation.campaigns).toHaveLength(1);
    expect(evaluation.campaigns[0].currencyProvenance).toBe(origin === 'PLATFORM_REPORTED' ? origin : 'LEGACY_UNKNOWN');
    const result = await getConnectorVerdicts(ws, { evaluation, memory: { records: [], status: 'NO_VALIDATED_MEMORY' } });
    expect(result.verdicts).toHaveLength(1);
    expect(result.budgetDistribution).toMatchObject(origin === 'PLATFORM_REPORTED'
      ? { status: 'AVAILABLE', currency: 'EGP', totalSpendMinor: 10000 }
      : { status: 'UNAVAILABLE', reason: 'UNKNOWN_CURRENCY', currency: null, totalSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
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
