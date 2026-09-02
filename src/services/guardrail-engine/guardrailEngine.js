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

/**
 * What a rule concluded about one entity ON THIS PASS — and the set is
 * deliberately only two values, because the third outcome is the ABSENCE of an
 * entry rather than a value in it.
 *
 * C-02: a guardrail hit is a breach EPISODE, and an episode can only be ended by
 * a pass that actually looked. So the sweep needs to tell three cases apart:
 *
 *   BREACH            the rule applied and fired      → open, or leave open
 *   CLEAR             the rule applied and declined   → CLOSE the open episode
 *   (not in the list) the rule never applied          → LEAVE THE EPISODE ALONE
 *
 * Collapsing the third into CLEAR is the failure this exists to prevent:
 * disabling a rule would then silently close every breach it was holding open,
 * and an entity dropping out of the snapshot window would read as "the problem
 * went away". Both are claims about the account made from an absence of looking.
 *
 * The same distinction, in the same codebase: DiagnosisEngine separates rules
 * that FIRED from rules that DECLINED from a pass where nothing was evaluable at
 * all — see the UNDIAGNOSABLE note in decisionIdentity.js for why that third
 * state had to be kept.
 */
export const GUARDRAIL_OUTCOME = Object.freeze({ BREACH: 'BREACH', CLEAR: 'CLEAR' });

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
 * @returns {{
 *   hits: Array<{ ruleId, ruleName, entityId, entityLevel, verdict, metric, sustainedDays, rationale }>,
 *   evaluated: Array<{ ruleId, entityId, entityLevel, outcome }>
 * }}
 *   `evaluated` lists ONLY the (rule, entity) pairs this pass actually reached a
 *   conclusion about. A pair absent from it was never judged, and the caller must
 *   not treat that silence as an all-clear. `hits` is the BREACH subset, kept
 *   separately because it carries the rationale and verdict the caller persists.
 */
export function evaluateGuardrails({ rules, entities } = {}) {
  validate(rules ?? [], entities ?? []);
  const hits = [];
  const evaluated = [];

  for (const rule of rules) {
    // A disabled rule is NOT EVALUATED. It is emphatically not "clean": turning
    // a rule off must never be a way to close the breaches it was holding open.
    if (rule.enabled === false) continue;
    const need = Math.max(1, rule.sustainedDays ?? 1);

    for (const entity of entities) {
      // Scope: level must match; audienceTag filters when the rule sets one.
      // Out of scope means the rule does not apply to this entity at all — there
      // is no episode to open or close either way.
      if (rule.scopeLevel && entity.entityLevel !== rule.scopeLevel) continue;
      if (rule.audienceTag && entity.audienceTag !== rule.audienceTag) continue;

      const series = Array.isArray(entity.series) ? entity.series : [];
      // In scope, but we cannot tell. "Not enough history to sustain" is
      // INSUFFICIENT DATA, not an all-clear — the entity may have dropped out of
      // the sync window entirely while the breach continued. Closing on this
      // would end an episode because we stopped receiving evidence about it.
      if (series.length < need) continue;

      // The most-recent `need` points must ALL satisfy the condition.
      const window = series.slice(-need);
      const allHold = window.every((pt) => {
        const v = pt.values?.[rule.metric];
        return typeof v === 'number' && Number.isFinite(v) && compare(v, rule.comparator, rule.threshold);
      });

      // From here down the pair WAS judged, either way — this is the only place
      // an entry joins `evaluated`.
      evaluated.push({
        ruleId:      rule.id ?? null,
        entityId:    entity.entityId,
        entityLevel: entity.entityLevel,
        outcome:     allHold ? GUARDRAIL_OUTCOME.BREACH : GUARDRAIL_OUTCOME.CLEAR,
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

  logger.debug(
    { ruleCount: rules.length, entityCount: entities.length, hits: hits.length, evaluated: evaluated.length },
    '[GuardrailEngine] evaluated',
  );
  return { hits, evaluated };
}
