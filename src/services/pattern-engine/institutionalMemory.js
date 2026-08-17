// ============================================================
// institutionalMemory — validated learning, reaching the next decision
// ============================================================
// R10 · Phase D (I50, I51). This is the link the discovery found missing: every
// stage from `Decision → Outcome → Accuracy → Pattern` was built and honest, and
// then nothing read the result. Patterns accumulated, the briefing rendered
// them, and the next verdict was computed as though the account had no history
// at all. Learning was stored, not compounded.
//
// ── WHAT THIS IS ALLOWED TO DO, EXACTLY ─────────────────────────────────────
// It may adjust CONFIDENCE. It may not touch the verdict, the diagnosis, the
// root cause, or any evidence figure.
//
// That boundary is the product, not a caution. A verdict is what the CURRENT
// evidence says about this campaign right now; if a pattern could overturn it,
// Lumi would be answering "what usually happens" instead of "what is happening",
// and the first time an account's behaviour changed the memory would keep
// arguing for the old world. Confidence is the honest place for history: how
// sure we are that this kind of call, on this account, works out.
//
// Enforced structurally rather than by convention — applyMemoryToConfidence
// takes a NUMBER and returns a NUMBER. It never receives the verdict, so it
// cannot return a different one.
//
// ── WHAT MAY ENTER ──────────────────────────────────────────────────────────
// Only patterns with a MEASURED track record: ESTABLISHED status, a non-null
// accuracy at or above the floor, and real support behind it. An unmeasured
// pattern says "we have seen this three times and never checked what happened",
// which is not knowledge and must not move a number (I54, and the reason
// confidence is now nullable on AccountPattern).
//
// Every field on a memory record comes from a column. Nothing here computes a
// figure the database cannot show, nothing is rounded into a claim, and no LLM
// is involved at any point — patternEngine is deterministic and this reads its
// output.
//
// ── WHAT MAY NOT ENTER ──────────────────────────────────────────────────────
// Unmeasured patterns · PatternObservation rows without an outcome · stale
// CampaignReasoning (LLM prose) · memoryStore content (user-scoped conversational
// memory, not institutional) · anything from another workspace. The last is
// structural: every read here is `where: { workspaceId }`, and the only
// sanctioned cross-workspace path in the system remains the network engine's
// consent- and k-anonymity-gated aggregate, which does not pass through here.
//
// ── FAILURE ─────────────────────────────────────────────────────────────────
// A failed read is MEMORY_UNAVAILABLE. Never `[]`, which means "this account has
// learned nothing" — a statement about the account, made when the truth is a
// statement about us. The distinction survives to the payload, and the
// confidence factor for both is 1.0: unknown memory changes nothing, rather than
// penalising an account for our outage.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { PATTERN_STATUS, MIN_PATTERN_ACCURACY } from './patternTypes.js';

export const MEMORY_STATUS = Object.freeze({
  OK:                  'OK',                  // validated patterns exist and are stated
  NO_VALIDATED_MEMORY: 'NO_VALIDATED_MEMORY', // we looked; this account has none yet
  MEMORY_UNAVAILABLE:  'MEMORY_UNAVAILABLE',  // we could not look
});

// How far confidence may move on validated history, in either direction.
//
// Small on purpose. Memory is a prior, not a measurement: the campaign in front
// of us is the evidence, and a track record that could swing confidence by half
// would let history shout down the present. ±10% also keeps every adjusted
// number inside the band its base already occupied, so nothing crosses a
// display threshold on memory alone.
const MEMORY_WEIGHT = 0.10;

// Below this many recency-weighted observations a pattern is not a track record
// even if its accuracy reads well — three-for-three is a coincidence, and the
// pattern engine already declines to call it ESTABLISHED. Stated again here
// because this consumer must not be looser than the promotion gate.
const MIN_EFFECTIVE_SUPPORT = 3;

/** The columns a memory record is built from. Every one of them is displayed or
 *  reasoned over; nothing rides along unread. */
const MEMORY_SELECT = Object.freeze({
  id: true, patternKey: true, kind: true, statement: true, basis: true,
  metric: true, scopeLevel: true, emitVerdict: true, threshold: true, unit: true,
  accuracy: true, confidence: true, support: true, effectiveSupport: true,
  firstObservedAt: true, lastObservedAt: true, updatedAt: true,
});

/**
 * PURE: is this persisted pattern a legitimate piece of institutional memory?
 *
 * Stricter than "is it ESTABLISHED", and deliberately so — CONFLICTED and
 * SUPERSEDED rows are excluded by the status check, and an ESTABLISHED row with
 * no measured accuracy cannot exist after R10 but is re-checked anyway: this
 * predicate must hold on legacy rows written before I54, which CAN carry
 * ESTABLISHED with a null accuracy.
 */
export function isValidatedMemory(p) {
  if (!p) return false;
  return p.status === PATTERN_STATUS.ESTABLISHED
    && p.accuracy != null && p.accuracy >= MIN_PATTERN_ACCURACY
    && p.effectiveSupport != null && p.effectiveSupport >= MIN_EFFECTIVE_SUPPORT;
}

/**
 * PURE: the shape that travels. Explicit rather than a spread, because a spread
 * would carry whatever the select grows into next, and this object is read by
 * the verdict payload and eventually by an operator on screen.
 *
 * Note what it does NOT carry: no workspaceId (nothing downstream needs it and
 * publishing it invites a cross-tenant mistake), no promotedRuleId (a governance
 * fact, not a historical one), and no derived percentage — `accuracy` travels as
 * the ratio it is stored as, so the surface that renders it owns the rounding.
 */
