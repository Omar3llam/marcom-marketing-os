// ============================================================
// runtimeContract — which Node runtime may make a verification claim (B5-01K)
// ============================================================
// B5-01I traced the residual non-determinism in `npm run test:full` to a single
// Vitest fork worker dying with Windows exit code 3221226505 (0xC0000409,
// __fastfail): no stderr, no exit handler, no native module loaded, no Node
// diagnostic report. Its module never reports, so the run summarises as
// "310 passed (311)" and exits 1 with ZERO failed tests.
//
// B5-01J measured it against the runtime, same commit, same machine:
//
//     Node 24.15.0    7 worker fast-fails / 20 runs   (+1/5 re-measured in 01K)
//     Node 24.20.0    0 / 25
//     Node 22.23.2    0 / 10
//
// An interleaved re-run of 24.15.0 AFTER twenty consecutive green runs still
// failed 3/10, which is what makes this attributable to the runtime rather than
// to a lucky streak.
//
// So the runtime is not an environmental detail — it decides whether a green
// result means anything. Leaving it implicit means the same commit and the same
// command have materially different reliability on two developers' machines.
//
// ── WHY A MINOR, NOT A MAJOR RANGE ──────────────────────────────────────────
// `>=24` and `24.x` are both wrong here: 24.15.0 IS 24.x, and it is the version
// the defect was measured on. Same major does not mean same deterministic
// runtime. The patch level is left open because 24.20.0 -> 24.20.x carries
// security fixes we want and no measured behavioural difference.
//
// Node 22.23.2 also measured clean, and is still REJECTED for verification: we
// are pinning one chosen environment, not maintaining a lottery of runtimes
// that happened to pass.
//
// ── NOT A PRODUCTION IMPORT ─────────────────────────────────────────────────
// Nothing under src/ imports this. The server must never fail to boot because a
// test-only runtime helper is missing or disagrees.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

/** The contract. Patch is open; major+minor are not. */
export const REQUIRED_MAJOR = 24;
export const REQUIRED_MINOR = 20;
export const REQUIRED_RANGE = `${REQUIRED_MAJOR}.${REQUIRED_MINOR}.x`;

/** The stable code callers match on — never the message. */
export const NODE_RUNTIME_MISMATCH = 'NODE_RUNTIME_MISMATCH';

export class NodeRuntimeMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NodeRuntimeMismatchError';
    this.code = NODE_RUNTIME_MISMATCH;
  }
}

/**
 * PURE. Parse a Node version string into numbers, or null when it is not one.
 * Accepts an optional leading `v` (`.nvmrc` and `process.version` disagree on
 * this) and tolerates surrounding whitespace, including the CRLF that git's
 * autocrlf will write into `.nvmrc` on Windows checkouts.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * PURE. Does this version satisfy the verification contract?
 * Anything unparseable — undefined, '', 'invalid', 'v24' — is NOT satisfied.
 * A missing answer is a rejection, never a pass.
 */
export function satisfiesRuntime(value) {
  const v = parseVersion(value);
  if (!v) return false;
  return v.major === REQUIRED_MAJOR && v.minor === REQUIRED_MINOR;
}

/** PURE. The operator-facing explanation. Carries no environment values. */
export function formatMismatch(detected, command) {
  const shown = parseVersion(detected) ? String(detected).trim() : `"${detected}" (unrecognised)`;
  return [
    `Verification requires Node ${REQUIRED_RANGE}. Detected Node ${shown}.`,
    command ? `  affected command: ${command}` : null,
    `  This repository pins its verification runtime in .nvmrc. Select it with:`,
    '',
    '      nvm use          # or: fnm use / volta pin, per your version manager',
    '',
    `  Node ${REQUIRED_MAJOR}.15.x is rejected deliberately: B5-01J measured a Vitest worker`,
    '  crash on it that silently DROPS a whole test module from the run — the',
    '  suite reports "310 passed (311)" with zero failed tests. A green result',
    '  from that runtime does not mean what it says.',
  ].filter((l) => l !== null).join('\n');
}

/** Reads the canonical declaration. Exported so a ratchet can compare sources. */
export function declaredRuntime(root = REPO_ROOT) {
  return readFileSync(resolve(root, '.nvmrc'), 'utf8').trim();
}

/**
 * The guard itself. Throws NodeRuntimeMismatchError when the running Node may
 * not make a verification claim. Deliberately NOT executed at import time —
 * this module is imported by its own contract test, and a module that throws on
 * import takes the whole file down with it.
 */
export function assertVerificationRuntime(...args) {
  // Arity, NOT a default parameter. `version = process.version` would make
  // assertVerificationRuntime(undefined) fall back to the RUNNING runtime and
  // pass — so a caller that computed a version and got undefined would silently
  // validate something it never asked about. A missing answer must fail closed,
  // which is the same rule B5-01G applied to the database probe.
  const version = args.length === 0 ? process.version : args[0];
  const command = args.length > 1 ? args[1] : null;

  if (!satisfiesRuntime(version)) {
    throw new NodeRuntimeMismatchError(formatMismatch(version, command));
  }
  return true;
}
