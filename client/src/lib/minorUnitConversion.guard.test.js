// ============================================================
// Minor-unit conversion — the standing guard
// ------------------------------------------------------------
// PARITY-01 removed a hardcoded /100 from the account aggregate, where it made
// two axes disagree tenfold on a 3-exponent currency. It fixed the site it
// found. Two surfaces it never swept — Attention's pacing widget and Growth's
// unit-economics form — still carried the same literal, and one of them was a
// WRITE. The class outlived its first cure because nothing was watching for it.
//
// This is that watch. `lib/money.ts` holds the ISO 4217 exponent table and the
// only two legitimate crossings of the minor/major boundary:
//
//   fromMinor(amountMinor, code)   minor → major
//   toMinor(amountMajor, code)     major → minor
//
// A literal 100 beside a `*Minor` identifier is, by construction, an assumption
// that every currency has two decimal places. KWD, BHD, OMR and JOD have three;
// JPY has none. So the guard is not a style rule — it is the exponent table
// asserting that nothing bypasses it.
//
// Scope note: only lines that mention a minor-unit value are examined. `* 100`
// on a ratio (grossMarginPct, a confidence, a percentage) is unrelated and
// deliberately untouched.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const CODE = /\.(js|jsx|ts|tsx)$/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (CODE.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

// A whole-line comment carries prose, not behaviour. `overviewDerive.js` quotes
// the loop PARITY-01 deleted, and that quotation must stay quotable.
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

const MINOR = /Minor/;
const LITERAL_100 = /[*/]\s*100\b/;

function violations(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (isComment(line)) return;
    if (MINOR.test(line) && LITERAL_100.test(line)) found.push({ line: i + 1, text: line.trim() });
  });
  return found;
}

describe('no client source converts minor units by a literal 100', () => {
  const files = sourceFiles(SRC);

  it('finds a non-trivial number of client sources to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every crossing goes through the currency exponent table', () => {
    const offenders = [];
    for (const file of files) {
      for (const v of violations(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(SRC.length + 1)}:${v.line}: ${v.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// A scanner that cannot find a planted violation proves nothing about an empty
// result. Each control names the exact way this instrument could lie.
describe('control — the scanner works', () => {
  it('catches a division', () => {
    expect(violations('const x = spendMinor / 100;')).toHaveLength(1);
  });

  it('catches a multiplication', () => {
    expect(violations('  aovMinor: Math.round(n * 100),')).toHaveLength(1);
  });

  it('catches it without whitespace', () => {
    expect(violations('const x = budgetMinor/100;')).toHaveLength(1);
  });

  it('ignores a ratio that has nothing to do with minor units', () => {
    expect(violations('const pct = Math.round(grossMarginPct * 100);')).toEqual([]);
  });

  it('ignores a canonical crossing', () => {
    expect(violations('const major = fromMinor(spendMinor, currency);')).toEqual([]);
  });

  it('ignores a comment quoting the deleted loop', () => {
    expect(violations('//     spend: live && sawSpend ? spendMinor / 100 : null')).toEqual([]);
    expect(violations(' * legacy: spendMinor / 100')).toEqual([]);
  });

  it('does not fire on 1000 or 10000', () => {
    expect(violations('const x = spendMinor / 1000;')).toEqual([]);
  });
});
