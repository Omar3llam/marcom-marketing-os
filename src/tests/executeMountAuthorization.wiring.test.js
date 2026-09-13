// ============================================================
// SLICE C · RED — the mount, read at SOURCE
// ------------------------------------------------------------
// ⚠️ A HARNESS CANNOT PROVE ITS OWN WIRING. executeMountAuthorization.red.test.js
// drives an app this repository assembles in a test file. It can show that a
// CLIENT is answered; it cannot show that the SHIPPED mount is the one that
// answered. PARITY-02 measured the cost of forgetting that — a smoke test with
// its own route table once asserted the opposite of the product.
//
// So this file reads the route modules and the mount itself. It runs no
// requests and mocks nothing.
//
// ⚠️ THIS FILE IS RED. Two cases fail on trunk:
//   • thirteen routes have no authorization outcome in source
//   • the router assembly declares no baseline, so a route added tomorrow
//     inherits authentication and rate limiting but not authorization
//
// The census cases pass, and must: they are what make the two failures a
// measurement of the shipped mount rather than of a test's imagination.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { statSync } from 'node:fs';

/** Every .js source under a directory, tests excluded. Depth-first, no git. */
function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walkJs(full));
    else if (entry.endsWith('.js') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}
import { join } from 'node:path';

import { EXECUTE_MOUNT_POLICY, label } from './executeMountAuthorization.policy.js';
import { CLIENT_READABLE } from '../routes/execution/authorizationBaseline.js';

const ROUTE_DIR = 'src/routes/execution';
const ASSEMBLY = join(ROUTE_DIR, 'index.js');
const SERVER = 'src/server.js';

/**
 * Every route registration in the folder, read from source.
 *
 * ⚠️ The receiver is matched as `<identifier>.<method>(` rather than as the
 * literal `router.`. That is not defensiveness for its own sake: the security
 * ledger census missed POST /api/export entirely because that file registers on
 * `exportRouter.post(` and the reader only looked for `router.`. An instrument
 * that can only see one spelling reports an absence it did not measure.
 */
