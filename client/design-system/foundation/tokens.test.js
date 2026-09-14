// ============================================================
// LUMI design tokens — the Phase 2 validation contract
// ------------------------------------------------------------
// Each `describe` maps to a Phase 2 validation item. The first block proves
// the instruments can fail: a rule checker that has never been seen to reject
// anything proves nothing when it passes.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build, contrast, duplicateKeys, emitted, cssVar, LAYERS, TOKEN_DIR } from './resolve.js';
import { buildOutputs, staleOutputs } from './build.js';

const result = build();
const tok = (p) => result.tokens.get(p);
const all = [...result.tokens.values()];
const semantic = all.filter((t) => t.layer === 'semantic');
const semanticColours = semantic.filter((t) => t.type === 'color');
const valuesOf = (t) => (t.value && typeof t.value === 'object' ? Object.values(t.value) : [t.value]).filter((v) => v !== null);
const { css } = buildOutputs();

const BRAND = { gold: '#D4A017', charcoal: '#0B0F14', offWhite: '#F7F7F3', warmGray: '#E6E2DA' };
const VERDICTS = { kill: '#C74646', hold: '#D97732', scale: '#3D9B6D', watch: '#3B82F6', refresh: '#B7791F', reallocate: '#D4A017' };
const LEGACY_VERDICT_HEXES = ['#EF4444', '#F59E0B', '#10B981'];
const LOCKED_STATES = ['loading', 'available', 'empty', 'failed', 'unavailable', 'notConnected', 'notPermitted', 'notSupported', 'stale', 'processing', 'success', 'notMeasured', 'insufficientData', 'noConversions', 'mixedCurrency', 'disabled', 'partial'];

function mutatedBuild(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'lumi-tokens-'));
  const sources = Object.fromEntries(LAYERS.map((l) => [l, JSON.parse(readFileSync(join(TOKEN_DIR, `${l}.json`), 'utf8'))]));
  mutate(sources);
  mkdirSync(dir, { recursive: true });
  for (const l of LAYERS) writeFileSync(join(dir, `${l}.json`), JSON.stringify(sources[l]));
  return build(dir).errors;
}

