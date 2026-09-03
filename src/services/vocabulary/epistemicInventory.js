// ============================================================
// epistemicInventory — the declared jurisdiction of C-06
// ============================================================
// 🔒 C-06. This file is the ANSWER to the question "which status vocabularies
// is Lumi's epistemic layer responsible for?", and it answers it by name, for
// every vocabulary that exists — not by a heuristic that guesses.
//
// ── WHY AN INVENTORY AND NOT A SCANNER'S JUDGEMENT ──────────────────────────
// A ratchet that tried to semantically classify every `Object.freeze` in the
// repository would be claiming an ability it does not have, and would hand back
// false confidence in both directions: enums dragged in that are not epistemic,
// and epistemic ones missed because they are shaped unusually.
//
// So the jurisdiction is a SHAPE, which is measurable, and membership is a
// RULING, which is written down:
//
//   jurisdiction  every `export const NAME_(STATUS|STATE|REASON|RUN) =
//                 Object.freeze(...)` under src/ and packages/
//   membership    each one is DECLARED here, or EXCLUDED here WITH A REASON
//
// `epistemicInventory.test.js` fails when a vocabulary in the jurisdiction
// appears in neither list. A new vocabulary therefore cannot be silently in and
// cannot be silently out: someone must rule on it, in writing, in this file.
//
// ── THE MEMBERSHIP RULE ─────────────────────────────────────────────────────
// A vocabulary is epistemic when BOTH hold:
//   1. at least one value reports OUR POSITION rather than the subject — that
//      we could not look, hold no record, have too little, or may not ask; and
//   2. every remaining value can be classified without inventing a distinction
//      the value does not carry.
//
// Failing (1) makes it a description of the answer (CONNECTION_STATE,
// BOUNDS_STATUS). Failing (2) makes it un-declarable honestly (STAGE_STATE).
// There is no partial membership: a vocabulary is wholly in or wholly out.
// ============================================================
import { HISTORY_KNOWLEDGE } from '../decision-memory/decisionHistory.js';
import { MEMORY_KNOWLEDGE } from '../pattern-engine/institutionalMemory.js';
import { ATTRIBUTION_KNOWLEDGE, ATTRIBUTION_EVIDENCE_KNOWLEDGE } from '../attribution-engine/attributionTypes.js';
import { EVIDENCE_KNOWLEDGE } from '../decision-accuracy/outcomeEvidenceComparison.js';
import { OBSERVATION_KNOWLEDGE } from '../daily-observations/dailyObservationReader.js';
import { NETWORK_KNOWLEDGE } from '../network-engine/networkTypes.js';
import { LIFT_KNOWLEDGE } from '../decision-accuracy/accuracyTypes.js';
import { LEARNING_KNOWLEDGE } from '../analysis/decisionLearning.js';
import {
  AVAILABILITY_KNOWLEDGE,
  COMPLETENESS_KNOWLEDGE,
  READINESS_KNOWLEDGE,
  CAPABILITY_RUN_KNOWLEDGE,
} from '../connectors/connectorReadiness.js';
import { DAILY_KNOWLEDGE } from '../connectors/connectorConfig.js';
import { EXECUTION_STATE_KNOWLEDGE } from '../execution/executionProjection.js';

/**
 * The suffixes that define the ratchet's jurisdiction. A shape, not a guess.
 *
 * ── AND THE SUFFIX IS NOT THE DEFINITION ────────────────────────────────────
 * Matching `_STATUS` proves nothing about meaning. All the regex guarantees is
 * that SOMEONE RULED — the ruling below is what says a vocabulary is epistemic.
 * `_RUN` is here because CAPABILITY_RUN is one (see its entry); it is not here
 * because "_RUN sounds like a status".
 */
export const JURISDICTION_SUFFIXES = Object.freeze(['_STATUS', '_STATE', '_REASON', '_RUN']);

/**
 * The epistemic vocabularies, each with the declaration that classifies it.
 *
 * `at` and `symbol` together are how the ratchet matches a vocabulary it found
 * in the source to a ruling here — the pair is unique even where the SYMBOL is
 * not, which is the case for EVIDENCE_STATUS.
 *
 * ── TWO OF THESE FIFTEEN ARE NEWLY ADJUDICATED (C-06) ───────────────────────
 * They were NOT inherited from the vocabularies C-06's discovery listed. They
 * are marked `adjudicated: true` and the reason is written on each, because a
 * ratchet that lists everything uniformly would hide the fact that a judgement
 * was exercised here — and the next person to disagree needs to know there is
 * something to disagree WITH:
 *
 *   EXECUTION_STATE  a LIFECYCLE vocabulary admitted for two of its values.
 *                    "no execution" and "we do not know how the execution
 *                    ended" are different facts, and only this vocabulary can
 *                    say which. Leaving it out would have described one of
 *                    Lumi's most consequential states less precisely than the
 *                    code already does.
 *   CAPABILITY_RUN   an expansion of the JURISDICTION itself: `_RUN` was added
 *                    to the suffix list so the widest epistemic vocabulary in
 *                    the system (7 values, 4 tokens, and it crosses the wire)
 *                    could not sit outside the ratchet on a naming accident.
 *                    The declaration is what makes it epistemic; the suffix
 *                    only makes it VISIBLE.
 */
