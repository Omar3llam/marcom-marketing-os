// ============================================================
// resolveBrandContext — onboarding ids → readable, real descriptors
// ------------------------------------------------------------
// The resolver is the only place onboarding selections become the strings sent
// to the AI gateway, so it carries the honesty contract: real labels when the
// signal exists, null (never a fabricated value) when it doesn't.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveBrandContext } from './brandContext.js';

const FULL = {
  name: 'Acme', industry: 'ecommerce', market: 'eg', city: 'Cairo',
  ages: { '25-34': true, '35-44': true }, gender: 'female', interests: { Fashion: true },
  language: 'both', dialect: 'egy', tone: 'bold',
  objective: 'roas', customObjective: '',
};

describe('resolveBrandContext', () => {
  it('maps every onboarding id to its real human label', () => {
    const b = resolveBrandContext(FULL);
    expect(b.industry).toBe('E-commerce / Retail');
    expect(b.objective).toBe('Maximize ROAS, minimize bleed');
    expect(b.toneLabel).toBe('Bold & rebellious');
    expect(b.brandVoice).toContain('Bold & rebellious');
    expect(b.brandVoice).toContain('Punchy, provocative, opinionated'); // tone sub
    expect(b.brandVoice).toContain('Egyptian dialect');                  // language + dialect
    expect(b.audience).toContain('25 – 34');
    expect(b.audience).toContain('Female-leaning');
    expect(b.audience).toContain('Fashion');
  });

  it('uses the custom objective text when objective is "custom"', () => {
    const b = resolveBrandContext({ ...FULL, objective: 'custom', customObjective: 'Hit 5,000 app installs under $2 CPI' });
    expect(b.objective).toBe('Hit 5,000 app installs under $2 CPI');
  });

  it('omits the dialect for an English-only brand', () => {
    const b = resolveBrandContext({ ...FULL, language: 'en', dialect: 'egy' });
    expect(b.brandVoice).toContain('English');
    expect(b.brandVoice).not.toContain('dialect');
  });

  it('returns all-null for a missing/empty context — no fabrication', () => {
    expect(resolveBrandContext(null)).toEqual({
      brandVoice: null, toneLabel: null, industry: null, objective: null, audience: null,
    });
    expect(resolveBrandContext({})).toEqual({
      brandVoice: null, toneLabel: null, industry: null, objective: null, audience: null,
    });
  });

  it('nulls only the fields that are absent, keeping the ones present', () => {
    const b = resolveBrandContext({ industry: 'saas' });
    expect(b.industry).toBe('SaaS / Subscription');
    expect(b.toneLabel).toBeNull();
    expect(b.audience).toBeNull();
    expect(b.objective).toBeNull();
  });
});
