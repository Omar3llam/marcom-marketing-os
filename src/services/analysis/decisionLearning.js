// ============================================================
// decisionLearning — what happened the last N times we said this
// ============================================================
// Backs the "9 of 12 similar decisions improved" line.
//
// ── What counts as similar ──────────────────────────────────────────────────
// verdict + rootCause + entityLevel + objective + channel. Verdict alone is too
// coarse: a KILL on a META conversion campaign and a KILL on a Google awareness
// campaign have different track records, and averaging them describes neither.
// Each key narrows only when the asking decision HAS it — a decision with no
// channel recorded compares against the wider set rather than against nothing.
//
// ── What it refuses to count ────────────────────────────────────────────────
// Only decisions that are BOTH resolved (we know what happened next) AND
// INTERVENED ON (somebody actually changed the campaign). A verdict that sat in
// a list and got replaced two weeks later says nothing about whether ACTING on
// this kind of verdict works; counting it would turn "acting on this helped"
// into "this campaign drifted".
//
// ── C1: what "acted on" is allowed to mean ──────────────────────────────────
// This gate used to read `intentAt`, and that was the defect. `intentAt` is
// stamped when an operator COPIES the recommendation text or CLICKS the link to
// the ad platform — engagement, carried toward a place where action could
// happen. Neither event observes an ad account, and the two are separated by
// however long the operator took to not act. So a marketer who copied a KILL,
// did nothing, and watched the campaign drift upward produced a row this
// function counted as "improved after action" — the exact sentence
// LearningInsight renders.
//
// The fix is the evidence, not the wording. Eligibility is now the canonical
// intervention union (`humanExecutedAt` OR `platformExecutedAt`): an operator's
// own report that they performed the change, or Lumi's record that it performed
// the change itself. Both are claims ABOUT AN AD ACCOUNT. `intentAt` keeps its
// own meaning and its own column and is untouched — it is the only adoption
// signal this system has, and nothing here reads it any more.
//
// The swap moves the population in BOTH directions, which is why it is not a
// simple tightening: a copied-but-never-executed verdict leaves, and a verdict
// self-reported from Home (a surface with no copy button, so no `intentAt` was
// ever stamped) enters for the first time.
//
// UNKNOWN rows are excluded from the denominator entirely. They are decisions
// whose outcome could not be scored, and "9 of 12" must mean twelve decisions
// that WERE scored — otherwise the sentence claims a measurement that was never
// taken. They are returned separately so a caller can say how many were dropped.
//
// The counts are CORRELATIONAL. `improved` is "improved after", never "improved
// because" — nothing here establishes that the action caused the change, and no
// copy built on it may claim otherwise.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { INTERVENED_WHERE } from '../execution/decisionProvenance.js';

// How far back to look. Recent behaviour is the relevant behaviour.
const DEFAULT_LIMIT = 20;

// Below this many SCORED outcomes the sample says nothing, and a "1 of 1
// improved" line would read as a track record when it is a coincidence. Under
// the floor the function returns null and the UI renders nothing at all —
// silence is the honest state, not "0% success".
export const MIN_SAMPLE = 3;

/**
 * The states this read can be in, kept apart on purpose (R10 · F15).
 *
 * Only UNAVAILABLE is carried as a value; the other two are `null`, because the
 * caller treats them identically AND SHOULD — a thin sample and no sample are
 * both "nothing defensible to show". An error is not.
 */
export const LEARNING_STATUS = Object.freeze({ UNAVAILABLE: 'UNAVAILABLE' });

/**
 * Outcome tally for comparable past decisions, or null when there is no
 * defensible track record to show.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.verdict
 * @param {string} [args.rootCause]   — narrows when present
 * @param {string} [args.entityLevel] — narrows when present
 * @param {string} [args.objective]   — narrows when present
 * @param {string} [args.channel]     — narrows when present
 * @param {number} [args.limit]
 * @returns {Promise<{total:number, improved:number, unchanged:number,
 *                    worsened:number, unscored:number, confidence:number}|null>}
 *   null when: no workspace/verdict, fewer than MIN_SAMPLE scored outcomes, or
 *   none of them improved. `total` counts SCORED outcomes only.
 */
