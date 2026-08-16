// ============================================================
// PlaybookService — promote a learned pattern into a GuardrailRule
// ============================================================
// One-tap "make it a rule". Reuses the entire Phase-2 governance loop:
// the created GuardrailRule is auto-evaluated by GuardrailSweepService →
// PROPOSED Decision → confirm→execute → OutcomeSnapshot → memory. No new
// evaluation/execution code.
//
// HONESTY GUARD: only an ESTABLISHED, accurate, non-conflicted pattern
// with a valid spec can be promoted — Lumi never ships an unproven or
// contradictory rule.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { PATTERN_STATUS } from './patternTypes.js';

const MIN_ACCURACY = Number(process.env.PATTERN_PROMOTE_MIN_ACCURACY || 0.6);
const VALID_COMPARATORS = new Set(['GT', 'GTE', 'LT', 'LTE']);
const VALID_UNITS       = new Set(['MINOR', 'RATIO', 'PCT']);

/**
 * Pure: validate a pattern is promotable and shape it into GuardrailRule
 * create-data. Throws (does NOT silently skip) on any non-promotable
 * pattern. Exported for unit testing without a DB.
 *
 * @param {object} p — AccountPattern row (or engine pattern)
 * @param {string} workspaceId
 * @returns {object} prisma.guardrailRule create data
 */
export function patternToGuardrailData(p, workspaceId) {
  if (!workspaceId) throw new Error('patternToGuardrailData: workspaceId required');
  if (!p) throw new Error('patternToGuardrailData: pattern required');
  if (p.status === PATTERN_STATUS.SUPERSEDED || p.status === PATTERN_STATUS.CONFLICTED) {
    throw new Error(`Pattern is ${p.status} — a reconciled/contested pattern cannot become a rule.`);
  }
  if (p.status !== PATTERN_STATUS.ESTABLISHED) {
    throw new Error('Pattern is not ESTABLISHED yet — needs more proven history before it can become a rule.');
  }
  if (p.accuracy == null || p.accuracy < MIN_ACCURACY) {
    throw new Error(`Pattern accuracy ${p.accuracy ?? 'unknown'} is below the ${MIN_ACCURACY} floor to promote.`);
  }
  if (!p.emitVerdict || !p.metric || p.threshold == null ||
      !VALID_COMPARATORS.has(p.comparator) || !VALID_UNITS.has(p.unit)) {
    throw new Error('Pattern has no valid executable spec — it is informational only.');
  }
  if (p.promotedRuleId) throw new Error('Pattern has already been promoted to a rule.');

  return {
    workspaceId,
    name:          `Learned: ${String(p.statement).slice(0, 80)}`,
    enabled:       true,
    scopeLevel:    p.scopeLevel ?? 'ADSET',
    audienceTag:   p.audienceTag ?? null,
    metric:        p.metric,
    comparator:    p.comparator,
    threshold:     p.threshold,
    unit:          p.unit,
    sustainedDays: p.sustainedDays ?? 1,
    emitVerdict:   p.emitVerdict,
  };
}

/**
 * Promote a pattern → GuardrailRule, linking provenance. One transaction.
 * @returns {Promise<{ ruleId, rule }>}
 */
export async function promotePattern(workspaceId, patternId) {
  if (!workspaceId) throw new Error('promotePattern: workspaceId required');
  if (!patternId) throw new Error('promotePattern: patternId required');

  // R9 (I40) — the scope is IN the query, not checked after it. The post-hoc
  // comparison below was correct and is kept as a belt-and-braces assertion, but
  // it is the kind of guard that survives only while every future edit remembers
  // it; `findFirst` scoped to the workspace cannot forget.
  const pattern = await prisma.accountPattern.findFirst({ where: { id: patternId, workspaceId } });
  if (!pattern || pattern.workspaceId !== workspaceId) throw new Error('Pattern not found in this workspace.');

  const ruleData = patternToGuardrailData(pattern, workspaceId); // throws if not promotable

  const rule = await prisma.$transaction(async (tx) => {
    const created = await tx.guardrailRule.create({ data: ruleData });
    await tx.accountPattern.update({ where: { id: patternId }, data: { promotedRuleId: created.id } });
    return created;
  });

  logger.info({ workspaceId, patternId, ruleId: rule.id }, '[PlaybookService] pattern promoted to guardrail');
  return { ruleId: rule.id, rule };
}
