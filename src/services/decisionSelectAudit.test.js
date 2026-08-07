// ============================================================
// Every Decision read names its fields
// ============================================================
// Adding `hypotheses` and `counterfactuals` to Decision widens every read that
// has no `select`: Prisma generates SELECT * from the model, so a query nobody
// touched starts asking for two columns it never wanted.
//
// TWO COSTS, and the second is the one that takes a service down:
//
//   BANDWIDTH — these are reasoning blobs. NarrativeService takes 100 rows,
//     feed.js takes 100, PatternService reads an unbounded lookback window.
//     None of them read either column.
//
//   THE MIGRATION-LAG 500 — render.yaml gives the WORKER service
//     `npm install && npx prisma generate` with NO `migrate deploy`; only the
//     web build migrates. A worker can boot on a client that knows a column the
//     database has not got yet, and its next SELECT * throws "column does not
//     exist". narrativeWorker imports generateNarrative, whose Decision read was
//     the widest of the six. This is the exact shape of #209.
//
// WHY A SOURCE SCAN RATHER THAN SIX MOCKED CALLS. The obvious test — call each
// service, inspect the query — passes VACUOUSLY wherever the service returns
// early: previewAllocation bails on `channels.length === 0`, so a fully mocked
// call issues no Decision query at all and an assertion looping over zero
// queries is green for the wrong reason. That is the failure mode this file
// exists to prevent, so it must not be built on it. Scanning the source asserts
// the property directly and covers reads that do not exist yet.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extract the argument object of every `prisma.decision.findMany|findFirst`
 * call in a source string, by brace-matching from the opening `({`.
 */
function decisionReads(source) {
  const out = [];
  const re = /(?:prisma|tx)\.decision\.(findMany|findFirst)\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = re.lastIndex - 1; // at the '{'
    let depth = 0;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ method: m[1], body: source.slice(start, i + 1) });
  }
  return out;
}

/** Every non-test .js under src/, walked without a glob dependency. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'tests' ? [] : walk(full);
    return e.isFile() && e.name.endsWith('.js') && !e.name.includes('.test.') ? [full] : [];
  });
}

const files = walk(SRC);

const reads = files.flatMap((file) =>
  decisionReads(readFileSync(file, 'utf8')).map((r) => ({
    ...r, file: path.relative(SRC, file).replace(/\\/g, '/'),
  })));

describe('the audit finds something to audit', () => {
  // A scan that matches nothing passes every assertion below. This is the guard
  // against the regex silently rotting when the call style changes.
  it('locates the Decision reads across the backend', () => {
    expect(reads.length).toBeGreaterThanOrEqual(10);
  });

  it('includes the worker-side narrative read', () => {
    expect(reads.some((r) => r.file === 'services/narrative-engine/NarrativeService.js')).toBe(true);
  });
});

describe('no Decision read may SELECT *', () => {
  it('every findMany/findFirst names its fields', () => {
    const unguarded = reads
      .filter((r) => !/\bselect:/.test(r.body))
      .map((r) => `${r.file} (${r.method})`);

    expect(unguarded, [
      'These reads have no `select`, so Prisma emits SELECT * and they widen',
      'with every column added to Decision — including the two reasoning JSONB',
      'columns they have no use for. Name the fields the consumer actually reads.',
    ].join('\n')).toEqual([]);
  });

  // `include` without `select` is SELECT * PLUS the relation — strictly worse
  // than a bare read, and what NarrativeService was doing in the worker.
  it('no read uses a bare `include` in place of `select`', () => {
    const bare = reads
      .filter((r) => /\binclude:/.test(r.body) && !/\bselect:/.test(r.body))
      .map((r) => r.file);

    expect(bare).toEqual([]);
  });
});

describe('the reasoning columns are storage, not a read dependency', () => {
  // Nothing reads them yet, and the moment something does it should be a
  // deliberate, reviewed change rather than a field that drifted into a select.
  it('no read asks for hypotheses or counterfactuals', () => {
    const asking = reads
      .filter((r) => /\b(hypotheses|counterfactuals)\s*:\s*true/.test(r.body))
      .map((r) => r.file);

    expect(asking).toEqual([]);
  });
});
