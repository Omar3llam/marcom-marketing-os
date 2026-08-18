// ============================================================
// Cohort assignment — server-determined, never self-declared (R11 · F12 / RU-5)
// ============================================================
// A cohort is the population an anonymized network insight is computed over.
// Membership in it decides two things at once: whose patterns you contribute
// to, and whose aggregate you get to read.
//
// Before this module, `cohortTag` was a free-text string the workspace POSTed
// with its consent. That made cohort membership a CLAIM, and the claim was
// trusted: type "EG-apparel" and you were in that cohort — contributing to its
// aggregate and reading it back. Nothing verified the claim, because there was
// nothing to verify it against. k-anonymity still held (K distinct workspaces
// were still required), so no single account could be re-identified — but
// k-anonymity protects the CONTRIBUTORS, not the boundary. It says nothing
// about who is allowed to stand inside the cohort and look out.
//
// So the cohort is now DERIVED by the server from a controlled attribute:
//
//   • controlled — its value space is a fixed vocabulary the server defines
//     (ISO 4217), not an arbitrary string. There is no cohort to invent.
//   • attributable — the workspace does not author it. `Workspace.currency`
//     is stamped from the connected ad account (MetaConnector reads the
//     account's own `currency` field), so its authoritative writer is the ad
//     platform, not the account holder.
//
// The dimension is a one-element allowlist on purpose. Adding a second is a
// governance decision, not a code change: any dimension a workspace can freely
// set restores exactly the lever this module removes — the ability to choose
// which population you are measured against, and which one you get to see.
// `spendTier` and `objective` are the obvious candidates and are BOTH
// self-selected through /me/context, so neither is eligible today. An industry
// dimension would be the right second axis; it has no Workspace column and no
// server-side writer, so it does not exist to be used yet.
//
// TRADE-OFF, stated plainly: currency is a coarser cohort than "EG-apparel"
// was. Fewer, larger populations means insights are less specific to a trade.
// That is the cost of the tags having been unverifiable. A coarse TRUE cohort
// is worth more than a precise claimed one, and K/minSupport are unchanged.
// ============================================================

/** The approved controlled attributes a cohort may be derived from. */
export const COHORT_DIMENSIONS = Object.freeze(['currency']);

const ISO_4217 = /^[A-Za-z]{3}$/;

/**
 * The cohort this workspace belongs to, or null when one cannot be established.
 *
 * Null is a real answer, not a fallback: it means the controlled attribute is
 * missing or outside its vocabulary, so there is no population this workspace
 * can honestly be said to belong to. Callers must refuse rather than invent
 * one — a defaulted cohort would put an account into an aggregate it has no
 * claim to, which is the exact failure this module exists to prevent.
 *
 * @param {{ currency?: string|null }} workspace
 * @returns {string|null}
 */
export function assignCohort(workspace) {
  const currency = workspace?.currency;
  if (typeof currency !== 'string' || !ISO_4217.test(currency.trim())) return null;
  return `CUR-${currency.trim().toUpperCase()}`;
}

/**
 * The Prisma WHERE fragment selecting the workspaces in the same cohort.
 *
 * This exists so peer SELECTION and cohort DERIVATION cannot drift apart. They
 * are the same decision asked in two places — once in JavaScript for the label,
 * once in SQL for the population — and if a second dimension is ever added to
 * COHORT_DIMENSIONS, a version of that decision left behind here would widen
 * the aggregate past its own cohort silently. Both are asserted against
 * COHORT_DIMENSIONS in cohort.test.js.
 *
 * Note this deliberately queries the controlled ATTRIBUTE, not the stored
 * `cohortTag` column. The column is a server-written label for display; the
 * attribute is the fact. A stale label can therefore never span a cohort.
 *
 * @param {{ currency?: string|null }} workspace
 * @returns {object|null} null when the workspace has no assignable cohort
 */
export function cohortWhere(workspace) {
  if (!assignCohort(workspace)) return null;
  return { currency: workspace.currency };
}

/** Raised when consent is requested by a workspace that has no assignable cohort. */
export class CohortUnavailableError extends Error {
  constructor(message = 'No cohort can be established for this workspace') {
    super(message);
    this.name = 'CohortUnavailableError';
    this.code = 'COHORT_UNAVAILABLE';
  }
}
