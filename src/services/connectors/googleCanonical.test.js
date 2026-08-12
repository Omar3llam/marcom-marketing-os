// ============================================================
// Phase D.3 — Google canonical 30-day evidence
// ============================================================
// Google reaches a canonical row by a different road than Meta, and these tests
// exist to pin the difference rather than let it be discovered later.
//
// Meta is handed rows that state their own period. Google is asked for DAILY
// rows across an explicit range and they are summed here — legitimate ONLY
// because every Google canonical metric is additive and Google reports no reach
// or frequency, the two metrics that genuinely cannot be rebuilt from daily
// observations. Nothing here licenses daily→cumulative anywhere else.
//
// The accepted contract (Phase D.3 §1, Option A) is that a COMPLETED query over
// an EXPLICIT range is the period evidence, with `segments.date` as
// corroboration that the range was honoured. So the two failure modes worth
// testing are: a response that quietly steps outside the range, and a partial
// read dressed as a result. Both must yield NO canonical row — never a shorter
// window, never a fabricated zero.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  buildCanonicalGaqlQuery, mapGoogleAdsDailyResponse, aggregateDailyToCanonical,
  buildGaqlReportQuery,
} from './google/googleAdsClient.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { GoogleAdsConnector } from './GoogleAdsConnector.js';
import {
  canonicalWindowBounds, canonicalEligibility, inclusiveDays,
  CANONICAL_VERDICT_WINDOW_DAYS,
} from '../verdict-engine/metricWindow.js';
import { MEASUREMENT_WINDOW } from './connectorTypes.js';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const { start, end } = canonicalWindowBounds(NOW);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// A Google API row as searchStream returns it: camelCase, string numerics, and
// a `segments.date` naming the single calendar day it covers.
const apiRow = (id, date, m = {}) => ({
  campaign: { id, name: `Camp ${id}` },
  segments: { date },
  metrics: {
    costMicros: String((m.cost ?? 1) * 1e6),
    impressions: String(m.impressions ?? 100),
    clicks: String(m.clicks ?? 10),
    conversions: m.conversions ?? 1,
    conversionsValue: String(m.revenue ?? 5),
  },
});

// N consecutive days from the window start.
const daysFrom = (n, id = 'g1', m) =>
  Array.from({ length: n }, (_, i) => apiRow(id, ymd(new Date(start.getTime() + i * 86_400_000)), m));

const aggregate = (apiRows) => aggregateDailyToCanonical(mapGoogleAdsDailyResponse(apiRows), { start, end });

