import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verificationScope } from '../../scripts/verificationScope.js';

describe('verification scope cannot hide a missing subject', () => {
  it('requires frontend for full checks and all backend subjects for backend checks', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumi-scope-'));
    try {
      expect(() => verificationScope(root, ['--backend'])).toThrow('src');
      for (const dir of ['src', 'prisma', 'packages/runtime-contracts']) {
        mkdirSync(join(root, dir), {recursive: true});
        writeFileSync(join(root, dir, 'subject'), 'synthetic');
      }
      expect(verificationScope(root, ['--backend'])).toEqual({includeFrontend: false});
      expect(() => verificationScope(root, [])).toThrow('client/src');
      mkdirSync(join(root, 'client/src'), {recursive: true});
      expect(() => verificationScope(root, [])).toThrow('empty');
      writeFileSync(join(root, 'client/src/subject'), 'synthetic');
      expect(verificationScope(root, [])).toEqual({includeFrontend: true});
      expect(() => verificationScope(root, ['--skip'])).toThrow('Expected');
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('backend security retains its verified-email guard with no client present', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumi-security-scope-'));
    try {
      // Read-only hard links avoid copying the entire backend in every worker.
      // The one mutated subject is a separate copy, so the real source is safe.
      const fixture = (source, dest) => {
        mkdirSync(dest, {recursive: true});
        for (const entry of readdirSync(source, {withFileTypes: true})) {
          if (entry.name === 'node_modules' || entry.name.includes('.test.')) continue;
          const from = join(source, entry.name), to = join(dest, entry.name);
          if (entry.isDirectory()) fixture(from, to);
          else if (entry.name === 'firebaseAuth.js') cpSync(from, to);
          else {
            try { linkSync(from, to); }
            catch { cpSync(from, to); } // Temporary directories may be on another volume.
          }
        }
      };
      for (const dir of ['src', 'prisma', 'packages', 'scripts']) {
        fixture(resolve(dir), join(root, dir));
      }
      cpSync(resolve('package.json'), join(root, 'package.json'));
      const run = args => spawnSync(process.execPath, [resolve('scripts/security-check.js'), ...args], {cwd: root, encoding: 'utf8'});
      const full = run([]);
      expect(full.status).not.toBe(0);
      expect(full.stderr).toContain('client/src');
      const baseline = run(['--backend']);
      expect(baseline.status, baseline.stdout + baseline.stderr).toBe(0);
      expect(baseline.stdout).not.toContain('no unguarded innerHTML in the client');
      const auth = join(root, 'src/middleware/firebaseAuth.js');
      writeFileSync(auth, readFileSync(auth, 'utf8').replace(/email_verified\s*===\s*true/g, 'email_verified !== false'));
      const mutation = run(['--backend']);
      expect(mutation.status).not.toBe(0);
      expect(mutation.stdout).toContain('SEC-ID-1');
    } finally { rmSync(root, {recursive: true, force: true}); }
  // Copies a disposable source fixture and spawns three independent static gates.
  }, 15000);
});
