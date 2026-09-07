// ============================================================
// FE-04 — Connectors is a destination, and it is the only one
// ------------------------------------------------------------
// `/app/connections` existed as a <Navigate> into a Settings tab labelled
// "Channels". B8-03 met the same shape at /app/decisions: the URL is present,
// the surface is not. This is a RECLAIM, not an invention.
//
// The discovery that made the slice worth its PR: NINE production call sites
// send an operator to `/app/settings/integrations`, including the first-run
// interrupt and the Sidebar's "Connect a channel" CTA. The single most
// important instruction the product gives a new account — connect a channel —
// resolved into a settings sub-tab.
//
// Read from App.jsx SOURCE via ?raw. `fileURLToPath(import.meta.url)` throws
// "The URL must be of scheme file" under the vitest transform (FE-02); Vite
// resolves ?raw itself and cannot drift from what ships.
// ============================================================
import { describe, it, expect } from 'vitest';
import appSource from '../../App.jsx?raw';
import { appRoutes, settingsSections, legacyAppRedirects } from '../routeManifest.js';

// Everything from `<Route path="X"` up to the next `<Route`. Coarse on purpose:
// it over-captures trailing comments rather than trying to balance JSX braces,
// and over-capturing cannot manufacture a PASS for the assertions below.
function routeBlock(path) {
  const chunks = appSource.split('<Route ');
  return chunks.find((c) => c.startsWith(`path="${path}"`)) ?? '';
}

const connections = routeBlock('connections');
const settingsChannels = routeBlock('settings/integrations');

describe('the extractor found something (self-refutation)', () => {
  // Without this, every `not.toMatch` below would pass on an empty string —
  // the vacuous-negative trap FE-02 caught in its own RED test.
  it('the connections block is a real route element', () => {
    expect(connections.length).toBeGreaterThan(80);
    expect(connections).toMatch(/element=/);
  });

  it('a path App.jsx does not declare extracts to nothing', () => {
    expect(routeBlock('definitely-not-a-route')).toBe('');
  });

  it('the extractor can still see a route that IS a redirect', () => {
    expect(routeBlock('home')).toMatch(/<Navigate/);
  });
});

describe('FE-04 · /app/connections renders the Connectors surface', () => {
  it('is named in the route manifest', () => {
    expect(appRoutes.connections).toBe('/app/connections');
  });

  it('renders ConnectorsView', () => {
    expect(connections).toMatch(/ConnectorsView/);
  });

  it('is no longer a redirect', () => {
    expect(connections).not.toMatch(/<Navigate/);
  });

  it('is lazy-loaded behind Suspense, like every other destination', () => {
    expect(connections).toMatch(/<Suspense/);
    expect(appSource).toMatch(/const ConnectorsView\s*=\s*lazy\(/);
  });
});

describe('FE-04 · the destination is an OPERATOR surface', () => {
  // Settings carried NO gate at all, so a CLIENT could reach Channels by URL.
  // That was an omission, not an entitlement: the backend already scopes the
  // writes (POST is BUYER+, PATCH is STRATEGIST). Ruled GATED.
  it('carries a RoleGate for STRATEGIST and BUYER', () => {
    expect(connections).toMatch(/RoleGate/);
    expect(connections).toMatch(/STRATEGIST/);
    expect(connections).toMatch(/BUYER/);
  });

  // Role authorization, not monetization. Connectors are how an account gets
  // ANY data at all; a plan gate here would lock a FREE workspace out of the
  // one action that makes the product work.
  it('carries NO PlanGate', () => {
    expect(connections).not.toMatch(/PlanGate/);
  });
});

describe('FE-04 · one object, one destination (B7 Ruling 2)', () => {
  it('Settings › Channels redirects to the destination rather than rendering it', () => {
    expect(settingsChannels).toMatch(/<Navigate/);
    expect(settingsChannels).toMatch(/appRoutes\.connections/);
  });

  it('Settings no longer lists a Channels tab', () => {
    expect(settingsSections.map((s) => s.key)).not.toContain('integrations');
    expect(settingsSections.map((s) => s.label)).not.toContain('Channels');
  });

  it('…but Settings still has its other tabs (self-refutation)', () => {
    expect(settingsSections.map((s) => s.key)).toEqual(
      expect.arrayContaining(['general', 'team', 'revenue', 'workspace', 'security']),
    );
  });

  it('the legacy redirect table records the new direction, not the old one', () => {
    const from = legacyAppRedirects.find((r) => r.from === 'connections');
    expect(from).toBeUndefined();
    expect(legacyAppRedirects).toContainEqual({ from: 'settings/integrations', to: appRoutes.connections });
  });
});

// ── the CTA census ──────────────────────────────────────────────────────────
// FE-03's census was wrong in BOTH directions before it was right, so this one
// carries its controls in the same file. Comments are stripped because a
// reference inside prose is not a link.
const sources = import.meta.glob('/src/**/*.{js,jsx,ts,tsx}', { query: '?raw', import: 'default', eager: true });

export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// The manifest is the ONE place the old address is still legitimately named:
// it is the source of a redirect, not the target of a link. App.jsx spells the
// same path as a literal route pattern, so it does not carry the identifier.
const ROUTE_TABLE = ['/src/app/routeManifest.js'];

describe('FE-04 · nothing points a person at the Settings tab any more', () => {
  const linkers = Object.entries(sources)
    .filter(([p]) => !p.includes('.test.') && !p.includes('__tests__'))
    .filter(([p]) => !ROUTE_TABLE.includes(p))
    .filter(([, src]) => stripComments(src).includes('settingsIntegrations'))
    .map(([p]) => p);

  it('no production surface links to /app/settings/integrations', () => {
    expect(linkers).toEqual([]);
  });

  // The census must be able to FIND the string somewhere, or the assertion
  // above is a measurement of nothing — the vacuous-empty-set trap. FE-03's
  // census would have reported "zero call sites" with a real one two lines
  // away; this is the control that would have caught it.
  it('the census can see the route table, which legitimately still names it', () => {
    const inTable = ROUTE_TABLE.filter((p) => stripComments(sources[p] ?? '').includes('settingsIntegrations'));
    expect(inTable).toEqual(ROUTE_TABLE);
  });

  // …and the same census, pointed at the NEW address, finds the call sites it
  // just failed to find at the old one. Without this, "nobody links to the old
  // tab" would also be true of an app where nobody links anywhere.
  it('the same census finds the CTAs at the new address', () => {
    const linkingToDestination = Object.entries(sources)
      .filter(([p]) => !p.includes('.test.') && !p.includes('__tests__'))
      .filter(([p]) => !ROUTE_TABLE.includes(p) && p !== '/src/App.jsx')
      .filter(([, src]) => stripComments(src).includes('appRoutes.connections'))
      .map(([p]) => p);
    expect(linkingToDestination.length).toBeGreaterThanOrEqual(7);
  });

  it('the census reads a real, populated source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(150);
  });

  it('a reference inside a COMMENT is not a link', () => {
    expect(stripComments('// go to appRoutes.settingsIntegrations\nconst x = 1;')).not.toMatch(/settingsIntegrations/);
    expect(stripComments('/* appRoutes.settingsIntegrations */\nconst x = 1;')).not.toMatch(/settingsIntegrations/);
  });
});
