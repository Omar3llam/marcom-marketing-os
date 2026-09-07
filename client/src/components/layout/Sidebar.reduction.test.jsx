// ============================================================
// FE-05 · the nav reduction — and the two paths it may not break
// ------------------------------------------------------------
// B7-08 locked a primary navigation of the four axes plus Connectors. This
// slice executes that, with two exceptions the DISCOVERY forced and the ruling
// confirmed — both of which are pinned here as reachability proofs, not as
// assertions about an array.
//
// 🔒 LOCK 1 — Testing and Measurement KEEP their slots. The proof that they
// could be demoted failed, and it failed in a closed loop:
//
//     RUNNING  → an Attention agenda item ("In flight — read when concluded.")
//              → the Testing / Measurement LIST
//     CONCLUDED → the agenda item disappears (the planner emits openTests /
//                 openHoldouts only)
//              → no back-edge from its Decision (B8-05 deferred: `rootCause`
//                 is not an identity contract)
//              → no experiment reading on Memory
//              → the ONLY links into an experiment detail are from those two
//                 lists, whose only outside entrances are these nav slots and
//                 that RUNNING-only agenda item.
//
// So the running experiment tells the operator "read when concluded", and the
// moment it concludes the surface that can show the result loses its entrance.
//
// 🔒 Reports KEEPS its slot. It is the ONLY nav item without a `roles`
// constraint — nine of ten are STRATEGIST/BUYER — so demoting it would empty a
// CLIENT's primary navigation entirely. A navigation regression, not a taste.
//
// What this file does NOT touch, deliberately: role and plan gates are frozen
// (the baseline below is asserted key by key), B7's IA is not reopened, Growth
// Strategy is not split, and Memory's CLIENT discoverability is a separate
// finding, not a thing to fix inside a nav reduction.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { tools, NAV_GROUP, primaryTools, secondaryTools } from './Sidebar.jsx';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { appRoutes } from '@/app/routeManifest.js';
import appSource from '@/App.jsx?raw';
import { TestingView } from '@/features/testing/TestingView.jsx';

const keys = (list) => list.map((t) => t.key);

// ── the reduction ───────────────────────────────────────────────────────────
describe('FE-05 · the primary navigation', () => {
  it('is exactly the axes, Connectors, and the two the locks retained', () => {
    // Ordered FREE → GROWTH → PRO, as the array always has been. Connectors
    // sits in the FREE block because its route carries no PlanGate — see the
    // entitlement assertion below, where that placement is load-bearing rather
    // than cosmetic.
    expect(keys(primaryTools)).toEqual([
      'overview', 'decisions', 'campaigns', 'leadership', 'connections',
      'memory',
      'testing', 'measure',
    ]);
  });

  it('demotes exactly the three surfaces nothing but the Sidebar links to', () => {
    // Census, from trunk: content 1 inbound, intelligence 1, publishing 2 —
    // every one of them the Sidebar itself. A secondary group leaves them
    // exactly as reachable as they are today.
    expect(keys(secondaryTools)).toEqual(['content', 'intelligence', 'publishing']);
  });

  it('every item belongs to exactly one group, and the groups partition tools', () => {
    expect(tools.every((t) => t.group === NAV_GROUP.PRIMARY || t.group === NAV_GROUP.SECONDARY)).toBe(true);
    expect([...primaryTools, ...secondaryTools]).toHaveLength(tools.length);
    expect(new Set(keys(tools)).size).toBe(tools.length);
  });

  // Self-refutation for the two `toEqual` assertions above: they must be
  // describing a real, populated model, not an empty one that trivially matches.
  it('the model is populated (self-refutation)', () => {
    expect(tools.length).toBeGreaterThanOrEqual(11);
    expect(primaryTools.length).toBeGreaterThan(secondaryTools.length);
    expect(keys(tools)).not.toContain('zzz-not-a-nav-item');
  });
});

// ── Connectors takes the slot FE-04 deferred to this slice ──────────────────
describe('FE-05 · Connectors gets the nav owner FE-04 left it without', () => {
  const connectors = tools.find((t) => t.key === 'connections');

  it('points at the destination FE-04 reclaimed', () => {
    expect(connectors.path).toBe(appRoutes.connections);
    expect(connectors.group).toBe(NAV_GROUP.PRIMARY);
  });

  it('carries the same role scope as its route, and NO plan gate', () => {
    // `plan` here is not a heading — it is an entitlement filter
    // (`canAccess(t.plan)` hides the row). /app/connections carries a RoleGate
    // and deliberately no PlanGate: connectors are how an account gets ANY data
    // at all, so a tier gate would hide the connect destination from exactly
    // the FREE workspaces that have nothing connected. A nav row stricter than
    // its own route is the B7 Ruling 3 mismatch pointing the other way.
    expect(connectors.roles).toEqual(['STRATEGIST', 'BUYER']);
    expect(connectors.plan).toBe('FREE');
  });
});

