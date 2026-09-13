// ============================================================
// SLICE B — the fresh gate is on BOTH canonical mutation paths
// ------------------------------------------------------------
// The behavioural suites drive a chain assembled by a harness. A harness can
// agree with the product today and disagree with it tomorrow — that is exactly
// how PARITY-02's route table came to assert the opposite of the shipped router
// and pass. So the WIRING is asserted against the route modules' own source.
//
// The mutation this exists to kill is the tempting one:
//
//     the fresh check is added to /meta, and /:id/retry keeps the old chain
//
// Both are callers of enqueueExecution. Both write ExecutionRequest. A boundary
// that holds on one of them is not a boundary. Two independent facts are
// checked per path — the import and the gate at the route — because a file can
// import a middleware it never mounts.
//
// This also pins the claim that these are the ONLY two such paths: if a third
// caller of enqueueExecution ever appears, the census below fails and whoever
// added it has to say what guards it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXEC_DIR = join(ROOT, 'src', 'routes', 'execution');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CANONICAL = [
  { file: 'src/routes/execution/meta.js', route: "router.post('/meta'" },
  { file: 'src/routes/execution/retry.js', route: "router.post('/:id/retry'" },
];

/** The middleware named on the same line as a route registration. */
function gateAt(src, routePrefix) {
  const line = src.split('\n').find((l) => l.includes(routePrefix));
  return line ?? null;
}

describe.each(CANONICAL)('$file', ({ file, route }) => {
  const src = read(file);

  it('imports the fresh-authority gate', () => {
    expect(src).toContain("import { requireFreshAuthority } from '../../middleware/requireFreshAuthority.js';");
  });

  it('mounts it on the canonical mutation route', () => {
    const line = gateAt(src, route);
    expect(line).not.toBeNull();
    expect(line).toContain('requireFreshAuthority(');
  });

  it('names both permitted roles at that route', () => {
    const line = gateAt(src, route);
    expect(line).toContain('WORKSPACE_ROLE.BUYER');
    expect(line).toContain('WORKSPACE_ROLE.STRATEGIST');
  });

  // The cached-role gate is the thing being replaced here. Leaving it on the
  // same route would put two gates on one path and make it ambiguous which one
  // the security property rests on.
  it('no longer leans on the cached-role gate for this route', () => {
    const line = gateAt(src, route);
    expect(line).not.toContain('requireCollabRole(');
  });
});

// ── The census that keeps the claim true ────────────────────────────────────
describe('the canonical mutation paths are still exactly two', () => {
  const files = readdirSync(EXEC_DIR).filter((f) => /\.js$/.test(f) && !/\.test\./.test(f));

  it('only meta.js and retry.js can enqueue an execution', () => {
    const callers = files.filter((f) => /enqueueExecution\s*\(/.test(readFileSync(join(EXEC_DIR, f), 'utf8')));
    expect(callers.sort()).toEqual(['meta.js', 'retry.js']);
  });

  it('only meta.js and retry.js create an ExecutionRequest', () => {
    const writers = files.filter((f) => /executionRequest\.create\s*\(/.test(readFileSync(join(EXEC_DIR, f), 'utf8')));
    expect(writers.sort()).toEqual(['meta.js', 'retry.js']);
  });

  it('every route that enqueues carries the fresh gate', () => {
    for (const f of files) {
      const src = readFileSync(join(EXEC_DIR, f), 'utf8');
      if (!/enqueueExecution\s*\(/.test(src)) continue;
      expect(src).toContain('requireFreshAuthority(');
    }
  });
});

// A reader that cannot fail proves nothing about a passing result.
describe('control — the reader reads', () => {
  it('finds no gate on a route that has none', () => {
    const line = gateAt("router.post('/meta', async (req, res) => {", "router.post('/meta'");
    expect(line).not.toBeNull();
    expect(line).not.toContain('requireFreshAuthority(');
  });

  it('finds the gate when it is there', () => {
    const line = gateAt("router.post('/meta', requireFreshAuthority(A, B), h);", "router.post('/meta'");
    expect(line).toContain('requireFreshAuthority(');
  });

  it('returns null for a route that does not exist', () => {
    expect(gateAt("router.get('/x', h);", "router.post('/nope'")).toBeNull();
  });
});