export const DECLARED = Object.freeze([
  { at: 'src/services/decision-memory/decisionHistory.js',            symbol: 'HISTORY_STATUS',      declaration: HISTORY_KNOWLEDGE },
  { at: 'src/services/pattern-engine/institutionalMemory.js',         symbol: 'MEMORY_STATUS',       declaration: MEMORY_KNOWLEDGE },
  { at: 'src/services/attribution-engine/attributionTypes.js',        symbol: 'ATTRIBUTION_STATUS',  declaration: ATTRIBUTION_KNOWLEDGE },
  { at: 'src/services/attribution-engine/attributionTypes.js',        symbol: 'EVIDENCE_STATUS',     declaration: ATTRIBUTION_EVIDENCE_KNOWLEDGE },
  { at: 'src/services/decision-accuracy/outcomeEvidenceComparison.js', symbol: 'EVIDENCE_STATUS',    declaration: EVIDENCE_KNOWLEDGE },
  { at: 'src/services/daily-observations/dailyObservationReader.js',  symbol: 'OBSERVATION_STATUS',  declaration: OBSERVATION_KNOWLEDGE },
  { at: 'src/services/network-engine/networkTypes.js',                symbol: 'NETWORK_STATUS',      declaration: NETWORK_KNOWLEDGE },
  { at: 'src/services/decision-accuracy/accuracyTypes.js',            symbol: 'LIFT_STATUS',         declaration: LIFT_KNOWLEDGE },
  { at: 'src/services/analysis/decisionLearning.js',                  symbol: 'LEARNING_STATUS',     declaration: LEARNING_KNOWLEDGE },
  { at: 'src/services/connectors/connectorReadiness.js',              symbol: 'AVAILABILITY_STATE',  declaration: AVAILABILITY_KNOWLEDGE },
  { at: 'src/services/connectors/connectorReadiness.js',              symbol: 'COMPLETENESS_STATE',  declaration: COMPLETENESS_KNOWLEDGE },
  { at: 'src/services/connectors/connectorReadiness.js',              symbol: 'READINESS_STATE',     declaration: READINESS_KNOWLEDGE },
  { at: 'src/services/connectors/connectorReadiness.js',              symbol: 'CAPABILITY_RUN',      declaration: CAPABILITY_RUN_KNOWLEDGE, adjudicated: true },
  { at: 'src/services/connectors/connectorConfig.js',                 symbol: 'DAILY_STATE',         declaration: DAILY_KNOWLEDGE },
  { at: 'src/services/execution/executionProjection.js',              symbol: 'EXECUTION_STATE',     declaration: EXECUTION_STATE_KNOWLEDGE, adjudicated: true },
]);

/**
 * Vocabularies inside the jurisdiction that are NOT epistemic, each with the
 * reason. Written out rather than filtered away, so a future reader can see
 * that the question was asked and answered — and can overturn a ruling by
 * editing one line here instead of by discovering the omission in production.
 */