export async function getSimilarOutcomes({
  workspaceId, verdict, rootCause, entityLevel, objective, channel, limit = DEFAULT_LIMIT,
} = {}) {
  if (!workspaceId || !verdict) return null;

  const rows = await prisma.decision.findMany({
    where: {
      workspaceId,
      verdict,
      // Each dimension narrows ONLY when the asking decision carries it.
      ...(rootCause   ? { rootCause }   : {}),
      ...(entityLevel ? { entityLevel } : {}),
      ...(objective   ? { objective }   : {}),
      ...(channel     ? { channel }     : {}),
      resolution: { not: null }, // we know what happened next
      // C1 — …and somebody actually intervened on the campaign. Spread from the
      // canonical seam rather than spelled out here: this is the same union the
      // provenance module defines once, and a local copy of it is a definition
      // that drifts. It contributes the `OR` key, which nothing else in this
      // where clause uses.
      ...INTERVENED_WHERE,
    },
    // R13 — the human judgement rides along with the outcome. The similarity
    // key above is UNCHANGED: comparability is still verdict + rootCause +
    // entityLevel + objective + channel, and judgement narrows nothing. It is
    // an extra dimension to REPORT, not a new filter.
    //
    // C1 — the provenance columns are deliberately NOT selected. Eligibility is
    // decided by the database in the `where` above, so pulling the timestamps
    // back would be bytes nobody reads, and a second in-memory check would be a
    // second place the rule could disagree with itself.
    select:  { resolution: true, humanResponse: true, humanReasonCode: true },

    orderBy: { createdAt: 'desc' },
    take:    limit,
  // R10 (F15) — a failed read is UNAVAILABLE, never an empty track record.
  //
  // This used to `return []`, which fell through the MIN_SAMPLE floor below and
  // produced the same `null` a genuinely thin history produces. Both render
  // nothing, so the UI looked identical either way — and that was the problem:
  // "this workspace has no comparable decisions yet" and "we could not read this
  // workspace's history" are different facts, and only one of them is about the
  // account. Collapsing them meant a broken query could never be noticed from
  // the outside, because its symptom was a legitimate empty state.
  //
  // The sentinel is a distinct return value rather than a throw: this is
  // decoration beside a verdict, and losing it must not cost the caller the
  // verdict. The distinction is preserved in the CONTRACT; what a renderer does
  // with it stays the renderer's choice.
  }).catch((err) => {
    logger.warn({ err: err.message, workspaceId, verdict }, '[decisionLearning] read failed');
    return null;
  });

  if (rows === null) return { status: LEARNING_STATUS.UNAVAILABLE };

  let improved = 0, unchanged = 0, worsened = 0, unscored = 0;
  for (const r of rows) {
    if (r.resolution === 'IMPROVED') improved += 1;
    else if (r.resolution === 'UNCHANGED') unchanged += 1;
    else if (r.resolution === 'WORSENED') worsened += 1;
    else unscored += 1; // UNKNOWN — outside the denominator, reported separately
  }

  const total = improved + unchanged + worsened;

  // ── R13 — the same scored outcomes, split by what the human decided ──────
  //
  // CORRELATIONAL, and it must stay that way. "An overridden KILL was followed
  // by an improved outcome" is a fact about sequence; "the human was right" is a
  // causal claim this data cannot support and nothing here computes. There is
  // deliberately no accuracy, no win rate and no better/worse comparison
  // between CONFIRM and OVERRIDE — only counts of what actually happened.
  //
  // Scored rows only, so the buckets sum to `total` and cannot be read as a
  // denominator that includes outcomes nobody measured. `none` is the honest
  // name for decisions carrying no judgement: they are not CONFIRM, and folding
  // them into one would invent agreement that was never expressed.
  const bucket = () => ({ total: 0, improved: 0, unchanged: 0, worsened: 0 });
  const tally = (into, key, resolution) => {
    into[key] ??= bucket();
    into[key].total += 1;
    if (resolution === 'IMPROVED') into[key].improved += 1;
    else if (resolution === 'UNCHANGED') into[key].unchanged += 1;
    else into[key].worsened += 1;
  };

  const byHumanResponse = {};
  const byHumanReason = {};
  for (const r of rows) {
    if (r.resolution !== 'IMPROVED' && r.resolution !== 'UNCHANGED' && r.resolution !== 'WORSENED') continue;
    tally(byHumanResponse, r.humanResponse ?? 'none', r.resolution);
    // Reason is only meaningful where a judgement exists; a reason with no
    // response would be a row this route cannot produce.
    if (r.humanResponse && r.humanReasonCode) tally(byHumanReason, r.humanReasonCode, r.resolution);
  }

  // Too small a sample, or nothing to claim. Both return null so the caller
  // renders NOTHING — an empty state here would invite reading "0 of 2" as
  // evidence, which is exactly what too small a sample cannot provide.
  if (total < MIN_SAMPLE || improved === 0) return null;

  return {
    total,
    improved,
    unchanged,
    worsened,
    unscored,
    confidence: improved / total, // 0–1, over SCORED outcomes only
    // R13 — additive. Every existing key above keeps its meaning, and the
    // MIN_SAMPLE floor still gates the whole object, so these breakdowns can
    // never surface from a sample too thin to have been reported at all.
    // Internal evidence for R14; not a user-facing claim.
    byHumanResponse,
    byHumanReason,
  };
}