describe('instrument controls — the checkers can fail', () => {
  it('contrast reproduces the WCAG controls', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('reproduces a Phase 1 measurement from the Constitution (KILL on Charcoal 4.02)', () => {
    expect(Math.round(contrast(VERDICTS.kill, BRAND.charcoal) * 100) / 100).toBe(4.02);
  });

  it('detects a duplicate key, and does not confuse nesting with duplication', () => {
    expect(duplicateKeys('{"a": 1, "a": 2}')).toEqual(['a']);
    expect(duplicateKeys('{"a": {"a": 1}, "b": ["a", "a"]}')).toEqual([]);
  });

  it('rejects REALLOCATE aliasing brand gold', () => {
    const errors = mutatedBuild((s) => { s.semantic.color.verdict.reallocate.mark.$value.charcoal = '{brand.color.gold}'; });
    expect(errors.some((e) => e.includes('color.verdict.reallocate.mark') && e.includes('brand.color.gold'))).toBe(true);
  });

  it('rejects a primitive that reaches brand gold', () => {
    const errors = mutatedBuild((s) => { s.primitive.primitive.color.reallocate.$value = '{brand.color.gold}'; });
    expect(errors.some((e) => e.startsWith('primitive.color.reallocate'))).toBe(true);
  });

  it('rejects a declared contrast pair that fails', () => {
    const errors = mutatedBuild((s) => { s.semantic.color.text.meta.$value.charcoal = '{primitive.color.light.20}'; });
    expect(errors.some((e) => e.startsWith('contrast color.text.meta'))).toBe(true);
  });

  it('rejects a motion duration without a reduced-motion value', () => {
    const errors = mutatedBuild((s) => { delete s.semantic.motion.duration.reveal.$reduced; });
    expect(errors).toContain('motion.duration.reveal: motion token has no declared reduced-motion value');
  });

  it('rejects an unused primitive and a hue-named semantic token', () => {
    const errors = mutatedBuild((s) => {
      s.primitive.primitive.space['12'] = { $type: 'dimension', $value: '12px' };
      s.semantic.color.surface.blue = { $type: 'color', $value: { charcoal: '{primitive.color.light.4}', offWhite: '{primitive.color.shade.6}' } };
    });
    expect(errors).toContain('primitive.space.12: primitive referenced by no semantic token');
    expect(errors.some((e) => e.startsWith('color.surface.blue') && e.includes('hue'))).toBe(true);
  });

  it('rejects a colour token that is neither verified nor declared exempt', () => {
    const errors = mutatedBuild((s) => { s.semantic.color.text.hint = { $type: 'color', $value: { charcoal: '{primitive.color.light.44}', offWhite: '{primitive.color.shade.52}' } }; });
    expect(errors).toContain('color.text.hint: colour token is in no contrast pair and not declared exempt');
  });
});

describe('build', () => {
  it('holds every rule', () => {
    expect(result.errors).toEqual([]);
  });

  it('generated output is current with the source', () => {
    expect(staleOutputs(buildOutputs())).toEqual([]);
  });
});

describe('1 · brand colours match governance', () => {
  it.each(Object.entries(BRAND))('brand.color.%s = %s', (name, hex) => {
    expect(tok(`brand.color.${name}`).value).toBe(hex);
  });

  it('gold carries its meaning and its prohibitions', () => {
    const def = JSON.parse(readFileSync(join(TOKEN_DIR, 'brand.json'), 'utf8')).brand.color.gold;
    expect(def.$means).toEqual(['signal', 'attention', 'decision', 'meaningful emphasis']);
    expect(def.$notMeans).toEqual(['generic success', 'generic interaction', 'universal focus', 'universal selection', 'decoration']);
  });
});

describe('2 · verdict colours match the locked ruling', () => {
  it.each(Object.entries(VERDICTS))('%s = %s as primitive and as a Charcoal mark', (verdict, hex) => {
    expect(tok(`primitive.color.${verdict}`).value).toBe(hex);
    expect(tok(`color.verdict.${verdict}.mark`).value).toEqual({ charcoal: hex, offWhite: null });
  });

  it('there are exactly six verdict marks and no verdict text, fill, background or glow token', () => {
    const verdictTokens = all.filter((t) => t.path.startsWith('color.verdict.')).map((t) => t.path);
    expect(verdictTokens.sort()).toEqual(Object.keys(VERDICTS).map((v) => `color.verdict.${v}.mark`).sort());
  });
});

describe('3 · legacy verdict colours are not active', () => {
  it('no resolved token value in any layer is a legacy verdict hex', () => {
    const hits = all.filter((t) => valuesOf(t).some((v) => LEGACY_VERDICT_HEXES.includes(String(v).toUpperCase())));
    expect(hits.map((t) => t.path)).toEqual([]);
  });

  it('neither the token source nor the generated CSS contains them', () => {
    for (const l of LAYERS) {
      const text = readFileSync(join(TOKEN_DIR, `${l}.json`), 'utf8').toUpperCase();
      for (const hex of LEGACY_VERDICT_HEXES) expect(text.includes(hex)).toBe(false);
    }
    for (const hex of LEGACY_VERDICT_HEXES) expect(css.toUpperCase().includes(hex)).toBe(false);
  });
});

describe('4 · brand gold and REALLOCATE are separate tokens', () => {
  it('REALLOCATE resolves through its own primitive and never reaches the brand layer', () => {
    const mark = tok('color.verdict.reallocate.mark');
    expect(mark.references).toEqual(['primitive.color.reallocate']);
    expect(mark.chain.some((p) => p.startsWith('brand.'))).toBe(false);
    expect(tok('primitive.color.reallocate').references).toEqual([]);
  });

  it('the attention signal is the only token below brand whose chain reaches brand gold', () => {
    const reachers = all.filter((t) => t.layer !== 'brand' && t.chain.includes('brand.color.gold')).map((t) => t.path);
    expect(reachers).toEqual(['color.signal.attention']);
  });
});

describe('5 · no gold focus, hover, selected or other interaction token', () => {
  it('no interaction, border, text, surface or state token resolves to gold on any ground', () => {
    const roles = semanticColours.filter((t) => /^color\.(interaction|border|text|surface|state)\./.test(t.path));
    expect(roles.length).toBeGreaterThan(0);
    const hits = roles.filter((t) => valuesOf(t).includes(BRAND.gold));
    expect(hits.map((t) => t.path)).toEqual([]);
  });

  it('gold appears only in brand gold, the REALLOCATE primitive and mark, and the attention signal', () => {
    const holders = all.filter((t) => valuesOf(t).includes(BRAND.gold)).map((t) => t.path).sort();
    expect(holders).toEqual(['brand.color.gold', 'color.signal.attention', 'color.verdict.reallocate.mark', 'primitive.color.reallocate']);
  });
});

describe('6 · verdict colours are not generic interaction colours', () => {
  it('no non-verdict semantic token shares a verdict value (the attention signal shares gold by FC-2 only)', () => {
    const verdictValues = Object.values(VERDICTS);
    const hits = semanticColours
      .filter((t) => !t.path.startsWith('color.verdict.') && t.path !== 'color.signal.attention')
      .filter((t) => valuesOf(t).some((v) => verdictValues.includes(v)));
    expect(hits.map((t) => t.path)).toEqual([]);
  });
});

describe('7 · typography uses only Space Grotesk, Inter and JetBrains Mono', () => {
  const families = all.filter((t) => t.type === 'fontFamily' && t.layer !== 'brand');

  it('every stack is one brand face followed by platform fallbacks only', () => {
    for (const t of families) {
      const [face, ...fallbacks] = t.value.split(', ');
      expect(['"Space Grotesk"', '"Inter"', '"JetBrains Mono"']).toContain(face);
      for (const f of fallbacks) expect(['system-ui', 'sans-serif', 'ui-monospace', 'monospace']).toContain(f);
    }
  });

  it('the generated CSS names no other quoted typeface', () => {
    const quoted = [...new Set(css.match(/"[A-Z][^"]*"/g))].sort();
    expect(quoted).toEqual(['"Inter"', '"JetBrains Mono"', '"Space Grotesk"']);
  });

  it('metrics and identifiers are mono and distinguishable from prose; metrics are tabular', () => {
    for (const role of ['metric.headline', 'metric.inline', 'technical.identifier']) {
      expect(tok(`type.${role}.family`).value.startsWith('"JetBrains Mono"')).toBe(true);
    }
    for (const role of ['metric.headline', 'metric.inline']) expect(tok(`type.${role}.numeric`).value).toBe('tabular-nums');
    for (const role of ['body.default', 'body.claim', 'label.default', 'caption.default', 'heading.section']) {
      expect(tok(`type.${role}.family`).value.startsWith('"Inter"')).toBe(true);
    }
  });

  it('Space Grotesk is rare: display and surface titles only', () => {
    const display = all.filter((t) => t.path.startsWith('type.') && t.path.endsWith('.family') && t.value.startsWith('"Space Grotesk"')).map((t) => t.path);
    expect(display.sort()).toEqual(['type.display.brand.family', 'type.heading.surface.family']);
  });

  it('no role is below the 12px legibility floor, and the claim is never smaller than body', () => {
    const sizes = all.filter((t) => /^type\..+\.size$/.test(t.path));
    for (const t of sizes) expect(parseInt(t.value, 10)).toBeGreaterThanOrEqual(12);
    expect(parseInt(tok('type.body.claim.size').value, 10)).toBeGreaterThanOrEqual(parseInt(tok('type.body.default.size').value, 10));
  });
});

describe('8 · state semantics remain distinct', () => {
  const states = result.sources.semantic.$states;
  const names = Object.keys(states).filter((k) => !k.startsWith('$'));
  const light = (path, ground) => contrast(tok(path).value[ground], tok('color.surface.base').value[ground]);

  it('the registry is exactly the locked vocabulary', () => {
    expect(names.sort()).toEqual([...LOCKED_STATES].sort());
  });

  it('every state owns its tokens; no two states share a token', () => {
    const seen = new Map();
    for (const s of names) {
      expect(states[s].tokens.length).toBeGreaterThan(0);
      for (const p of states[s].tokens) {
        expect(seen.has(p) ? `${p} shared by ${seen.get(p)} and ${s}` : null).toBeNull();
        seen.set(p, s);
      }
    }
  });

  it('light follows the class: value = available, absence below it, a failure never dimmer', () => {
    for (const ground of ['charcoal', 'offWhite']) {
      const available = light('color.state.available.foreground', ground);
      for (const s of names) {
        const fg = states[s].tokens.find((p) => p.endsWith('.foreground') && p.startsWith('color.state.'));
        if (!fg) continue;
        const l = light(fg, ground);
        if (states[s].illumination === 'value') expect(l).toBe(available);
        if (states[s].illumination === 'absence') expect(l).toBeLessThan(available);
        if (states[s].illumination === 'claim') expect(l).toBeGreaterThanOrEqual(available);
      }
    }
  });

  it('FAILED is not EMPTY, UNAVAILABLE is not EMPTY, STALE is not faded, DISABLED is not UNAVAILABLE', () => {
    expect(states.failed.illumination).not.toBe(states.empty.illumination);
    expect(states.unavailable.illumination).not.toBe(states.empty.illumination);
    expect(states.stale.illumination).toBe('value');
    expect(states.disabled.illumination).toBe('interaction');
    expect(states.disabled.tokens.every((p) => p.startsWith('color.interaction.disabled.'))).toBe(true);
  });

  it('no state token is a verdict colour or gold, and no state has a tint, fill or icon token', () => {
    const forbidden = [...Object.values(VERDICTS), BRAND.gold];
    const stateTokens = all.filter((t) => t.path.startsWith('color.state.'));
    for (const t of stateTokens) for (const v of valuesOf(t)) expect(forbidden).not.toContain(v);
    expect(stateTokens.filter((t) => !/\.(foreground|border)$/.test(t.path)).map((t) => t.path)).toEqual([]);
  });
});

describe('9 · dark and light contexts are explicit', () => {
  const envs = result.sources.semantic.$environments;

  it('exactly three product-context environments on two grounds', () => {
    const table = Object.fromEntries(Object.entries(envs).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.ground]));
    expect(table).toEqual({ product: 'charcoal', marketing: 'offWhite', 'marketing-dark-section': 'charcoal' });
  });

  it('every semantic colour declares both grounds; only verdict marks and attention are absent on Off White', () => {
    for (const t of semanticColours) {
      expect(Object.keys(t.value).sort()).toEqual(['charcoal', 'offWhite']);
      expect(t.value.charcoal).not.toBeNull();
    }
    const absentOnOffWhite = semanticColours.filter((t) => t.value.offWhite === null).map((t) => t.path).sort();
    expect(absentOnOffWhite).toEqual(['color.signal.attention', ...Object.keys(VERDICTS).map((v) => `color.verdict.${v}.mark`)].sort());
  });

  it('environment-dependent colour is never declared on :root', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    expect(root.includes('--lumi-color-')).toBe(false);
    expect(css).toContain('[data-lumi-env="product"]');
    expect(css).toContain('[data-lumi-env="marketing"]');
    expect(css).toContain('[data-lumi-env="marketing-dark-section"]');
  });
});