export const EXCLUDED = Object.freeze([
  {
    at: 'src/services/connectors/connectorReadiness.js', symbol: 'CONNECTION_STATE',
    because: 'CONNECTED / DISCONNECTED are facts about a credential row. No value '
           + 'reports our position, so every one would map to KNOWN and the '
           + 'declaration would add nothing. The other four readiness axes ARE '
           + 'declared — this one is the axis with no absence to explain.',
  },
  {
    at: 'src/services/analysis/AccountAggregateService.js', symbol: 'BOUNDS_STATUS',
    because: 'RULED OUT (C-06, Omar). REPORTED / NON_UNIFORM / NOT_REPORTED describe '
           + 'the ANSWER — what the rows say about their own windows — not our '
           + 'knowledge of it. Forcing it into the taxonomy would create a second, '
           + 'partial kind of membership, which is the leakage C-06 exists to stop. '
           + 'Separating "the answer" from "what we know about the answer" is a '
           + 'later contract, not this one.',
  },
  {
    at: 'src/services/analysis/AccountAggregateService.js', symbol: 'CURRENCY_STATUS',
    because: 'RULED OUT (C-06, Omar), for the same reason as BOUNDS_STATUS: SINGLE '
           + 'and MIXED are descriptions of the contributing rows.',
  },
  {
    at: 'src/services/agentic-loop/agenticTypes.js', symbol: 'STAGE_STATE',
    because: 'FAILS the second half of the membership rule. STALE is documented as '
           + '"no row, OR past the stale threshold" — NOTHING_THERE and KNOWN at '
           + 'once. Mapping it to either token would invent a distinction the value '
           + 'does not carry. Splitting it is a change to that vocabulary, which is '
           + 'not C-06\'s to make.',
  },
  {
    at: 'src/routes/lumi/entities.js', symbol: 'EVIDENCE_REASON',
    because: 'A REASON vocabulary: it refines a status that is already classified. '
           + 'Declaring both would let one claim carry two knowledge tokens, which '
           + 'is precisely the ambiguity C-06 removes.',
  },
  {
    at: 'src/services/attribution-engine/attributionTypes.js', symbol: 'EVIDENCE_REASON',
    because: 'A reason vocabulary — see the entities.js entry. It names WHICH read '
           + 'failed under attribution/EVIDENCE_STATUS.UNAVAILABLE, which is already '
           + 'declared COULD_NOT_LOOK.',
  },
  {
    at: 'src/services/decision-accuracy/outcomeEvidenceComparison.js', symbol: 'UNSUPPORTED_REASON',
    because: 'A reason vocabulary — it refines outcome-evidence/EVIDENCE_STATUS.'
           + 'UNSUPPORTED, already declared CANNOT_ASK.',
  },
  {
    at: 'src/services/verdict-engine/metricWindow.js', symbol: 'NON_AGGREGABLE_REASON',
    because: 'A reason vocabulary, and its values are English sentences explaining '
           + 'why a metric cannot be summed — prose, not states.',
  },
  {
    at: 'src/services/pattern-engine/patternTypes.js', symbol: 'PATTERN_STATUS',
    because: 'A lifecycle vocabulary. EMERGING / ESTABLISHED / SUPERSEDED / '
           + 'CONFLICTED are what Lumi believes about a pattern — the claim itself, '
           + 'in every value.',
  },
  {
    at: 'src/services/goal-tracker/goalTrackerTypes.js', symbol: 'GOAL_STATUS',
    because: 'A finding vocabulary: ON_TRACK / AT_RISK / OFF_TRACK are the answer.',
  },
  {
    at: 'src/services/incrementality-engine/incrementalityTypes.js', symbol: 'INCREMENTALITY_STATUS',
    because: 'A lifecycle vocabulary for a test: DESIGNED → RUNNING → CONCLUDED.',
  },
  {
    at: 'src/services/pacing-engine/pacingEngine.js', symbol: 'PACE_STATUS',
    because: 'A finding vocabulary: ON_TRACK / OVER / UNDER is the pacing answer.',
  },
  {
    at: 'src/services/approval-decision/index.js', symbol: 'APPROVAL_STATUS',
    because: 'A lifecycle vocabulary: PENDING / COMPLETED.',
  },
  {
    at: 'src/services/collaboration/ApprovalService.js', symbol: 'APPROVAL_STATE',
    because: 'A lifecycle vocabulary: PENDING / APPROVED / REJECTED.',
  },
  {
    at: 'src/services/pattern-engine/PromotionService.js', symbol: 'PROMOTION_STATE',
    because: 'A lifecycle vocabulary (C-05): the state of an authorization request.',
  },
  {
    at: 'src/services/execution-runtime/runtimeEvents.js', symbol: 'EXECUTION_STATUS',
    because: 'A lifecycle vocabulary for a runtime event. Distinct from '
           + 'executionProjection\'s EXECUTION_STATE, which IS declared because it '
           + 'carries NONE and TIMED_OUT.',
  },
  {
    at: 'src/services/execution-runtime/runtimeEvents.js', symbol: 'NODE_STATUS',
    because: 'A lifecycle vocabulary for a graph node: PENDING / RUNNING / SUCCESS / '
           + 'FAILURE / SKIPPED.',
  },
]);

/** `at::symbol` for one entry — the identity the ratchet matches on. */
export const keyOf = (entry) => `${entry.at}::${entry.symbol}`;

/** Every vocabulary this file has ruled on, declared or excluded. */
export const RULED = Object.freeze(
  new Set([...DECLARED, ...EXCLUDED].map(keyOf)),
);