export function toMemoryRecord(p) {
  return {
    patternId:  p.id,
    patternKey: p.patternKey,
    kind:       p.kind,
    statement:  p.statement,
    basis:      p.basis ?? null,
    metric:     p.metric ?? null,
    scopeLevel: p.scopeLevel ?? null,
    verdict:    p.emitVerdict ?? null,
    threshold:  p.threshold ?? null,
    unit:       p.unit ?? null,
    // The provenance an operator needs to disbelieve this if they want to: how
    // often it was right, over how many observations, most recently when.
    accuracy:         p.accuracy,
    support:          p.support,
    effectiveSupport: p.effectiveSupport,
    firstObservedAt:  p.firstObservedAt,
    lastObservedAt:   p.lastObservedAt,
  };
}

/**
 * Load one workspace's validated institutional memory.
 *
 * Read-only. Runs no extraction — that is the scheduled sweep's job (Phase C),
 * and doing it here would put a 365-day derivation on the verdict path.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @returns {Promise<{ status: string, records: Array }>}
 */
export async function getInstitutionalMemory(workspaceId) {
  if (!workspaceId) throw new Error('getInstitutionalMemory: workspaceId required');

  let rows;
  try {
    rows = await prisma.accountPattern.findMany({
      // Scoped in the WHERE (R9 · I40). Institutional memory is the one thing in
      // this system it would be most damaging to leak across tenants: it is
      // literally an account's accumulated competitive knowledge.
      where: {
        workspaceId,
        status:   PATTERN_STATUS.ESTABLISHED,
        accuracy: { not: null },
      },
      select: MEMORY_SELECT,
      orderBy: [{ accuracy: 'desc' }, { effectiveSupport: 'desc' }, { patternKey: 'asc' }],
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[institutionalMemory] read failed');
    // NOT an empty list. See the header: `[]` is a claim about the account.
    return { status: MEMORY_STATUS.MEMORY_UNAVAILABLE, records: [] };
  }

  const records = rows.filter(isValidatedMemory).map(toMemoryRecord);

  return {
    status: records.length > 0 ? MEMORY_STATUS.OK : MEMORY_STATUS.NO_VALIDATED_MEMORY,
    records,
  };
}

/**
 * PURE: the records that bear on THIS call.
 *
 * Relevance is the pattern's own executable spec matching the verdict and scope
 * being decided — the same (emitVerdict, scopeLevel) pair the guardrail promotion
 * path uses. Not a similarity score, not a heuristic: a pattern either states
 * something about this verdict at this level or it does not.
 *
 * `scopeLevel: null` on a pattern means it was never scoped (informational
 * kinds), and those do not match a specific decision.
 */
export function selectRelevantMemory(records = [], { verdict, entityLevel } = {}) {
  if (!verdict) return [];
  return records.filter((r) =>
    r.verdict === verdict && (r.scopeLevel == null || r.scopeLevel === entityLevel));
}

/**
 * PURE: the multiplier validated history places on a verdict's confidence.
 *
 * Centred on 1.0 and bounded by MEMORY_WEIGHT. The input is the support-weighted
 * mean accuracy of the relevant patterns, re-centred on the promotion floor:
 * a track record exactly at the floor is neutral, a perfect one lifts by the
 * full weight, and one below the floor (which cannot reach here, but the
 * arithmetic is stated for the whole domain) reduces.
 *
 * Returns EXACTLY 1 — not "about 1" — when there is nothing validated to say,
 * so an account with no memory and an account we could not read for both get
 * their deterministic confidence back unchanged, to the last decimal.
 *
 * @param {Array} relevant — from selectRelevantMemory
 * @returns {number} a multiplier in [1 - MEMORY_WEIGHT, 1 + MEMORY_WEIGHT]
 */
export function memoryConfidenceFactor(relevant = []) {
  if (!Array.isArray(relevant) || relevant.length === 0) return 1;

  let weight = 0;
  let weighted = 0;
  for (const r of relevant) {
    // Guard the whole domain: a record that somehow arrived without a measured
    // accuracy contributes nothing rather than a substituted prior. There is no
    // `?? 0.5` anywhere in this file, and there must never be.
    if (r.accuracy == null) continue;
    const w = r.effectiveSupport > 0 ? r.effectiveSupport : 1;
    weight += w;
    weighted += w * r.accuracy;
  }
  if (weight === 0) return 1;

  const meanAccuracy = weighted / weight;
  // Re-centre on the floor and normalise to [-1, 1] over the reachable range.
  const span = 1 - MIN_PATTERN_ACCURACY;
  const centred = span > 0 ? (meanAccuracy - MIN_PATTERN_ACCURACY) / span : 0;
  const clamped = centred < -1 ? -1 : centred > 1 ? 1 : centred;
  return 1 + clamped * MEMORY_WEIGHT;
}

/**
 * PURE: apply memory to a deterministic confidence.
 *
 * Takes a NUMBER and returns a NUMBER — it is handed no verdict and can produce
 * none. That is I51 enforced by the signature rather than by a comment, which
 * is what makes the "memory cannot change the verdict" control impossible to
 * regress by editing this function.
 *
 * @param {number|null} baseConfidence — the engine's own figure
 * @param {number} factor — from memoryConfidenceFactor
 * @returns {number|null} null in → null out; an unknown confidence stays unknown
 */
export function applyMemoryToConfidence(baseConfidence, factor = 1) {
  if (baseConfidence == null || !Number.isFinite(baseConfidence)) return baseConfidence ?? null;
  const f = Number.isFinite(factor) ? factor : 1;
  const raw = baseConfidence * f;
  // Same ceiling the confidence engine enforces: memory must not be a route to
  // a certainty the deterministic path refuses to express.
  const capped = Math.min(Math.max(raw, 0), 0.97);
  return Math.round(capped * 100) / 100;
}