describe('10 · no theme switch', () => {
  it('no colour-scheme media query, theme attribute or dark class in the token output or source', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).toContain('--lumi-');
    for (const needle of ['prefers-color-scheme', 'data-theme', '.dark', 'color-scheme']) expect(rules.includes(needle)).toBe(false);
    for (const l of LAYERS) expect(/theme/i.test(readFileSync(join(TOKEN_DIR, `${l}.json`), 'utf8').replace(/"\$description": "[^"]*"/g, ''))).toBe(false);
  });
});

describe('11 · no fabricated data', () => {
  it('no token is an example, sample, KPI, mock or placeholder value', () => {
    const suspicious = all.filter((t) => /example|sample|demo|kpi|mock|placeholder|fake/i.test(t.path));
    expect(suspicious.map((t) => t.path)).toEqual([]);
  });

  it('numbers exist only as design scales, never as product values', () => {
    const numbers = all.filter((t) => t.type === 'number').map((t) => t.path.split('.').slice(0, 1)[0] === 'primitive' ? t.path.split('.').slice(0, 2).join('.') : t.path.split('.')[0]);
    expect([...new Set(numbers)].sort()).toEqual(['layer', 'primitive.zIndex']);
  });
});

describe('17 · one current token authority', () => {
  it('each legacy token file declares itself legacy and points here', () => {
    for (const f of ['colors', 'typography', 'spacing', 'motion']) {
      const legacy = JSON.parse(readFileSync(join(TOKEN_DIR, '..', '..', 'tokens', `${f}.json`), 'utf8'));
      expect(legacy._comment).toMatch(/^LEGACY/);
      expect(legacy._comment).not.toMatch(/source of truth/i);
      expect(legacy._authority).toBe('client/design-system/foundation/tokens/');
    }
  });
});

