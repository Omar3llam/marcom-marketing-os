// ============================================================
// withContextAliases — context-shape reconciliation
// ============================================================
// The onboarding form shape (name, market id, industry) is persisted verbatim;
// these tests pin the additive aliases that let contextGuard / buildSystemPrompt
// resolve to real data without a rename. See context.js for the why.
import { describe, it, expect } from 'vitest';
import { withContextAliases, workspaceColumnsFromContext } from './context.js';

describe('withContextAliases', () => {
  it('aliases companyName from name without dropping name', () => {
    const out = withContextAliases({ name: 'Zara Egypt', market: 'eg' });
    expect(out.companyName).toBe('Zara Egypt');
    expect(out.name).toBe('Zara Egypt'); // original field untouched
  });

  it('maps a known market id to its full marketName', () => {
    expect(withContextAliases({ market: 'eg' }).marketName).toBe('Egypt');
    expect(withContextAliases({ market: 'sa' }).marketName).toBe('Saudi Arabia');
    expect(withContextAliases({ market: 'ae' }).marketName).toBe('UAE');
  });

  it('falls back to the raw market value when the id is unknown', () => {
    expect(withContextAliases({ market: 'Egypt' }).marketName).toBe('Egypt');
  });

  it('passes industry through verbatim (no alias needed)', () => {
    expect(withContextAliases({ industry: 'ecommerce' }).industry).toBe('ecommerce');
  });

  it('satisfies contextGuard required fields for a real onboarding payload', () => {
    const out = withContextAliases({ name: 'Acme', market: 'sa', industry: 'saas' });
    // contextGuard requires non-empty companyName, industry, market
    for (const field of ['companyName', 'industry', 'market']) {
      expect(out[field] && out[field].toString().trim()).toBeTruthy();
    }
  });

  it('does not overwrite an explicit companyName / marketName if already present', () => {
    const out = withContextAliases({ name: 'A', companyName: 'B', market: 'eg', marketName: 'Egypt (explicit)' });
    expect(out.companyName).toBe('B');
    expect(out.marketName).toBe('Egypt (explicit)');
  });

  it('is null-safe for non-object input', () => {
    expect(withContextAliases(null)).toBeNull();
    expect(withContextAliases(undefined)).toBeUndefined();
  });
});

describe('workspaceColumnsFromContext', () => {
  it('projects spendTier/objective verbatim and normalizes channels to uppercase Channel values', () => {
    const out = workspaceColumnsFromContext({
      spendTier: 't2', objective: 'roas', channels: { meta: true, google: true },
    });
    expect(out.spendTier).toBe('t2');
    expect(out.objective).toBe('roas');
    expect(out.adChannels.sort()).toEqual(['GOOGLE', 'META']);
  });

  it('drops unselected channels', () => {
    const out = workspaceColumnsFromContext({ channels: { meta: true, google: false } });
    expect(out.adChannels).toEqual(['META']);
  });

  it('falls back to null / empty when a step was skipped', () => {
    const out = workspaceColumnsFromContext({ name: 'Acme' });
    expect(out).toEqual({ spendTier: null, objective: null, adChannels: [] });
  });

  it('promotes a custom objective’s free text into the column (not the literal "custom")', () => {
    const out = workspaceColumnsFromContext({ objective: 'custom', customObjective: 'Grow B2B pipeline in KSA' });
    expect(out.objective).toBe('Grow B2B pipeline in KSA');
  });

  it('falls back to the literal "custom" when the custom text is empty / whitespace', () => {
    expect(workspaceColumnsFromContext({ objective: 'custom', customObjective: '   ' }).objective).toBe('custom');
    expect(workspaceColumnsFromContext({ objective: 'custom' }).objective).toBe('custom');
  });

  it('leaves a preset objective untouched (customObjective is ignored)', () => {
    const out = workspaceColumnsFromContext({ objective: 'roas', customObjective: 'ignored' });
    expect(out.objective).toBe('roas');
  });

  it('is null-safe for non-object input', () => {
    expect(workspaceColumnsFromContext(null)).toEqual({ spendTier: null, objective: null, adChannels: [] });
  });
});
