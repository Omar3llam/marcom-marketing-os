// ============================================================
// Migration/schema difference classification — ONE definition (B5-01Q)
// ============================================================
// PURE. No I/O, no Prisma, no database. Both callers share this file so the
// repository has exactly one answer to "is this difference acceptable?":
//
//   src/tests/migrationContract.test.js  — B5-01M's ratchet: do the MIGRATIONS
//                                          express schema.prisma?
//   scripts/prisma-migrate-safe.js       — B5-01Q's preflight: does the DEPLOY
//                                          TARGET match schema.prisma?
//
// Those are different questions against different databases, and the answers can
// legitimately differ. What must NOT differ is the vocabulary, or the allow-list
// becomes two allow-lists that drift apart — a second competing definition of
// schema truth, which is precisely what a safety check must not introduce.
//
// ── DIRECTION MATTERS ───────────────────────────────────────────────────────
// `migrate diff --to-schema-datamodel` prints the changes needed to turn the
// DATABASE into the DATAMODEL. So the sign carries the risk:
//
//   [+] Added column `x`     the datamodel HAS x, the database LACKS it.
//                            Prisma Client will select `x`. Every read of that
//                            model 500s. DANGEROUS.
//   [-] Removed column `x`   the database has MORE than the datamodel. Prisma
//                            never names it, so it is inert weight. Real, worth
//                            reporting, but it does not break the deploy.
//
// Anything else — altered columns, unparseable lines — is treated as dangerous.
// The safe default when a difference is not understood is to stop.
// ============================================================

// ============================================================
// THE ALLOW-LIST — a customs checkpoint, not a broom.
// ============================================================
// Each entry names ONE table and ONE narrow pattern, and carries a reason that
// says why the difference is not evidence of a wrong database shape. An entry
// that could swallow an unrelated change is rejected mechanically by
// migrationContract.test.js.
export const ALLOWED = [
  {
    id: 'decisions-partial-indexes',
    reason:
      'The migrations create these as PARTIAL indexes (WHERE resolution IS NOT NULL AND '
      + 'intentAt IS NOT NULL, and similar). Prisma @@index cannot express a WHERE predicate, '
      + 'so the datamodel declares them unconditionally and the diff reports the predicate-free '
      + 'form as missing. The indexes exist; their predicates do not fit the schema language.',
    table: 'decisions',
    pattern: /^\[\+\] Added index on columns \((verdict, resolution|workspaceId, humanExecutedAt|workspaceId, platformExecutedAt|workspaceId, verdict, rootCause, channel)\)$/,
  },
  {
    id: 'provider-performance-unique-index-name',
    reason:
      'The migration issues CREATE UNIQUE INDEX "provider_performance_metrics_publishedCreativeId_startD_idx". '
      + 'Uniqueness IS enforced; only the identifier differs from the "_key" name Prisma would generate, '
      + 'so the diff reports a rename rather than a missing constraint.',
    table: 'provider_performance_metrics',
    pattern: /^\[\*\] Renamed index `provider_performance_metrics_publishedCreativeId_startD_idx` to `provider_performance_metrics_publishedCreativeId_startDate__key`$/,
  },
  {
    id: 'client-managed-updatedat-default',
    reason:
      'The migrations give updatedAt a database-level DEFAULT now(); the datamodel marks it @updatedAt, '
      + 'which Prisma Client writes on every update and therefore does not declare as a DB default. '
      + 'The column is never read without the client setting it.',
    table: /^(decisions|execution_requests)$/,
    pattern: /^\[\*\] Altered column `updatedAt` \(default changed from `Some\(Now\)` to `None`\)$/,
  },
  {
    id: 'workspaces-adchannels-default',
    reason:
      'The migration gives adChannels a DB-level empty-list default; the datamodel leaves the default '
      + 'to Prisma Client. Same client-ownership shape as updatedAt above.',
    table: 'workspaces',
    pattern: /^\[\*\] Altered column `adChannels` \(default changed from `Some\(Value\(List\(\[\]\)\)\)` to `None`\)$/,
  },
  {
    id: 'workspace-fk-on-update-omitted',
    reason:
      'REAL, NOT COSMETIC — recorded deliberately. The migrations declare these FKs with ON DELETE '
      + 'CASCADE but omit ON UPDATE CASCADE, which the Prisma relation implies, so the diff drops and '
      + 're-adds the constraint. It is inert because workspaces.id is a UUID primary key that is never '
      + 'updated, so the ON UPDATE action can never fire. Allow-listed as known and inert, NOT as '
      + 'representational. If workspace ids ever become mutable this entry must be removed and the '
      + 'migrations corrected.',
    table: /^(audit_logs|users)$/,
    pattern: /^\[[-+]\] (Removed|Added) foreign key on columns \(workspaceId\)$/,
  },
];

/** PURE. `[*] Changed the \`x\` table` opens a block; indented lines are its changes. */
export function parseDiff(text) {
  const out = [];
  let table = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const header = /^\[[*+-]\] (?:Changed|Added|Removed) the `([^`]+)` (?:table|enum|view)/.exec(raw);
    if (header) {
      table = header[1];
      // A whole table added or removed is itself a difference, not just a header.
      if (!raw.startsWith('[*]')) out.push({ table, change: raw.trim(), raw });
      continue;
    }
    if (/^\s+\[/.test(raw)) {
      out.push({ table, change: raw.trim(), raw });
      continue;
    }
    out.push({ table: table ?? '(none)', change: raw.trim(), raw });
  }
  return out;
}

export const tableMatches = (spec, table) => (
  spec instanceof RegExp ? spec.test(table ?? '') : spec === table
);

/** PURE. Which allow-list entry, if any, covers this difference? */
export function classify(diffLine, allowed = ALLOWED) {
  return allowed.find(
    (a) => tableMatches(a.table, diffLine.table) && a.pattern.test(diffLine.change),
  ) ?? null;
}

/**
 * PURE. Which way does this difference cut?
 *
 *   'extra'   the database carries something the datamodel does not name.
 *   'missing' the datamodel needs something the database does not have — or the
 *             line could not be understood, which is treated the same way.
 */
export function severityOf(diffLine) {
  return String(diffLine.change ?? '').startsWith('[-]') ? 'extra' : 'missing';
}

/**
 * PURE. Split a raw `migrate diff` report into the three buckets a deployment
 * decision actually needs. `blocking` being empty is the condition for
 * continuing; `extra` is reported, never fatal (see DIRECTION MATTERS above).
 */
export function classifyDiff(rawText, allowed = ALLOWED) {
  const differences = parseDiff(rawText);
  const tolerated = [];
  const blocking = [];
  const extra = [];
  for (const d of differences) {
    const entry = classify(d, allowed);
    if (entry) { tolerated.push({ ...d, allowedBy: entry.id }); continue; }
    (severityOf(d) === 'extra' ? extra : blocking).push(d);
  }
  return { differences, tolerated, blocking, extra };
}