function registeredRoutes() {
  const METHODS = /([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3\s*,([\s\S]*?)(?=async\s*\(\s*req|\(\s*req\s*,)/g;
  const CALLS = /([A-Za-z_$][\w$]*)\s*\(/g;
  const out = [];
  for (const file of readdirSync(ROUTE_DIR).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
    const src = readFileSync(join(ROUTE_DIR, file), 'utf8');
    METHODS.lastIndex = 0;
    let m;
    while ((m = METHODS.exec(src)) !== null) {
      const [, , method, , path, middle] = m;
      const gates = [];
      CALLS.lastIndex = 0;
      let g;
      while ((g = CALLS.exec(middle)) !== null) gates.push(g[1]);
      out.push({ file, method: method.toUpperCase(), path, gates });
    }
  }
  return out;
}

/**
 * The gates that decide AUTHORIZATION — what a seat may do.
 *
 * requireAuth and requireWorkspace are deliberately NOT here. They answer who
 * the caller is and which tenant they belong to. Treating either as
 * authorization is the exact confusion this slice exists to remove.
 */
const AUTHORIZATION_GATES = ['requireCollabRole', 'requireFreshAuthority'];

const ROUTES = registeredRoutes();

const authorizationOf = (r) => r.gates.filter((g) => AUTHORIZATION_GATES.includes(g));

// ── CONTROLS — the reader must be able to see both answers ──────────────────
describe('control — the source reader reports what is there', () => {
  it('finds every route the router assembles', () => {
    // 18 is the census, cross-checked against the policy table below. If these
    // two ever disagree, one of them is describing a mount that is not shipping.
    expect(ROUTES.length).toBe(18);
  });

  it('finds an authorization gate where one exists', () => {
    const meta = ROUTES.find((r) => r.file === 'meta.js' && r.method === 'POST');
    expect(authorizationOf(meta)).toEqual(['requireFreshAuthority']);

    const detail = ROUTES.find((r) => r.file === 'detail.js');
    expect(authorizationOf(detail)).toEqual(['requireCollabRole']);
  });

  it('reports an absent gate as absent, rather than failing to look', () => {
    const audit = ROUTES.find((r) => r.file === 'audit.js');
    expect(audit).toBeDefined();
    expect(audit.method).toBe('GET');
    expect(authorizationOf(audit)).toEqual([]);
  });

  it('would see a registration written on a receiver that is not named "router"', () => {
    // The instrument, tested against the shape that once defeated it.
    const sample = "exportRouter.post('/export', validate(exportSchema), async (req, res) => {";
    const RX = /([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3\s*,([\s\S]*?)(?=async\s*\(\s*req|\(\s*req\s*,)/g;
    expect(RX.exec(sample)).not.toBeNull();
  });
});

// ── CENSUS — the policy table describes the mount that ships ────────────────
describe('the policy table and the shipped mount agree, checked BOTH ways', () => {
  // FE-06's law: a count is not a guard. Both directions, as sets.
  const key = (r) => `${r.method} ${r.path}`;

  it('every registered route is classified in the policy table', () => {
    const classified = new Set(EXECUTE_MOUNT_POLICY.map(key));
    const unclassified = ROUTES.map(key).filter((k) => !classified.has(k));
    expect(unclassified).toEqual([]);
  });

  it('every classified route is actually registered', () => {
    const registered = new Set(ROUTES.map(key));
    const phantom = EXECUTE_MOUNT_POLICY.map(key).filter((k) => !registered.has(k));
    expect(phantom).toEqual([]);
  });

  it('the table reports each route\'s CURRENT gate truthfully', () => {
    for (const row of EXECUTE_MOUNT_POLICY) {
      const live = ROUTES.find((r) => key(r) === key(row));
      const gates = authorizationOf(live);
      if (row.enforcedToday === null) {
        expect(gates, `${label(row)} claims no gate`).toEqual([]);
      } else {
        expect(gates.length, `${label(row)} claims ${row.enforcedToday}`).toBeGreaterThan(0);
        expect(row.enforcedToday).toContain(gates[0]);
      }
    }
  });
});

// ── TENANCY AT SOURCE — the half a mock cannot prove ────────────────────────
describe('every route on the mount reads within a workspace', () => {
  // The behavioural cross-tenant cases in the RED suite cover the seven reads
  // that compare a workspace in the HANDLER. The workspace-WIDE reads (/audit,
  // /vitals, /active, /paused, /metrics/summary) put workspaceId in the query
  // predicate instead, and a suite whose prisma mock ignores `where` would be
  // testing its own mock if it claimed to have checked them. So they are
  // checked here, where the predicate is a fact in the file.
  it.each([...new Set(ROUTES.map((r) => r.file))].map((f) => [f]))(
    '%s qualifies its reads by workspaceId',
    (file) => {
      const src = readFileSync(join(ROUTE_DIR, file), 'utf8');
      expect(src).toMatch(/workspaceId/);
    },
  );

  it('control — the reader would notice a file that never mentions a workspace', () => {
    expect(/workspaceId/.test('const rows = await prisma.auditLog.findMany({});')).toBe(false);
  });
});

// ── THE STRUCTURAL RED ──────────────────────────────────────────────────────
describe('authorization is a property of the mount, not an option per route', () => {
  it('EVERY route under the mount has an authorization outcome', () => {
    // The outcome may be a route-level gate or a router-wide baseline. What it
    // may not be is absent — an authenticated-only route on this mount is a
    // route whose audience nobody decided.
    const assembly = readFileSync(ASSEMBLY, 'utf8');
    const hasBaseline = /router\.use\(/.test(assembly);

    const undecided = ROUTES
      .filter((r) => authorizationOf(r).length === 0)
      .map((r) => `${r.method} ${r.path}  (${r.file})`);

    expect(hasBaseline || undecided.length === 0, undecided.join('\n')).toBe(true);
  });

  it('the router assembly declares a baseline, so a NEW route inherits it', () => {
    // Closure condition 4. Without this, the fix is 13 gates somebody added
    // once — the C-12 shape, a cure that has to be remembered. The assembly is
    // the right place because every sub-route registers onto this router: a
    // baseline here is scoped to this mount and cannot leak to a sibling, which
    // is the hazard a path-less `use` carries on the flat-mounted lumi router.
    const assembly = readFileSync(ASSEMBLY, 'utf8');
    expect(assembly).toMatch(/router\.use\(/);
  });

  it('the baseline is mounted BEFORE any route is registered', () => {
    // Order is the whole mechanism. A `router.use` placed after the
    // registrations would apply to nothing that came before it, and the file
    // would still contain the line a reader was looking for.
    const assembly = readFileSync(ASSEMBLY, 'utf8');
    const baselineAt = assembly.indexOf('router.use(');
    // Look for a registrar CALL, not the word "register" — the baseline's own
    // comment says "before any route is registered", and matching that made the
    // first version of this case read its own explanation as the first route.
    const afterDecl = assembly.indexOf('const router = Router()');
    const call = new RegExp('register[A-Z]' + String.fromCharCode(92) + 'w*Route' + String.fromCharCode(92) + 's*' + String.fromCharCode(92) + '(');
    const firstRouteAt = afterDecl + assembly.slice(afterDecl).search(call);
    expect(baselineAt).toBeGreaterThan(-1);
    expect(baselineAt).toBeLessThan(firstRouteAt);
  });

  it('the router assembly is the ONLY place these routes are registered', () => {
    // Mutation 5: bypass the mount through a secondary router. A second
    // assembly importing the same registrars would carry none of the baseline,
    // and every behavioural suite in Slice C would still pass.
    const CALLS_A_REGISTRAR = new RegExp(
      'register(Meta|Audit|Vitals|Active|MetricsSummary|Reconciliation|Transitions'
      + '|Incident|Retry|Trace|Resume|Checkpoint|Artifacts|Detail)Route\\s*\\(',
    );
    // ⚠️ ENUMERATED FROM THE FILESYSTEM, NOT FROM GIT. The first version of
    // this case listed files with `git ls-files`, and the mutation battery
    // walked straight past it: a new second assembly is UNTRACKED, so git had
    // never heard of it. An instrument that can only see committed files
    // cannot see the file somebody is about to commit.
    const files = walkJs('src');

    // A route module DEFINES its own registrar, so the folder itself is
    // expected to match. What may not exist is a caller OUTSIDE it: only the
    // assembly assembles.
    const offenders = files
      .filter((f) => !f.startsWith('src/routes/execution/'))
      .filter((f) => CALLS_A_REGISTRAR.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);

    // Control: the reader is looking for something that genuinely occurs.
    const insideFolder = files
      .filter((f) => f.startsWith('src/routes/execution/'))
      .filter((f) => CALLS_A_REGISTRAR.test(readFileSync(f, 'utf8')));
    expect(insideFolder.length).toBeGreaterThan(0);
  });

  it('the shipped CLIENT exception list is an empty literal in source', () => {
    // Mutation 4, read at source rather than through an import: a list built at
    // runtime could be populated by something a behavioural test never sees.
    const baseline = readFileSync(join(ROUTE_DIR, 'authorizationBaseline.js'), 'utf8');
    expect(baseline).toContain('export const CLIENT_READABLE = Object.freeze([]);');
  });

  it('every CLIENT exception names a route that actually exists', () => {
    // Mutation 9: an exception that disappears silently. A path spelled in the
    // wrong vocabulary matches nothing and fails CLOSED — safe, but it means a
    // deliberate decision quietly did not take effect. Empty today; the check
    // is what makes the first entry trustworthy.
    const registered = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const entry of CLIENT_READABLE) {
      expect(registered, JSON.stringify(entry)).toContain(`${entry.method.toUpperCase()} ${entry.path}`);
    }
  });

  it('the mount in server.js still supplies authentication, workspace and limits', () => {
    // A regression guard, not a RED case: whatever Slice C adds, it must not
    // cost the mount what it already has.
    const server = readFileSync(SERVER, 'utf8');
    const mount = server.slice(server.indexOf("app.use('/api/execute'"));
    const block = mount.slice(0, mount.indexOf(');') + 1);
    expect(block).toContain('requireAuth');
    expect(block).toContain('requireWorkspace');
    expect(block).toContain('apiLimiter');
    expect(block).toContain('executionLimiter');
    expect(block).toContain('executionRouter');
  });
});