// ── The query ───────────────────────────────────────────────────────────────
describe('the canonical GAQL query asks for daily rows over an explicit range', () => {
  it('selects segments.date — the field that makes each row one calendar day', () => {
    expect(buildCanonicalGaqlQuery(NOW)).toContain('segments.date,');
  });

  it('bounds the range explicitly, spanning exactly the canonical window', () => {
    const q = buildCanonicalGaqlQuery(NOW);
    expect(q).toContain(`segments.date BETWEEN '${ymd(start)}' AND '${ymd(end)}'`);
    expect(inclusiveDays(start, end)).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
  });

  it('asks for additive metrics only — never a ratio the platform pre-computed', () => {
    const q = buildCanonicalGaqlQuery(NOW);
    for (const additive of ['cost_micros', 'impressions', 'clicks', 'conversions', 'conversions_value']) {
      expect(q).toContain(additive);
    }
    expect(q).not.toContain('ctr');
    expect(q).not.toContain('average_frequency');
  });

  it('leaves the OPERATIONAL query untouched — it still has no date segment', () => {
    expect(buildGaqlReportQuery({ since: start, until: end })).not.toContain('segments.date,');
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────
describe('daily rows fold into one 30-day observation', () => {
  it('sums every additive metric across the days', () => {
    const [row] = aggregate(daysFrom(30, 'g1', { cost: 2, impressions: 100, clicks: 10, conversions: 1, revenue: 5 }));
    expect(row.metrics).toEqual({
      cost_micros: 30 * 2e6, impressions: 3000, clicks: 300, conversions: 30, conversions_value: 150,
    });
  });

  it('keeps campaigns separate — one observation each, never merged', () => {
    const rows = aggregate([...daysFrom(3, 'g1'), ...daysFrom(3, 'g2')]);
    expect(rows.map((r) => r.campaign.id).sort()).toEqual(['g1', 'g2']);
    expect(rows.every((r) => r.metrics.impressions === 300)).toBe(true);
  });

  // The weekend-dark account: delivery period and MEASUREMENT period are
  // different facts. A campaign that ran on 6 of 30 days was still measured
  // across 30, and gating on observed days would drop every account that pauses.
  it('accepts a campaign that delivered on only some days', () => {
    const [row] = aggregate(daysFrom(6));
    expect(row.observedDays).toBe(6);
    expect(row.metrics.impressions).toBe(600);
  });

  it('reports observed days without letting them become a coverage gate', () => {
    expect(aggregate(daysFrom(1))[0].observedDays).toBe(1);
    expect(aggregate(daysFrom(30))[0].observedDays).toBe(30);
  });

  it('produces no rows at all from an empty response — never a zero row', () => {
    expect(aggregate([])).toEqual([]);
  });

  it('never emits a pre-aggregation ratio', () => {
    const [row] = aggregate(daysFrom(30));
    expect(row.metrics).not.toHaveProperty('ctr');
    expect(row.metrics).not.toHaveProperty('roas');
  });
});

// ── Corroboration ───────────────────────────────────────────────────────────
describe('segments.date corroborates that the range was honoured', () => {
  it('refuses a row dated outside the requested range', () => {
    const outside = ymd(new Date(start.getTime() - 86_400_000));
    expect(() => aggregate([...daysFrom(5), apiRow('g1', outside)]))
      .toThrow(/outside the requested/);
  });

  it('refuses a row dated after the window ends', () => {
    const future = ymd(new Date(end.getTime() + 86_400_000));
    expect(() => aggregate([apiRow('g1', future)])).toThrow(/outside the requested/);
  });

  // A row with no day cannot be checked against anything, and an uncorroborated
  // row is not evidence for a 30-day period.
  it('refuses a row with no segments.date', () => {
    expect(() => aggregateDailyToCanonical([{ campaign: { id: 'g1' }, metrics: {}, date: null }], { start, end }))
      .toThrow(/no segments.date/);
  });

  it('refusal is total — one bad row yields no canonical rows, not a partial set', () => {
    const bad = [...daysFrom(29), apiRow('g1', ymd(new Date(end.getTime() + 86_400_000)))];
    expect(() => aggregate(bad)).toThrow();
  });
});

// ── The normalized row ──────────────────────────────────────────────────────
describe('the canonical row states its period and survives eligibility', () => {
  const connector = new GoogleAdsConnector();
  const normalized = () => connector.normalizeCanonical({
    accountExternalId: 'cust_1', accountName: 'Acct', currency: 'USD', date: NOW,
    rows: aggregate(daysFrom(30, 'g1', { cost: 2, impressions: 100, clicks: 10, conversions: 1, revenue: 5 })),
    windowStart: start, windowEnd: end,
  });

  it('declares CUMULATIVE_30D with the requested bounds', () => {
    const campaign = normalized().find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    expect(campaign.windowStart).toEqual(start);
    expect(campaign.windowEnd).toEqual(end);
  });

  it('passes canonicalEligibility — the declaration and the dates agree', () => {
    for (const row of normalized()) {
      expect(canonicalEligibility(row, { now: NOW })).toEqual({ ok: true });
    }
  });

  it('carries the SUMMED totals, leaving CTR and ROAS to be derived downstream', () => {
    const campaign = normalized().find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.impressions).toBe(3000);
    expect(campaign.clicks).toBe(300);
    expect(campaign).not.toHaveProperty('ctr');
    expect(campaign).not.toHaveProperty('roas');
  });

  it('reports NO frequency — Google has none, and none is invented', () => {
    const campaign = normalized().find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.frequency).toBeNull();
    expect(campaign.reach ?? null).toBeNull();
  });

  it('rolls the account up from the campaigns, inheriting their window', () => {
    const account = normalized().find((r) => r.entityLevel === 'ACCOUNT');
    expect(account.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    expect(account.impressions).toBe(3000);
  });
});

// ── The operational path is untouched ───────────────────────────────────────
describe('the operational Google contract is unchanged', () => {
  const operational = () => googleNormalize({
    accountExternalId: 'cust_1', currency: 'USD', date: NOW,
    rows: [{ campaign: { id: 'g1', name: 'G' }, metrics: { cost_micros: 1e6, impressions: 100, clicks: 10, conversions: 1, conversions_value: 5 } }],
  });

  it('still declares ROLLING_WINDOW with null bounds by default', () => {
    for (const row of operational()) {
      expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
      expect(row.windowStart).toBeNull();
      expect(row.windowEnd).toBeNull();
    }
  });

  // The default must stay OUTSIDE the canonical class: an operational row that
  // drifted into CUMULATIVE_30D would become verdict evidence without ever
  // having been measured over the verdict window.
  it('an operational row is never canonical-eligible', () => {
    for (const row of operational()) {
      expect(canonicalEligibility(row, { now: NOW }).ok).toBe(false);
    }
  });

  it('the connector still exposes both paths', () => {
    const connector = new GoogleAdsConnector();
    expect(typeof connector.fetchRaw).toBe('function');
    expect(typeof connector.fetchCanonicalRaw).toBe('function');
    expect(typeof connector.normalizeCanonical).toBe('function');
  });
});
