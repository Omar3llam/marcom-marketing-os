// ============================================================
// B5-01P″′ — the network guard is alive, and the mock surface stays closed
// ============================================================
// Two independent protections, tested independently on purpose:
//
//   1. THE GUARD  — blocks and reports any outbound connection to a non-local
//      host, whatever opens it. It does not care whether a mock exists; it is
//      the backstop for the day one is removed.
//
//   2. THE RATCHET — asserts the two connector suites still stub every
//      network-capable function their tested path can reach. This is the check
//      that would have caught the original defect: `fetchAdInsights` and
//      `fetchAllAds` were added to fetchRaw and never added to the stub lists,
//      so both ran for real against graph.facebook.com on every test run while
//      softFail swallowed the rejection and the suite reported green.
//
// A guard alone would leave the leak in place and merely fail loudly. A ratchet
// alone would be defeated by the next function nobody thought about. Both.
// ============================================================
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLocalDestination, destinationOf, drainViolations } from './networkGuard.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ── T3/T4 · the guard itself ────────────────────────────────────────────────
describe('B5-01P″′ · the network guard', () => {
  it('T3 — refuses a real outbound connection to an external host', () => {
    const socket = new net.Socket();
    // A connection this suite must never be able to make. If the guard is
    // removed, this attempt SUCCEEDS in reaching DNS and the assertion below
    // fails — which is the point: the test proves the guard acts, not that a
    // constant is defined somewhere.
    expect(() => socket.connect({ host: 'graph.facebook.com', port: 443 }))
      .toThrow(/blocked an outbound connection/i);

    // The attempt is also RECORDED, so a caller that swallows the throw (which
    // is exactly what fetchRaw's softFail does) still fails its test. Drained
    // here so this file's own afterEach does not fire on a deliberate probe.
    const violations = drainViolations();
    expect(violations).toEqual(['graph.facebook.com:443']);
    socket.destroy();
  });

  it('T4 — leaves local infrastructure alone', () => {
    // Loopback in every form the repository's clients actually use, including
    // the `connect(port, host)` signature the postgres client calls with.
    expect(isLocalDestination('localhost')).toBe(true);
    expect(isLocalDestination('127.0.0.1')).toBe(true);
    expect(isLocalDestination('::1')).toBe(true);
    expect(isLocalDestination(null)).toBe(true); // IPC / unix socket
    expect(destinationOf([5432, 'localhost'])).toEqual({ host: 'localhost', label: 'localhost:5432' });
    expect(destinationOf(['/tmp/pg.sock'])).toEqual({ host: null, label: 'ipc:/tmp/pg.sock' });

    // And a host the repository has explicitly provisioned stays allowed, which
    // is what keeps this an "allow local infrastructure" policy rather than
    // "allow loopback and break anyone whose test database lives elsewhere".
    const env = { TEST_DATABASE_URL: 'postgresql://u:p@db.internal:5432/verify' };
    expect(isLocalDestination('db.internal', env)).toBe(true);
    expect(isLocalDestination('db.internal', {})).toBe(false);
  });

  it('rejects external destinations regardless of how the call is shaped', () => {
    expect(isLocalDestination('graph.facebook.com')).toBe(false);
    expect(isLocalDestination('checkpoint.prisma.io')).toBe(false);
    expect(isLocalDestination('8.8.8.8')).toBe(false);
    // Not a deny-list: a host nobody has ever seen is refused by default.
    expect(isLocalDestination('some-host-nobody-listed.example')).toBe(false);
  });

  it('silences Prisma version telemetry rather than blocking it every run', () => {
    // checkpoint.prisma.io is a real outbound call the suite never asked for.
    // Disabling it is better than tripping the guard on every DB-backed test.
    expect(process.env.CHECKPOINT_DISABLE).toBe('1');
  });
});

// ── T5 · the mock surface cannot quietly re-open ────────────────────────────
describe('B5-01P″′ · connector suites stub every reachable network function', () => {
  const connectorSrc = read('../services/connectors/MetaConnector.js');

  /** What MetaConnector actually pulls in from the Meta service layer. Derived,
   *  never restated: a function added to that import list is caught here on the
   *  day it is added, which is precisely what did not happen for the ad edges. */
  const imported = (() => {
    // `[^}]*` rather than a lazy `[\s\S]*?`: the lazy form still had to reach
    // the closing brace that precedes metaAdsService, so it swallowed every
    // earlier import statement in the file along with it.
    const block = connectorSrc.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/metaAdsService\.js'/);
    expect(block, 'MetaConnector must import from metaAdsService.js').toBeTruthy();
    return block[1].split(',').map((s) => s.trim()).filter(Boolean);
  })();

  /** The only members that need no stub: pure in-memory merges with no I/O.
   *  Everything else is assumed network-capable until proven otherwise — the
   *  safe direction, since the cost of a wrong guess here is a live HTTP call. */
  const PURE = new Set(['mergeMetaCampaigns', 'mergeMetaAdSets', 'mergeMetaAds']);
  const mustMock = imported.filter((n) => !PURE.has(n));

  it('the derived surface is non-trivial and includes the functions that leaked', () => {
    expect(mustMock.length).toBeGreaterThan(5);
    expect(mustMock).toContain('fetchAdInsights');
    expect(mustMock).toContain('fetchAllAds');
  });

  it.each([
    ['MetaConnector.test.js', '../services/connectors/MetaConnector.test.js'],
    ['metaWorkspaceBridge.test.js', '../services/connectors/metaWorkspaceBridge.test.js'],
  ])('%s stubs every network-capable function it can reach', (_name, rel) => {
    const src = read(rel);
    const mockBlock = src.slice(src.indexOf("vi.mock('../metaAdsService.js'"));
    expect(mockBlock, 'the suite must mock metaAdsService').not.toBe('');

    const missing = mustMock.filter((fn) => !new RegExp(`\\b${fn}\\s*:`).test(mockBlock));
    expect(missing).toEqual([]);
  });
});
