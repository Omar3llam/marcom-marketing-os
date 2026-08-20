// ============================================================
// Naming reconciliation — the names may not drift back
// ============================================================
// Every defect this slice corrected was invisible to the test suite, because
// each one lived in a name or a description rather than in behaviour. The
// intervention union had three implementations that agreed today; `isExecuted`
// meant the union while the loop's EXECUTE stage meant platform-only; a JSDoc
// declared an input the code stopped reading two slices ago. Nothing was red.
//
// So these are REPOSITORY-level properties, checked over source. A test that
// imported one module could not see a second copy reintroduced somewhere else,
// which is exactly how the copies got there.
//
// COMMENTS ARE STRIPPED FIRST. Every one of these facts is explained at length
// in the files it governs — decisionProvenance names the deprecated alias,
// decisionLearning explains what intentAt is not — and a raw scan would score
// the explanation as the violation. The rule is about what the code DOES.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

/** Every .js file under src/, excluding tests. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (!entry.endsWith('.js')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

const FILES = sourceFiles();

const code = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/^\s*\/\/.*$/gm, '');      // whole-line comments

const rel = (f) => f.replace(process.cwd(), '').replace(/\\/g, '/');

/** Files whose CODE (never comments) matches, as repo-relative POSIX paths. */
const filesWhereCode = (re) => FILES.filter((f) => re.test(code(f))).map(rel).sort();

// ── intentAt is engagement, and nothing reads it ────────────────────────────
describe('intentAt may not become action evidence again', () => {
  it('has exactly one production site: the route that writes it', () => {
    // C1 removed the single reader — decisionLearning gated its population on
    // this column and rendered "improved after action" over it. Copying a
    // recommendation is not changing a campaign, and the distance between the
    // two is however long the operator took to not act.
    //
    // Asserted as an exact set rather than "not in decisionLearning": the next
    // reader will not necessarily be that one, and a predicate naming its own
    // exception can only catch the mistake it already knows about.
    expect(filesWhereCode(/\bintentAt\b/)).toEqual(['/src/routes/lumi/decisions.js']);
  });

  it('the writer names it exactly once, as a stamp literal', () => {
    const src = code(resolve(SRC, 'routes/lumi/decisions.js'));
    expect(src).toMatch(/stampOnce\(req, res, 'intentAt'\)/);
    // Once, so it cannot also appear in a select, a where, or a response body
    // in this file. That an intent click writes NO execution timestamp is
    // proven behaviourally by T1c in routes/execution/provenance.contract.test.js;
    // this is the structural half.
    expect((src.match(/\bintentAt\b/g) ?? []).length).toBe(1);
  });
});

// ── the deprecated column, and who may still say its name ───────────────────
describe('legacy Decision.executedAt stays a compatibility projection', () => {
  // The distinction NC6 turns on: publishing a derived `executedAt` to clients
  // shipped before the split is ALLOWED and deliberate. Reading it as evidence
  // — in an engine, a gate, a population, an index — is not, because the field
  // cannot say which kind of execution it recorded.
  // The three wire projections that still publish it — and only they.
  // decisionProvenance is NOT on this list: `legacyExecutedAt` is built from the
  // two split columns and never names the bare one, which is the point of it.
  const ALLOWED = [
    '/src/routes/lumi/decisions.js',
    '/src/routes/lumi/executions.js',
    '/src/services/decision-memory/decisionHistory.js',
  ].sort();

  it('is named in code by the projection seams only', () => {
    // `executedAt` on its own — not humanExecutedAt, not platformExecutedAt,
    // not legacyExecutedAt, not succeededAt. A word boundary is not enough:
    // JavaScript property access makes `d.humanExecutedAt` contain the string.
    const bare = /(?<![A-Za-z])(?<!human)(?<!platform)(?<!legacy)executedAt\b/;
    expect(filesWhereCode(bare)).toEqual(ALLOWED);
  });

  it('no canonical consumer reads the stored column', () => {
    // Where a canonical read would have to appear if one were introduced.
    const CANONICAL = [
      'services/decision-accuracy', 'services/pattern-engine', 'services/analysis',
      'services/agentic-loop', 'services/verdict-engine', 'services/execution',
      'workers',
    ];
    const offenders = FILES
      .filter((f) => CANONICAL.some((d) => rel(f).includes(`/src/${d}/`)))
      .filter((f) => /(?<![A-Za-z])(?<!human)(?<!platform)(?<!legacy)executedAt\b/.test(code(f)))
      .map(rel);
    // Empty, and it stays empty. decisionProvenance builds the deprecated alias
    // out of the two split columns without naming the bare one at all.
    expect(offenders).toEqual([]);
  });

  it('the two wire aliases both declare themselves deprecated', () => {
    // They derive DIFFERENTLY — decisions.js always returns the human instant it
    // just wrote, executions.js returns platform ?? human — so a reader who
    // assumed one canonical fact would be wrong about at least one endpoint.
    for (const f of ['routes/lumi/decisions.js', 'routes/lumi/executions.js']) {
      const raw = readFileSync(resolve(SRC, f), 'utf8');
      expect(raw, `${f} must mark its executedAt alias deprecated`)
        .toMatch(/DEPRECATED COMPATIBILITY FIELD/);
    }
  });
});

