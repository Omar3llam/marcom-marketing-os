// ============================================================
// LUMI design tokens — build (Phase 2)
// ------------------------------------------------------------
//   node design-system/foundation/build.js           write generated/*
//   node design-system/foundation/build.js --check   fail if generated/* is stale
//
// Refuses to write anything while a single rule is broken: a stylesheet
// generated from a broken token set would ship the break.
//
// Output:
//   generated/tokens.css            semantic + component tokens as `--lumi-*`
//                                   custom properties. Brand and primitive
//                                   tokens are NOT emitted, so a component
//                                   cannot consume a raw value at all.
//   generated/tokens.resolved.json  every token with its resolved value and
//                                   reference chain, the contrast results
//                                   and the counts. Tooling reads this.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, emitted, cssVar, localDir, GROUNDS, LAYERS, TOKEN_DIR } from './resolve.js';

export const GENERATED_DIR = localDir('./generated/', import.meta.url);
const SOURCE_NOTE = 'client/design-system/foundation/tokens/*.json';

function renderCss(result) {
  const { tokens, sources } = result;
  const environments = Object.entries(sources.semantic.$environments).filter(([k]) => !k.startsWith('$'));
  const list = emitted(tokens);
  const invariant = list.filter((t) => typeof t.value !== 'object' || t.value === null);
  const grounded = list.filter((t) => typeof t.value === 'object' && t.value !== null);
  const reduced = invariant.filter((t) => t.reduced !== undefined);

  const decl = (t, v) => `  ${cssVar(t.path)}: ${v === null ? 'initial' : v};`;
  const lines = [
    '/* ============================================================',
    ' * GENERATED — do not edit. LUMI design tokens (Phase 2).',
    ` * Source of truth: ${SOURCE_NOTE}`,
    ' * Rebuild:        npm run tokens:build --workspace client',
    ' *',
    ' * Environments are product contexts chosen by route family, not a',
    ' * theme: there is no prefers-color-scheme branch and no user switch.',
    ' * `initial` means the role does not exist on that ground (for',
    ' * example a verdict mark on Off White) and cannot be used there.',
    ' * ============================================================ */',
    '',
    ':root {',
    ...invariant.map((t) => decl(t, t.value)),
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    ...reduced.map((t) => `  ${decl(t, t.reduced)}`),
    '  }',
    '}',
  ];
  for (const ground of GROUNDS) {
    const selectors = environments.filter(([, env]) => env.ground === ground).map(([, env]) => env.selector);
    if (selectors.length === 0) continue;
    lines.push('', `${selectors.join(',\n')} {`, ...grounded.map((t) => decl(t, t.value[ground])), '}');
  }
  return `${lines.join('\n')}\n`;
}

function renderManifest(result) {
  const { tokens, sources, contrast } = result;
  const all = [...tokens.values()].sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) || a.path.localeCompare(b.path));
  const css = emitted(tokens);
  const byLayer = Object.fromEntries(LAYERS.map((l) => [l, all.filter((t) => t.layer === l).length]));
  const semanticRoots = {};
  for (const t of all.filter((x) => x.layer === 'semantic')) {
    const root = t.path.split('.')[0];
    semanticRoots[root] = (semanticRoots[root] ?? 0) + 1;
  }
  const manifest = {
    $generated: `GENERATED — do not edit. Source of truth: ${SOURCE_NOTE}.`,
    counts: {
      tokens: all.length,
      byLayer,
      semanticByRoot: semanticRoots,
      cssVariables: css.length,
      provisional: all.filter((t) => t.status === 'provisional').length,
      contrastChecks: contrast.length,
      contrastFailures: contrast.filter((c) => !c.pass).length,
      states: Object.keys(sources.semantic.$states).filter((k) => !k.startsWith('$')).length,
    },
    environments: Object.fromEntries(Object.entries(sources.semantic.$environments).filter(([k]) => !k.startsWith('$'))),
    states: Object.fromEntries(Object.entries(sources.semantic.$states).filter(([k]) => !k.startsWith('$'))),
    tokens: Object.fromEntries(all.map((t) => [t.path, {
      layer: t.layer,
      type: t.type,
      value: t.value,
      ...(t.reduced !== undefined ? { reduced: t.reduced } : {}),
      ...(t.status ? { status: t.status } : {}),
      ...(css.includes(t) ? { cssVariable: cssVar(t.path) } : {}),
      references: t.chain,
    }])),
    contrast,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function buildOutputs(dir = TOKEN_DIR) {
  const result = build(dir);
  if (result.errors.length) return { result, css: null, manifest: null };
  return { result, css: renderCss(result), manifest: renderManifest(result) };
}

const lf = (s) => s.replace(/\r\n/g, '\n');

export function staleOutputs(outputs, dir = GENERATED_DIR) {
  const stale = [];
  for (const [name, content] of [['tokens.css', outputs.css], ['tokens.resolved.json', outputs.manifest]]) {
    let current = null;
    try { current = readFileSync(join(dir, name), 'utf8'); } catch { /* missing counts as stale */ }
    if (current === null || lf(current) !== content) stale.push(name);
  }
  return stale;
}

// ── CLI ──────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputs = buildOutputs();
  if (outputs.result.errors.length) {
    process.stderr.write(`\n❌ ${outputs.result.errors.length} token rule(s) broken — nothing written.\n\n`);
    for (const e of outputs.result.errors) process.stderr.write(`  ${e}\n`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const stale = staleOutputs(outputs);
    if (stale.length) {
      process.stderr.write(`❌ generated token output is stale: ${stale.join(', ')}. Run \`npm run tokens:build --workspace client\`.\n`);
      process.exit(1);
    }
    process.stdout.write('✅ Token rules hold and generated output is current.\n');
  } else {
    mkdirSync(GENERATED_DIR, { recursive: true });
    writeFileSync(join(GENERATED_DIR, 'tokens.css'), outputs.css);
    writeFileSync(join(GENERATED_DIR, 'tokens.resolved.json'), outputs.manifest);
    const c = JSON.parse(outputs.manifest).counts;
    process.stdout.write(`✅ ${c.tokens} tokens · ${c.cssVariables} CSS variables · ${c.contrastChecks} contrast checks, ${c.contrastFailures} failing.\n`);
  }
}
