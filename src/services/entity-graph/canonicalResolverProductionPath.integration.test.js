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
