// ============================================================
// R8 — the seam: a Meta response becomes a DB row
// ============================================================
// The unit files hold the normalizer and the sink to their own contracts. This
// one runs the REAL chain between them —
//
//     raw Meta daily response
//       → MetaConnector.normalizeDaily
//         → metaDailyNormalize
//           → toSnapshotRows      (the shared row builder, deliberately reused)
//             → landDailySnapshots
//               → the row handed to Prisma
//
// — with nothing mocked except the database client itself. The expected row is
// written out by hand, field by field: a test that rebuilt it by calling the
// same code would agree with the implementation about anything they got wrong
// together, which is the exact gap R5's negative control found.
//
// It also pins the compatibility claim the whole phase rests on: the DAILY
// population is invisible to every existing consumer, and the rolling population
// still means what it meant yesterday.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace:      { findUnique: vi.fn(), update: vi.fn() },
    $transaction:   vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { metaConnector } from './MetaConnector.js';
import { landDailySnapshots } from './dailySnapshotSink.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { detId, CHANNEL, MEASUREMENT_WINDOW, OPERATIONAL_WINDOW_FILTER, isOperationalWindow } from './connectorTypes.js';

const WS = 'ws-1';
const OBSERVED = new Date('2026-08-16T09:00:00.000Z');
const ACCOUNT = 'act_123';
const ENTITY = detId(WS, CHANNEL.META, 'CAMPAIGN', 'c1');

// Exactly what Meta returns for `time_increment=1`: one row per campaign per
// day, each stating its own single-day period.
const META_DAY = Object.freeze({
  campaign_id: 'c1',
  campaign_name: 'Eid — Cold',
  spend: '420.00',
  impressions: '15000',
  clicks: '300',
  actions: [{ action_type: 'purchase', value: '12' }],
  action_values: [{ action_type: 'purchase', value: '2100' }],
  date_start: '2026-08-10',
  date_stop: '2026-08-10',
});

const landDay = async (rows = [META_DAY], date = OBSERVED) => {
  const { snapshots } = metaConnector.normalizeDaily({
    accountExternalId: ACCOUNT, currency: 'EGP', date, rows,
  });
  return landDailySnapshots(WS, CHANNEL.META, snapshots);
};
const persisted = () => prisma.metricSnapshot.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.campaign.findMany.mockImplementation(async ({ where }) => where.id.in.map((id) => ({ id })));
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.metricSnapshot.create.mockImplementation((args) => args);
  prisma.metricSnapshot.update.mockImplementation((args) => args);
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
});

describe('R8 seam — one Meta day becomes exactly one row', () => {
  it('persists the row those fields justify, and nothing else', async () => {
    await landDay();

    expect(persisted()).toEqual({
      workspaceId: WS,
      entityId: ENTITY,
      entityLevel: 'CAMPAIGN',
      // The OBSERVATION instant — when the sync looked.
      date: OBSERVED,
      source: 'META',
      // Still hardcoded by the shared row builder, still not a claim about the
      // period (the schema says so). measurementWindow is the field that answers
      // that question — and here, for the first time in this codebase, the two
      // happen to agree.
      granularity: 'DAILY',
      measurementWindow: 'DAILY',
      // The MEASURED day — the platform's own dates, inclusive both ends.
      windowStart: new Date('2026-08-10T00:00:00.000Z'),
      windowEnd: new Date('2026-08-10T00:00:00.000Z'),
      spendMinor: 42000,
      revenueMinor: 210000,
      cpaMinor: 3500,               // 42000 / 12, derived by the shared builder
      impressions: 15000,
      clicks: 300,
      conversions: 12,
      ctr: 0.02,                    // that day's own clicks ÷ impressions
      roas: 5,                      // that day's own revenue ÷ spend
      frequency: null,              // CUMULATIVE — never carried in this population
      reach: null,                  // CUMULATIVE — never carried in this population
      actionMetrics: { purchase: 12, purchaseValue: 2100 },
      dailyBudgetMinor: null,
      currency: 'EGP',
      currencyProvenance: 'LEGACY_UNKNOWN', // fixture supplies a code without its origin
    });
  });

  it('derives the ratios from that DAY, not from any window', async () => {
    // A daily CTR is the day's clicks over the day's impressions — a within-row
    // ratio, which is the only kind the DERIVED family permits without summing
    // first. Nothing here averages anything across days.
    await landDay([{ ...META_DAY, clicks: '150', impressions: '10000' }]);
    expect(persisted().ctr).toBe(0.015);
  });
});

