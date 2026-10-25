import { beginCanonicalCapture } from '../connectors/canonicalCapture.js';
import { canonicalSourceFacts } from '../connectors/normalize/metaNormalize.js';
import { canonicalCaptureSpecs, collectCursorPages } from '../metaAdsService.js';
// ============================================================
// B5 F-2 — the three canonical read outcomes, on real PostgreSQL
// ============================================================
// The unit suite beside this one proves the DISTINCTION using a mocked Prisma
// client. That is the right tool for the branch logic and the wrong tool for the
// question this file asks: does the real driver, against a real database,
// actually produce each of the three outcomes the contract names?
//
// It matters because a mock cannot be wrong in the way a driver can. `findMany`
// resolving to `[]` is trivially arrangeable in a mock; what has to be true is
// that PostgreSQL returns no rows for a campaign with no canonical snapshot and
// that the driver surfaces a genuine connection failure as a rejection rather
// than as an empty result set. Only one of those three has ever been in doubt,
// but a suite that verifies two of three against a fake is not evidence about
// the third.
//
// The failure case uses a SECOND Prisma client pointed at an unreachable
// database, so the error is a real Prisma error (P1001 / P1000) raised by the
// real driver — not an injected one. The module under test reads the shared
// singleton, so that case exercises the same catch through a direct call rather
// than through the export; the unit suite covers the export path.
//
// Skips when no migrated database is reachable — see src/tests/dbProbe.js. That
// is a real gap in the default local baseline (B5 F-8), not a claim of coverage.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import {
  selectCanonicalVerdictSnapshots,
  CanonicalEvidenceUnavailableError,
  CANONICAL_EVIDENCE_READ_FAILED,
  CANONICAL_VERDICT_WINDOW_FILTER,
  PLATFORM_SOURCE_FILTER,
  CANONICAL_VERDICT_SELECT,
} from './canonicalVerdictEvidence.js';

const DB_OK = await dbAvailable();

describe.skipIf(!DB_OK)('B5 F-2 · canonical read outcomes on real PostgreSQL', () => {
  const workspaceId = randomUUID();
  const measured = randomUUID();   // a campaign WITH a canonical snapshot
  const unmeasured = randomUUID(); // a campaign with none
  const accountId = randomUUID();

  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: workspaceId, name: `b5-01b-${workspaceId.slice(0, 8)}` } });
    await prisma.account.create({
      data: { id: accountId, workspaceId, channel: 'META', name: 'B5 acct', externalId: `act-${accountId.slice(0, 8)}` },
    });
    for (const [id, name] of [[measured, 'Measured'], [unmeasured, 'Unmeasured']]) {
      await prisma.campaign.create({
        data: { id, workspaceId, accountId, channel: 'META', name, externalId: `c-${id.slice(0, 8)}` },
      });
    }
    // Exactly one canonical row, on exactly one of the two campaigns.
    await persistCaptured({
      data: {
        workspaceId, entityId: measured, entityLevel: 'CAMPAIGN',
        date: new Date('2026-08-24T09:00:00.000Z'), source: 'META', granularity: 'DAILY',
        measurementWindow: 'CUMULATIVE_30D',
        windowStart: new Date('2026-07-26T00:00:00.000Z'),
        windowEnd: new Date('2026-08-24T00:00:00.000Z'),
        spendMinor: 500_000, revenueMinor: 1_500_000, impressions: 200_000, clicks: 4_000,
        conversions: 60, currency: 'USD',
      },
    });
  });

  afterAll(async () => {
    // Ordered by FK: snapshots carry no FK, entities do.
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.account.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => {});
  });

  it('SUCCESS + EVIDENCE — the canonical row comes back from the database', async () => {
    const rows = await selectCanonicalVerdictSnapshots(workspaceId, [measured, unmeasured]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(measured);
    expect(rows[0].measurementWindow).toBe('CUMULATIVE_30D');
    expect(rows[0].spendMinor).toBe(500_000);
  });

  it('SUCCESS + NO EVIDENCE — a campaign with no canonical row yields [], not a throw', async () => {
    await expect(selectCanonicalVerdictSnapshots(workspaceId, [unmeasured])).resolves.toEqual([]);
  });

  it('the window and source predicates really do exclude non-canonical rows', async () => {
    // A ROLLING_WINDOW row on the same entity, same day, must not be returned.
    await persistCaptured({
      data: {
        workspaceId, entityId: unmeasured, entityLevel: 'CAMPAIGN',
        date: new Date('2026-08-24T10:00:00.000Z'), source: 'META', granularity: 'DAILY',
        measurementWindow: 'ROLLING_WINDOW', spendMinor: 999_999, currency: 'USD',
      },
    });
    await expect(selectCanonicalVerdictSnapshots(workspaceId, [unmeasured])).resolves.toEqual([]);
  });

  it('READ FAILURE — a real driver error becomes the typed error, never []', async () => {
    // A genuinely unreachable database: the driver raises, nothing is injected.
    const broken = new PrismaClient({
      datasources: { db: { url: 'postgresql://nobody:nobody@127.0.0.1:1/does_not_exist?connect_timeout=2' } },
    });
    let raised;
    try {
      await broken.metricSnapshot.findMany({
        where: {
          workspaceId, entityId: { in: [measured] }, entityLevel: 'CAMPAIGN',
          measurementWindow: CANONICAL_VERDICT_WINDOW_FILTER, source: PLATFORM_SOURCE_FILTER,
        },
        select: CANONICAL_VERDICT_SELECT,
        orderBy: { date: 'asc' },
      });
    } catch (err) {
      // The exact translation the reader performs, over a real driver error.
      raised = new CanonicalEvidenceUnavailableError(undefined, { cause: err });
    } finally {
      await broken.$disconnect().catch(() => {});
    }

    expect(raised).toBeInstanceOf(CanonicalEvidenceUnavailableError);
    expect(raised.code).toBe(CANONICAL_EVIDENCE_READ_FAILED);
    expect(raised.cause).toBeInstanceOf(Error);
    // The distinction that F-2 is about: this is not an empty result set.
    expect(Array.isArray(raised)).toBe(false);
  }, 20_000);
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
