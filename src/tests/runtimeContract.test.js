// ============================================================
// The verification runtime contract (B5-01K)
// ============================================================
// B5-01J measured, on one commit and one machine, that the Node runtime decides
// whether `npm run test:full` is deterministic:
//
//     24.15.0   7 worker fast-fails / 20 runs   (+1/5 re-measured in 01K)
//     24.20.0   0 / 25
//     22.23.2   0 / 10
//
// The failure mode is the dangerous kind: a worker dies, its module never
// reports, and the suite says "310 passed (311)" with ZERO failed tests. So the
// runtime is part of the verification contract, and these tests exist to keep
// it from quietly widening back into "any runtime that seems to work".
//
// These are pure-function tests: they assert the POLICY against version
// strings, never the version this file happens to be running under. A test that
// only checked `process.version` would pass for the wrong reason on a developer
// machine that already has the right Node.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  satisfiesRuntime, parseVersion, assertVerificationRuntime, formatMismatch,
  declaredRuntime, NodeRuntimeMismatchError, NODE_RUNTIME_MISMATCH,
  REQUIRED_MAJOR, REQUIRED_MINOR, REQUIRED_RANGE,
} from '../../scripts/runtimeContract.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

describe('B5-01K · which Node runtime may make a verification claim', () => {
  // ── §9.1 the selected runtime is accepted ──────────────────
  it('accepts the selected runtime 24.20.0', () => {
    expect(satisfiesRuntime('24.20.0')).toBe(true);
    expect(satisfiesRuntime('v24.20.0')).toBe(true);
    expect(assertVerificationRuntime('v24.20.0')).toBe(true);
  });

  // ── §9.2 patch level is open, by policy ────────────────────
  it('accepts any patch inside 24.20.x — the policy is major.minor', () => {
    expect(satisfiesRuntime('24.20.1')).toBe(true);
    expect(satisfiesRuntime('v24.20.99')).toBe(true);
  });

  // ── §9.3 the measured-unstable runtime is rejected ─────────
  it('REJECTS 24.15.x — the runtime the worker fast-fail was measured on', () => {
    expect(satisfiesRuntime('24.15.0')).toBe(false);
    expect(satisfiesRuntime('v24.15.3')).toBe(false);
    expect(() => assertVerificationRuntime('v24.15.0')).toThrow(NodeRuntimeMismatchError);
    try {
      assertVerificationRuntime('v24.15.0');
    } catch (err) {
      // Matched on the stable code, never the prose.
      expect(err.code).toBe(NODE_RUNTIME_MISMATCH);
    }
  });

  // ── §9.4 stable-but-not-selected is still rejected ─────────
  // This is the test that stops the rule decaying into "anything that passes".
  it('REJECTS 22.23.2 even though it also measured clean', () => {
    expect(satisfiesRuntime('22.23.2')).toBe(false);
    expect(satisfiesRuntime('v22.23.2')).toBe(false);
  });

  // ── §9.5 other majors ──────────────────────────────────────
  it('REJECTS other majors, above and below', () => {
    for (const v of ['25.0.0', 'v25.1.2', '23.20.0', '20.20.0', '26.20.0']) {
      expect(satisfiesRuntime(v), `${v} must not satisfy ${REQUIRED_RANGE}`).toBe(false);
    }
  });

  // ── §9.6 a missing answer is a rejection, not a pass ────────
  it('REJECTS missing and malformed version information', () => {
    for (const v of [undefined, null, '', '   ', 'invalid', 'v24', '24.20', 'node', {}, 42, NaN]) {
      expect(satisfiesRuntime(v), `${String(v)} must not satisfy the contract`).toBe(false);
    }
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion('24.20')).toBeNull();
    expect(() => assertVerificationRuntime(undefined)).toThrow(NodeRuntimeMismatchError);
  });

  // ── §7 the error has to be actionable, and must not leak ───
  it('names the detected version, the requirement, and the command — and no secrets', () => {
    const msg = formatMismatch('v24.15.0', 'npm run test:full');
    expect(msg).toContain('24.15.0');
    expect(msg).toContain(REQUIRED_RANGE);
    expect(msg).toContain('npm run test:full');
    expect(msg).toContain('.nvmrc');
    // A guard that printed the environment would be a new leak, not a fix.
    for (const secret of ['DATABASE_URL', 'postgres://', 'postgresql://', 'TEST_DATABASE_URL', 'SECRET', 'TOKEN', 'password']) {
      expect(msg).not.toContain(secret);
    }
    expect(formatMismatch(undefined)).toContain('unrecognised');
  });
});

// ============================================================
// §10 SOURCE RATCHETS — these fail when the repository drifts, not when a
// version string is merely reworded.
// ============================================================
describe('B5-01K · ratchets', () => {
  // ── Ratchet A — one truth, parsed from every surface that declares it ──
  it('A · .nvmrc and package.json engines agree with the enforced policy', () => {
    const declared = parseVersion(declaredRuntime(REPO));
    expect(declared, '.nvmrc must contain a full x.y.z version').not.toBeNull();
    expect(declared.major).toBe(REQUIRED_MAJOR);
    expect(declared.minor).toBe(REQUIRED_MINOR);
    // The declared version must itself pass the guard it declares.
    expect(satisfiesRuntime(declaredRuntime(REPO))).toBe(true);

    const engines = JSON.parse(read('package.json')).engines?.node;
    expect(engines, 'package.json must declare engines.node').toBeTruthy();
    expect(engines).toBe(`${REQUIRED_MAJOR}.${REQUIRED_MINOR}.x`);
    // The old `>=22.0.0` admitted 24.15.x. A range that admits the rejected
    // runtime is exactly the drift this ratchet exists to catch.
    expect(engines).not.toMatch(/^[><=^~*]/);
  });

  // ── Ratchet B — every official command routes through the guarded seam ──
  it('B · npm test, test:fast and test:full all pass through the guard', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    for (const name of ['test', 'test:fast', 'test:full']) {
      expect(scripts[name], `${name} must exist`).toBeTruthy();
      expect(scripts[name], `${name} must route through the guarded runner`)
        .toMatch(/run-tests\.js/);
    }
    // ...and the runner must actually call the guard before doing work. A
    // command can only be "guarded" if the seam it points at enforces.
    const runner = read('scripts/run-tests.js');
    expect(runner).toMatch(/assertVerificationRuntime\s*\(/);
    expect(runner).toMatch(/runtimeContract\.js/);
  });

  // ── CI must not carry a second, independently-drifting truth ──
  it('B · CI reads the pin from .nvmrc rather than a literal', () => {
    for (const wf of ['.github/workflows/tests.yml', '.github/workflows/architecture-check.yml']) {
      const yml = read(wf);
      if (!yml.includes('setup-node')) continue;
      expect(yml, `${wf} must not hard-code a node-version`).not.toMatch(/^\s*node-version:\s*['"]?\d/m);
      expect(yml, `${wf} must point setup-node at .nvmrc`).toMatch(/node-version-file:\s*['"]\.nvmrc['"]/);
    }
  });

  // ── The guard must not become a production import dependency (§8) ──
  it('the runtime guard is not reachable from production code', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) { if (!/node_modules|tests?$/.test(e.name)) walk(p); continue; }
        if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue;
        if (/runtimeContract/.test(readFileSync(p, 'utf8'))) offenders.push(p.replace(REPO, '').replace(/\\/g, '/'));
      }
    };
    walk(resolve(REPO, 'src'));
    expect(offenders, 'the server must not fail to boot over a test-only runtime helper').toEqual([]);
  });
});
