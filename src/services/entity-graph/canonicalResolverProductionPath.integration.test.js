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
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
    prisma.metricSnapshot.create({
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

  // Two real 30-day periods, both safely in the past relative to any test run.
  const JUL_AUG = ['2026-07-13T00:00:00Z', '2026-08-11T00:00:00Z'];
  const JUN_JUL = ['2026-06-13T00:00:00Z', '2026-07-12T00:00:00Z'];

  beforeAll(async () => {
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

  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
  });

  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.account.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: ws } }).catch(() => {});
  });

  // ── A · a valid row is selected ─────────────────────────────────────────────
  it('A · a structurally valid persisted row becomes verdict evidence', async () => {
    await persist({ period: JUL_AUG, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 999 });

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(noCanonicalWindow).toEqual([]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  // ── B · newer malformed vs older valid ──────────────────────────────────────
  it('B · a newer MALFORMED row does not beat an older VALID one', async () => {
    // 31 inclusive days — declared canonical, contradicted by its own dates.
    await persist({ period: ['2026-07-12T00:00:00Z', '2026-08-11T00:00:00Z'], syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 });
    await persist({ period: JUN_JUL, syncedAt: '2026-07-12T09:00:00Z', spendMinor: 999 });

    const { campaigns } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  // ── C · every candidate invalid ─────────────────────────────────────────────
  it('C · when every persisted candidate is invalid, the campaign has NO canonical evidence', async () => {
    await persist({ period: null, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 });
    await persist({ period: ['2026-08-01T00:00:00Z', '2026-08-07T00:00:00Z'], syncedAt: '2026-08-10T09:00:00Z', spendMinor: 222 });

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(ws);

    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0]).toMatchObject({ id: campaignId, reason: 'NO_CANONICAL_WINDOW' });
  });

  // ── D · re-sync promotion — THE F-3A DEFECT, ON REAL ROWS ───────────────────
  it('D · the newer MEASUREMENT wins over the newer SYNC (F-3A closed on the persistence path)', async () => {
    // The stale period, re-synced most recently → the highest `date` in the table.
    await persist({ period: JUN_JUL, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 });
    // The current period, synced earlier → a lower `date`.
    await persist({ period: JUL_AUG, syncedAt: '2026-08-08T09:00:00Z', spendMinor: 999 });

    // Ordering by sync timestamp — what the old selector did — picks 111.
    const bySyncDesc = await prisma.metricSnapshot.findFirst({
      where: { workspaceId: ws, entityId: campaignId }, orderBy: { date: 'desc' }, select: { spendMinor: true },
    });
    expect(bySyncDesc.spendMinor).toBe(111);

    // The production path picks the row that measures the most recent period.
    const { campaigns } = await getCanonicalVerdictCampaigns(ws);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].windowEnd.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('D2 · rowCount reports every candidate the read consumed, not the one chosen', async () => {
    await persist({ period: JUN_JUL, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 });
    await persist({ period: JUL_AUG, syncedAt: '2026-08-08T09:00:00Z', spendMinor: 999 });

    const { campaigns } = await getCanonicalVerdictCampaigns(ws);
    expect(campaigns[0].evidenceBasis.rowCount).toBe(2);
    expect(campaigns[0].evidenceBasis.reduction).toBe('canonical-resolved-per-entity');
  });

  // ── §14 · the freshness limit of this slice, on real rows ───────────────────
  it('§14 · a structurally valid JANUARY window is still ACCEPTED — B5-01E is not a freshness slice', async () => {
    await persist({ period: ['2026-01-01T00:00:00Z', '2026-01-30T00:00:00Z'], syncedAt: '2026-01-30T09:00:00Z', spendMinor: 777 });

    const { campaigns } = await getCanonicalVerdictCampaigns(ws);

    // Accepted STRUCTURALLY. Not "fresh", not "adequate evidence for a verdict
    // today" — that ruling is F-13 / F-3B and is deliberately not made here.
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(777);
  });
});
