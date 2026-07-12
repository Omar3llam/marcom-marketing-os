// ============================================================
// FatigueForecastService — per-campaign, NAMED fatigue forecast
// ============================================================
// Surfaces the existing least-squares fatigue engine (fatigueForecaster) as a
// per-campaign view joined to connector campaign NAMES + channels — the piece
// the persisted FatiguePrediction feed couldn't carry (it keys entityId, which
// is name-less). Reuses forecastFatigue (frequency velocity → ceiling) and the
// sweep's buildEntitySeries; adds only the name-join + a display status.
//
// Read-only, computes on demand, persists nothing. Batched: ONE snapshot query
// for all campaigns (never per-campaign N+1). Honest by construction — a
// campaign with < 2 usable daily points is only shown if it's ALREADY saturated,
// never with a fabricated velocity.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { forecastFatigue } from '../fatigue-forecaster/fatigueForecaster.js';
import { buildEntitySeries } from '../fatigue-forecaster/FatigueSweepService.js';

const CEILING       = Number(process.env.FATIGUE_CEILING || 3.5);       // matches signalRules FREQUENCY_HIGH
const LOOKBACK_DAYS = Number(process.env.FATIGUE_LOOKBACK_DAYS || 30);
const MIN_VELOCITY  = 0.01;   // below this, frequency isn't meaningfully rising → no "+0.00/day"
const AT_RISK_DAYS  = 7;      // ≤ 1 week
const MONITOR_DAYS  = 21;     // ≤ 3 weeks

// Display sort: most urgent first.
const STATUS_ORDER = { SATURATED: 0, AT_RISK: 1, MONITOR: 2, HEALTHY: 3, STABLE: 4 };

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

function statusFor(currentValue, willBreach, daysToBreach) {
  if (currentValue >= CEILING) return 'SATURATED';
  if (!willBreach || daysToBreach == null) return 'STABLE'; // flat / declining frequency
  if (daysToBreach <= AT_RISK_DAYS) return 'AT_RISK';
  if (daysToBreach <= MONITOR_DAYS) return 'MONITOR';
  return 'HEALTHY';
}

/**
 * Per-campaign fatigue forecast.
 * @param {string} workspaceId
 * @param {Array<object>} campaigns — rows from getConnectorCampaigns
 *   (entityId, name, channel, frequency, …)
 * @returns {Promise<Array<{
 *   entityId, name, channel, currentFrequency, velocity,
 *   daysUntilSaturation, status, confidence
 * }>>}
 */
export async function computeFatigueForecast(workspaceId, campaigns = []) {
  if (!workspaceId || !Array.isArray(campaigns) || campaigns.length === 0) return [];

  // Only campaigns with a current frequency reading are forecastable.
  const withFreq = campaigns.filter((c) => c && c.entityId && c.frequency != null);
  if (withFreq.length === 0) return [];

  const entityIds = withFreq.map((c) => c.entityId);

  // ── ONE batched query for every campaign (no per-campaign N+1) ──
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const snapshots = await prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      entityId:    { in: entityIds },
      granularity: 'DAILY',
      date:        { gte: since },
      frequency:   { not: null },
      impressions: { gt: 0 },
    },
    select:  { entityId: true, entityLevel: true, date: true, frequency: true, ctr: true },
    orderBy: { date: 'asc' },
  });

  // Reuse the sweep's series builder (one point/day, last-of-day wins, ≥2 days).
  const seriesByEntity = new Map(buildEntitySeries(snapshots).map((e) => [e.entityId, e.series]));

  const rows = [];
  for (const c of withFreq) {
    const series = seriesByEntity.get(c.entityId);

    // < 2 usable daily points: can't fit a velocity. Only surface if the CURRENT
    // reading is already at/above the ceiling — a real breach we can see now.
    // Otherwise skip (never a fabricated projection from a single point).
    if (!series) {
      if (Number(c.frequency) >= CEILING) {
        rows.push({
          entityId: c.entityId, name: c.name, channel: c.channel,
          currentFrequency: round2(Number(c.frequency)), velocity: null,
          daysUntilSaturation: 0, status: 'SATURATED', confidence: null,
        });
      }
      continue;
    }

    let f;
    try {
      f = forecastFatigue({ series, ceiling: CEILING });
    } catch {
      continue; // unforecastable series — never fabricate a row
    }

    const status = statusFor(f.currentValue, f.willBreach, f.daysToBreach);
    rows.push({
      entityId: c.entityId,
      name: c.name,
      channel: c.channel,
      currentFrequency: round2(f.currentValue),
      velocity: f.slopePerDay > MIN_VELOCITY ? round3(f.slopePerDay) : null,
      daysUntilSaturation:
        status === 'SATURATED' ? 0
        : status === 'STABLE'  ? null
        : Math.max(1, Math.ceil(f.daysToBreach)),
      status,
      confidence: Number.isFinite(f.confidence) ? f.confidence : null,
    });
  }

  return rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5));
}
