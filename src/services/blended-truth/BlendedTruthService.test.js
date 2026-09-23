// ============================================================
// BlendedTruthService.buildChannelInputs — label join correctness (P1.2)
// ------------------------------------------------------------
// Snapshots are CAMPAIGN-grain: MetricSnapshot.entityId == Campaign.id. The
// label map is now keyed off Campaign.id, so a channel row must carry the
// name/channel of the campaign whose id equals its entityId — never a different
// entity's. Pure function → tested without a DB (mirrors the engine tests).
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildChannelInputs, latestPerStream } from './BlendedTruthService.js';
import { reconcile } from './blendedTruthEngine.js';

const snap = (over = {}) => ({
  entityId: 'B', entityLevel: 'CAMPAIGN', source: 'META',
  revenueMinor: 0, spendMinor: 0, currency: 'USD', ...over,
});

// labelsById as getBlendedTruth now builds it: keyed by Campaign.id.
const labels = () => new Map([
  ['A', { name: 'Always On',    channel: 'META',   currency: 'USD' }],
  ['B', { name: 'Summer Promo', channel: 'GOOGLE', currency: 'USD' }],
]);

describe('buildChannelInputs — campaign-keyed label join', () => {
  it('INVARIANT: a snapshot with entityId=B resolves to Campaign B, NOT Campaign A', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'B' })], labels());
    expect(row.channelId).toBe('B');
    expect(row.name).toBe('Summer Promo'); // B's name, never A's
    expect(row.channel).toBe('GOOGLE');    // B's channel, never A's
  });

  it('hits the label map on the campaign id (returns name + channel)', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'A' })], labels());
    expect(row.name).toBe('Always On');
    expect(row.channel).toBe('META');
  });

  it('is graceful when no campaign matches the entityId (name/channel null)', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'Z-orphan' })], labels());
    expect(row.name).toBeNull();
    expect(row.channel).toBeNull();
    expect(row.channelId).toBe('Z-orphan'); // the view's last-resort identity
  });

  it('aggregates spend/platform/actual per entity unchanged (labels are identity-only)', () => {
    const rows = buildChannelInputs([
      snap({ entityId: 'B', source: 'META', spendMinor: 2000, revenueMinor: 8000 }),
      snap({ entityId: 'B', source: 'GA4',  revenueMinor: 6000 }), // actual
    ], labels());
    expect(rows).toHaveLength(1);
    const b = rows[0];
    expect(b.spendMinor).toBe(2000);
    expect(b.platformRevenueMinor).toBe(8000);
    expect(b.actualRevenueMinor).toBe(6000);
  });
});

describe('selected blended revenue window', () => {
  const start = new Date('2026-08-01T00:00:00Z');
  const end = new Date('2026-08-31T23:59:59.999Z');
  const platform = (over = {}) => snap({ entityId: 'A', source: 'META',
    date: new Date('2026-09-01T12:00:00Z'), spendMinor: 100, revenueMinor: 300,
    measurementWindow: 'ROLLING_WINDOW', windowStart: start, windowEnd: end, ...over });
  const actual = (over = {}) => snap({ entityId: 'A', source: 'GA4',
    date: new Date('2026-09-01T12:00:00Z'), revenueMinor: 250,
    measurementWindow: 'ROLLING_WINDOW', windowStart: start, windowEnd: end, ...over });

  it('carries the actual observation window when actual revenue is selected', () => {
    const [channel] = reconcile({ channels: buildChannelInputs([platform(), actual()]) }).channels;
    expect(channel.blendedRevenueWindow).toEqual({ windowStatus: 'EXACT', windowStart: start, windowEnd: end });
  });

  it('carries the platform window on fallback, never an absent actual window', () => {
    const [channel] = reconcile({ channels: buildChannelInputs([platform()]) }).channels;
    expect(channel.blendedRevenueWindow).toEqual({ windowStatus: 'EXACT', windowStart: start, windowEnd: end });
  });

  it('does not borrow the discarded platform window when the selected actual is unknown', () => {
    const [channel] = reconcile({ channels: buildChannelInputs([platform(), actual({
      measurementWindow: 'LEGACY_UNKNOWN', windowStart: null, windowEnd: null,
    })]) }).channels;
    expect(channel.blendedRevenueWindow).toMatchObject({ windowStatus: 'UNKNOWN', windowStart: null, windowEnd: null });
  });

  it('refuses to present mixed actual-source periods as one exact period', () => {
    const [channel] = reconcile({ channels: buildChannelInputs([platform(), actual(), actual({
      source: 'MANUAL', windowStart: new Date('2026-08-02T00:00:00Z'),
    })]) }).channels;
    expect(channel.blendedRevenueWindow.windowStatus).toBe('UNKNOWN');
  });
});

// ============================================================
// Overlapping trailing-window snapshots (#359)
// ------------------------------------------------------------
// Every row here is a ROLLING-WINDOW AGGREGATE for its sync date, because that
// is what the Meta connector actually writes: `date_preset: last_90d` with no
// `time_increment`, stamped `new Date()`. Day 2 therefore CONTAINS day 1's
// spend. The numbers below are shaped like real ones — a slowly climbing
// cumulative total — so that summing them produces a plausible-looking figure
// rather than an obviously broken one. That is exactly why this survived.
//
// These tests do NOT assert that the rows are daily. They assert that the
// arithmetic stops pretending they are additive.
// ============================================================
const dated = (over = {}) => ({
  entityId: 'E1', entityLevel: 'CAMPAIGN', source: 'META',
  date: new Date('2026-08-01T00:00:00Z'),
  revenueMinor: 0, spendMinor: 0, currency: 'USD', ...over,
});
const onDay = (n, over = {}) => dated({ date: new Date(`2026-08-0${n}T09:00:00Z`), ...over });

