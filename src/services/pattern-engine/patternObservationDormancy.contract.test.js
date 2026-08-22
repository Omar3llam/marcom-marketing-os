// ============================================================
// Backend Closure S1 — PatternObservation is DORMANT, and says so
// ============================================================
// The closure audit found `PatternObservation` written on every extraction and
// read by nothing. That is not a defect, and this file exists so it stops
// looking like one — an unclassified write-only table is indistinguishable from
// a reader somebody forgot to write, and the next person to find it has no way
// to tell which.
//
// WHAT IT IS
//   The per-occurrence audit trail behind a pattern: one row per occurrence,
//   carrying `predicted` / `actual` / `correct` / `observedAt`. Append-only and
//   idempotent by @@unique([patternId, occurrenceKey]).
//
// WHY NOTHING READS IT, AND WHY THAT IS NOT A DUPLICATE
//   `institutionalMemory` answers "was Lumi right about this pattern" from
//   `AccountPattern.accuracy` — a ROLLUP, persisted by the same extraction pass
//   that emits these rows, from the same in-memory `extractPatterns()` output.
//   So the question the schema comment names IS answered; it is answered at a
//   coarser grain, from a different column.
//
//   The two are therefore NOT interchangeable populations and must not be
//   merged: one is a scalar per pattern, the other is the evidence underneath
//   it. Deleting the writer would not remove a duplicate — it would remove the
//   only per-occurrence record of what Lumi predicted, which is the thing that
//   would let a future reader decay stale evidence by date rather than trusting
//   a rollup that cannot say when it was earned.
//
// WHAT THIS FILE ENFORCES
//   The classification, not the design. If someone adds the first production
//   reader, the third assertion fails — deliberately. That failure is not a
//   defect either: it means the surface has moved from DORMANT to LIVE and the
//   closure register has to be updated to match. The message says so.
//
// Source-level, comment-stripped: every file below documents this table by name
// in prose, so an un-stripped scan would match its own explanation.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

const production = (() => {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && !entry.includes('.test.')) out.push(full);
    }
  })(SRC);
  return out;
})();

const strip = (s) => s
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const rel = (f) => f.split(/[\\/]/).join('/').replace(/^.*\/src\//, 'src/');
const code = new Map(production.map((f) => [rel(f), strip(readFileSync(f, 'utf8'))]));

/** Files naming `prisma.patternObservation.<op>` / `tx.patternObservation.<op>`, by op class. */
function sites(opPattern) {
  const re = new RegExp(`(?:prisma|tx|db)\\.patternObservation\\.(${opPattern})\\(`);
  return [...code.entries()].filter(([, c]) => re.test(c)).map(([f]) => f).sort();
}

const WRITE_OPS = 'create|createMany|update|updateMany|upsert|delete|deleteMany';
const READ_OPS  = 'findFirst|findUnique|findMany|count|aggregate|groupBy';

describe('S1 · PatternObservation — the dormant classification', () => {
  it('has exactly ONE production writer, and it is the extraction pass', () => {
    // Two writers would mean two definitions of what an occurrence is, and the
    // @@unique dedup key cannot arbitrate between them — it would silently keep
    // whichever landed first.
    expect(sites(WRITE_OPS)).toEqual(['src/services/pattern-engine/PatternService.js']);
  });

  it('the writer is append-only and idempotent, never an upsert', () => {
    // `skipDuplicates` is the whole idempotency guarantee: re-observing the same
    // occurrence carries no new information, so it must not overwrite the
    // original reading with a later one taken under different conditions.
    const s = code.get('src/services/pattern-engine/PatternService.js');
    expect(s).toMatch(/patternObservation\.createMany\([^)]*skipDuplicates:\s*true/s);
    expect(s).not.toMatch(/patternObservation\.(upsert|update|delete)/);
  });

  it('has ZERO production readers — DORMANT, deliberately', () => {
    const readers = sites(READ_OPS);
    expect(
      readers,
      'PatternObservation gained a production reader. That is allowed — but it moves the '
      + 'surface from DORMANT to LIVE, and the closure register must be updated to match '
      + 'rather than this assertion relaxed. Reclassify, then change this test on purpose.',
    ).toEqual([]);
  });

  it('the question the rows exist for is answered from the ROLLUP, not from them', () => {
    // The distinction this pins: `institutionalMemory` says "was Lumi right"
    // using AccountPattern.accuracy. If it ever reads the observation rows
    // instead, the two populations have met and the assertion above is the one
    // that should have caught it.
    const memory = code.get('src/services/pattern-engine/institutionalMemory.js');
    expect(memory).toMatch(/prisma\.accountPattern\.findMany/);
    expect(memory).toMatch(/accuracy:\s*\{\s*not:\s*null\s*\}/);
    expect(memory).not.toMatch(/patternObservation/);
  });

  it('the rollup and the rows come from ONE extraction, so they cannot disagree', () => {
    // Both are projected from the same `patterns` array in the same function.
    // Two extractions would let a pattern's accuracy describe a different run
    // from the occurrences filed beneath it.
    const s = code.get('src/services/pattern-engine/PatternService.js');
    expect(s).toMatch(/const observationRows = patterns\.flatMap/);
    expect(s).toMatch(/accountPattern\.upsert/);
    expect(s).toMatch(/extractPatterns\(/);
  });
});
