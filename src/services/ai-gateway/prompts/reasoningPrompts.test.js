// ============================================================
// reasoningPrompts — EXPLAIN_VERDICT prompt building
// ------------------------------------------------------------
// Pins the honesty rules: null signals render as "not available" (never a bare
// null the model could invent around), the no-fabrication + brevity instructions
// are present, real values pass through, and dialect maps to a language.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildReasoningPrompt, languageForDialect } from './reasoningPrompts.js';

const FULL = {
  name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES',
  verdict: 'KILL', impactScore: 9, ctrPct: 0.42, frequency: 4.1, roas: 0.6,
  spendSharePct: 23.4, rationale: 'frequency 4.1 exceeds saturation threshold 3.0',
  accountObjective: 'roas', dialect: 'egy',
};

describe('languageForDialect', () => {
  it('maps onboarding dialect ids to a language, defaulting English', () => {
    expect(languageForDialect('egy')).toBe('Egyptian Arabic');
    expect(languageForDialect('gulf')).toBe('Gulf Arabic');
    expect(languageForDialect('xx')).toBe('English');
    expect(languageForDialect(undefined)).toBe('English');
  });
});

describe('buildReasoningPrompt', () => {
  it('threads real values into the user prompt', () => {
    const { user } = buildReasoningPrompt(FULL);
    expect(user).toContain('Eid Sale');
    expect(user).toContain('Verdict: KILL');
    expect(user).toContain('9/10');
    expect(user).toContain('0.42%');       // ctr already in percent
    expect(user).toContain('4.10');        // frequency
    expect(user).toContain('0.60x');       // roas
    expect(user).toContain('23.4% of account spend');
    expect(user).toContain('frequency 4.1 exceeds saturation threshold 3.0');
  });

  it('renders null signals as "not available" — never a bare null', () => {
    const { user } = buildReasoningPrompt({ name: 'Awareness', verdict: 'REFRESH', ctrPct: null, frequency: null, roas: null, spendSharePct: null, rationale: null });
    expect(user).not.toMatch(/null/);
    expect(user).toContain('CTR: not available');
    expect(user).toContain('Frequency: not available');
    expect(user).toContain('ROAS: not measured');
    expect(user).toContain('Spend share: not available');
  });

  it('system prompt sets language, forbids fabrication, and demands brevity', () => {
    const { system } = buildReasoningPrompt(FULL);
    expect(system).toContain('Egyptian Arabic');
    expect(system).toMatch(/never fabricate numbers/i);
    expect(system).toMatch(/2 to 3 sentences/i);
    expect(system).toContain('roas'); // account objective surfaced
  });

  it('falls back to English + a safe account objective when unset', () => {
    const { system } = buildReasoningPrompt({ name: 'X', verdict: 'HOLD' });
    expect(system).toContain('English');
    expect(system).toContain('performance marketing');
  });
});
