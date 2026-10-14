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

describe('R7 — legacy client cannot revive retired memory', () => {
  it('no client file calls the retired endpoints', () => {
    expect(filesMatching(CLIENT, /['"`]\/api\/(memory|decision-memory)\b/)).toEqual([]);
  });
  it('no client reads the Shape-B columns that never existed', () => {
    expect(filesMatching(CLIENT, /\bmem\.(campaignId|decisionRationale|deltaCtr|deltaRoas|resultStatus|impactDurationHrs|isSustainable)\b/)).toEqual([]);
  });
});
