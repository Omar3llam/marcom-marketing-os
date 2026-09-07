// ============================================================
// FE-01 — the token-resolution checker's own parsing, pinned
// ------------------------------------------------------------
// This instrument exists to catch a class of silent defect, so its own silent
// defects matter more than usual. Both bugs below were real, both were found
// while building it, and both produced output that looked like a catastrophic
// finding about the codebase rather than a bug in the tool:
//
//   1. 130 false positives on `text-xs`, because minified CSS runs declarations
//      together and a decimal value is a false start for a selector match.
//   2. 4 phantom classes like `true]:bg-lumi-gold/5`, because an arbitrary
//      VARIANT (`data-[active=true]:`) was split at the `=`.
//
// A checker that cries wolf gets switched off, so these are ratchets.
// ============================================================
import { describe, it, expect } from 'vitest';
import { selectorsInCss, colourClassesIn } from './checkTokenResolution.js';

describe('selectorsInCss — reading what the stylesheet defines', () => {
  it('finds plain class selectors', () => {
    const s = selectorsInCss('.bg-lumi-surface{color:red}.text-lumi-muted{color:blue}');
    expect(s.has('bg-lumi-surface')).toBe(true);
    expect(s.has('text-lumi-muted')).toBe(true);
  });

  it('a decimal value does not swallow the selector that follows it', () => {
    // THE BUG: `.` and `}` were not terminators, so the match starting at the
    // `.` of `.01em` ran on through `}` and consumed `.text-xs` with it —
    // producing one selector named `01em}.text-xs` and reporting the real class
    // as undefined at all 130 of its call sites.
    const css = '.text-xl{letter-spacing:-.01em}.text-xs{font-size:11px}';
    const s = selectorsInCss(css);
    expect(s.has('text-xs')).toBe(true);
    expect(s.has('text-xl')).toBe(true);
  });

  it('unescapes arbitrary values and opacity modifiers', () => {
    const s = selectorsInCss(String.raw`.text-\[10px\]{a:b}.bg-lumi-accent\/10{c:d}`);
    expect(s.has('text-[10px]')).toBe(true);
    expect(s.has('bg-lumi-accent/10')).toBe(true);
  });

  it('a variant selector keeps its variant', () => {
    const s = selectorsInCss(String.raw`.hover\:bg-lumi-gold:hover{a:b}`);
    expect(s.has('hover:bg-lumi-gold')).toBe(true);
  });
});

describe('colourClassesIn — reading what the source claims', () => {
  it('finds colour utilities and ignores everything else', () => {
    const found = [...colourClassesIn('<p className="text-lumi-muted p-4 flex" />').keys()];
    expect(found).toContain('text-lumi-muted');
    expect(found).not.toContain('p-4');
    expect(found).not.toContain('flex');
  });

  it('keeps variants and opacity attached', () => {
    const found = [...colourClassesIn('<a className="hover:bg-lumi-gold/10" />').keys()];
    expect(found).toEqual(['hover:bg-lumi-gold/10']);
  });

  it('an arbitrary variant is not split into a phantom class', () => {
    // THE BUG: `=` was not a class character, so `data-[active=true]:bg-lumi-gold/5`
    // was cut in two and the tail `true]:bg-lumi-gold/5` was reported as an
    // undefined class. It is not a class at all.
    const found = [...colourClassesIn('<b className="data-[active=true]:bg-lumi-gold/5" />').keys()];
    expect(found).toEqual(['data-[active=true]:bg-lumi-gold/5']);
    expect(found.some((c) => c.startsWith('true]'))).toBe(false);
  });

  it('a class NAMED in a comment is not read as a class USED', () => {
    // `no-generic-tailwind.js` and several components discuss forbidden classes
    // in prose. Scanning them would report the example as a defect.
    const found = [...colourClassesIn('// Use bg-surface-card instead of bg-gray-900\nconst a = 1;')];
    expect(found).toHaveLength(0);
  });

  it('a runtime-composed class is skipped, not guessed at', () => {
    const found = [...colourClassesIn('<i className={`text-${tone}-500`} />').keys()];
    expect(found).toHaveLength(0);
  });

  it('reports the line so a failure is actionable', () => {
    const found = colourClassesIn('\n\n<p className="bg-nope-500" />');
    expect(found.get('bg-nope-500')).toBe(3);
  });
});
