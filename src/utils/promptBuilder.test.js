import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const baseCtx = { companyName: 'Zara Egypt', industry: 'ecommerce', market: 'eg', marketName: 'Egypt' };

describe('buildSystemPrompt — onboarding preference lines (Wire-1)', () => {
  it('includes objective + spend tier when present', () => {
    const p = buildSystemPrompt({ ...baseCtx, objective: 'roas', spendTier: 't2' });
    expect(p).toContain('- Objective: roas');
    expect(p).toContain('- Spend tier: t2');
  });

  it('omits the lines entirely when the fields are absent (no empty labels)', () => {
    const p = buildSystemPrompt(baseCtx);
    expect(p).not.toContain('Objective:');
    expect(p).not.toContain('Spend tier:');
  });

  it('still throws when the hard-lock trio is missing', () => {
    expect(() => buildSystemPrompt({ objective: 'roas' })).toThrow(/companyName, industry, and market/);
  });
});
