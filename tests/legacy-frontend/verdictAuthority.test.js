import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const CLIENT = path.resolve('client/src');
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(full))
    : /\.(js|jsx)$/.test(e.name) && !e.name.includes('.test.') ? [full] : [];
});
const codeOf = f => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const filesMatching = (root, pattern) => walk(root).filter(f => pattern.test(codeOf(f))).map(f => rel(root, f)).sort();
// CONTROL 4 — the client must not hold a verdict authority.
describe('R8 · the client consumes verdicts, it does not author them', () => {
  it('the ONLY client-side verdict derivation is the known-dead useOrchestrate mapper', () => {
    const derivation = /[<>]=?\s*[\d.]+\s*\?\s*['"`](KILL|SCALE|HOLD|WATCH|REFRESH|REALLOCATE|OPTIMIZE)/;
    // R8 §12 rules this out of scope for removal (it belongs to R12 Legacy
    // Cleanup) and requires it to be documented instead. Documented is not the
    // same as safe, so the next test is the one that actually holds it down.
    expect(filesMatching(CLIENT, derivation)).toEqual(['hooks/useOrchestrate/fetchers.js']);
  });

  it('…and nothing reaches the mappers, so they cannot render', () => {
    // This is the real guard. The derivation is harmless only while unreachable;
    // the moment a component wires it up, a score-derived 'SCALE' and an
    // 'OPTIMIZE' the backend cannot emit start rendering beside real verdicts.
    //
    // TWO doors, and only one of them is shut by accident of nobody using it:
    //   1. the useOrchestrate hook itself — zero importers
    //   2. the three flow functions in fetchers.js that call the mappers
    // `fetchContext`, also exported from fetchers.js, IS live (useOnboardingContext)
    // and reaches no mapper — which is why this asks about the doors rather than
    // about the file.
    const files = walk(CLIENT).filter((f) => !/hooks[\\/]useOrchestrate/.test(f));

    const hookImporters = files
      .filter((f) => /from\s+['"][^'"]*useOrchestrate(\.js|\/index\.js)?['"]/.test(codeOf(f)))
      .map((f) => rel(CLIENT, f));
    expect(hookImporters).toEqual([]);

    const flowImporters = files
      .filter((f) => /\b(runContentFlow|runStrategyFlow|runCampaignFlow)\b/.test(codeOf(f)))
      .map((f) => rel(CLIENT, f));
    expect(flowImporters).toEqual([]);
  });
});
