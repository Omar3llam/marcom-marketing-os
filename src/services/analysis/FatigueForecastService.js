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
//
// EVIDENCE (Phase K): every metric on these rows — frequency, reach and the
// exhaustion % derived from them — comes from canonical CUMULATIVE_30D snapshots
// via the shared fatigue selector, the same evidence FatigueSweepService and
// ScenarioService read. The `campaigns` argument supplies identity only. A
// campaign with no canonical observation is omitted rather than shown from the
// operational row that named it.
// ============================================================
import { ENTITY_LEVEL } from '../connectors/connectorTypes.js';
import { forecastFatigue } from '../fatigue-forecaster/fatigueForecaster.js';
import { buildEntitySeries } from '../fatigue-forecaster/FatigueSweepService.js';
import {
  selectCanonicalFatigueSnapshots, latestCanonicalByEntity,
} from '../fatigue-forecaster/canonicalFatigueEvidence.js';
import { TEMPORAL } from '../../config/temporal.js';
import { FATIGUE_FREQ as CEILING } from '../verdict-engine/benchmarkProvider.js';

// Bounds MetricSnapshot.date — the SYNC timestamp — on rows that are ALREADY
// canonical CUMULATIVE_30D observations. Two different periods, and only the
// second is the measurement: this bound decides how many 30-day observations to
// fit a trend through, never what any one of them covers. Value unchanged (30).
const SYNC_RECENCY_DAYS = TEMPORAL.fatigueSyncRecencyDays;
const MIN_VELOCITY  = 0.01;   // below this, frequency isn't meaningfully rising → no "+0.00/day"
const AT_RISK_DAYS  = 7;      // ≤ 1 week
const MONITOR_DAYS  = 21;     // ≤ 3 weeks

// Display sort: most urgent first.
const STATUS_ORDER = { SATURATED: 0, AT_RISK: 1, MONITOR: 2, HEALTHY: 3, STABLE: 4 };

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// How far current frequency has climbed toward the saturation ceiling, 0–100.
// This is an honest restatement of the (real, Meta-derived) frequency — NOT a
// pool-saturation ratio (that needs the ad set's targetable audience_size, which
// campaign insights don't carry). Gated on real reach so it's only shown where
// the frequency is a genuine reach-derived Meta delivery number (frequency =
// impressions ÷ reach): null for pre-column rows and channels without reach
// (Google), never a fabricated 0. Additive only — it does not alter status.
function exhaustionPctOf(frequency, reach) {
  if (reach == null || !(reach > 0) || !Number.isFinite(frequency)) return null;
  return Math.min(100, Math.round((frequency / CEILING) * 100));
}

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
 *   daysUntilSaturation, status, confidence, reach, exhaustionPct
 * }>>}
 *   reach = unique people reached (null when unreported); exhaustionPct = how far
 *   frequency has climbed toward the ceiling, 0–100 (null without real reach).
 */
export async function computeFatigueForecast(workspaceId, campaigns = []) {
  if (!workspaceId || !Array.isArray(campaigns) || campaigns.length === 0) return [];

  // `campaigns` is an IDENTITY source here, not an evidence source (Phase K).
  //
  // It arrives from getConnectorCampaigns → EntityGraphService.latestSnapshots,
  // which is the operational reader the whole verdict path shares — the same row
  // that supplies ROAS, CTR, spend and revenue. Reading `c.frequency`/`c.reach`
  // off it (as this service used to) is what made fatigue an operational
  // judgement; converting latestSnapshots instead would have moved four unrelated
  // verdict metrics to a different measurement period, so the split happens HERE.
  // Only entityId / name / channel are taken from it.
  const named = campaigns.filter((c) => c && c.entityId);
  if (named.length === 0) return [];

  const entityIds = named.map((c) => c.entityId);

  // ── ONE batched query for every campaign (no per-campaign N+1) ──
  // CAMPAIGN level explicitly: this surface names campaigns, and an ad-set's
  // canonical row must never stand in for its parent's.
  const since = new Date(Date.now() - SYNC_RECENCY_DAYS * 86_400_000);
  const snapshots = await selectCanonicalFatigueSnapshots(workspaceId, {
    entityIds, entityLevel: ENTITY_LEVEL.CAMPAIGN, since,
  });

  // Reuse the sweep's series builder (one point/day, last-of-day wins, ≥2 days).
  const seriesByEntity = new Map(buildEntitySeries(snapshots).map((e) => [e.entityId, e.series]));
  // The current 30-day reading. Frequency, reach and the exhaustion % derived
  // from them all come from THIS row, so one fatigue statement never mixes a
  // canonical frequency with an operational reach.
  const latestByEntity = latestCanonicalByEntity(snapshots);

  const rows = [];
  for (const c of named) {
    const latest = latestByEntity.get(`${c.entityId}:${ENTITY_LEVEL.CAMPAIGN}`);
    // No canonical observation → no fatigue evidence for this campaign. It is
    // omitted, not shown at zero and not back-filled from the operational row we
    // were handed: an unmeasured campaign and an unfatigued one are different
    // claims, and only one of them is true.
    if (!latest) continue;

    const currentFrequency = Number(latest.frequency);
    const reach = latest.reach ?? null;
    const series = seriesByEntity.get(c.entityId);

    // < 2 usable daily points: can't fit a velocity. Only surface if the CURRENT
    // reading is already at/above the ceiling — a real breach we can see now.
    // Otherwise skip (never a fabricated projection from a single point).
    if (!series) {
      if (currentFrequency >= CEILING) {
        rows.push({
          entityId: c.entityId, name: c.name, channel: c.channel,
          currentFrequency: round2(currentFrequency), velocity: null,
          daysUntilSaturation: 0, status: 'SATURATED', confidence: null,
          reach,
          exhaustionPct: exhaustionPctOf(currentFrequency, reach),
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
      reach,
      exhaustionPct: exhaustionPctOf(f.currentValue, reach),
    });
  }

  return rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5));
}
