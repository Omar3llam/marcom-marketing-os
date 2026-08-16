// ============================================================
// connectorVerdictService — live connector campaigns → verdicts
// ============================================================
// Bridges the connector entity graph (EntityGraphService) into the pure
// verdictEngine. Read-only: builds the {id,level,metrics,children} tree the
// engine wants, runs rollupVerdicts, returns JSON. NEVER persists — a GET that
// silently wrote PROPOSED Decision rows would surprise the caller and brush the
// "Lumi initiates / human confirms" guard. Persistence stays in VerdictService.
//
// TWO ELIGIBILITY TRACKS (load-bearing, governing law):
//   A. MEASURED REVENUE — positive claimed revenue against real spend → the
//      revenue verdicts (KILL/SCALE/HOLD). verdictEngine reads roas < 1.0 as KILL,
//      so this must be a REAL signal: a row whose revenue was never measured lands
//      revenueMinor 0 (snapshotSink `|| 0`), and forcing it through the roas
//      thresholds would fabricate a KILL from data that doesn't exist (the class
//      PR #96 removed from the ROAS display). We gate on revenue+spend directly
//      (not `roas != null`) because a stale row can carry a literal roas:0.
//   B. ENGAGEMENT, NO REVENUE — real spend + impressions but no measured revenue
//      (awareness/reach campaigns). These ARE eligible, via the engine's AWARENESS
//      track: judged on frequency + CTR only, roas stays null, NEVER a revenue
//      verdict. The engine routes A vs B on the `revenueMeasured` flag toSignalInput
//      derives — so both tracks share one code path; the gate only decides entry.
// Everything else is genuinely dataless (no spend or no delivery — incl. PR #156
// zero-spend roster rows) → `gatedOut`, never scored.
// (Revenue here is platform-CLAIMED via Meta action_values — present, if not yet
// independently verified — so it counts as measured for gating purposes.)
// ============================================================
import { prisma }                from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from '../entity-graph/index.js';
import { rollupVerdicts }        from './verdictEngine.js';
import { applyRelativeRanking }  from './relativeRanking.js';
import { daysSince }             from './confidenceEngine.js';
import { isSubstantive }         from './counterfactualEngine.js';
import { connectorDecisionScope } from './decisionIdentity.js';
import { getDecisionHistory }    from '../decision-memory/index.js';
import { logger }                from '../../utils/logger.js';

// Meta objectives that are GENUINELY awareness/reach — no purchase revenue is
// expected, so "no revenue measured" is honest, not a tracking gap. Everything
// else (OUTCOME_LEADS / OUTCOME_SALES / OUTCOME_APP_PROMOTION / legacy CONVERSIONS)
// is a conversion objective: no measured revenue there is a MEASUREMENT GAP.
export const AWARENESS_OBJECTIVES = new Set([
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_TRAFFIC',
  // legacy objective names Meta still returns on older campaigns:
  'BRAND_AWARENESS', 'REACH', 'VIDEO_VIEWS', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'LINK_CLICKS', 'EVENT_RESPONSES',
]);

/** PURE: is this objective a genuine awareness/reach objective (no revenue expected)? */
export function isAwarenessObjective(objective) {
  return objective != null && AWARENESS_OBJECTIVES.has(objective);
}

/**
 * PURE: should revenue/conversion value be EXPECTED for this objective? A known
 * conversion objective → true (no revenue = a tracking gap). A known awareness
 * objective → false. Unknown/null → false: we never fabricate a "verify your
 * tracking" claim on an objective we don't actually know — and a real conversion
 * campaign carries a known OUTCOME_*, so it still gets the corrected message.
 */
export function revenueExpectedFor(objective) {
  return objective != null && !AWARENESS_OBJECTIVES.has(objective);
}

/** PURE: does this connector row carry a positive measured revenue signal? */
export function hasMeasuredRevenue(row) {
  const rev = row?.revenueMinor;
  const spend = row?.spendMinor;
  return Number.isFinite(rev) && rev > 0 && Number.isFinite(spend) && spend > 0;
}

