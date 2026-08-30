// ============================================================
// Migration rollout-compatibility classifier (B5-01R⁗)
// ============================================================
// PURE. No database, no Prisma, no network, no credentials. Deterministic from
// repository bytes alone, so it runs inside `npm run arch-check` on any machine.
//
// ── WHAT THIS ANSWERS, AND WHAT IT DOES NOT ─────────────────────────────────
// It answers ONE question about a migration's SQL:
//
//     During a rolling deploy, where old and new application instances overlap,
//     can this schema change break one of them?
//
// It does NOT know whether application code handles a schema correctly. It
// classifies the OPERATION, never the program. COMPATIBLE means "this operation
// does not, by itself, break an instance running the other version" — never
// "this deploy is safe". That limit is deliberate and permanent (B5-01R⁗ STOP-3).
//
// ── THE LANGUAGE IS DERIVED, NOT INVENTED ───────────────────────────────────
// Every pattern below came out of this repository's own 66 migrations. Two
// properties of that corpus shaped the design:
//
//   1. 23 migrations wrap their DDL in `DO $$ … $$` blocks with existence
//      guards, because they are written to be re-runnable. A classifier that
//      treated DO bodies as opaque would miss real DDL — including the most
//      destructive operation in the whole corpus, the `ai_insight` → `aiInsight`
//      RENAME in r12_1d, which lives inside one.
//
//   2. plpgsql control flow puts semicolons inside those blocks, so splitting on
//      `;` shreds them. Statement splitting was tried first and produced 51
//      bogus fragments. This walks DDL VERBS instead: it cannot miss an
//      operation by mis-splitting, which is the failure mode that matters.
//
// ── WHY THE PATTERNS ARE ANCHORED AT THEIR VERB ─────────────────────────────
// Coverage has to be provable, not asserted. Every CREATE/ALTER/DROP/… in the
// file must match exactly one pattern STARTING AT THAT VERB. So "which
// operations does this migration perform" and "is there SQL I do not
// understand" are the same pass, with no gap between them for new syntax to
// slip through. An unmatched verb is UNKNOWN, and UNKNOWN is never COMPATIBLE.
// ============================================================

/** Strip comments, keep dollar-quoted bodies verbatim, blank single-quoted
 *  literals so a keyword inside a string cannot be read as SQL. */
export function normalise(sql) {
  let out = '';
  let i = 0;
  let tag = null;
  const s = String(sql ?? '');
  while (i < s.length) {
    if (tag) {                                     // inside $$ … $$
      if (s.startsWith(tag, i)) { out += tag; i += tag.length; tag = null; continue; }
      if (s[i] === "'") {                          // plpgsql literal — blank it too
        let j = i + 1;
        while (j < s.length && !(s[j] === "'" && s[j - 1] !== '\\')) j += 1;
        out += `'${' '.repeat(Math.max(0, j - i - 1))}'`;
        i = j + 1; continue;
      }
      if (s.startsWith('--', i)) { while (i < s.length && s[i] !== '\n') i += 1; out += ' '; continue; }
      out += s[i]; i += 1; continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(s.slice(i));
    if (dollar) { tag = dollar[0]; out += tag; i += tag.length; continue; }
    if (s[i] === "'") {
      // Blanked EVERYWHERE, including inside $$ blocks. Without this, RAISE
      // message text and format() templates read as SQL — measured: 6 phantom
      // "unknown operations" from prose like 'alter, drop or extend it'.
      // Genuine dynamic DDL is caught by its EXECUTE, not by its template.
      let j = i + 1;
      while (j < s.length && !(s[j] === "'" && s[j - 1] !== '\\')) j += 1;
      out += `'${' '.repeat(Math.max(0, j - i - 1))}'`;
      i = j + 1; continue;
    }
    if (s.startsWith('--', i)) { while (i < s.length && s[i] !== '\n') i += 1; out += ' '; continue; }
    if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
    out += s[i]; i += 1;
  }
  return out.replace(/\s+/g, ' ');
}

export const COMPATIBLE = 'COMPATIBLE';
export const TRANSITION_REQUIRED = 'TRANSITION_REQUIRED';
export const INCOMPATIBLE = 'INCOMPATIBLE';
export const UNKNOWN = 'UNKNOWN';

const RANK = {
  [COMPATIBLE]: 0, [TRANSITION_REQUIRED]: 1, [INCOMPATIBLE]: 2, [UNKNOWN]: 3,
};

/** Verbs that open a statement this classifier must account for. */
const DDL_VERB = /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|UPDATE|DELETE|INSERT)\b/gi;

