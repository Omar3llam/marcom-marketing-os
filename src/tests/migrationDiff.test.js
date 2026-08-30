// ============================================================
// migrate diff classification — the output shapes, pinned (B5-01Q)
// ============================================================
// Pure unit tests, no database, so they run in fast mode too. They exist
// because the behavioural tests could not have caught the defect below:
//
//   T1b runs the gate against an EMPTY database, but the gate runs
//   `migrate deploy` FIRST — so by the time it diffs, nothing is grouped.
//   T6/T6b inject a missing/extra COLUMN, which uses the per-object shape.
//
// Nothing exercised the GROUPED shape, and the grouped shape is what
// production actually produced on the first deploy after B5-01Q shipped.
// The raw text below is that output, verbatim.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseDiff, classifyDiff, severityOf, classify, isUnrecognised, ALLOWED,
} from '../../scripts/migrationDiff.js';

// ── PROVENANCE, stated exactly ──────────────────────────────────────────────
// The grouped block below — the header and all four table names — is VERBATIM
// from the failed Render build log. It is the part that broke.
//
// The per-object blocks after it are from a local migrations-built database and
// are a SUPERSET of what production reported: production's log showed 1 ×
// client-managed-updatedat-default (not 2), and neither the audit_logs/users FK
// pair nor the provider_performance index rename. Those absences mean
// production is CLOSER to the datamodel there, not further — none of them
// affect the classification under test.
//
// The four tables are legacy pre-Prisma state (scripts/migrate.js creates
// marcom_sessions). Inert to Prisma Client, which never names them — so:
// report, never block.
const PRODUCTION_DIFF = `[-] Removed tables
  - marcom_credentials
  - marcom_projects
  - marcom_sessions
  - marcom_user_context

[*] Changed the \`audit_logs\` table
  [-] Removed foreign key on columns (workspaceId)
  [+] Added foreign key on columns (workspaceId)

[*] Changed the \`decisions\` table
  [*] Altered column \`updatedAt\` (default changed from \`Some(Now)\` to \`None\`)
  [+] Added index on columns (verdict, resolution)
  [+] Added index on columns (workspaceId, humanExecutedAt)
  [+] Added index on columns (workspaceId, platformExecutedAt)
  [+] Added index on columns (workspaceId, verdict, rootCause, channel)

[*] Changed the \`workspaces\` table
  [*] Altered column \`adChannels\` (default changed from \`Some(Value(List([])))\` to \`None\`)`;

describe('B5-01Q · grouped diff output', () => {
  it('gives every grouped child its parent\'s sign', () => {
    const parsed = parseDiff(PRODUCTION_DIFF);
    const legacy = parsed.filter((d) => d.table.startsWith('marcom_'));

    expect(legacy.map((d) => d.table)).toEqual([
      'marcom_credentials', 'marcom_projects', 'marcom_sessions', 'marcom_user_context',
    ]);
    // The whole defect in one assertion: these lines carry no sign of their
    // own, and without the group they defaulted to "the datamodel requires it".
    for (const d of legacy) {
      expect(d.sign).toBe('-');
      expect(severityOf(d)).toBe('extra');
    }
  });

  it('does not stop a deploy over tables the database merely has spare', () => {
    const { blocking, extra } = classifyDiff(PRODUCTION_DIFF);

    expect(blocking, 'legacy tables must never block a deploy').toEqual([]);
    expect(extra.map((d) => d.table)).toEqual([
      'marcom_credentials', 'marcom_projects', 'marcom_sessions', 'marcom_user_context',
    ]);
  });

  it('still tolerates the five differences Prisma cannot express', () => {
    const { tolerated } = classifyDiff(PRODUCTION_DIFF);
    const ids = [...new Set(tolerated.map((d) => d.allowedBy))].sort();
    expect(ids).toEqual([
      'client-managed-updatedat-default',
      'decisions-partial-indexes',
      'workspace-fk-on-update-omitted',
      'workspaces-adchannels-default',
    ]);
  });

  it('the header itself is not counted as a difference', () => {
    // It named no object; its children are the differences. Reporting it too
    // produced the nonsense line "(none): [-] Removed tables".
    const parsed = parseDiff(PRODUCTION_DIFF);
    expect(parsed.filter((d) => /^\[.\] Removed tables$/.test(d.change))).toEqual([]);
    expect(parsed.every((d) => d.table !== '(none)')).toBe(true);
  });

  // ── the OTHER direction, which must still stop the deploy ───────────────
  it('a grouped ADD is dangerous — the datamodel needs what the database lacks', () => {
    const added = `[+] Added enums
  - UserRole
  - ExecutionStatus

[+] Added tables
  - decisions`;
    const { blocking, extra } = classifyDiff(added);
    expect(extra).toEqual([]);
    expect(blocking.map((d) => d.table)).toEqual(['UserRole', 'ExecutionStatus', 'decisions']);
    expect(blocking.every((d) => d.sign === '+')).toBe(true);
  });

  it('a per-object difference still classifies as it always did', () => {
    const { blocking, extra } = classifyDiff(`[*] Changed the \`decisions\` table
  [+] Added column \`rootCause\`

[*] Changed the \`workspaces\` table
  [-] Removed column \`__spare__\``);
    expect(blocking.map((d) => `${d.table}: ${d.change}`)).toEqual(['decisions: [+] Added column `rootCause`']);
    expect(extra.map((d) => d.table)).toEqual(['workspaces']);
  });

  it('an unparseable line is dangerous AND flagged as a parser gap', () => {
    // Fail-safe stays fail-safe — but it announces itself now, instead of
    // arriving as a confidently wrong table name.
    const [d] = parseDiff('something prisma has not printed before');
    expect(severityOf(d)).toBe('missing');
    expect(isUnrecognised(d)).toBe(true);
    expect(isUnrecognised(parseDiff(PRODUCTION_DIFF)[0])).toBe(false);
  });

  it('the allow-list cannot match a legacy table line', () => {
    // Guards against "fixing" a future false positive by widening an entry
    // until it swallows real drift.
    for (const t of ['marcom_sessions', 'decisions', 'workspaces']) {
      expect(classify({ table: t, change: '[+] Added table' }, ALLOWED)).toBeNull();
    }
  });
});