describe('latestPerStream — the newest reading supersedes, it does not add', () => {
  it('A · three overlapping spend aggregates collapse to the newest, not their sum', () => {
    const [row] = buildChannelInputs([
      onDay(1, { spendMinor: 900 }),
      onDay(2, { spendMinor: 910 }),
      onDay(3, { spendMinor: 925 }),
    ]);
    expect(row.spendMinor).toBe(925);
    expect(row.spendMinor).not.toBe(2735); // 900+910+925 — the defect
  });

  it('B · revenue collapses to the newest reading', () => {
    const [row] = buildChannelInputs([
      onDay(1, { revenueMinor: 1800 }),
      onDay(2, { revenueMinor: 1900 }),
      onDay(3, { revenueMinor: 2100 }),
    ]);
    expect(row.platformRevenueMinor).toBe(2100);
    expect(row.platformRevenueMinor).not.toBe(5800);
  });

  it('D · one entity\'s snapshots cannot contaminate another', () => {
    const rows = buildChannelInputs([
      onDay(1, { entityId: 'A', spendMinor: 100 }),
      onDay(2, { entityId: 'A', spendMinor: 120 }),
      onDay(1, { entityId: 'B', spendMinor: 200 }),
      onDay(2, { entityId: 'B', spendMinor: 240 }),
    ]);
    const by = new Map(rows.map((r) => [r.channelId, r]));
    expect(by.get('A').spendMinor).toBe(120);
    expect(by.get('B').spendMinor).toBe(240);
    expect(rows).toHaveLength(2);
  });

  it('E · no snapshots yields no channels — nothing is invented', () => {
    expect(buildChannelInputs([])).toEqual([]);
    expect(latestPerStream([])).toEqual([]);
    expect(latestPerStream()).toEqual([]);
  });

  it('F · a metric absent from the NEWEST row is not inherited from an older one', () => {
    // The DB cannot produce this — spendMinor is `Int @default(0)`, non-nullable.
    // It is a hostile fixture: the point is that 900 must not survive into the
    // answer by falling back down the stack to a stale row.
    const [row] = buildChannelInputs([
      onDay(1, { spendMinor: 900, revenueMinor: 1800 }),
      onDay(2, { spendMinor: undefined, revenueMinor: undefined }),
    ]);
    expect(row.spendMinor).not.toBe(900);
    expect(row.platformRevenueMinor).not.toBe(1800);
  });

  // §9 cross-service fixture. The identical rows are asserted in
  // EconomicsService.test.js and AttributionService.test.js, and all three run
  // against THIS function — not three copies of it.
  it('G · a stale historical row is superseded, never added to the current one', () => {
    const rows = [onDay(1, { spendMinor: 100 }), onDay(2, { spendMinor: 120 }), onDay(3, { spendMinor: 140 })];
    expect(buildChannelInputs(rows)[0].spendMinor).toBe(140);
    expect(latestPerStream(rows)).toHaveLength(1);
    expect(latestPerStream(rows)[0].spendMinor).toBe(140);
  });

  // The fold must not depend on the caller having remembered an `orderBy`.
  it('picks the newest regardless of the order rows arrive in', () => {
    for (const order of [[3, 1, 2], [2, 3, 1], [1, 2, 3], [3, 2, 1]]) {
      const [row] = buildChannelInputs(order.map((n) => onDay(n, { spendMinor: n * 100 })));
      expect(row.spendMinor).toBe(300);
    }
  });

  // The reduction is per (entityId, source). Two DIFFERENT sources on one entity
  // are independent measurements — a platform claim and a measured actual — and
  // collapsing those together would destroy the platform-vs-actual gap that is
  // this whole service's reason to exist.
  it('supersedes WITHIN a source stream but never ACROSS two of them', () => {
    const [row] = buildChannelInputs([
      onDay(1, { source: 'META', spendMinor: 900, revenueMinor: 8000 }),
      onDay(2, { source: 'META', spendMinor: 925, revenueMinor: 8200 }),
      onDay(1, { source: 'GA4',  revenueMinor: 5900 }),
      onDay(2, { source: 'GA4',  revenueMinor: 6100 }),
    ]);
    expect(row.spendMinor).toBe(925);            // newest META
    expect(row.platformRevenueMinor).toBe(8200); // newest META
    expect(row.actualRevenueMinor).toBe(6100);   // newest GA4, still SEPARATE
  });

  it('keeps actualRevenueMinor null when no actual source ever reported', () => {
    const [row] = buildChannelInputs([onDay(1, { spendMinor: 900 }), onDay(2, { spendMinor: 925 })]);
    expect(row.actualRevenueMinor).toBeNull(); // absence, not a fabricated 0
  });

  // A single row is the degenerate case and must be identity — otherwise a
  // workspace that has synced exactly once would read differently.
  it('is identity on a single row per stream', () => {
    const [row] = buildChannelInputs([onDay(1, { spendMinor: 925, revenueMinor: 2100 })]);
    expect(row.spendMinor).toBe(925);
    expect(row.platformRevenueMinor).toBe(2100);
  });

  it('H · a real measured zero is kept; it is not treated as missing', () => {
    const [row] = buildChannelInputs([
      onDay(1, { spendMinor: 900, revenueMinor: 1800 }),
      onDay(2, { spendMinor: 925, revenueMinor: 0 }), // genuinely zero revenue today
    ]);
    expect(row.platformRevenueMinor).toBe(0);
    expect(row.spendMinor).toBe(925);
  });
});