/**
 * Is this verb occurrence the START of a statement, or a clause inside one?
 *
 * The distinction is not cosmetic — without it the corpus produced 119 phantom
 * unknowns from `ON DELETE CASCADE ON UPDATE CASCADE` (referential actions, not
 * statements) and ~14 more from continuation clauses like the `ALTER` of
 * `ALTER TABLE … ALTER COLUMN …`, whose parent statement was already matched.
 *
 * A statement starts at the beginning of the file, after `;`, or after the
 * plpgsql keywords that open a body.
 */
function isStatementStart(text, index) {
  const before = text.slice(Math.max(0, index - 40), index);
  return /(?:^|;|\bTHEN\b|\bELSE\b|\bBEGIN\b|\bLOOP\b|\$\$|\bDO\b)\s*$/i.test(before);
}

/** Dynamic DDL — real schema change, but its target is a runtime string. */
const DYNAMIC_DDL = /\bEXECUTE\s+(?:format\s*\(|'|\w+\s*\|\|)/i;

export const OPERATIONS = [
  // ── INCOMPATIBLE — one side loses something it still names ───────────────
  {
    id: 'drop-column',
    cls: INCOMPATIBLE,
    why: 'Prisma selects every declared column, so an old instance 500s on every read of that model',
    re: /^ALTER\s+TABLE\b[^;]*?\bDROP\s+COLUMN\b/i,
  },
  {
    id: 'rename-column',
    cls: INCOMPATIBLE,
    why: 'the old name vanishes for one side and the new name does not exist for the other',
    re: /^ALTER\s+TABLE\b[^;]*?\bRENAME\s+COLUMN\b/i,
  },
  {
    id: 'rename-table',
    cls: INCOMPATIBLE,
    why: 'a drop, as far as whichever side still holds the other name is concerned',
    re: /^ALTER\s+TABLE\b[^;]*?\bRENAME\s+TO\b/i,
  },
  {
    id: 'alter-column-type',
    cls: INCOMPATIBLE,
    why: 'the two versions disagree about the column type for the length of the overlap',
    re: /^ALTER\s+TABLE\b[^;]*?\bALTER\s+COLUMN\b[^;]*?\b(?:SET\s+DATA\s+)?TYPE\b/i,
  },
  {
    id: 'rename-type',
    cls: INCOMPATIBLE,
    why: 'as rename-table, for an enum type',
    re: /^ALTER\s+TYPE\b[^;]*?\bRENAME\b/i,
  },
  {
    id: 'drop-table',
    cls: INCOMPATIBLE,
    why: 'an instance still reading the table gets a missing-relation error',
    re: /^DROP\s+TABLE\b/i,
  },
  {
    id: 'drop-type',
    cls: INCOMPATIBLE,
    why: 'an enum type an overlapping instance still writes',
    re: /^DROP\s+TYPE\b/i,
  },

  // ── TRANSITION_REQUIRED — safe, but not in one unphased step ─────────────
  {
    id: 'set-not-null',
    cls: TRANSITION_REQUIRED,
    why: 'an old instance still writing NULL is rejected; backfill and deploy the writer first',
    re: /^ALTER\s+TABLE\b[^;]*?\bALTER\s+COLUMN\b[^;]*?\bSET\s+NOT\s+NULL\b/i,
  },
  {
    id: 'add-constraint-restrictive',
    cls: TRANSITION_REQUIRED,
    why: 'an old instance can still write rows the new rule rejects',
    re: /^ALTER\s+TABLE\b[^;]*?\bADD\s+CONSTRAINT\b[^;]*?\b(?:UNIQUE|CHECK|FOREIGN\s+KEY)\b/i,
  },
  {
    id: 'drop-constraint',
    cls: TRANSITION_REQUIRED,
    why: 'relaxes a guarantee the other side may rely on — a Prisma upsert needs its unique index',
    re: /^ALTER\s+TABLE\b[^;]*?\bDROP\s+CONSTRAINT\b/i,
  },
  {
    id: 'backfill',
    cls: TRANSITION_REQUIRED,
    why: 'a data rewrite races instances still writing the old shape',
    re: /^UPDATE\s+"?[A-Za-z_]\w*"?\s+SET\b/i,
  },

  // ── COMPATIBLE — additive, or invisible to the other version ─────────────
  {
    id: 'alter-column-default',
    cls: COMPATIBLE,
    why: 'defaults bind at write time only',
    re: /^ALTER\s+TABLE\b[^;]*?\bALTER\s+COLUMN\b[^;]*?\b(?:SET|DROP)\s+DEFAULT\b/i,
  },
  {
    id: 'drop-not-null',
    cls: COMPATIBLE,
    why: 'relaxes; nothing that wrote before stops working',
    re: /^ALTER\s+TABLE\b[^;]*?\bALTER\s+COLUMN\b[^;]*?\bDROP\s+NOT\s+NULL\b/i,
  },
  {
    // Sub-checked below: NOT NULL with no DEFAULT is escalated to
    // TRANSITION_REQUIRED. MEASURED (B5-01R″ F4): an old instance INSERT then
    // fails with P2011, so the feature is dead until the code catches up.
    id: 'add-column',
    cls: COMPATIBLE,
    why: 'nullable or defaulted — MEASURED safe for an old instance (B5-01R″ F2a/F2b)',
    re: /^ALTER\s+TABLE\b[^;]*?\bADD\s+COLUMN\b/i,
  },
  {
    id: 'add-enum-value',
    cls: COMPATIBLE,
    why: 'additive; an old instance simply never produces the new value',
    re: /^ALTER\s+TYPE\b[^;]*?\bADD\s+VALUE\b/i,
  },
  { id: 'create-table', cls: COMPATIBLE, why: 'neither side reads a table that did not exist', re: /^CREATE\s+TABLE\b/i },
  { id: 'create-index', cls: COMPATIBLE, why: 'affects query plans, never correctness', re: /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i },
  { id: 'drop-index', cls: COMPATIBLE, why: 'affects query plans, never correctness', re: /^DROP\s+INDEX\b/i },
  { id: 'create-type', cls: COMPATIBLE, why: 'a new enum nothing yet writes', re: /^CREATE\s+TYPE\b/i },
  { id: 'create-extension', cls: COMPATIBLE, why: 'additive', re: /^CREATE\s+EXTENSION\b/i },
  { id: 'create-function', cls: COMPATIBLE, why: 'additive; bodies are resolved at call time', re: /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i },
  { id: 'create-trigger', cls: COMPATIBLE, why: 'additive', re: /^CREATE\s+TRIGGER\b/i },
  { id: 'drop-trigger', cls: COMPATIBLE, why: 'removes behaviour no Prisma query names', re: /^DROP\s+TRIGGER\b/i },
  { id: 'comment-on', cls: COMPATIBLE, why: 'metadata only', re: /^COMMENT\s+ON\b/i },
  {
    // The corpus's re-runnability idiom: `IF NOT EXISTS (SELECT 1 FROM
    // pg_constraint WHERE conname = …)`. These read the catalogue; the DDL they
    // guard is matched separately on its own verb.
    id: 'catalogue-guard',
    cls: COMPATIBLE,
    why: 'an existence check inside a DO block, not a schema change',
    re: /^(?:CREATE|ALTER|DROP)\b(?=[^;]{0,200}?\bpg_(?:constraint|indexes|index|type|class|attribute|tables)\b)/i,
  },
];

/** PURE. Tables this migration creates itself — nothing old writes them. */
export function tablesCreatedIn(text) {
  return new Set(
    [...text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_]\w*)"?/gi)]
      .map((m) => m[1].toLowerCase()),
  );
}

/** PURE. The table an `ALTER TABLE …` statement targets. */
export function alterTarget(statement) {
  const m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?([A-Za-z_]\w*)"?/i.exec(String(statement ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** PURE. Does this ADD COLUMN demand a value an old instance will not supply? */
export function isRequiredColumnAddition(statement) {
  const s = String(statement ?? '');
  if (!/\bADD\s+COLUMN\b/i.test(s)) return false;
  // Cut to the added column's own definition — the clause ends at a comma that
  // separates further ADDs, or the statement end.
  const after = s.slice(s.search(/\bADD\s+COLUMN\b/i));
  const clause = after.split(/,\s*(?=ADD\b)/i)[0];
  return /\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause);
}

/**
 * Classify one migration's SQL.
 * @returns {{verdict:string, operations:Array, unknown:string[]}}
 */
export function classifyMigrationSql(sql) {
  const text = normalise(sql);
  const created = tablesCreatedIn(text);
  const operations = [];
  const unknown = [];

  // Dynamic DDL is a real schema change whose target only exists at runtime.
  // It CANNOT be classified from repository bytes, and saying so is the honest
  // answer — UNKNOWN fails closed, which is exactly right for SQL nobody can
  // read ahead of time. Two migrations in this corpus do this deliberately
  // (enum reconciliation, index-name reconciliation).
  if (DYNAMIC_DDL.test(text)) {
    unknown.push('dynamic DDL: EXECUTE with a runtime-built statement');
  }

  DDL_VERB.lastIndex = 0;
  let m;
  while ((m = DDL_VERB.exec(text)) !== null) {
    if (!isStatementStart(text, m.index)) continue;
    const stmt = text.slice(m.index, m.index + 400).split(';')[0];
    const hit = OPERATIONS.find((op) => op.re.test(stmt));
    if (!hit) { unknown.push(stmt.slice(0, 110).trim()); continue; }

    // A constraint on a table THIS migration creates cannot reject anything an
    // old instance does — that instance does not know the table exists. Without
    // this the corpus reads 29 TRANSITION_REQUIRED instead of 8, because almost
    // every new table gets its foreign keys in a following ALTER.
    if ((hit.id === 'add-constraint-restrictive' || hit.id === 'drop-constraint')
        && created.has(alterTarget(stmt))) {
      operations.push({
        id: `${hit.id}-on-new-table`,
        cls: COMPATIBLE,
        why: 'the table is created by this same migration, so no older instance can write to it',
      });
      continue;
    }

    // T6's rule lives here too: a single operation can be escalated by its own
    // detail, not only by a sibling statement.
    if (hit.id === 'add-column' && isRequiredColumnAddition(stmt)) {
      operations.push({
        id: 'add-column-not-null-no-default',
        cls: TRANSITION_REQUIRED,
        why: 'MEASURED (B5-01R″ F4): an old instance INSERT fails with P2011. '
          + 'Add nullable, backfill, enforce NOT NULL in a later migration.',
      });
      continue;
    }
    operations.push({ id: hit.id, cls: hit.cls, why: hit.why });
  }

  // Most restrictive wins (T6). A safe statement never dilutes a dangerous one.
  let verdict = COMPATIBLE;
  for (const o of operations) if (RANK[o.cls] > RANK[verdict]) verdict = o.cls;
  if (unknown.length) verdict = UNKNOWN;

  return { verdict, operations, unknown };
}

// ============================================================
// The contract
// ============================================================
// Scanning is separated from verdict-keeping so the classifier stays pure and
// the I/O lives in one place. `prisma/migrations` remains the only source of
// truth (I4) — nothing here maintains a second registry of what exists; the
// baseline records only a VERDICT for names the directory already lists.

/** Production migration directories, and nothing else (T7). */
export function migrationDirs(fs, dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{14}_[a-z0-9_]+$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** Classify every production migration. `fs` is injected so tests stay pure. */
export function scanMigrations(fs, path, dir) {
  return migrationDirs(fs, dir).map((name) => {
    const file = path.join(dir, name, 'migration.sql');
    if (!fs.existsSync(file)) {
      return { name, verdict: UNKNOWN, operations: [], unknown: ['no migration.sql'] };
    }
    return { name, ...classifyMigrationSql(fs.readFileSync(file, 'utf8')) };
  });
}

/**
 * The ratchet.
 *
 * Any migration that is not COMPATIBLE must be listed in the baseline with a
 * matching verdict and a written reason. That is the escape hatch, and it is
 * deliberately the only one: it lives in a checked-in file, it names one
 * migration at a time, and it shows up in a diff (I3). There is no
 * catch-and-continue anywhere in this path.
 *
 * The baseline is also kept honest in the other direction — an entry for a
 * migration that no longer exists, or that now classifies COMPATIBLE, is a
 * failure too. A list of exemptions nobody prunes stops being a list of
 * exemptions and becomes a place regressions hide.
 */
export function verifyAgainstBaseline(scan, baseline) {
  const declared = new Map(Object.entries(baseline ?? {}));
  const undeclared = [];
  const mismatched = [];
  const stale = [];
  const unreasoned = [];

  for (const m of scan) {
    const entry = declared.get(m.name);
    if (m.verdict === COMPATIBLE) {
      if (entry) stale.push(`${m.name}: now COMPATIBLE — remove it from the baseline`);
      continue;
    }
    if (!entry) { undeclared.push(m); continue; }
    if (entry.verdict !== m.verdict) {
      mismatched.push(`${m.name}: baseline says ${entry.verdict}, classifier says ${m.verdict}`);
    }
    if (!entry.reason || String(entry.reason).trim().length < 20) {
      unreasoned.push(`${m.name}: baseline entry needs a reason that explains WHY, not just a verdict`);
    }
  }

  const names = new Set(scan.map((m) => m.name));
  for (const name of declared.keys()) {
    if (!names.has(name)) stale.push(`${name}: no such migration — remove it from the baseline`);
  }

  return {
    ok: !undeclared.length && !mismatched.length && !stale.length && !unreasoned.length,
    undeclared,
    mismatched,
    stale,
    unreasoned,
  };
}

/** Human-readable counts, for the check's own output. */
export function summarise(scan) {
  const t = {
    [COMPATIBLE]: 0, [TRANSITION_REQUIRED]: 0, [INCOMPATIBLE]: 0, [UNKNOWN]: 0,
  };
  for (const m of scan) t[m.verdict] += 1;
  return t;
}
