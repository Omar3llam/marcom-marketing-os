// ============================================================
// VerdictService — persistence wrapper for the verdict engine
// ============================================================
// Owns DB I/O (the deterministic verdictEngine never touches it).
// Walks an annotated entity tree (from rollupVerdicts) and records a
// Decision per entity level, appending to the verdict timeline only
// when a level's verdict changes (so the multi-level verdict graph is
// persisted and consistent with the rollup, without unbounded rows).
// ============================================================
import { prisma }                  from '../../lib/prisma.js';
import { logger }                  from '../../utils/logger.js';
import { rollupVerdicts }          from './verdictEngine.js';
import { applyRelativeRanking }     from './relativeRanking.js';
import { assertUsableEvaluation }    from './connectorVerdictService.js';
import { toReasoningArtifact, toCounterfactualArtifact } from './reasoningArtifact.js';
import { toEvidenceReference }     from './evidenceReference.js';
import { connectorDecisionScope }  from './decisionIdentity.js';
import { computeResolution, ctrDelta } from './decisionLifecycle.js';

// The rootCauses persistConnectorVerdicts writes: a diagnosis signalType, a
// funnel-stage or data-quality cause, or null when the engine set none.
// Guardrail / allocation / test / incrementality decisions all use their own
// non-null prefixes, so this set + null identifies connector verdicts exactly.
//
// LOAD-BEARING: supersedeDroppedConnectorVerdicts scopes on this set. Any cause
// the engine can emit MUST be listed, or verdicts carrying it become
// un-supersedable and pile up as permanently-open PROPOSED rows.
// Moved to decisionIdentity.js — the read path needs the SAME definition, and a
// second copy is how the two drift into disagreeing about which rows are ours.

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * The two metrics the lifecycle scores, lifted off an annotated node.
 * null-when-absent throughout — a missing reading must not become a 0, which
 * would resolve as a catastrophic collapse rather than "we don't know".
 */
function nodeMetrics(node) {
  const s = node?.signalInput ?? {};
  return { ctr: finite(s.ctr), roas: finite(s.roas) };
}

/**
 * The evidence reference for a node, or null when it carries no basis.
 *
 * null IS AN ANSWER, and the honest one for an internal/rollup node: the
 * account-level verdict is computed from its children's aggregates, not from a
 * read of its own, so there is no population, window or observation time to
 * name. A reference invented for it would assert a read that never happened.
 *
 * BEST-EFFORT, LIKE resolvePrevious. toEvidenceReference throws on a contract
 * violation — that is what keeps a false reference from being constructed at
 * all — but a KILL must not be lost because provenance could not be described.
 * A failure here is logged and the decision is written with `evidenceReference:
 * null`, which reads as "not captured": true, and not a fabrication.
 */
function nodeEvidenceReference(node) {
  const basis = node?.evidenceBasis;
  if (!basis) return null;
  try {
    return toEvidenceReference({ ...basis, rows: node.evidenceRows ?? [] });
  } catch (err) {
    logger.warn(
      { err: err.message, entityId: node?.id, level: node?.level },
      '[VerdictService] evidence reference not recorded',
    );
    return null;
  }
}

/**
 * Close out the verdict that a new one replaces: mark it SUPERSEDED and record
 * how the entity behaved in between. Best-effort — a failure here must never
 * cost the sweep the new verdict it just wrote, which is the load-bearing row.
 *
 * WRITES OUTCOME, NEVER REASONING. The four fields below are all facts about
 * what happened AFTER the call. `hypotheses` and `counterfactuals` are what the
 * engine believed when it MADE the call, and the new verdict's reasoning belongs
 * to the new row — persistNode has already created it. Copying fresh reasoning
 * onto a closed-out row would make it claim it had foreseen its own replacement,
 * and the resulting history would show every superseded decision reasoning
 * perfectly about an outcome it never predicted.
 */
async function resolvePrevious(previous, now) {
  const at = { ctr: previous.ctrAtDecision ?? null, roas: previous.roasAtDecision ?? null };
  try {
    await prisma.decision.update({
      where: { id: previous.id },
      data: {
        status:          'SUPERSEDED',
        resolvedAt:      new Date(),
        resolution:      computeResolution(previous.verdict, at, now),
        confidenceDelta: ctrDelta(at, now),
      },
    });
  } catch (err) {
    logger.warn({ err: err.message, decisionId: previous.id }, '[VerdictService] could not resolve superseded verdict');
  }
}

