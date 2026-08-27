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
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
    return prisma.metricSnapshot.create({
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

  beforeAll(async () => {
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

  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
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
