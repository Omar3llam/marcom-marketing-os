// ============================================================
// FE-02 — the ACROSS axis gets an address (B7 Ruling 2)
// ------------------------------------------------------------
// Four axes were locked in B7. Three had destinations; ACROSS had none, and
// its two readings lived as tabs under "Intelligence — truth, insights, proof".
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
//   `routerSmoke.test.jsx` cannot help here. It is a SYNTHETIC harness: a
//   hand-written route table that mirrors App.jsx's SHAPE so a react-router
//   bump is exercised against nested layouts, index redirects and splats.
//   Adding /app/memory to it would prove that react-router matches a string —
//   not that App.jsx mounts anything. So the split below is deliberate:
//
//     the manifest + nav assertions   → real, behavioural
//     the App.jsx assertions          → DECLARATION only, read from source
//     that the page renders           → MemoryView.test.jsx
//
//   Naming that limit is the point. A check that quietly implied "the route
//   mounts" would be the same species of green as the test this slice deletes.
// ============================================================
import { describe, it, expect } from 'vitest';
import { appRoutes, intelligenceSections } from '../routeManifest.js';
import { tools } from '@/components/layout/Sidebar.jsx';
// Read as text through Vite's own resolver — `import.meta.url` is not a file:
// URL under the test transform, so node:fs cannot locate it.
import appSource from '../../App.jsx?raw';

const byKey = (k) => tools.find((t) => t.key === k);

describe('FE-02 · ACROSS has a destination', () => {
  it('the manifest names it', () => {
    expect(appRoutes.memory).toBe('/app/memory');
  });

  it('the nav points at it, and names the axis rather than a feature', () => {
    const memory = byKey('memory');
    expect(memory).toBeTruthy();
    expect(memory.label).toBe('Memory');
    expect(memory.path).toBe(appRoutes.memory);
  });

  it('it is GROWTH, because GET /lumi/briefing is requirePlan(GROWTH)', () => {
    // B7 Ruling 3's test: the surface and the API it reads must agree. A
    // destination reachable by an operator the API will refuse is a lie one
    // click deep.
    expect(byKey('memory').plan).toBe('GROWTH');
  });

  it('no other nav item claims the axis', () => {
    const claimants = tools.filter((t) => /memory|learn(ed|ing)?\b/i.test(`${t.label} ${t.sub ?? ''}`));
    expect(claimants.map((t) => t.key)).toEqual(['memory']);
  });
});

describe('FE-02 · one object may not have two destinations', () => {
  it('Proof is no longer a peer tab — it is Memory\'s second reading', () => {
    expect(intelligenceSections.map((s) => s.key)).not.toContain('proof');
  });

  it('and its old address still resolves, to Memory', () => {
    expect(appSource).toMatch(/path="intelligence\/proof"[\s\S]{0,160}appRoutes\.memory/);
  });
});

describe('FE-02 · App.jsx DECLARES the route (source assertion — see header)', () => {
  it('mounts a page at path="memory"', () => {
    expect(appSource).toMatch(/path="memory"/);
  });

  it('gates it on plan, not on role — the readings gate themselves', () => {
    // The whole-page RoleGate is what would have deleted a CLIENT's access to
    // the proof reading. MemoryView.test.jsx proves the per-reading gates.
    const route = appSource.match(/path="memory"[\s\S]{0,600}?\/>\s*\n/)?.[0] ?? '';
    // Self-refutation: an extraction that matched nothing leaves `route` as ''
    // and makes the NEGATIVE assertion below pass for free. Prove the slice is
    // the route before reading anything out of it.
    expect(route).toMatch(/MemoryView|<Memory/);
    expect(route).toMatch(/PlanGate required="GROWTH"/);
    expect(route).not.toMatch(/RoleGate/);
  });
});
