// ============================================================
// RecommendationEngine
// ============================================================
// Single public API: generateRecommendations(input)
//
// DETERMINISM CONTRACT:
//   Given the same input, always produces the same output.
//   No randomness.  No LLM calls.  No DB reads.
//
// ISOLATION CONTRACT:
//   Never writes to DB.  Never enqueues jobs.  Never calls routes.
//   Callers own persistence — pass the result to DecisionMemoryService
//   if the recommendation should be recorded.
// ============================================================
import { SIGNAL_TYPE }          from '../diagnosis-engine/index.js';
import { RECOMMENDATION_RULES } from './recommendationRules.js';
import { logger }                from '../../utils/logger.js';

const VALID_SIGNAL_TYPES = new Set(Object.values(SIGNAL_TYPE));

function validateInput(input) {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new Error('generateRecommendations: input must be a non-null object');
  }

  const { diagnosis, metrics } = input;

  if (diagnosis === null || diagnosis === undefined || typeof diagnosis !== 'object') {
    throw new Error('generateRecommendations: diagnosis must be a non-null object');
  }
  if (!diagnosis.type || typeof diagnosis.type !== 'string' || !diagnosis.type.trim()) {
    throw new Error('generateRecommendations: diagnosis.type is required');
  }
  if (!VALID_SIGNAL_TYPES.has(diagnosis.type)) {
    throw new Error(`generateRecommendations: unknown diagnosis type "${diagnosis.type}"`);
  }

  const conf = Number(diagnosis.confidence);
  if (diagnosis.confidence === undefined || diagnosis.confidence === null || !Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new Error('generateRecommendations: diagnosis.confidence must be a number between 0 and 1');
  }

  if (metrics === null || metrics === undefined || typeof metrics !== 'object') {
    throw new Error('generateRecommendations: metrics must be a non-null object');
  }

  const METRIC_FIELDS = ['ctr', 'cpc', 'cpm', 'frequency', 'spend', 'conversions'];
  for (const field of METRIC_FIELDS) {
    const val = metrics[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`generateRecommendations: metrics.${field} must be a finite number if provided`);
      }
      if (val < 0) {
        throw new Error(`generateRecommendations: metrics.${field} must be non-negative`);
      }
    }
  }
}

/**
 * Converts a diagnosis signal into an ordered list of actionable recommendations.
 *
 * @param {{ diagnosis: { type: string, confidence: number }, metrics: object }} input
 * @returns {{ diagnosis: string, confidence: number, recommendations: Array<{ type: string, priority: string, rationale: string }> }}
 */
export function generateRecommendations(input) {
  validateInput(input);

  const { type: diagnosisType, confidence } = input.diagnosis;
  const metrics = input.metrics;

  const rule = RECOMMENDATION_RULES.find(r => r.diagnosisType === diagnosisType);

  const recommendations = rule.build(metrics);

  logger.debug({
    diagnosisType,
    confidence,
    count: recommendations.length,
    types: recommendations.map(r => r.type),
  }, '[RecommendationEngine] recommendations generated');

  return {
    diagnosis:       diagnosisType,
    confidence,
    recommendations,
  };
}
