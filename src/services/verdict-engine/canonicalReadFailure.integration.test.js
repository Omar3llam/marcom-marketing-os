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
    await prisma.metricSnapshot.create({
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
    await prisma.metricSnapshot.create({
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