/**
 * PURE: is this campaign's ROAS unscoreable for want of revenue DATA (not for
 * want of performance)? True only for a CONVERSION-objective campaign that spent
 * real money and measured no revenue — i.e. a tracking gap the user can close by
 * uploading revenue (Settings → Revenue data) or wiring a purchase pixel.
 *
 * Deliberately NOT true for:
 *   • a genuine awareness/reach campaign (no revenue is EXPECTED — scoring it on
 *     ROAS would be the fabrication the awareness track exists to prevent),
 *   • an unknown objective (we never claim a tracking gap we can't prove),
 *   • a campaign with no spend (nothing to attribute revenue to yet).
 *
 * This is the deterministic signal behind the "needs revenue" UI — it is derived
 * from real rows, never from an LLM.
 */
export function needsRevenueData(row) {
  const spend = row?.spendMinor;
  if (!Number.isFinite(spend) || spend <= 0) return false;
  return revenueExpectedFor(row?.objective) && !hasMeasuredRevenue(row);
}

/**
 * PURE: did this campaign actually deliver — real spend AND impressions — even
 * with no measured revenue? An awareness/reach campaign qualifies for the engine's
 * engagement-only track. A PR #156 zero-spend roster row (spend 0, impressions 0)
 * does NOT — it has no signal to judge, so it stays gatedOut.
 */
export function hasEngagement(row) {
  const spend = row?.spendMinor;
  const impressions = row?.impressions;
  return Number.isFinite(spend) && spend > 0 && Number.isFinite(impressions) && impressions > 0;
}

/** PURE: a connector row → the engine's leaf metric shape (raw, un-ratio'd). */
function toLeafMetrics(row) {
  return {
    spendMinor:   row.spendMinor   ?? 0,
    revenueMinor: row.revenueMinor ?? 0,
    impressions:  row.impressions  ?? 0,
    clicks:       row.clicks       ?? 0,
    conversions:  row.conversions  ?? 0,
    frequency:    row.frequency    ?? 0,
  };
}

/**
 * PURE: split connector campaigns into a verdict tree (eligible) + a gatedOut
 * list. Eligible = measured revenue OR real engagement (the engine's awareness
 * track handles the latter, roas null). gatedOut = genuinely dataless (no spend or
 * no delivery). Returns { tree, gatedOut }; tree is null when nothing is eligible
 * (caller must NOT fabricate a verdict in that case).
 */
export function buildConnectorVerdictTree(workspaceId, campaigns = [], { now = Date.now() } = {}) {
  const eligible = [];
  const gatedOut = [];
  for (const c of campaigns) {
    // Measured revenue OR engaged-but-no-revenue both reach the engine; the
    // revenueMeasured flag (derived in toSignalInput) routes them to the revenue
    // verdicts vs the awareness track. Only dataless rows are gated out.
    if (hasMeasuredRevenue(c) || hasEngagement(c)) {
      eligible.push({
        id:      c.entityId,
        level:   'CAMPAIGN',
        name:    c.name,
        currency: c.currency || 'USD',
        // Carry the objective + the channel-agnostic revenueExpected flag so the
        // engine's no-revenue branch can name the real story: true awareness vs a
        // conversion campaign with no measured revenue (a tracking gap).
        objective:       c.objective ?? null,
        revenueExpected: revenueExpectedFor(c.objective),
        // The channel was on the connector row all along and got dropped here.
        // persistNode stamps it onto the Decision so the learning query can ask
        // "how did KILLs go on META" — without it, `node.channel` is undefined
        // and every stored channel would be null.
        channel:         c.channel ?? null,
        // The funnel bag the engine's stage rules diagnose over. null when the
        // channel reported none — the rules then decline to fire rather than
        // reading an unmeasured stage as a 100% drop-off.
        actionMetrics:   c.actionMetrics ?? null,
        // Platform-side age. Time is resolved HERE, at the service boundary,
        // because the engine's determinism contract forbids it from reading the
        // clock: a stored verdict must stay reproducible from its inputs.
        platformCreatedTime: c.platformCreatedTime ?? null,
        daysRunning:     daysSince(c.platformCreatedTime, now),
        // ── Evidence provenance (R5 / I18) ──────────────────────────────────
        // The SECOND loss point this repair closes. `evidenceBasis` is what the
        // reader declared (population, selector, window, reduction, rows
        // consumed); `evidenceRows` is which row(s) actually contributed, with
        // their source and their OBSERVATION timestamp.
        //
        // Both used to die right here: the row's `source` was already gone at
        // metricsOf, and `lastDate` was dropped building this node — so the
        // engine has never known when its evidence was observed, and the
        // decision written from it could not say either.
        //
        // CARRIED, NOT COMPUTED. Nothing below reads these: they are not signal
        // inputs, they do not reach toSignalInput, and no verdict, threshold,
        // confidence or rank moves because they exist. They ride to the
        // persistence boundary and stop.
        evidenceBasis: c.evidenceBasis ?? null,
        evidenceRows:  c.evidenceRows  ?? [],
        metrics: toLeafMetrics(c),
      });
    } else {
      gatedOut.push({ id: c.entityId, name: c.name, reason: 'no measured revenue or engagement' });
    }
  }
  const tree = eligible.length
    ? { id: workspaceId, level: 'ACCOUNT', children: eligible }
    : null;
  return { tree, gatedOut };
}

