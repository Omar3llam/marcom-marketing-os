// ============================================================
// MARCOM / Admin — list query-param parsing
// ------------------------------------------------------------
// Shared by the workspaces and users lists. Both take ?limit / ?offset from a
// URL, so both need the same guards: a query string is arbitrary user input,
// and Prisma throws on `take: NaN` / `skip: -1` rather than ignoring them.
//
// The audit log keeps its own parser: it is CURSOR-paginated (?before=<iso>),
// a different contract with a different failure mode, and folding the two
// together would couple an append-only log to two mutable lists.
// ============================================================

/**
 * Clamp a ?limit into [1, max], falling back to `def` for anything unparseable.
 * Number.parseInt('abc') is NaN and Math.min(NaN, n) is NaN — a value Prisma
 * rejects — so junk must never reach `take`.
 */
export function parseLimit(raw, { def = 25, max = 100 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/** Clamp a ?offset to a non-negative integer. Junk and negatives → 0. */
export function parseOffset(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * A free-text search term, or null when there is nothing to search for.
 * Trimmed, because '   ' is not a search — it is a `contains` that matches
 * almost nothing and makes the list look empty for no stated reason.
 */
export function parseSearch(raw) {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  return q.length === 0 ? null : q;
}

/**
 * An exact-match filter, accepted only if it is one of `allowed`.
 *
 * Not decorative: User.role is a Prisma enum, so an unrecognised ?role would
 * throw a validation error and surface as a 500 on a route where the honest
 * answer is "that is not a role". Workspace.plan is a plain String and would
 * instead return zero rows silently — same whitelist, same reason.
 */
export function parseEnum(raw, allowed) {
  return allowed.includes(raw) ? raw : null;
}
