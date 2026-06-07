// ============================================================
// TestGeneratorEngine — weekly testing agenda
// ============================================================
// Public API:
//   generateAgenda({ entities, memory, constraints })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps. (Mirrors VerdictEngine / DiagnosisEngine.)
//
// ISOLATION CONTRACT:
//   Never writes to DB / enqueues / calls routes. Callers own
//   persistence (see TestGeneratorService → TestExperiment rows).
//
// The core idea: from each entity's current signals, propose the
// dimension(s) worth testing this week, rank them by how much is at
// stake, and bend the ranking with MEMORY of past test outcomes —
// so a dimension that already failed on this entity is demoted and an
// unexplored dimension is nudged up. That memory term is the loop
// closing back into the next agenda.
// ============================================================
import { fromMinor }                          from '../../lib/money.js';
import { TEST_DIMENSION, DIMENSION_METRIC }   from './testGeneratorTypes.js';
import { logger }                             from '../../utils/logger.js';

// Trigger thresholds (frozen for auditability).
const T = Object.freeze({
  LOW_CTR:     1.0,  // % — below this the hook is weak
  HEALTHY_CTR: 1.5,  // % — at/above this the hook is pulling traffic
  WEAK_ROAS:   2.0,  // traffic that isn't converting to return
  HIGH_FREQ:   3.0,  // saturation — same people seeing it too often
});