describe('R8 seam — the sync clock can never define the measured day', () => {
  it('moves the observation instant and leaves the period exactly where it was', async () => {
    // Controls 3 and 4 together: neither a client-supplied time nor the sync
    // timestamp may stand in for the platform's day. Only date_start/date_stop
    // decide, so a sync running a month later records the same day.
    const muchLater = new Date('2026-09-30T23:59:00.000Z');
    await landDay([META_DAY], muchLater);

    expect(persisted().date).toBe(muchLater);
    expect(persisted().windowStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(persisted().windowEnd).toEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('refuses the whole row when the platform states no period', async () => {
    // There is no fallback to `now`, to the requested range, or to yesterday.
    // A row that cannot say what it measured is not landed at all.
    const out = await landDay([{ ...META_DAY, date_start: null, date_stop: null }]);
    expect(out).toEqual({ created: 0, restated: 0, skippedUnknownEntity: 0 });
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
  });

  it('refuses a trailing aggregate that arrives on the daily path', async () => {
    // If Meta ever stops honouring time_increment, the response is a 90-day row.
    // It is dropped, and the account simply has no daily observations that run —
    // which is the honest state, and visibly different from zeros.
    const out = await landDay([{ ...META_DAY, date_start: '2026-05-13', date_stop: '2026-08-10' }]);
    expect(out.created).toBe(0);
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
  });
});

describe('R8 seam — a second sync of the same day', () => {
  it('restates the row rather than adding a second observation of that day', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([{
      id: 'snap-1', entityId: ENTITY, entityLevel: 'CAMPAIGN',
      source: 'META', windowStart: new Date('2026-08-10T00:00:00.000Z'),
    }]);

    const out = await landDay([{ ...META_DAY, action_values: [{ action_type: 'purchase', value: '2400' }] }]);

    expect(out).toEqual({ created: 0, restated: 1, skippedUnknownEntity: 0 });
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.metricSnapshot.update.mock.calls[0][0].data.revenueMinor).toBe(240000);
  });
});

describe('R8 — the new population is invisible to every existing consumer', () => {
  it('the operational allow-list still excludes DAILY, now that it has a producer', async () => {
    expect(isOperationalWindow(MEASUREMENT_WINDOW.DAILY)).toBe(false);
    expect(OPERATIONAL_WINDOW_FILTER.in).not.toContain('DAILY');
    expect(OPERATIONAL_WINDOW_FILTER.in).toEqual(['LEGACY_UNKNOWN', 'ROLLING_WINDOW']);
  });

  it('the canonical selectors ask for CUMULATIVE_30D, which a daily row is not', async () => {
    const { CANONICAL_VERDICT_WINDOW } = await import('../verdict-engine/canonicalVerdictEvidence.js');
    expect(CANONICAL_VERDICT_WINDOW).toBe('CUMULATIVE_30D');
    expect(CANONICAL_VERDICT_WINDOW).not.toBe(MEASUREMENT_WINDOW.DAILY);
  });

  it('the rolling population still declares ROLLING_WINDOW for the same raw rows', async () => {
    // Control 9. The operational normalizer was not taught anything by this
    // phase: hand it the same Meta payload and it still produces the trailing
    // population it always did.
    const rows = metaNormalize({
      accountExternalId: ACCOUNT, currency: 'EGP', date: OBSERVED, rows: [META_DAY],
    });
    const campaign = rows.find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.measurementWindow).toBe('ROLLING_WINDOW');
    expect(campaign.measurementWindow).not.toBe('DAILY');
    // …and it still builds the ACCOUNT rollup the daily path deliberately lacks.
    expect(rows.some((r) => r.entityLevel === 'ACCOUNT')).toBe(true);
  });

  it('a daily row is never derived by subtracting rolling snapshots', async () => {
    // Control 8, structurally. The daily number's only ancestor is a platform
    // response: the sink reads the DAILY population solely to find the row it is
    // about to rewrite, and neither module imports an operational read at all.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const code = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const rel of ['./dailySnapshotSink.js', './normalize/metaDailyNormalize.js']) {
      expect(code(rel)).not.toMatch(/selectOperationalSnapshots|OPERATIONAL_WINDOW_FILTER/);
      expect(code(rel)).not.toMatch(/ROLLING_WINDOW/);
    }
  });
});