async function persistNode(workspaceId, node, created) {
  // Only persist real entity ids (uuids); skip synthetic roots.
  if (node.id && node.level) {
    const latest = await prisma.decision.findFirst({
      // Compare against the latest ACTIVE verdict (PROPOSED or EXECUTED). A row we
      // SUPERSEDED (a campaign that had dropped out of the eligible set, below)
      // must NOT block a fresh PROPOSED when the campaign re-enters with the same
      // verdict — otherwise it would silently vanish from the agenda.
      //
      // C-01 — …and it must be OUR row. Without the scope this is exactly the
      // predicate decisionIdentity warns about: entity + level + status names
      // "some proposal about this entity", a far larger set than "the connector
      // verdict for it". R-3 lets a Guardrail episode and an Experiment sit open
      // on the same entity, so the unscoped read could pick a foreign class as
      // `latest` and then do one of two damaging things — suppress a real
      // verdict because the foreign row's verdict happened to match, or hand it
      // to resolvePrevious, which SUPERSEDES it and stamps `resolution` on it.
      // The second reopens, from the write side, the door C-02 deliberately shut
      // by keeping `resolution` off guardrail closure. This is an identity
      // question, so it takes the identity scope; BUYER_ACTIONABLE is the
      // actionability one and would leave HOLD verdicts un-supersedable.
      where:   {
        workspaceId, entityId: node.id, entityLevel: node.level,
        status: { not: 'SUPERSEDED' },
        ...connectorDecisionScope(),
      },
      orderBy: { createdAt: 'desc' },
      // The four fields this row is used for: `verdict` decides whether anything
      // changed, and resolvePrevious reads the other three. Named rather than
      // SELECT *, which would now pull the previous decision's whole reasoning
      // snapshot — once per entity, on every sweep — only to compare one enum.
      select:  { id: true, verdict: true, ctrAtDecision: true, roasAtDecision: true },
    });
    if (!latest || latest.verdict !== node.verdict) {
      // The metrics AS THEY STAND NOW, stamped onto the row. This is the only
      // moment they can be captured: a MetricSnapshot is a rolling per-sync
      // aggregate re-stamped every sweep, so nothing can reconstruct "what did
      // this look like when we called it" after the fact.
      //
      // signalInput.ctr is a PERCENT (verdictEngine derives it as
      // clicks/impressions*100) — NOT the 0..1 ratio a snapshot row carries.
      // roas is null when revenue was never measured; it stays null.
      const now = nodeMetrics(node);

      await prisma.decision.create({
        data: {
          workspaceId,
          entityId:    node.id,
          entityLevel: node.level,
          verdict:     node.verdict,
          confidence:  node.verdictConfidence ?? 0.5,
          diagnosis:   node.rationale ?? '',
          // The engine's explicit cause wins over the raw diagnosis signal: a
          // WATCH from a broken landing page and a WATCH from a thin sample are
          // different decisions, and grouping both under a signalType (or null)
          // makes the learning query average two unrelated populations.
          rootCause:   node.rootCause ?? node.signalType ?? null,
          status:      'PROPOSED',
          ctrAtDecision:  now.ctr,
          roasAtDecision: now.roas,
          // The similarity key. Both ride on the node from
          // buildConnectorVerdictTree; a non-connector caller supplies neither,
          // and null is the honest record of "we were never told".
          objective:   node.objective ?? null,
          channel:     node.channel ?? null,
          // What the engine BELIEVED, frozen at the moment of the call. Both
          // already ride on the node (verdictEngine attaches them beside the
          // verdict) — they were simply never written, so every decision the
          // product has ever made kept its conclusion and discarded its
          // reasoning. Projected rather than spread: see reasoningArtifact.js.
          //
          // null when a caller supplied nothing (guardrail and allocation
          // writers do not reason this way); [] when the engine ran and found
          // no mechanism, which an early-gate campaign genuinely produces.
          hypotheses:      toReasoningArtifact(node.hypotheses),
          counterfactuals: toCounterfactualArtifact(node.counterfactuals),
          // WHAT IT WAS LOOKING AT (R5 / I18). The three fields above record
          // what the engine believed; this records the evidence underneath —
          // population, window, source(s), observation time(s), how many rows
          // were consumed and the rule that reduced them. null when the node
          // carried no basis (an internal/rollup node, or a caller that never
          // declared one), which stays null rather than becoming a guess.
          evidenceReference: nodeEvidenceReference(node),
        },
      });
      created.push({ entityId: node.id, level: node.level, verdict: node.verdict });

      // Resolve the verdict this one replaces. Only fires on a real CHANGE (we
      // are inside the `verdict !== ` branch), which is the seam that carries
      // meaning: the engine looked again and reached a different conclusion.
      //
      // Deliberately NOT done in supersedeDroppedConnectorVerdicts: a campaign
      // that fell out of the eligible set was never re-judged, so there is no
      // "what happened next" to record — only an absence of data. Resolving it
      // would manufacture an outcome from a campaign going quiet.
      if (latest) await resolvePrevious(latest, now);
    }
  }
  for (const child of node.children ?? []) {
    await persistNode(workspaceId, child, created);
  }
}

