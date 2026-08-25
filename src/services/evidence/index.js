// ============================================================
// evidence — the ONE entry point for reading measured rows
// ============================================================
// R1 of the System Design Refactor. This module introduces the Evidence seam and
// NOTHING ELSE: every symbol below is re-exported from the module that already
// owned it, unchanged. No query moved, no consumer migrated, no behaviour
// altered. The point of shipping an empty seam first is that the migration which
// follows (R3, one consumer per PR) can be read as "this consumer stopped
// querying MetricSnapshot directly" rather than as "this consumer changed".
//
// WHY A SEAM AT ALL
// -----------------
// Eleven modules currently issue their own `prisma.metricSnapshot.findMany`.
// They share one constant (OPERATIONAL_WINDOW_FILTER) and nothing else: not the
// lookback bound, not the level filter, not the latest-per-entity reduction, not
// the order the two are applied in. Filter-before-latest — the invariant Phase K
// and Phase D.4 both exist to enforce — is today a convention re-implemented per
// consumer, and a convention re-implemented eleven times is a convention that
// will eventually be implemented ten times.
//
// The target invariant is I14: only the Evidence layer queries MetricSnapshot.
// This file is where that becomes sayable.
//
// CANONICAL AND OPERATIONAL ARE POLICIES, NOT TIERS
// -------------------------------------------------
// They are not "high quality" and "low quality" rows. They are DIFFERENT
// MEASUREMENTS, and the whole D-track exists because treating one as a degraded
// form of the other silently changed what a verdict measured. This module
// deliberately keeps them in separate namespaces and offers no helper that
// blends, falls back, or promotes between them. There is no `getEvidence()` here
// that picks a policy for you; a caller must name the population it consumes.
// ============================================================

// ── Canonical policies, namespaced ─────────────────────────────────────────
//
// NAMESPACED RATHER THAN FLATTENED, FOR ONE LOAD-BEARING REASON:
// both canonical modules export a function called `latestCanonicalByEntity`, and
// the two are NOT interchangeable —
//
//   verdict  → keys on `entityId`                 (campaign level only, by query)
//   fatigue  → keys on `entityId:entityLevel`     (all levels, never merged)
//
// A flat `export *` from both would resolve the collision by silently dropping
// one of them, and the survivor would be picked by declaration order. The
// failure would not be a crash: fatigue rows reduced through the verdict variant
// would collapse a campaign and its ad-sets into a single entry whenever the two
// share an id, and the forecast would read one entity's frequency as another's.
// That is a wrong number on a screen, arriving silently, which is the exact
// class of defect this refactor exists to close.
export * as canonicalVerdict from '../verdict-engine/canonicalVerdictEvidence.js';
export * as canonicalFatigue from '../fatigue-forecaster/canonicalFatigueEvidence.js';

// ── Flat re-exports: the unambiguous symbols ───────────────────────────────
//
// Everything whose name identifies exactly one thing across both policies is
// also exported flat, so an R3 consumer can import what it needs without
// reaching through a namespace. `latestCanonicalByEntity` is deliberately ABSENT
// from this list and always will be — see above. A caller that wants it must say
// which one it means.
export {
  CANONICAL_VERDICT_WINDOW,
  CANONICAL_VERDICT_WINDOW_FILTER,
  CANONICAL_VERDICT_SELECT,
  PLATFORM_VERDICT_SOURCES,
  PLATFORM_SOURCE_FILTER,
  NO_CANONICAL_WINDOW,
  // The two ways canonical evidence can be absent, exported together on purpose:
  // NO_CANONICAL_WINDOW is "the database answered and this campaign was never
  // measured"; this error is "the database did not answer". A consumer that can
  // reach the reader through this seam can identify its failure through it too.
  CANONICAL_EVIDENCE_READ_FAILED,
  CanonicalEvidenceUnavailableError,
  selectCanonicalVerdictSnapshots,
  partitionByCanonicalEvidence,
} from '../verdict-engine/canonicalVerdictEvidence.js';

export {
  CANONICAL_FATIGUE_WINDOW,
  CANONICAL_FATIGUE_WINDOW_FILTER,
  CANONICAL_FATIGUE_SELECT,
  selectCanonicalFatigueSnapshots,
} from '../fatigue-forecaster/canonicalFatigueEvidence.js';

// ── Operational policy ─────────────────────────────────────────────────────
//
// Enumerated explicitly rather than `export *`: connectorTypes.js is the
// connector layer's own type module and carries detId, ENTITY_LEVEL, DATA_SOURCE,
// staleness helpers and more. Re-exporting all of it through the Evidence seam
// would make Evidence look like the owner of the connector vocabulary, which it
// is not — these three symbols are the operational READ policy and the rest is
// somebody else's contract.
//
// The window filter stays owned by connectorTypes for now. Moving it is R3's
// job, once there are consumers reading it from here; relocating a constant that
// still has nine direct importers would make this PR a behaviour-neutral rename
// spread across nine files, which is exactly the shape R1 is meant to avoid.
export {
  OPERATIONAL_MEASUREMENT_WINDOWS,
  OPERATIONAL_WINDOW_FILTER,
  isOperationalWindow,
} from '../connectors/connectorTypes.js';

// The first thing this layer OWNS rather than forwards (R3). The canonical
// policies above still live in their engines' own modules; the operational
// population had no home at all — nine consumers each re-expressed it inline —
// so it gets one here, and consumers migrate onto it one PR at a time.
export { selectOperationalSnapshots, OPERATIONAL_ORDER_BY } from './operationalEvidence.js';