// ── one definition of "somebody intervened" ─────────────────────────────────
describe('the intervention union has exactly one implementation', () => {
  it('no file spells the union out inline', () => {
    // Three copies existed and agreed. Agreement is the dangerous state: it is
    // what makes the fourth copy look harmless and the first divergence silent.
    // The canonical module is the one place the words may appear.
    expect(filesWhereCode(/humanExecutedAt:\s*\{\s*not:\s*null\s*\}/))
      .toEqual(['/src/services/execution/decisionProvenance.js']);

  });

  it('the canonical seam is the only definition, and consumers spread it', () => {
    const provenance = code(resolve(SRC, 'services/execution/decisionProvenance.js'));
    expect(provenance).toMatch(/export const INTERVENED_WHERE/);

    const consumers = filesWhereCode(/\.\.\.INTERVENED_WHERE|INTERVENED_WHERE\.OR/);
    expect(consumers).toEqual([
      '/src/services/analysis/decisionLearning.js',
      '/src/services/decision-accuracy/DecisionAccuracyService.js',
      '/src/services/pattern-engine/PatternService.js',
    ]);
  });
});

// ── "executed" may not mean two things ──────────────────────────────────────
describe('the union is not published under an execution name', () => {
  it('isExecuted is gone from production code', () => {
    // It returned the union while reading as platform execution — and the
    // agentic loop's EXECUTE stage means platform-only, deliberately. Two
    // subsystems, one English word, opposite answers.
    expect(filesWhereCode(/\bisExecuted\b/)).toEqual([]);
  });

  it('the accuracy helpers expose the canonical predicate under its own name', () => {
    const src = code(resolve(SRC, 'services/decision-accuracy/decisionAccuracyHelpers.js'));
    expect(src).toMatch(/export \{ wasActedOn \}/);
    // Re-exported, not redefined: a second definition here is a second place the
    // rule could be tightened in only one of them.
    expect(src).not.toMatch(/const wasActedOn\s*=/);
  });
});

// ── derived accuracy status is not the stored status ────────────────────────
describe('accuracyStatus does not masquerade as Decision.status', () => {
  it('the seam emits accuracyStatus and the engine reads it', () => {
    const service = code(resolve(SRC, 'services/decision-accuracy/DecisionAccuracyService.js'));
    const engine = code(resolve(SRC, 'services/decision-accuracy/decisionAccuracyEngine.js'));

    expect(service).toMatch(/accuracyStatus:\s*deriveAccuracyStatus\(d\)/);
    expect(service).not.toMatch(/\bstatus:\s*deriveAccuracyStatus/);

    expect(engine).toMatch(/d\.accuracyStatus/);
    // The engine's own OUTPUT has a `status` (LIFT_STATUS) which is a third,
    // unrelated fact — so the check is that no INPUT decision is read as
    // `d.status`, not that the word is absent.
    expect(engine).not.toMatch(/\bd\.status\b/);
  });

  it('the derived value never reaches the database', () => {
    // Decision.status stays PROPOSED after a human signal, on purpose: four
    // readers gate on it. deriveAccuracyStatus is a VIEW, and a writer would
    // turn it into a second source of truth.
    expect(filesWhereCode(/data:\s*\{[^}]*deriveAccuracyStatus/)).toEqual([]);
  });
});

// ── the audit enum collision ────────────────────────────────────────────────
describe('the audit write uses the audit vocabulary', () => {
  it('never writes an execution-lifecycle word to AuditLog.status', () => {
    // AuditLog.status is Prisma's `ExecutionStatus` — PENDING | SUCCESS |
    // FAILED | … — and the execution lifecycle exports a DIFFERENT enum under
    // the same identifier. Writing 'QUEUED' here was rejected by Prisma on every
    // successful enqueue, swallowed by a `.catch`, and left the audit log with
    // no row at all for the path that matters most.
    const src = code(resolve(SRC, 'routes/execution/meta.js'));
    const auditWrites = [...src.matchAll(/auditLog\.create\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
    expect(auditWrites.length).toBeGreaterThan(0);

    const AUDIT_ENUM = ['PENDING', 'SUCCESS', 'FAILED', 'PAUSED_FOR_APPROVAL', 'RESUMING', 'RESUMED'];
    for (const block of auditWrites) {
      const status = block.match(/status:\s*'([A-Z_]+)'/)?.[1];
      expect(AUDIT_ENUM, `audit write used status '${status}'`).toContain(status);
    }
  });
});