/**
 * THE PERSISTENCE SINK (R8 / I26). Writes an ALREADY-EVALUATED tree. It does not
 * call the engine, and it must never learn how: the verdict it stores has to be
 * the verdict its caller computed, not a second one that agrees with it by
 * construction. "They agree because they run the same code on the same rows" is
 * a property that holds until the day two reads land either side of a sync.
 *
 * @param {string} workspaceId
 * @param {object} annotated — output of rollupVerdicts (+ applyRelativeRanking)
 * @param {object} [opts]
 * @param {boolean} [opts.skipRoot=false] — persist the CHILDREN only.
 *   The connector tree's ACCOUNT root is keyed by workspaceId, which is not an
 *   entity. It used to be skipped implicitly, because the write path built a
 *   ROOTLESS literal (`{ level: 'ACCOUNT', children }`) and persistNode ignores
 *   a node with no id. Now that both twins share ONE tree — the read path's,
 *   which does carry `id: workspaceId` so the payload can name the account —
 *   that implicit skip would silently become an ACCOUNT Decision row per sweep
 *   with a workspace id in its entityId column. Made explicit rather than
 *   re-introducing a second tree shape to keep an accident working.
 * @returns {Promise<{ annotated:object, created:Array }>}
 */
export async function persistAnnotatedVerdicts(workspaceId, annotated, { skipRoot = false } = {}) {
  if (!workspaceId) throw new Error('persistAnnotatedVerdicts: workspaceId required');
  if (!annotated) throw new Error('persistAnnotatedVerdicts: annotated tree required');
  const created = [];
  if (skipRoot) {
    for (const child of annotated.children ?? []) await persistNode(workspaceId, child, created);
  } else {
    await persistNode(workspaceId, annotated, created);
  }
  logger.info({ workspaceId, decisions: created.length }, '[VerdictService] level verdicts persisted');
  return { annotated, created };
}

/**
 * Evaluate + persist multi-level verdicts for a RAW entity tree.
 *
 * NOT the connector path. The connector verdict is evaluated once per logical
 * evaluation by evaluateConnectorVerdicts and threaded to the sink above; this
 * entry remains for a caller that holds a hand-built tree and no evaluation —
 * today, the persistence tests that exercise persistNode directly.
 *
 * @param {string} workspaceId
 * @param {object} entityTree — Account/Campaign tree with leaf metrics
 * @param {object} [opts] — passed to rollupVerdicts (currency, guardrailHitsByEntity)
 * @returns {Promise<{ annotated:object, created:Array }>}
 */
export async function persistLevelVerdicts(workspaceId, entityTree, opts = {}) {
  if (!workspaceId) throw new Error('persistLevelVerdicts: workspaceId required');
  const rolled = rollupVerdicts(entityTree, opts);
  // The portfolio-relative post-pass (bottom/top of a cohort upgrades an
  // undecided HOLD/WATCH to KILL/SCALE). Pure + deterministic; default OFF so a
  // non-connector caller keeps pure absolute-threshold verdicts.
  const annotated = opts.relativeRanking ? applyRelativeRanking(rolled) : rolled;
  return persistAnnotatedVerdicts(workspaceId, annotated);
}

