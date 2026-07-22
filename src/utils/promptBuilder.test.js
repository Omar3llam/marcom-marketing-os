import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const baseCtx = { companyName: 'Zara Egypt', industry: 'ecommerce', market: 'eg', marketName: 'Egypt' };

describe('buildSystemPrompt — onboarding preference lines (Wire-1)', () => {
  it('includes objective + spend tier when present', () => {
    const p = buildSystemPrompt({ ...baseCtx, objective: 'roas', spendTier: 't2' });
    expect(p).toContain('- Objective: roas');
    expect(p).toContain('- Spend tier: t2');
  });

  it('omits the objective/spend-tier lines entirely when absent (no empty labels)', () => {
    const p = buildSystemPrompt(baseCtx);
    expect(p).not.toContain('Objective:');
    expect(p).not.toContain('Spend tier:');
  });
});

describe('buildSystemPrompt — graceful degradation (PR#264)', () => {
  it('does not throw on a name-only context', () => {
    expect(() => buildSystemPrompt({ name: 'Acme' })).not.toThrow();
  });

  it('does not throw on an empty context', () => {
    expect(() => buildSystemPrompt({})).not.toThrow();
  });

  it('name-only → Market defaults to MENA', () => {
    expect(buildSystemPrompt({ name: 'Acme' })).toContain('- Market: MENA');
  });

  it('name-only → omits the Industry line entirely (never fabricated)', () => {
    expect(buildSystemPrompt({ name: 'Acme' })).not.toContain('Industry:');
  });

  it('no identity (null companyName + null name) → omits the Business line', () => {
    expect(buildSystemPrompt({ market: 'eg' })).not.toContain('Business:');
  });

  it('{ name } → Business line resolved from name', () => {
    expect(buildSystemPrompt({ name: 'Acme' })).toContain('- Business: Acme');
  });

  it('{ companyName } → Business line (backward compat)', () => {
    expect(buildSystemPrompt({ companyName: 'Acme' })).toContain('- Business: Acme');
  });

  it('industry present → Industry line', () => {
    expect(buildSystemPrompt({ name: 'Acme', industry: 'SaaS' })).toContain('- Industry: SaaS');
  });

  it('objective present → Objective line', () => {
    expect(buildSystemPrompt({ name: 'Acme', objective: 'roas' })).toContain('- Objective: roas');
  });
});