// ── the gates are frozen ────────────────────────────────────────────────────
// "FE-05 preserves existing entitlement semantics and does not redistribute
// gates as part of a nav reduction." Asserted key by key so a quiet change to
// any one of them fails, rather than being absorbed by a looser check.
describe('FE-05 · no role or plan gate moved', () => {
  const BASELINE = {
    overview:     { roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
    decisions:    { roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
    campaigns:    { roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
    content:      { roles: ['STRATEGIST', 'BUYER'], plan: 'FREE' },
    leadership:   { roles: undefined,               plan: 'FREE' },
    memory:       { roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH' },
    intelligence: { roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH' },
    publishing:   { roles: ['STRATEGIST', 'BUYER'], plan: 'GROWTH' },
    testing:      { roles: ['STRATEGIST', 'BUYER'], plan: 'PRO' },
    measure:      { roles: ['STRATEGIST', 'BUYER'], plan: 'PRO' },
  };

  it.each(Object.entries(BASELINE))('%s keeps its gates', (key, want) => {
    const t = tools.find((x) => x.key === key);
    expect(t).toBeTruthy();
    expect(t.roles).toEqual(want.roles);
    expect(t.plan).toBe(want.plan);
  });

  it('Reports is still the one item with no role constraint', () => {
    const ungated = tools.filter((t) => !t.roles);
    expect(keys(ungated)).toEqual(['leadership']);
  });
});

// ── PROOF 1 · a CLIENT still has a primary destination ──────────────────────
describe('FE-05 · self-refutation — a CLIENT is not left without navigation', () => {
  const forClient = (list) => list.filter((t) => roleAllowed('CLIENT', t.roles));

  it('a CLIENT sees at least one PRIMARY item', () => {
    expect(forClient(primaryTools).length).toBeGreaterThan(0);
  });

  it('…and it is Reports, which is why it may not be demoted', () => {
    expect(keys(forClient(primaryTools))).toEqual(['leadership']);
  });

  // The control: the filter must actually be filtering. If roleAllowed were
  // broken open, "a CLIENT sees at least one item" would pass for every item.
  it('the role filter is really excluding the operator surfaces', () => {
    expect(keys(forClient(tools))).toEqual(['leadership']);
    expect(forClient(tools).length).toBeLessThan(tools.length);
  });
});

// ── PROOF 2 · a CONCLUDED experiment is still reachable ─────────────────────
// Not an assertion about an array — the actual chain, one link at a time.
describe('FE-05 · self-refutation — a concluded experiment keeps a discoverable path', () => {
  const concluded = {
    id: 't-42', status: 'CONCLUDED', dimension: 'HOOK', metric: 'CTR',
    hypothesis: 'Static beats video', winnerLabel: 'Variant B', lift: 12,
    confidenceLabel: 'HIGH', decisionId: 'd-99',
    variants: [
      { id: 'a', label: 'Control', isControl: true, impressions: 2000, clicks: 40, conversions: 4 },
      { id: 'b', label: 'Variant B', isControl: false, impressions: 2000, clicks: 60, conversions: 6, isWinner: true },
    ],
  };

  it('step 1 — the nav still offers Testing and Measurement in the PRIMARY group', () => {
    expect(keys(primaryTools)).toEqual(expect.arrayContaining(['testing', 'measure']));
  });

  it('step 2 — those rows point at the lists', () => {
    expect(tools.find((t) => t.key === 'testing').path).toBe(appRoutes.testing);
    expect(tools.find((t) => t.key === 'measure').path).toBe(appRoutes.measure);
  });

  it('step 3 — the list renders a CONCLUDED experiment and links into its detail', () => {
    render(<MemoryRouter><TestingView experiments={[concluded]} role="BUYER" /></MemoryRouter>);
    // The detail link IS the hypothesis text — `{exp.hypothesis && <Link…>}`.
    // Naming it here rather than matching loosely keeps the proof honest about
    // what it rests on: verified against the schema, `hypothesis` is a required
    // String on the model AND `z.string()` (not nullish) in
    // testExperiment.schema.ts, so it survives the parse for every row. That
    // matters because it is the ONLY link into an experiment detail — the C-04
    // shape, where a field eaten at the contract boundary silently removes a
    // destination, would have closed this path with the nav slot still in place.
    const detail = screen.getByRole('link', { name: 'Static beats video' });
    expect(detail).toHaveAttribute('href', '/app/testing/t-42');
  });

  it('step 4 — and App.jsx still declares that detail route', () => {
    expect(appSource).toMatch(/path="testing\/:id"/);
    expect(appSource).toMatch(/path="measure\/:id"/);
  });
});

// ── every demoted surface keeps its route ───────────────────────────────────
describe('FE-05 · demotion is not deletion', () => {
  it.each([['content', 'content'], ['intelligence', 'intelligence'], ['publishing', 'publishing']])(
    '%s still has a declared route',
    (_key, path) => {
      expect(appSource).toMatch(new RegExp(`path="${path}"`));
    },
  );

  it('and every nav path, primary or secondary, is a route App.jsx declares', () => {
    for (const t of tools) {
      const sub = t.path.replace('/app/', '');
      expect(appSource).toMatch(new RegExp(`path="${sub.replace('/', '\\/')}"`));
    }
  });

  // Control for the loop above: a path App.jsx does NOT declare must fail it.
  it('the route check can fail (self-refutation)', () => {
    expect(appSource).not.toMatch(/path="definitely-not-a-route"/);
  });
});

// ── the render actually shows both groups ───────────────────────────────────
describe('FE-05 · the secondary group is rendered, not hidden', () => {
  it('the two groups are separately addressable and non-empty', () => {
    // Sidebar itself needs auth + plan + router context to mount, so the copy
    // is asserted on the exported model — the same choice Sidebar.nav.test.js
    // made and for the same reason. That the Sidebar RENDERS both groups is
    // covered by Sidebar.test.jsx.
    expect(primaryTools.length).toBeGreaterThan(0);
    expect(secondaryTools.length).toBeGreaterThan(0);
    expect(primaryTools.every((t) => t.group === NAV_GROUP.PRIMARY)).toBe(true);
    expect(secondaryTools.every((t) => t.group === NAV_GROUP.SECONDARY)).toBe(true);
  });
});