// ============================================================
// R8 — ONE canonical evaluation, carried rather than rediscovered
// ------------------------------------------------------------
// There has only ever been one connector-verdict ALGORITHM. What there were
// several of was INVOCATIONS: the read twin, the write twin, and five consumers
// each ran the whole pipeline — canonical evidence read → tree → rollupVerdicts →
// applyRelativeRanking — for the same logical question. One agentic sweep did it
// two to four times.
//
// evaluateConnectorVerdicts IS that pipeline, extracted once and returned as a
// value. Everything downstream now takes the result; nothing recomputes it.
// This is explicit result threading, NOT a cache: the object lives for exactly
// as long as the caller holds it, is never keyed, stored, shared between
// requests or reused after the caller returns. Two HTTP requests are two
// evaluations, by design.
// ============================================================

/**
 * The status a FAILED evaluation carries.
 *
 * Deliberately NOT a member of the computed set (OK / NO_CAMPAIGNS /
 * NO_ELIGIBLE_CAMPAIGNS / NO_WORKSPACE) — every one of those means "we ran the
 * engine and this is what it found". This one means "we could not run it", and
 * a consumer that cannot tell the two apart will render "could not compute" as
 * "nothing to act on". That collapse is the exact class R7 removed from the
 * memory slot, and I29 forbids it here.
 */
export const EVALUATION_FAILED = 'EVALUATION_FAILED';

/**
 * Carry a failure forward instead of leaving the next consumer to re-attempt it.
 *
 * When a sweep's single evaluation throws, the sweep does not fall back to
 * letting each of its four consumers try again — that would be four failures
 * where there was one, and it would put the recomputation this whole change
 * removes back on the error path. It threads THIS, and every consumer re-raises.
 */
export function failedEvaluation(workspaceId, err) {
  return Object.freeze({
    workspaceId: workspaceId ?? null,
    campaigns: [], tree: null, annotated: null, gatedOut: [],
    status: EVALUATION_FAILED,
    error: err?.message ?? String(err ?? 'unknown'),
  });
}

/** PURE: did this evaluation actually run? (An absent one has not been attempted.) */
export function isEvaluated(evaluation) {
  return evaluation != null && evaluation.status !== EVALUATION_FAILED;
}

/**
 * Re-raise a supplied evaluation that cannot be used. Shared by every consumer
 * so "failed" and "belongs to another workspace" always throw with the same
 * words, and no consumer can quietly downgrade either into an empty result.
 */
