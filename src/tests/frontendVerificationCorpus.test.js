import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, linkSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumi-corpus-'));
  const copy = (from, to) => {
    mkdirSync(to, {recursive: true});
    for (const entry of readdirSync(from, {withFileTypes: true})) {
      if (entry.name === 'node_modules' || entry.name.includes('.test.')) continue;
      const source = join(from, entry.name), target = join(to, entry.name);
      if (entry.isDirectory()) copy(source, target);
      else { try { linkSync(source, target); } catch { cpSync(source, target); } }
    }
  };
  for (const dir of ['src', 'scripts', 'prisma', 'packages']) copy(resolve(dir), join(root, dir));
  cpSync(resolve('package.json'), join(root, 'package.json'));
  mkdirSync(join(root, 'client/src'), {recursive: true});
  // A synthetic configuration keeps this backend test independent of client/.
  writeFileSync(join(root, 'client/vite.config.js'), 'export default {build: {sourcemap: false}};');
  return root;
}

describe('F-1 — full scanners require an applicable frontend corpus', () => {
  it.each(['README', 'empty', 'tests-only'].flatMap(shape =>
    ['arch-check.js', 'security-check.js'].map(scanner => [shape, scanner])))('rejects %s in %s before frontend PASS output', (shape, scanner) => {
    const root = fixture();
    try {
      if (shape === 'README') writeFileSync(join(root, 'client/src/README.md'), 'No applicable source');
      if (shape === 'tests-only') writeFileSync(join(root, 'client/src/fixture.test.jsx'), 'export const testOnly = true;');
      const result = spawnSync(process.execPath, [resolve('scripts', scanner)], {cwd: root, encoding: 'utf8'});
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stderr).toMatch(/Missing frontend source.*client\/src/);
      expect(result.stdout).not.toMatch(/PASSED|SEC-XSS-1/);
    } finally { rmSync(root, {recursive: true, force: true}); }
  }, 15000);
});
