// ============================================================
// gatingReasonInventory — the C-07 ratchet (tests 2, 5, 6)
// ============================================================
// C-06's ratchet guards a declared jurisdiction of status VOCABULARIES. This one
// guards a declared jurisdiction of PRODUCERS: the modules allowed to put a row
// into `gatedOut`. The two are deliberately separate registries, because a
// reason and an epistemic status are separate vocabularies — see the inventory.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATING_REASON_VALUES } from '@marcom/runtime-contracts';
import { GATING_PRODUCERS, REASON_SITE_RE } from './gatingReasonInventory.js';
import { EXCLUDED } from '../vocabulary/epistemicInventory.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (!entry.endsWith('.js') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

/** Code only: block comments and line comments carry `reason:` in prose. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('C-07 · every reason a producer emits is a declared one', () => {
  it('names producers that exist', () => {
    expect(GATING_PRODUCERS.length).toBeGreaterThan(0);
    for (const rel of GATING_PRODUCERS) expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
  });

  it('emits a GATING_REASON member at every reason site — never a string literal', () => {
    // THE DEFECT, STATED AS A RULE. One of the three reasons shipped for years
    // as the English sentence 'no measured revenue or engagement': a display
    // string on a domain wire, which no consumer could branch on, so the client
    // substituted a sentence of its own — and got it wrong for the other two.
    const offenders = [];
    let sites = 0;
    for (const rel of GATING_PRODUCERS) {
      const src = stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8'));
      for (const m of src.matchAll(REASON_SITE_RE)) {
        sites += 1;
        const rhs = m[1].trim();
        const member = /^GATING_REASON\.([A-Z][A-Z0-9_]*)$/.exec(rhs);
        if (!member || !GATING_REASON_VALUES.includes(member[1])) offenders.push(`${rel}: reason: ${rhs}`);
      }
    }
    // A scanner that matches nothing proves nothing.
    expect(sites).toBeGreaterThanOrEqual(3);
    expect(offenders, [
      'A gatedOut producer emits a reason that is not a declared GATING_REASON member.',
      'Declare it in packages/runtime-contracts/src/gatingReason.js — with its',
      'knowledge token AND the prerequisite it waits on — then reference it as',
      'GATING_REASON.<NAME>. A reason with no prerequisite is a label, and the',
      'client will invent an instruction to fill the gap.',
    ].join('\n')).toEqual([]);
  });

  it('has no producer outside the declared jurisdiction', () => {
    // The other direction: a fourth gate added in a module nobody ruled on.
    const declared = new Set(GATING_PRODUCERS);
    const rogue = sourceFiles(join(REPO_ROOT, 'src'))
      .filter((f) => /gatedOut\.push\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(REPO_ROOT, f).split(sep).join('/'))
      .filter((rel) => !declared.has(rel));
    expect(rogue).toEqual([]);
  });
});

describe('C-07 · the two vocabularies stay separate', () => {
  it('C-06 still EXCLUDES the reason vocabulary from the epistemic registry', () => {
    // GATING_REASON ends in _REASON, so it falls inside C-06's jurisdiction and
    // must be ruled on there. The ruling is EXCLUDED: a reason refines an
    // already-classified absence, and declaring it in both registries would let
    // one claim carry two knowledge tokens. Its own registry is C-07's.
    const entry = EXCLUDED.find((e) => e.symbol === 'GATING_REASON');
    expect(entry, 'GATING_REASON is unmentioned in the C-06 inventory').toBeTruthy();
    expect(entry.because.length).toBeGreaterThan(40);
    expect(entry.at).toBe('packages/runtime-contracts/src/gatingReason.js');
  });
});