describe('18 · the component layer is reserved and empty', () => {
  it('holds no tokens in Phase 2', () => {
    expect(all.filter((t) => t.layer === 'component')).toEqual([]);
  });
});

describe('19 · naming is internally consistent', () => {
  it('every emitted variable is unique, kebab-case and namespaced', () => {
    const names = emitted(result.tokens).map((t) => cssVar(t.path));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^--lumi-[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('brand, primitive and provisional tokens are never emitted, so components cannot consume raw values', () => {
    expect(css.includes('--lumi-brand-')).toBe(false);
    expect(css.includes('--lumi-primitive-')).toBe(false);
    expect(css.includes('breakpoint')).toBe(false);
  });
});

describe('20 · no accidental duplication', () => {
  it('equal colour values below the semantic layer are exactly the declared ones', () => {
    const raw = all.filter((t) => (t.layer === 'brand' || t.layer === 'primitive') && t.type === 'color');
    const groups = new Map();
    for (const t of raw) groups.set(t.value, [...(groups.get(t.value) ?? []), t.path]);
    const shared = [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort().join(' = ')).sort();
    expect(shared).toEqual([
      'brand.color.charcoal = primitive.color.light.0 = primitive.color.shade.100',
      'brand.color.gold = primitive.color.reallocate',
      'brand.color.offWhite = primitive.color.light.100 = primitive.color.shade.0',
      'brand.color.warmGray = primitive.color.warm.100',
      'primitive.color.light.80 = primitive.color.shade.20',
    ]);
  });
});

describe('foundations — spacing, radius, elevation, motion, sizing', () => {
  it('the five spacing tiers double', () => {
    const tiers = ['inline', 'meta', 'object', 'section', 'macro'].map((n) => parseInt(tok(`space.${n}`).value, 10));
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBe(tiers[i - 1] * 2);
  });

  it('radius is restrained: nothing above 4px except the one round-by-meaning token', () => {
    const radii = all.filter((t) => t.path.startsWith('radius.'));
    expect(radii.filter((t) => t.value === '9999px').map((t) => t.path)).toEqual(['radius.round']);
    for (const t of radii.filter((r) => r.value !== '9999px')) expect(parseInt(t.value, 10)).toBeLessThanOrEqual(4);
  });

  it('one functional shadow, no glow', () => {
    const shadows = all.filter((t) => t.type === 'shadow');
    expect(shadows.map((t) => t.path)).toEqual(['shadow.overlay']);
    expect(shadows[0].chain.some((p) => /gold|kill|hold|scale|watch|refresh|reallocate/.test(p))).toBe(false);
  });

  it('feedback < reveal <= transition <= maximum, and reduced motion removes movement', () => {
    const ms = (p, key = 'value') => parseInt(tok(p)[key], 10);
    expect(ms('motion.duration.feedback')).toBeLessThan(ms('motion.duration.reveal'));
    expect(ms('motion.duration.reveal')).toBeLessThanOrEqual(ms('motion.duration.transition'));
    expect(ms('motion.duration.transition')).toBeLessThanOrEqual(ms('motion.duration.maximum'));
    expect(ms('motion.duration.reveal', 'reduced')).toBe(0);
    expect(ms('motion.duration.transition', 'reduced')).toBe(0);
    expect(tok('motion.distance.settle').reduced).toBe('0px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(all.some((t) => /animation|keyframe|pulse|shimmer|loop/i.test(t.path))).toBe(false);
  });

  it('targets meet WCAG 2.5.8 and focus is visible without gold', () => {
    expect(parseInt(tok('size.target.minimum').value, 10)).toBeGreaterThanOrEqual(24);
    expect(parseInt(tok('size.focus.width').value, 10)).toBeGreaterThanOrEqual(2);
    expect(valuesOf(tok('color.interaction.focus.ring'))).not.toContain(BRAND.gold);
  });
});
