// ============================================================
// GuardrailEngine — user-defined recurring rule evaluation
// ============================================================
// Public API: evaluateGuardrails({ rules, entities })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB.
//
// ISOLATION CONTRACT:
//   Never writes to DB / executes anything. Hits are returned to the
//   caller (GuardrailSweepService), which records them as radar
//   verdicts (Decisions, status PROPOSED). A guardrail NEVER
//   auto-executes — a human still confirms every action.
//
// A rule fires only when its condition holds for `sustainedDays`
// consecutive most-recent days, e.g. "flag any cold ad set above
// CPA target +50% for 2 days".
// ============================================================
import { logger } from '../../utils/logger.js';

export const COMPARATOR = Object.freeze({ GT: 'GT', GTE: 'GTE', LT: 'LT', LTE: 'LTE' });

const COMPARATOR_SYMBOL = { GT: '>', GTE: '≥', LT: '<', LTE: '≤' };

function compare(value, comparator, threshold) {
  switch (comparator) {
    case COMPARATOR.GT:  return value > threshold;
    case COMPARATOR.GTE: return value >= threshold;
    case COMPARATOR.LT:  return value < threshold;
    case COMPARATOR.LTE: return value <= threshold;
    default: throw new Error(`evaluateGuardrails: unknown comparator "${comparator}"`);
  }
}

function validate(rules, entities) {
  if (!Array.isArray(rules)) throw new Error('evaluateGuardrails: rules must be an array');
  if (!Array.isArray(entities)) throw new Error('evaluateGuardrails: entities must be an array');
  for (const r of rules) {
    if (!r || typeof r !== 'object') throw new Error('evaluateGuardrails: each rule must be an object');
    if (!r.metric) throw new Error('evaluateGuardrails: rule.metric is required');
    if (!COMPARATOR[r.comparator]) throw new Error(`evaluateGuardrails: rule.comparator invalid "${r.comparator}"`);
    if (typeof r.threshold !== 'number' || !Number.isFinite(r.threshold)) {
      throw new Error('evaluateGuardrails: rule.threshold must be a finite number');
    }
  }
}

/**
 * Evaluate guardrail rules against per-entity time-series.
 *
 * @param {object} args
 * @param {Array<object>} args.rules — GuardrailRule-shaped:
 *   { id, name, enabled, scopeLevel, audienceTag?, metric, comparator,
 *     threshold, unit?, sustainedDays, emitVerdict }
 * @param {Array<object>} args.entities — per-entity windows:
 *   { entityId, entityLevel, audienceTag?, series: [{ date, values: {metric:number} }] (time-ordered) }
 * @returns {Array<{ ruleId, ruleName, entityId, entityLevel, verdict, metric, sustainedDays, rationale }>}
 */
export function evaluateGuardrails({ rules, entities } = {}) {
  validate(rules ?? [], entities ?? []);
  const hits = [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const need = Math.max(1, rule.sustainedDays ?? 1);

    for (const entity of entities) {
      // Scope: level must match; audienceTag filters when the rule sets one.
      if (rule.scopeLevel && entity.entityLevel !== rule.scopeLevel) continue;
      if (rule.audienceTag && entity.audienceTag !== rule.audienceTag) continue;

      const series = Array.isArray(entity.series) ? entity.series : [];
      if (series.length < need) continue; // not enough history to sustain

      // The most-recent `need` points must ALL satisfy the condition.
      const window = series.slice(-need);
      const allHold = window.every((pt) => {
        const v = pt.values?.[rule.metric];
        return typeof v === 'number' && Number.isFinite(v) && compare(v, rule.comparator, rule.threshold);
      });
      if (!allHold) continue;

      const unitSuffix = rule.unit === 'PCT' ? '%' : '';
      hits.push({
        ruleId:      rule.id ?? null,
        ruleName:    rule.name ?? rule.metric,
        entityId:    entity.entityId,
        entityLevel: entity.entityLevel,
        verdict:     rule.emitVerdict ?? 'WATCH',
        metric:      rule.metric,
        sustainedDays: need,
        rationale:   `${rule.name ?? rule.metric}: ${rule.metric} ${COMPARATOR_SYMBOL[rule.comparator]} ${rule.threshold}${unitSuffix} for ${need} day(s)`,
      });
    }
  }

  logger.debug({ ruleCount: rules.length, entityCount: entities.length, hits: hits.length }, '[GuardrailEngine] evaluated');
  return hits;
}
