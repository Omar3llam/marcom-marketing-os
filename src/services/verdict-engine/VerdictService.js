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
import { getConnectorCampaigns }   from '../entity-graph/index.js';
import { buildConnectorVerdictTree } from './connectorVerdictService.js';
import { toReasoningArtifact, toCounterfactualArtifact } from './reasoningArtifact.js';
import { SIGNAL_TYPE }             from '../diagnosis-engine/index.js';
import { ROOT_CAUSE }              from './verdictTypes.js';
import { FUNNEL_SIGNAL }           from './funnelDiagnosis.js';
import { computeResolution, ctrDelta } from './decisionLifecycle.js';

// The rootCauses persistConnectorVerdicts writes: a diagnosis signalType, a
// funnel-stage or data-quality cause, or null when the engine set none.
// Guardrail / allocation / test / incrementality decisions all use their own
// non-null prefixes, so this set + null identifies connector verdicts exactly.
//
// LOAD-BEARING: supersedeDroppedConnectorVerdicts scopes on this set. Any cause
// the engine can emit MUST be listed, or verdicts carrying it become
// un-supersedable and pile up as permanently-open PROPOSED rows.
const CONNECTOR_ROOT_CAUSES = Object.freeze([
  ...Object.values(SIGNAL_TYPE),
  ...Object.values(ROOT_CAUSE),
  ...Object.values(FUNNEL_SIGNAL),
]);

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
      where:   { workspaceId, entityId: node.id, entityLevel: node.level, status: { not: 'SUPERSEDED' } },
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
 * Evaluate + persist multi-level verdicts for an entity tree.
 * @param {string} workspaceId
 * @param {object} entityTree — Account/Campaign tree with leaf metrics
 * @param {object} [opts] — passed to rollupVerdicts (currency, guardrailHitsByEntity)
 * @returns {Promise<{ annotated:object, created:Array }>}
 */
export async function persistLevelVerdicts(workspaceId, entityTree, opts = {}) {
  if (!workspaceId) throw new Error('persistLevelVerdicts: workspaceId required');
  const rolled = rollupVerdicts(entityTree, opts);
  // Connector sweeps opt into the portfolio-relative post-pass (bottom/top of a
  // cohort upgrades an undecided HOLD/WATCH to KILL/SCALE). Pure + deterministic;
  // default OFF so any other caller keeps pure absolute-threshold verdicts. The
  // upgraded verdict rides the EXISTING persistNode path — one row per entity,
  // same rootCause tagging, no separate relative-verdict table.
  const annotated = opts.relativeRanking ? applyRelativeRanking(rolled) : rolled;
  const created = [];
  await persistNode(workspaceId, annotated, created);
  logger.info({ workspaceId, decisions: created.length }, '[VerdictService] level verdicts persisted');
  return { annotated, created };
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
    OR: [{ rootCause: { in: CONNECTOR_ROOT_CAUSES } }, { rootCause: null }],
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
 * Read live connector campaigns, score them through the verdict engine, and
 * PERSIST the campaign-level verdicts as PROPOSED Decisions. This is the write
 * twin of connectorVerdictService.getConnectorVerdicts (which is deliberately
 * read-only): same tree, same engine, same revenue gate — only this path
 * commits rows. (connectorVerdictService stays pure; persistence lives here, per
 * its own contract comment.)
 *
 * Three correctness seams:
 *  - REVENUE GATE: buildConnectorVerdictTree drops campaigns with no measured
 *    revenue, so a workspace with no real revenue persists NOTHING (never a
 *    fabricated verdict) — tree is null and we write no new rows.
 *  - SYNTHETIC ROOT: that tree's ACCOUNT root is keyed by workspaceId (not a
 *    real entity), so we hand persistLevelVerdicts a ROOTLESS account node —
 *    only the real campaign children (entity-graph UUIDs) become Decision rows.
 *  - STALE PRUNE: verdicts for entities NOT in this sweep's eligible set are
 *    superseded (runs even when nothing is eligible) so the agenda never carries
 *    a verdict for a campaign that no longer qualifies or no longer exists.
 *
 * Invoked from the agentic-loop sweep (cron / gated POST /loop/run /
 * rate-limited on-read) — never from a GET, never auto-executed (PROPOSED).
 *
 * @returns {Promise<{ created:Array, gatedOut:Array, superseded:number, status:string }>}
 */
export async function persistConnectorVerdicts(workspaceId) {
  if (!workspaceId) throw new Error('persistConnectorVerdicts: workspaceId required');
  const campaigns = await getConnectorCampaigns(workspaceId);
  const { tree, gatedOut } = buildConnectorVerdictTree(workspaceId, campaigns);
  const eligibleIds = tree ? tree.children.map((c) => c.id) : [];

  // Prune stale verdicts BEFORE (and regardless of) this sweep's writes — a
  // campaign that lost eligibility, or the whole account going dataless, must
  // not leave a lingering PROPOSED verdict behind.
  const superseded = await supersedeDroppedConnectorVerdicts(workspaceId, eligibleIds);

  if (!tree) {
    return { created: [], gatedOut, superseded, status: gatedOut.length ? 'NO_ELIGIBLE_CAMPAIGNS' : 'NO_CAMPAIGNS' };
  }
  const { created } = await persistLevelVerdicts(workspaceId, { level: 'ACCOUNT', children: tree.children }, { relativeRanking: true });
  logger.info({ workspaceId, created: created.length, gatedOut: gatedOut.length, superseded }, '[VerdictService] connector verdicts persisted');
  return { created, gatedOut, superseded, status: 'OK' };
}
