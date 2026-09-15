// ============================================================
// Phase 3 token consumption contract — static checks over src/lumi
// ------------------------------------------------------------
// V-1  every var() is a defined --lumi-* token, with no fallback
// V-2  no raw colour, length, duration, effect, legacy variable or font stack
// V-3  verdict mark colours only in .mark* rules; the gold attention signal nowhere
// V-4  no interaction selector reaches a verdict, gold or state colour
// V-5  no literal className, inline style, legacy import, animation, 3D
//      dependency or second currency formatter in LUMI source
// Each checker is first shown to FAIL on a planted violation.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditCss, auditSource, cssRules, definedTokens, lumiFiles, TOKENS_CSS } from './lumiAudit.js';

const defined = definedTokens(fs.readFileSync(TOKENS_CSS, 'utf8'));
const cssFiles = lumiFiles((name) => name.endsWith('.module.css'));
const sourceFiles = lumiFiles((name) => /\.jsx?$/.test(name));
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.basename(path.dirname(file)) + '/' + path.basename(file);

describe('instrument controls — each checker can fail', () => {
  it('reads the real token manifest and finds the LUMI files', () => {
    expect(defined.size).toBe(130);
    expect(defined.has('--lumi-color-text-claim')).toBe(true);
    expect(cssFiles.map(rel)).toEqual([
      'grammar/grammar.module.css', 'lab/lab.module.css', 'primitives/controls.module.css', 'primitives/layout.module.css',
      'primitives/type.module.css',
    ]);
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it('flattens @media blocks into rules', () => {
    const rules = cssRules('@media (pointer: coarse) { .a { color: var(--lumi-color-text-body); } .b { gap: 0; } }');
    expect(rules.map((r) => r.selector)).toEqual(['.a', '.b']);
  });

  it.each([
    ['.a { color: #EF4444; }', 'raw hex colour'],
    ['.a { color: rgb(1 2 3); }', 'raw colour function'],
    ['.a { color: var(--c-kill); }', 'non-LUMI variable'],
    ['.a { color: var(--lumi-color-verdict-danger); }', 'undefined token'],
    ['.a { color: var(--lumi-color-text-body, #fff); }', 'var() fallback'],
    ['.a { padding: 18px; }', 'raw length'],
    ['.a { transition: color 200ms; }', 'raw length or duration'],
    ['.a { background: linear-gradient(red, blue); }', 'forbidden effect'],
    ['.a { backdrop-filter: blur(4px); }', 'forbidden effect'],
    ['.a { box-shadow: 0 0 8px var(--lumi-color-text-claim); }', 'box-shadow other than shadow.overlay'],
    ['.a { font-family: Poppins; }', 'font-family not from a type role'],
    ['.button { background: var(--lumi-color-verdict-kill-mark); }', 'verdict mark colour outside a .mark rule'],
    ['.markKill { background: var(--lumi-color-signal-attention); }', 'attention signal (gold) used'],
    ['.button:focus-visible { outline-color: var(--lumi-color-state-failed-border); }', 'interaction state uses'],
  ])('auditCss flags %s', (css, expected) => {
    expect(auditCss(css, defined).join('\n')).toContain(expected);
  });

  it.each([
    ['<div className="bg-lumi-gold p-4" />', 'literal className'],
    ['<div style={{ color: "red" }} />', 'inline style'],
    ["import { VerdictPill } from '@/components/ui/DecisionPill.jsx';", 'legacy import'],
    ["import { getSignalTokens } from '@/design-system/signals/signals';", 'legacy import'],
    ["import * as THREE from 'three';", '3D, animation or particle dependency'],
    ["import { Canvas } from '@react-three/fiber';", '3D, animation or particle dependency'],
    ["// see client/src/design-system/patterns/StateBlock.jsx\nimport { x } from '@/design-system/patterns';", 'legacy import @/design-system/patterns'],
    ["new Intl.NumberFormat('en', { style: 'currency', currency });", 'a second currency formatter'],
    ['<span className={css.x + " animate-pulse"} />', 'animation'],
  ])('auditSource flags %s', (source, expected) => {
    expect(auditSource(source).join('\n')).toContain(expected);
  });

  it('does not flag a legacy path that is only named in a comment', () => {
    expect(auditSource('// "StateBlock" lives in client/src/design-system/patterns/StateBlock.jsx')).toEqual([]);
  });
});

describe('LUMI CSS modules consume Phase 2 tokens only', () => {
  it.each(cssFiles.map((file) => [rel(file), file]))('%s has no violations', (_, file) => {
    expect(auditCss(read(file), defined)).toEqual([]);
  });

  it('uses a verdict mark token for each of the six verdicts, and REALLOCATE is not gold', () => {
    const grammar = cssRules(read(cssFiles.find((f) => f.endsWith('grammar.module.css'))));
    const marks = Object.fromEntries(grammar.filter((r) => r.selector.startsWith('.mark')).map((r) => [r.selector, r.body]));
    for (const verdict of ['kill', 'hold', 'scale', 'watch', 'refresh', 'reallocate']) {
      const selector = `.mark${verdict[0].toUpperCase()}${verdict.slice(1)}`;
      expect(marks[selector]).toBe(`background: var(--lumi-color-verdict-${verdict}-mark);`);
    }
  });

  it('gives a quiet action a persistent structural affordance in border.strong (FC-19)', () => {
    const controls = cssRules(read(cssFiles.find((f) => f.endsWith('controls.module.css'))));
    const quiet = controls.find((r) => r.selector === '.quiet');
    expect(quiet.body).toContain('border-block-end-color: var(--lumi-color-border-strong);');
    const standard = controls.find((r) => r.selector === '.standard');
    expect(standard.body).toContain('border-color: var(--lumi-color-border-strong);');
    const disabledQuiet = controls.find((r) => r.selector === ".quiet[aria-disabled='true']");
    expect(disabledQuiet.body).toContain('border-block-end-color: var(--lumi-color-interaction-disabled-border);');
  });

  it('never consumes the attention signal, and never declares a focus ring other than the neutral one', () => {
    const all = cssFiles.map(read).join('\n');
    expect(all).not.toMatch(/signal-attention/);
    const outlines = [...all.matchAll(/outline\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(outlines.length).toBeGreaterThan(0);
    for (const outline of outlines) {
      expect(outline).toBe('var(--lumi-size-focus-width) solid var(--lumi-color-interaction-focus-ring)');
    }
  });

  it('names only the three locked families, through type-role tokens', () => {
    const families = new Set(cssFiles.flatMap((f) => [...read(f).matchAll(/--lumi-type-([a-z-]+)-family/g)].map((m) => m[1])));
    const tokenFamilies = [...fs.readFileSync(TOKENS_CSS, 'utf8').matchAll(/--lumi-type-[a-z-]+-family:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tokenFamilies)).toEqual(new Set(['Inter', 'Space Grotesk', 'JetBrains Mono']));
    expect(families.size).toBeGreaterThan(0);
  });
});

describe('LUMI source obeys the primitive contract', () => {
  it.each(sourceFiles.map((file) => [rel(file), file]))('%s has no violations', (_, file) => {
    expect(auditSource(read(file))).toEqual([]);
  });

  it('formats money only through the canonical client contract', () => {
    const importers = sourceFiles.filter((f) => /from '@\/lib\/money'/.test(read(f)));
    expect(importers.map(rel)).toEqual(['grammar/Measurement.jsx']);
  });

  it('keeps every UI primitive within the CLAUDE.md 150-line budget', () => {
    const over = sourceFiles
      .filter((f) => f.endsWith('.jsx'))
      .map((f) => [rel(f), read(f).split('\n').length])
      .filter(([, lines]) => lines > 150);
    expect(over).toEqual([]);
  });
});
