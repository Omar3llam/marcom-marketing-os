// ============================================================
// Phase 5.2 — the destination a visitor gets sent back to
// ------------------------------------------------------------
// One validator, so every guard preserves the same set of destinations and no
// guard can be talked into leaving the app.
// ============================================================
import { describe, it, expect } from 'vitest';
import { safeNextPath, currentDestination, loginPathFor } from '../nextPath.js';

describe('safeNextPath — what may be restored', () => {
  it('keeps every internal destination a guard can bounce, query and hash included', () => {
    for (const path of [
      '/app/overview',
      '/app/decisions',
      '/app/decisions/123',
      '/app/memory?filter=recent',
      '/app/settings/team#invite',
      '/onboarding',
      '/onboarding?next=%2Fapp%2Fmemory',
      '/admin',
      '/unknown-route',
    ]) {
      expect(safeNextPath(path)).toBe(path);
    }
  });

  it('refuses anything that would leave this origin', () => {
    for (const hostile of [
      'https://evil.example/app',
      '//evil.example',
      // `/\evil.example`, built without an escape so no tool can eat the backslash.
      `/${String.fromCharCode(92)}evil.example`,
      'app/overview',
      '',
      null,
      undefined,
      42,
      '/app/overview\nSet-Cookie: x',
    ]) {
      expect(safeNextPath(hostile)).toBeNull();
    }
  });

  it('refuses the auth pages themselves, which would be a loop', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=%2Fapp')).toBeNull();
    expect(safeNextPath('/signup')).toBeNull();
    expect(safeNextPath('/signup/step-2')).toBeNull();
  });

  // The router matches routes case-insensitively, so a case-varied spelling of
  // an auth page IS that auth page. `matchPath('/login', '/LOGIN')` matches —
  // measured, not assumed — which is why the comparison is lower-cased.
  it('refuses them however they are spelled, because the router does not care', () => {
    for (const spelling of ['/LOGIN', '/Login', '/lOgIn?next=%2Fapp', '/SIGNUP', '/SignUp/step-2']) {
      expect(safeNextPath(spelling)).toBeNull();
    }
  });
});

describe('loginPathFor — built once, encoded once', () => {
  const at = (pathname, search = '', hash = '') => ({ pathname, search, hash });

  it('carries the whole address', () => {
    expect(loginPathFor(at('/app/decisions/123'))).toBe('/login?next=%2Fapp%2Fdecisions%2F123');
    expect(loginPathFor(at('/app/memory', '?filter=recent'))).toBe('/login?next=%2Fapp%2Fmemory%3Ffilter%3Drecent');
    expect(loginPathFor(at('/admin'))).toBe('/login?next=%2Fadmin');
    expect(loginPathFor(at('/onboarding', '?next=%2Fapp%2Fmemory'))).toBe('/login?next=%2Fonboarding%3Fnext%3D%252Fapp%252Fmemory');
  });

  it('decodes back to exactly what was asked for — no double encoding', () => {
    const asked = '/app/memory?filter=recent';
    const built = loginPathFor(at('/app/memory', '?filter=recent'));
    const carried = new URLSearchParams(built.split('?').slice(1).join('?')).get('next');
    expect(carried).toBe(asked);
    expect(safeNextPath(carried)).toBe(asked);
  });

  it('drops a destination it may not restore rather than passing it on', () => {
    expect(loginPathFor(at('/login'))).toBe('/login');
    expect(loginPathFor(at(''))).toBe('/login');
  });

  it('reads an address the way the router reports one', () => {
    expect(currentDestination(at('/app/memory', '?filter=recent', '#top'))).toBe('/app/memory?filter=recent#top');
    expect(currentDestination({})).toBe('');
  });
});