export function assertUsableEvaluation(where, workspaceId, evaluation) {
  if (!isEvaluated(evaluation)) {
    throw new Error(`${where}: connector verdict evaluation unavailable — ${evaluation.error}`);
  }
  // Workspace scope is the one property an evaluation cannot carry implicitly:
  // it was computed for ONE workspace, and threading it into a call for another
  // would publish one account's verdicts under another's name. Cheap to check,
  // catastrophic to miss.
  if (evaluation.workspaceId !== workspaceId) {
    throw new Error(`${where}: evaluation belongs to a different workspace`);
  }
}

/**
 * THE canonical connector verdict computation (R8 / I25). Evidence read, tree,
 * engine, relative post-pass — once, as a reusable result.
 *
 * THROWS on a failed evidence read rather than returning an empty result. The
 * two callers that used to swallow this (copilot, portfolio analysis) turned it
 * into `verdicts: []`, which reads downstream as a healthy account with nothing
 * to do. A throw is the only shape a caller cannot mistake for an answer.
 *
 * @returns {Promise<{ workspaceId:string|null, campaigns:Array, tree:object|null,
 *   annotated:object|null, gatedOut:Array, status:string }>}
 *   `annotated` is the engine's output — null when nothing was eligible, which
 *   is a real answer and must never be replaced with a fabricated verdict.
 */
export async function evaluateConnectorVerdicts(workspaceId) {
  if (!workspaceId) {
    return { workspaceId: null, campaigns: [], tree: null, annotated: null, gatedOut: [], status: 'NO_WORKSPACE' };
  }

  const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(workspaceId);
  const { tree, gatedOut: dataless } = buildConnectorVerdictTree(workspaceId, campaigns);

  // TWO KINDS OF ABSENCE, kept apart (Phase D.4). `dataless` means we measured
  // the campaign over the verdict window and it delivered nothing to judge.
  // NO_CANONICAL_WINDOW means we never measured it over that window at all.
  // Same empty cell on screen, opposite fixes — one waits for spend, the other
  // waits for a sync — so collapsing them would tell the operator the wrong story.
  const gatedOut = [...dataless, ...noCanonicalWindow];

  if (!tree) {
    const status = gatedOut.length ? 'NO_ELIGIBLE_CAMPAIGNS' : 'NO_CAMPAIGNS';
    logger.info(
      { workspaceId, dataless: dataless.length, noCanonicalWindow: noCanonicalWindow.length, status },
      '[connectorVerdicts] no eligible campaigns',
    );
    return { workspaceId, campaigns, tree: null, annotated: null, gatedOut, status };
  }

  // Absolute verdicts first, then the portfolio-relative post-pass over the SAME
  // annotated tree — bottom-of-cohort HOLD/WATCH engagement campaigns become
  // KILL, top-of-cohort become SCALE, with the rationale rewritten to cite the
  // real group average. Pure + deterministic.
  //
  // This line used to exist twice: here, and inside persistLevelVerdicts behind
  // an `opts.relativeRanking` flag the write twin passed. Both produced the same
  // tree from the same evidence, which is why the duplication was invisible.
  const annotated = applyRelativeRanking(rollupVerdicts(tree));
  return { workspaceId, campaigns, tree, annotated, gatedOut, status: 'OK' };
}

