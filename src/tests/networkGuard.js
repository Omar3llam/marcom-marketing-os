// ============================================================
// B5-01P″′ — the verification suite does not use the internet
// ============================================================
// B5-01P″ proved that two connector suites were making live HTTPS calls to
// graph.facebook.com on every run. They passed anyway: `fetchRaw` wraps each
// secondary edge in `.catch(softFail(...))`, so the rejection was swallowed and
// only the WALL CLOCK carried the evidence. When the round trip was slow — CPU
// contention, DNS variance — the test crossed Vitest's 5000ms budget and failed
// as a timeout, which is the entire "sharding-dependent flake".
//
// The mock gaps that caused it are closed. This guard exists because closing
// them is not a property anything enforces: `MetaConnector` has gained a network
// function three times (ad-sets, ads, canonical-all-levels), and the stub list
// was extended for the first and forgotten for the rest. A comment in
// MetaConnector.test.js already tried to prevent exactly this and lost.
//
// ── WHY A THROW IS NOT ENOUGH ───────────────────────────────────────────────
// Blocking the socket stops the I/O, but the caller catches it — that is what
// softFail is for — and the test goes green having attempted the connection.
// So every violation is also RECORDED, and an afterEach fails the test on the
// record. A passing test cannot hide an outbound attempt behind a soft failure.
//
// ── POLICY ──────────────────────────────────────────────────────────────────
// Allow explicitly provisioned local infrastructure. Reject everything else.
// NOT "allow everything except graph.facebook.com" — the next leak will be to
// some other host, and a deny-list only ever knows about the last incident.
// ============================================================
import net from 'node:net';
import { afterEach } from 'vitest';

// Prisma phones checkpoint.prisma.io for version telemetry on client init. The
// suite never asked for that call, and it is one more piece of external latency
// inside a fixed test budget. Set before any Prisma client is constructed —
// this file is the FIRST entry in vitest `setupFiles`, ahead of workerDb.js.
process.env.CHECKPOINT_DISABLE = '1';

/** Hosts that are local by definition. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '']);

/**
 * Hosts named by the repository's own test infrastructure config. This is what
 * keeps the policy "allow local infrastructure" rather than "allow loopback and
 * hope nobody runs Postgres elsewhere" — a developer pointing TEST_DATABASE_URL
 * at a provisioned host has explicitly provisioned it, and it stays allowed
 * without widening the rule to the whole internet.
 */
function configuredHosts(env = process.env) {
  const out = new Set();
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL', 'REDIS_URL']) {
    const raw = env[key];
    if (!raw) continue;
    try { out.add(new URL(raw).hostname.toLowerCase()); } catch { /* unparseable — not an allowance */ }
  }
  return out;
}

export function isLocalDestination(host, env = process.env) {
  // No host at all means an IPC/unix socket — local by construction.
  if (host == null) return true;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK.has(h)) return true;
  if (h.startsWith('127.')) return true;
  if (h.endsWith('.localhost')) return true;
  return configuredHosts(env).has(h);
}

/**
 * net.Socket.prototype.connect carries three signatures, and the guard has to
 * read all of them or it will wave something through:
 *   connect(options)            — { host, port } or { path }
 *   connect(path)               — IPC
 *   connect(port[, host])       — how the postgres client actually connects
 */
export function destinationOf(args) {
  const a = args[0];
  if (typeof a === 'string') return { host: null, label: `ipc:${a}` };
  if (typeof a === 'number') {
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { host, label: `${host}:${a}` };
  }
  if (a && typeof a === 'object') {
    if (a.path) return { host: null, label: `ipc:${a.path}` };
    const host = a.host ?? 'localhost';
    return { host, label: `${host}:${a.port ?? '?'}` };
  }
  return { host: null, label: 'unknown' };
}

const violations = [];

/** Drain and return recorded violations. For the guard's OWN tests only. */
export function drainViolations() {
  return violations.splice(0, violations.length);
}

const original = net.Socket.prototype.connect;

net.Socket.prototype.connect = function guardedConnect(...args) {
  const { host, label } = destinationOf(args);
  if (!isLocalDestination(host)) {
    violations.push(label);
    // Thrown so no real I/O happens and no latency enters the test budget.
    // Recorded so a caller that swallows this still fails, below.
    throw new Error(
      `[networkGuard] blocked an outbound connection to ${label}. `
      + 'Tests must not reach the public internet — mock the service that made this call.',
    );
  }
  return original.apply(this, args);
};

afterEach(() => {
  if (violations.length === 0) return;
  const seen = [...new Set(violations)];
  violations.length = 0;
  throw new Error(
    `[networkGuard] this test attempted ${seen.length} external connection(s): ${seen.join(', ')}. `
    + 'The attempt was blocked, but a swallowed rejection is still a real dependency on the internet.',
  );
});
