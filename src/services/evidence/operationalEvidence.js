// ============================================================
// operationalEvidence — the operational population, owned in one place
// ============================================================
// R3 of the System Design Refactor. R1 built the Evidence seam and re-exported
// the two canonical policies through it. This is the first thing the seam OWNS
// rather than forwards: the operational population, which until now was
// re-expressed inline by nine separate consumers.
//
// WHAT "OPERATIONAL" MEANS, SAID ONCE
// ------------------------------------
//   • rows this workspace owns, and no other (I2)
//   • measurementWindow in the operational allow-list — LEGACY_UNKNOWN and
//     ROLLING_WINDOW, never CUMULATIVE_30D (that is canonical evidence and is
//     answered by a different selector, on purpose)
//   • synced no earlier than the caller's recency bound
//
// And what it deliberately does NOT mean:
//
//   • NOT a source filter. The operational population includes GA4, SHOPIFY and
//     MANUAL rows. That is the population its consumers read today, and adding
//     an allow-list here would silently drop actual-revenue rows out of every
//     one of them. The canonical VERDICT selector has a platform allow-list
//     because a verdict may not rest on a period nobody attested; that is a
//     verdict rule, not an operational one, and importing it here would be a
//     behaviour change dressed as consistency.
//
//   • NOT a latest-per-entity reduction. Some consumers want the latest row,
//     some want the whole series — guardrail wants the series, and collapsing it
//     would erase the very time-shape its rules evaluate. Reduction is the
//     caller's, applied to rows this function has ALREADY made eligible, which
//     is what keeps filter-before-latest true by construction (I3).
//
// WHY `select` IS REQUIRED
// -------------------------
// Prisma projects every column when `select` is absent, so a new MetricSnapshot
// column would silently widen whichever consumer forgot — the migration-lag
// failure that took getLoopState down when `aiInsight` landed. A shared entry
// point is the worst possible place to leave that door open, so it is closed by
// contract rather than by each caller remembering.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';

/**
 * The operational population's ordering. Oldest-first, because the consumers
 * that read a series read it forwards; a consumer wanting the newest row takes
 * the last one rather than re-asking the database in the other direction.
 */
export const OPERATIONAL_ORDER_BY = Object.freeze({ date: 'asc' });

/**
 * Select the operational MetricSnapshot population for a workspace.
 *
 * DOES NOT CATCH. The guardrail sweep this was extracted from let a read error
 * propagate to its caller, which decides what a failed sweep means; swallowing
 * it here would turn "the database is unreachable" into "this workspace has no
 * metrics", and the sweep would report a clean run over an empty series. The
 * canonical selectors DO catch, because their callers are read paths that
 * degrade to an honest "no evidence" — a different contract, deliberately.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {object}   opts
 * @param {Date}     opts.since  — sync-recency bound on `date`, the SYNC timestamp.
 *   NOT a delivery period: rows are rolling aggregates covering whatever window
 *   their sync requested (see config/temporal.js). Omit for no bound.
 * @param {object}   opts.select — REQUIRED Prisma projection; see above.
 * @returns {Promise<Array>} eligible rows, date-ascending.
 */
export async function selectOperationalSnapshots(workspaceId, { since = null, select } = {}) {
  // Both are programming errors rather than runtime states, and both are
  // unreachable from a correct caller — but a missing workspaceId would query
  // across every workspace, and a missing select would widen silently. Neither
  // may fail quietly at the one seam that now owns this table.
  if (!workspaceId) throw new Error('selectOperationalSnapshots: workspaceId required');
  if (!select) throw new Error('selectOperationalSnapshots: select required (an unprojected read widens silently)');

  return prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      ...(since ? { date: { gte: since } } : {}),
      measurementWindow: OPERATIONAL_WINDOW_FILTER,
    },
    select,
    orderBy: OPERATIONAL_ORDER_BY,
  });
}