/**
 * The latest PROPOSED Decision per CAMPAIGN entity, as Map<entityId, row>.
 *
 * IDENTITY ONLY. This says "a stored decision exists for this entity, and here
 * is its id" — nothing about whether it agrees with the verdict computed beside
 * it. The two answer different questions (what Lumi thinks NOW vs what it
 * decided THEN) and reconciling them here would put a third opinion, computed
 * by neither pass, on the wire.
 *
 * ── TWO filters, and the second is the one that matters ─────────────────────
 * `entityLevel: 'CAMPAIGN'` keeps out the OTHER LEVELS this engine writes:
 * persistNode emits one Decision per node — account, campaign and ad set alike
 * — all into this table keyed by entityId.
 *
 * `connectorDecisionScope()` keeps out the OTHER AUTHORS, and level alone does
 * not. Four services besides this engine write CAMPAIGN-level PROPOSED rows,
 * three of them against a real campaign entityId: a guardrail hit, an
 * incrementality readout, an allocation move. All are proposals about the same
 * campaign; none is the verdict on screen.
 *
 * Without it the first-hit-wins race below is decided by `createdAt` across ALL
 * of them — so a guardrail row written after the sweep silently becomes the id
 * behind a KILL button, and the operator's claim lands on a decision they were
 * never shown. That is not stale data, it is the wrong row, and it breaks the
 * one rule this projection exists to keep: a decisionId names the row the
 * reader was actually looking at.
 *
 * The scope is the SAME definition supersedeDroppedConnectorVerdicts uses.
 * Shared rather than copied, because two answers to "which rows are ours" is
 * how a row becomes un-supersedable in one place and invisible in the other.
 *
 * `status: 'PROPOSED'` excludes SUPERSEDED rows, which a later sweep has already
 * replaced. It does NOT exclude decisions a human has acted on: execute and
 * dismiss are recorded as TIMESTAMPS and deliberately leave `status` alone (see
 * the schema), so an executed row is still PROPOSED here. That is correct for
 * routing — the by-id route carries its own idempotency and mutual-exclusion
 * gate, and re-reaching a decision you already executed must 409, not 404.
 *
 * NO `take`. The read is naturally bounded — a new verdict supersedes the one
 * before it, so this is roughly one row per live campaign — and a cap would
 * silently hand the campaigns past it `decisionId: null`, quietly routing them
 * down the fallback. An unbounded read of a bounded set beats a truncation that
 * looks like an absence.
 */
export async function getLatestDecisions(workspaceId) {
  if (!workspaceId) return new Map();

  const rows = await prisma.decision.findMany({
    where:   { workspaceId, entityLevel: 'CAMPAIGN', status: 'PROPOSED', ...connectorDecisionScope() },
    // `evidenceReference` (R5) joins the projection because it is the ONE thing
    // about a stored decision this payload could never re-derive: the live
    // verdict beside it is recomputed from today's rows, and what a past
    // decision looked at is exactly the question re-reading cannot answer.
    // Named, not a select-less read — that would pull both reasoning JSONB
    // columns per row to discard them.
    select:  { id: true, entityId: true, verdict: true, createdAt: true, evidenceReference: true },
    orderBy: { createdAt: 'desc' },
  }).catch((err) => {
    // Identity is an ENHANCEMENT: without it every row falls back to the
    // by-entity path, which still works. Taking the whole verdict feed down
    // because this one query failed would trade a degraded surface for none.
    logger.debug({ err: err.message, workspaceId }, '[connectorVerdicts] decision identity read failed');
    return [];
  });

  // First hit wins, and `orderBy` desc makes that the most recent.
  const map = new Map();
  for (const d of rows) if (!map.has(d.entityId)) map.set(d.entityId, d);
  return map;
}

/**
 * Read connector campaigns for a workspace and return their verdicts.
 *
 * @param {string} workspaceId
 * @param {object} [opts]
 * @param {object} [opts.evaluation] — an evaluation ALREADY produced by
 *   evaluateConnectorVerdicts for THIS workspace. Supplied, it is used as-is and
 *   the engine does not run again (R8 / I25, I28); omitted, this call performs
 *   its own single evaluation, which is what an ordinary HTTP request does.
 * @returns {Promise<{ verdicts:Array, gatedOut:Array, account:object|null, status:string }>}
 */