// Memory multipliers (frozen). A past test outcome on the SAME entity +
// dimension bends that suggestion's priority.
const MEM = Object.freeze({
  UNSUSTAINABLE: 0.5,  // a prior test there fizzled — demote re-testing it
  SUSTAINED:     0.8,  // a prior test there held — less novelty left to win
  UNEXPLORED:    1.1,  // never tested this dimension here — nudge it up
});

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round4   = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Per-dimension severity in [0,1] from an entity's signals. Returns 0
 * when the dimension is not triggered (so it won't be suggested).
 */
function dimensionSeverity(dimension, m) {
  const ctr  = m.ctr ?? 0;
  const roas = m.roas ?? 0;
  const freq = m.frequency ?? 0;

  switch (dimension) {
    case TEST_DIMENSION.HOOK: {
      // Weak or fading hook: low CTR, or saturation dragging the hook.
      const ctrGap   = ctr < T.HEALTHY_CTR ? (T.HEALTHY_CTR - ctr) / T.HEALTHY_CTR : 0;
      const fatigue  = freq >= T.HIGH_FREQ ? clamp01((freq - T.HIGH_FREQ) / T.HIGH_FREQ) : 0;
      return clamp01(Math.max(ctrGap, fatigue * 0.6));
    }
    case TEST_DIMENSION.OFFER: {
      // Traffic is landing (healthy CTR) but not converting to return.
      if (ctr < T.HEALTHY_CTR) return 0;
      return roas < T.WEAK_ROAS ? clamp01((T.WEAK_ROAS - roas) / T.WEAK_ROAS) : 0;
    }
    case TEST_DIMENSION.AUDIENCE: {
      // Saturation / inefficient scaling → time to test the audience.
      const sat   = freq >= T.HIGH_FREQ ? clamp01((freq - T.HIGH_FREQ) / T.HIGH_FREQ + 0.3) : 0;
      const verd  = m.verdict === 'REALLOCATE' ? 0.5 : 0;
      return clamp01(Math.max(sat, verd));
    }
    case TEST_DIMENSION.CREATIVE_ANGLE: {
      // CTR plateau (between weak and healthy) or mild fatigue → try a
      // different angle before the creative dies outright.
      const plateau = ctr >= T.LOW_CTR && ctr < T.HEALTHY_CTR ? 0.45 : 0;
      const fatigue = freq >= T.HIGH_FREQ ? 0.4 : 0;
      return clamp01(Math.max(plateau, fatigue));
    }
    default:
      return 0;
  }
}

// The hypothesis + expected-signal + variants copy for each dimension.
function dimensionPlan(dimension, name) {
  switch (dimension) {
    case TEST_DIMENSION.HOOK:
      return {
        hypothesis:     `A sharper first-frame hook will lift CTR on "${name}".`,
        expectedSignal: 'CTR rises within 3–4 days at similar or lower CPM.',
        variants: [
          { label: 'A', description: 'Current hook (control)',                 isControl: true  },
          { label: 'B', description: 'Sharper first-frame hook / opening line', isControl: false },
        ],
      };
    case TEST_DIMENSION.OFFER:
      return {
        hypothesis:     `A stronger offer angle will convert "${name}"'s existing traffic into return.`,
        expectedSignal: 'ROAS / conversion rate improves while CTR holds.',
        variants: [
          { label: 'A', description: 'Current offer (control)',          isControl: true  },
          { label: 'B', description: 'Bundle / urgency / discount angle', isControl: false },
        ],
      };
    case TEST_DIMENSION.AUDIENCE:
      return {
        hypothesis:     `A fresher audience will lower CPA on "${name}" by breaking saturation.`,
        expectedSignal: 'CPA falls and frequency resets on the new audience.',
        variants: [
          { label: 'A', description: 'Current audience (control)', isControl: true  },
          { label: 'B', description: 'Broad / advantage+',         isControl: false },
          { label: 'C', description: '1–3% lookalike',             isControl: false },
        ],
      };
    case TEST_DIMENSION.CREATIVE_ANGLE:
      return {
        hypothesis:     `A different creative angle will re-engage "${name}"'s audience.`,
        expectedSignal: 'CTR recovers as a new angle resets attention.',
        variants: [
          { label: 'A', description: 'Current angle (control)',       isControl: true  },
          { label: 'B', description: 'UGC, problem-led re-framing',    isControl: false },
        ],
      };
    default:
      return { hypothesis: '', expectedSignal: '', variants: [] };
  }
}

/**
 * Memory multiplier for an (entityId, dimension) pair given prior
 * concluded-test outcomes. No memory at all on the dimension → an
 * exploration nudge; a sustained win → mild demote; a fizzle → demote.
 */
function memoryMultiplier(entityId, dimension, memory) {
  const relevant = memory.filter((e) => e.entityId === entityId && e.dimension === dimension);
  if (relevant.length === 0) return MEM.UNEXPLORED;
  // Most-recent-wins: if any relevant outcome was explicitly unsustainable, demote hardest.
  if (relevant.some((e) => e.isSustainable === false)) return MEM.UNSUSTAINABLE;
  if (relevant.some((e) => e.isSustainable === true))  return MEM.SUSTAINED;
  return 1.0;
}

/**
 * Generate a ranked weekly testing agenda.
 *
 * @param {object}  args
 * @param {Array}   args.entities  — [{ entityId, name, level, currency, metrics:{ctr,roas,frequency,cpa,conversions,spendMinor,verdict?}, verdict? }]
 * @param {Array}   [args.memory]  — [{ entityId, dimension, outcome, isSustainable }]
 * @param {object}  [args.constraints] — { maxSuggestions?, minPriority? }
 * @returns {Array} ranked suggestions
 */
export function generateAgenda({ entities, memory = [], constraints = {} } = {}) {
  if (!Array.isArray(entities)) throw new Error('generateAgenda: entities must be an array');

  const { maxSuggestions = 12, minPriority = 0 } = constraints;
  const suggestions = [];

  for (const entity of entities) {
    if (!entity || !entity.entityId) continue;
    const m = { ...(entity.metrics ?? {}), verdict: entity.verdict ?? entity.metrics?.verdict };
    const currency = entity.currency ?? 'USD';
    const name = entity.name ?? entity.entityId;
    // Spend-at-stake weight: more spend on a struggling entity = more to win.
    // log-scaled so one whale doesn't drown everything, monotonic in spend.
    const spendMajor  = fromMinor(m.spendMinor ?? 0, currency);
    const spendWeight = 1 + Math.log10(1 + Math.max(0, spendMajor));

    for (const dimension of Object.values(TEST_DIMENSION)) {
      const severity = dimensionSeverity(dimension, m);
      if (severity <= 0) continue;

      const memMult  = memoryMultiplier(entity.entityId, dimension, memory);
      const priority = round4(severity * spendWeight * memMult);
      if (priority < minPriority) continue;

      const plan = dimensionPlan(dimension, name);
      suggestions.push({
        entityId:       entity.entityId,
        entityLevel:    entity.level ?? null,
        name,
        currency,
        dimension,
        metric:         DIMENSION_METRIC[dimension],
        hypothesis:     plan.hypothesis,
        expectedSignal: plan.expectedSignal,
        variants:       plan.variants,
        priority,
        severity:       round4(severity),
        rationale:      `${dimension} flagged on "${name}" (severity ${round4(severity)}, ` +
                        `spend-weight ${round4(spendWeight)}, memory ×${memMult}).`,
      });
    }
  }

  // Rank by priority desc; deterministic tie-break on entityId then dimension.
  suggestions.sort((a, b) =>
    b.priority - a.priority ||
    a.entityId.localeCompare(b.entityId) ||
    a.dimension.localeCompare(b.dimension),
  );

  logger.debug({ count: suggestions.length }, '[TestGeneratorEngine] agenda generated');
  return suggestions.slice(0, maxSuggestions);
}