/**
 * Resolve STALE connector verdicts. persistNode only ever appends (a campaign
 * that flips verdicts leaves a timeline) and only for campaigns in the CURRENT
 * eligible set — so a campaign that drops below the revenue/engagement gate, or
 * is deleted, would keep its last PROPOSED verdict forever and go on inflating
 * the agenda (buyer band = latest PROPOSED verdict per entity). Each sweep we
 * mark those orphaned verdicts SUPERSEDED so the agenda reflects only currently
 * eligible campaigns.
 *
 * Scope is EXACT: campaign-level PROPOSED decisions whose rootCause is a diagnosis
 * signalType or null — i.e. connector verdicts only. Guardrail / allocation /
 * test / incrementality decisions (own non-null prefixes) are never touched.
 *
 * @param {string} workspaceId
 * @param {string[]} eligibleIds — entityIds scored THIS sweep (kept as-is)
 * @returns {Promise<number>} rows superseded
 */
async function supersedeDroppedConnectorVerdicts(workspaceId, eligibleIds) {
  const where = {
    workspaceId,
    status:      'PROPOSED',
    entityLevel: 'CAMPAIGN',
    ...connectorDecisionScope(),
  };
  // Empty eligible set ⇒ nothing is current (whole account went dataless) ⇒
  // supersede EVERY connector verdict. Omit the entityId filter entirely —
  // Prisma treats `notIn: []` inconsistently across versions.
  if (eligibleIds.length) where.entityId = { notIn: eligibleIds };
  const { count } = await prisma.decision.updateMany({ where, data: { status: 'SUPERSEDED' } });
  if (count) logger.info({ workspaceId, superseded: count }, '[VerdictService] stale connector verdicts superseded');
  return count;
}

/**
 * PERSIST an evaluated connector verdict set as PROPOSED Decisions.
 *
 * R8: this is a SINK, not a twin. It used to read canonical evidence and run the
 * engine itself, independently of the read path that had just run the identical
 * pipeline over the identical rows — two computations of one logical decision,
 * separated by however long the first took. They agreed in practice and could
 * not be relied on to: a sync landing between them writes a Decision the agenda
 * beside it does not describe. It now receives the ONE evaluation its caller
 * made and stores exactly that (I26).
 *
 * Three correctness seams, unchanged:
 *  - REVENUE GATE: buildConnectorVerdictTree drops campaigns with no measured
 *    revenue, so a workspace with no real revenue persists NOTHING (never a
 *    fabricated verdict) — `annotated` is null and we write no new rows.
 *  - SYNTHETIC ROOT: the ACCOUNT root is keyed by workspaceId, not a real
 *    entity → `skipRoot`, so only campaign children become Decision rows.
 *  - STALE PRUNE: verdicts for entities NOT in this evaluation's eligible set are
 *    superseded (runs even when nothing is eligible) so the agenda never carries
 *    a verdict for a campaign that no longer qualifies or no longer exists.
 *
 * Invoked from the agentic-loop sweep (cron / gated POST /loop/run /
 * rate-limited on-read) — never from a GET, never auto-executed (PROPOSED).
 *
 * @param {string} workspaceId
 * @param {object} evaluation — REQUIRED. From evaluateConnectorVerdicts, for this
 *   workspace. Not optional by design: an optional one would let a caller omit it
 *   and silently restore the second computation this exists to remove.
 * @returns {Promise<{ created:Array, gatedOut:Array, superseded:number, status:string }>}
 */
export async function persistConnectorVerdicts(workspaceId, evaluation) {
  if (!workspaceId) throw new Error('persistConnectorVerdicts: workspaceId required');
  if (!evaluation) throw new Error('persistConnectorVerdicts: evaluation required');
  assertUsableEvaluation('persistConnectorVerdicts', workspaceId, evaluation);

  const { annotated, gatedOut } = evaluation;
  const eligibleIds = annotated ? annotated.children.map((c) => c.id) : [];

  // Prune stale verdicts BEFORE (and regardless of) this sweep's writes — a
  // campaign that lost eligibility, or the whole account going dataless, must
  // not leave a lingering PROPOSED verdict behind.
  const superseded = await supersedeDroppedConnectorVerdicts(workspaceId, eligibleIds);

  if (!annotated) {
    return { created: [], gatedOut, superseded, status: evaluation.status };
  }
  const { created } = await persistAnnotatedVerdicts(workspaceId, annotated, { skipRoot: true });
  logger.info({ workspaceId, created: created.length, gatedOut: gatedOut.length, superseded }, '[VerdictService] connector verdicts persisted');
  return { created, gatedOut, superseded, status: 'OK' };
}