export async function getConnectorVerdicts(workspaceId, { evaluation } = {}) {
  if (!workspaceId) return { verdicts: [], gatedOut: [], account: null, status: 'NO_WORKSPACE' };
  if (evaluation) assertUsableEvaluation('getConnectorVerdicts', workspaceId, evaluation);

  // Parallel: neither read feeds the other. The decision lookup is keyed by
  // workspace, not by the campaigns that come back, so sequencing them would
  // add a round trip for nothing.
  //
  // getLatestDecisions runs even on a threaded evaluation, and must: it is
  // DECISION IDENTITY (which stored row is behind this button), not a verdict
  // computation, and it has to reflect the rows this sweep has just written.
  const [ev, decisionMap] = await Promise.all([
    evaluation ?? evaluateConnectorVerdicts(workspaceId),
    getLatestDecisions(workspaceId),
  ]);

  const { gatedOut, annotated } = ev;
  if (!annotated) {
    return { verdicts: [], gatedOut, account: null, status: ev.status };
  }

  const verdicts = annotated.children.map((c) => ({
    id:         c.id,
    name:       c.name,
    verdict:    c.verdict,
    confidence: c.verdictConfidence,
    rationale:  c.rationale,
    spendMinor: c.metrics.spendMinor,
    roas:       c.signalInput.roas,
    // revenueExpected (derived from the campaign objective) rides through so a
    // no-revenue campaign can be split honestly on-screen: a genuine awareness
    // campaign vs a conversion campaign with a tracking gap — the rationale
    // already distinguishes them per-row; this lets the aggregate banner too.
    revenueExpected: c.revenueExpected ?? false,
    // Set when this verdict was decided by the relative post-pass ('TOP' | 'BOTTOM')
    // — null otherwise. Lets the UI badge "relative to portfolio" honestly.
    relativeRank: c.relativeRank ?? null,
    // ── Decision identity ────────────────────────────────────────────────────
    // The STORED decision for this entity, if a sweep ever wrote one. Not the
    // verdict beside it: this row is recomputed on every read and persists
    // nothing, while the Decision is what Lumi committed to at some earlier
    // moment. Two different questions, deliberately not reconciled here.
    //
    // null when no sweep has run for this campaign — a real answer, and the
    // signal the client uses to route execute/dismiss down the by-entity
    // fallback instead of the precise by-id path.
    decisionId: decisionMap.get(c.id)?.id ?? null,
    // The verdict as STORED, so a client can see that the live call has moved on
    // without a second fetch. Published beside the live one, never instead of
    // it, and never used to suppress or "correct" it.
    decisionVerdict: decisionMap.get(c.id)?.verdict ?? null,
    // What the STORED decision was looking at (R5 / I18). Beside decisionId and
    // decisionVerdict, and about the same row: the frozen provenance of the call
    // Lumi committed to, not of the live verdict recomputed above.
    //
    // null on every pre-R5 decision, and on every campaign with no stored
    // decision at all. Both mean "no provenance to show" — the UI renders
    // nothing rather than an empty evidence block, because "we did not capture
    // this" is not the same claim as "there was no evidence".
    decisionEvidenceReference: decisionMap.get(c.id)?.evidenceReference ?? null,
    // The cohort the rank was decided in: { rank, group, cohortSize, ctrPct,
    // avgCtrPct }, null on every absolutely-decided verdict. Minted by
    // applyRelativeRanking, which runs AFTER rollupVerdicts and spreads `...c` —
    // so unlike the reasoning artifacts it never passes through that allowlist
    // and cannot be dropped by it.
    //
    // PUBLISH-ONLY. persistNode freezes hypotheses and counterfactuals; neither
    // relativeRank nor this has a column, so a stored Decision still cannot say
    // it was cohort-decided. That is a migration, and a separate decision.
    relativeContext: c.relativeContext ?? null,
    // The deterministic diagnosis + execution vocabulary the engine already
    // computed (judgeMetrics → diagnoseSignals). Forwarded so a decision-first UI
    // can map verdict + signalType → a specific content recommendation without an
    // LLM call. signalType is the absolute-pass signal (a relative upgrade keeps
    // it as a hint; the recommendation mapping falls back to verdict-level).
    signalType: c.signalType ?? null,
    recommendationTypes: c.recommendationTypes ?? [],
    // ── Signal provenance ────────────────────────────────────────────────────
    // Machine-readable WHY, alongside the prose rationale. rootCause separates a
    // WATCH that means "the landing page is broken" from one that means "we do
    // not have enough data yet" — same verdict, opposite implications, and the
    // UI could not previously tell them apart.
    rootCause: c.rootCause ?? null,
    // The two halves of the confidence number, so a reader can tell a weak
    // signal from thin data instead of guessing which one a single figure meant.
    // Until now only ONE half was published — `confidence` and `dataConfidence`,
    // with the signal half dropped by both allowlists, so "is this a weak signal
    // or thin data?" was unanswerable from the payload.
    //
    // The three multiply out on EVERY row, including relative upgrades: that
    // pass re-stamps this field with its own ranking strength when it recomposes
    // `confidence`, so the pair always describes the verdict actually published.
    // Pinned by the golden test in decisionEngine.test.js.
    signalConfidence: c.signalConfidence ?? null,
    dataConfidence: c.dataConfidence ?? null,
    // { signal, stage, evidence[], counterfactual, action } when a funnel stage
    // was diagnosed; null when the funnel was never measured or is healthy.
    // evidence[] carries the real value AND the benchmark it was judged against,
    // so nothing downstream has to restate — or re-derive — the arithmetic.
    funnel: c.funnel ?? null,
    // ── Stage 3 reasoning ────────────────────────────────────────────────────
    // `declined` is the raw material (rules that ran and passed, with their
    // measurements); `hypotheses` the candidate explanations built from it; and
    // `counterfactuals` why each alternative was set aside.
    //
    // THIS path persists nothing — getConnectorVerdicts is read-only by
    // contract. Its WRITE twin does: persistConnectorVerdicts is handed THIS
    // SAME annotated tree (R8) and persistNode freezes `hypotheses` and
    // `counterfactuals` onto the Decision row. Within one sweep the two are
    // therefore the same reasoning, not two derivations that happen to agree —
    // which is the whole point of I26.
    //
    // Across time they still differ, and that is also the point: a stored
    // decision keeps the reasoning of the moment it was made, while this payload
    // describes the campaign as it stands on THIS read.
    //
    // `declined` is the exception — it is raw material, not a conclusion, and
    // no column holds it.
    //
    // The `?? []` matters: this projection is the SECOND hand-picked list these
    // fields must appear in (the first is rollupVerdicts' node return), and a
    // legacy or hand-built node that predates them must project an empty list
    // rather than `undefined`, which a consumer would spread or map over.
    declined:        c.declined        ?? [],
    hypotheses:      c.hypotheses      ?? [],
    // Only counterfactuals that actually SAY something. A counterfactual with
    // neither a contradiction nor distinguishing evidence sets an alternative
    // aside while naming no reason — and a UI rendering "Why not X?" over an
    // empty pair states a conclusion it cannot support.
    //
    // Filtered HERE, not in buildCounterfactuals: the empty pair is a true
    // description of what the engine found, and the engine should go on saying so.
    // What must not happen is publishing it as an argument. So the node keeps the
    // full list and the payload carries the ones that carry weight.
    counterfactuals: (c.counterfactuals ?? []).filter(isSubstantive),
  }));

  logger.info(
    { workspaceId, scored: verdicts.length, gatedOut: gatedOut.length },
    '[connectorVerdicts] verdicts computed',
  );
  // Past decisions for the campaigns actually on screen, as a SEPARATE map
  // rather than a field on each verdict. A verdict is what Lumi thinks NOW,
  // computed from live signals and nothing else; folding history into it would
  // put an older opinion inside the object the engine owns, and the rule this
  // whole surface keeps is that the two never edit each other.
  //
  // Sequenced after the feed rather than parallel to it: it needs the entity ids
  // the feed produced, so there is nothing to overlap with.
  const memoryByEntityId = Object.fromEntries(
    await getDecisionHistory(workspaceId, verdicts.map((v) => v.id)),
  );

  return {
    verdicts,
    gatedOut,
    account: { verdict: annotated.verdict, confidence: annotated.verdictConfidence },
    // Keyed by entityId, and ABSENT for campaigns with no history — never
    // present with a zero, which would be indistinguishable from a real one.
    memoryByEntityId,
    status: 'OK',
  };
}
