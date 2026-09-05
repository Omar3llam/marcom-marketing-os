// ============================================================
// What a Decision records about the memory that shaped it (C-16 · R-6)
// ============================================================
// R-6, Article VI: a Decision records the memory that shaped it as a
// MEASUREMENT TAKEN AT THE MOMENT OF COMMITMENT, never as a reference to a
// pattern that can still change. Three facts freeze — what memory was
// available, whether it was applied, and the values it was applied from.
//
// ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
//
// `runSweep` computed ONE evaluation and handed it to both sides:
//
//   persistConnectorVerdicts → stored    verdictConfidence            (BASE)
//   getConnectorVerdicts     → published base × memoryFactor          (ADJUSTED)
//
// The same sweep published one confidence to the operator and stored a
// different one, and nothing recorded that they differed or why. That is not
// R-1's then/now split: the row's own comment claims to freeze "what the engine
// BELIEVED, frozen at the moment of the call", but what Lumi PUBLISHED was the
// adjusted number. The freeze captured the engine's belief, not Lumi's — and
// the stored figure is user-reachable through C-11's detail read and the
// campaign timeline.
//
// ── WHY VALUES, NEVER POINTERS ──────────────────────────────────────────────
//
// `AccountPattern` is upserted in place (`@@unique([workspaceId, patternKey])`)
// and `dynamicFields` rewrites NINE fields every sweep — including `statement`,
// the sentence itself. A stored `patternId` dereferenced six months later
// yields today's wording and today's accuracy: an audit trail that looks
// correct and lies. `ctrAtDecision` / `roasAtDecision` exist because
// `MetricSnapshot` is re-stamped per sync. Same argument, one object over.
//
// ── ONE ARITHMETIC, NOT TWO ─────────────────────────────────────────────────
//
// The factor and the adjustment come from the SAME three functions the read
// uses — `selectRelevantMemory` → `memoryConfidenceFactor` →
// `applyMemoryToConfidence`. Re-implementing them here is how the published and
// stored numbers would drift apart again, one refactor later, having just been
// brought together.
//
// PURE. No database, no clock, no randomness: it is handed the memory the sweep
// already read and returns the four fields a row records.
// ============================================================
import {
  MEMORY_STATUS, selectRelevantMemory, memoryConfidenceFactor, applyMemoryToConfidence,
} from '../pattern-engine/institutionalMemory.js';

/**
 * The memory facts a Decision row freezes at commitment.
 *
 * @param {{status: string, records: Array}|null|undefined} memory — as returned
 *   by `getInstitutionalMemory`. Absent means the caller never consulted it,
 *   which is a state in its own right and NOT an error.
 * @param {{verdict: string, entityLevel: string, baseConfidence: number|null}} node
 * @returns {{confidence: number|null, baseConfidence: number|null,
 *   memoryStatus: string, memoryProvenance: object|null}}
 */
export function memoryDecisionFacts(memory, { verdict, entityLevel, baseConfidence } = {}) {
  // `?? null` and NEVER `?? 0.5`. I54 removed one fabricated prior from the
  // pattern engine because a number nobody measured was being rendered as a
  // percentage; an invented confidence has no place on the row R-6 exists to
  // make auditable either.
  const base = baseConfidence ?? null;

  if (!memory) {
    // R-6: "A Decision naming no memory means memory was not consulted — never
    // that the account learned nothing." Those are a fact about US and a fact
    // about the ACCOUNT, and they must not share a spelling. `null` provenance
    // rather than an empty one: there is no measurement to report, not a
    // measurement that found nothing.
    return {
      confidence:       base,
      baseConfidence:   base,
      memoryStatus:     MEMORY_STATUS.NOT_CONSULTED,
      memoryProvenance: null,
    };
  }

  // ALL relevant records, never the read's `slice(0, 3)`. The factor is a
  // support-weighted mean over every one of them, so a record persisted from
  // that slice would be permanently unable to explain its own number.
  const relevant = selectRelevantMemory(memory.records ?? [], { verdict, entityLevel });
  const factor = memoryConfidenceFactor(relevant);

  return {
    confidence:     applyMemoryToConfidence(base, factor),
    baseConfidence: base,
    memoryStatus:   memory.status,
    memoryProvenance: {
      factor,
      // Derived from the factor rather than from the status: MEMORY_UNAVAILABLE
      // and NO_VALIDATED_MEMORY both yield exactly 1, and "we had memory and it
      // changed nothing" is a third case that must read the same way.
      applied: factor !== 1,
      patterns: relevant.map((r) => ({
        patternId:        r.patternId,
        statement:        r.statement,
        accuracy:         r.accuracy,
        effectiveSupport: r.effectiveSupport,
      })),
    },
  };
}
