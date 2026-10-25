// ============================================================
// FatiguePredictionService — persistence wrapper for the forecaster
// ============================================================
// Owns DB I/O (the deterministic forecaster never touches it).
//   recordPrediction()  — write a forecast each sweep.
//   resolvePrediction()  — on actual breach / REFRESH, score accuracy
//                          and LOG TO MEMORY (DecisionMemoryEntry).
// ============================================================
import { prisma }          from '../../lib/prisma.js';
import { logger }          from '../../utils/logger.js';
import { forecastFatigue } from './fatigueForecaster.js';

/**
 * Forecast + persist a fatigue prediction for an entity.
 * @returns {Promise<object|null>} the created FatiguePrediction, or null if no breach
 */
export async function recordPrediction({ workspaceId, entityId, entityLevel, series, ceiling = 3.5, memory = [] }) {
  const forecast = forecastFatigue({ series, ceiling, memory });
  if (!forecast.willBreach || !forecast.projectedBreachDate) return null;

  return prisma.fatiguePrediction.create({
    data: {
      workspaceId,
      entityId,
      entityLevel,
      metric:              forecast.metric,
      ceiling:             forecast.ceiling,
      projectedBreachDate: new Date(forecast.projectedBreachDate),
      confidence:          forecast.confidence,
      basis:               forecast.basis,
    },
  });
}

/**
 * Resolve a prediction once the breach actually happens (or a REFRESH
 * pre-empts it), scoring accuracy and writing a DecisionMemoryEntry so
 * the next forecast learns from this outcome.
 *
 * @returns {Promise<object>} the updated FatiguePrediction
 */
export async function resolvePrediction({ predictionId, workspaceId, actualBreachDate }) {
  // R9 (I40) — workspace-scoped. This resolver does not merely read: it scores
  // the prediction and writes a DecisionMemoryEntry stamped with the row's OWN
  // workspaceId, so an unscoped lookup would have written a memory entry into
  // whichever workspace the prediction belonged to — learning attributed to an
  // account that never made the forecast.
  if (!workspaceId) throw new Error('resolvePrediction: workspaceId required');
  const result = await prisma.$transaction(async (tx) => {
    // Only the owned parent can be locked. READ COMMITTED then observes the
    // winner's committed resolution after a competing resolver releases it.
    const owned = await tx.$queryRaw`
      SELECT id FROM public.fatigue_predictions
      WHERE id = ${predictionId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
    if (!owned.length) throw new Error(`resolvePrediction: prediction ${predictionId} not found`);
    const p = await tx.fatiguePrediction.findFirst({ where: { id: predictionId, workspaceId } });
    if (!p) throw new Error(`resolvePrediction: prediction ${predictionId} not found`);
    if (p.resolvedAt) return { prediction: p, wroteMemory: false };

    // Accuracy: 1.0 when on the day, decaying ~0.1 per day of error (floored at 0).
    let accuracy = null;
    if (actualBreachDate) {
      const errDays = Math.abs(new Date(actualBreachDate) - p.projectedBreachDate) / 86_400_000;
      accuracy = Math.max(0, Math.round((1 - errDays * 0.1) * 100) / 100);
    }

    const updated = await tx.fatiguePrediction.update({
      where: { id: predictionId, workspaceId },
      data:  { resolvedAt: new Date(), actualBreachDate: actualBreachDate ? new Date(actualBreachDate) : null, accuracy },
    });

    // Resolution and Memory commit together; a failed insert rolls both back.
    await tx.decisionMemoryEntry.create({
      data: {
        workspaceId: p.workspaceId,
        entityId:    p.entityId,
        actionType:  'FATIGUE_FORECAST',
        rationale:   `Predicted ${p.metric} breach of ${p.ceiling} on ${p.projectedBreachDate.toISOString().slice(0, 10)}` +
                     (actualBreachDate ? `; actual ${new Date(actualBreachDate).toISOString().slice(0, 10)} (accuracy ${accuracy}).` : '; pre-empted by refresh.'),
        // Forecast accuracy does not measure outcome durability.
        isSustainable: null,
        impactDurationHrs: null,
      },
    });
    return { prediction: updated, wroteMemory: true };
  }, { isolationLevel: 'ReadCommitted' });

  if (result.wroteMemory) {
    logger.info({ predictionId, accuracy: result.prediction.accuracy }, '[FatiguePrediction] resolved + logged to memory');
  }
  return result.prediction;
}
