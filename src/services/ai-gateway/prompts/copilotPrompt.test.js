// ============================================================
// copilotPrompt — pure prompt-builder tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCopilotSystemPrompt, buildCopilotUserPrompt } from './copilotPrompt.js';

describe('buildCopilotSystemPrompt', () => {
  const workspace = { name: 'Acme', currency: 'EGP', objective: 'sales', industry: 'retail', market: 'EG' };
  const campaigns = [
    { name: 'Ramadan Wave', channel: 'meta', verdict: 'KILL', rationale: 'ROAS below breakeven', roas: 0.8, ctr: 0.012, frequency: 4.2, spendMinor: 1234500, currency: 'EGP' },
  ];

  it('injects workspace context + campaign facts (grounding)', () => {
    const s = buildCopilotSystemPrompt(workspace, campaigns, 'Two campaigns need attention.');
    expect(s).toContain('WORKSPACE: Acme');
    expect(s).toContain('CURRENCY: EGP');
    expect(s).toContain('Ramadan Wave (meta)');
    expect(s).toContain('→ KILL');
    expect(s).toContain('ROAS 0.80x');
    expect(s).toContain('CTR 1.20%');
    expect(s).toContain('Freq 4.2');
    expect(s).toContain('ACCOUNT BRIEFING:');
  });

  it('forbids fabrication + demands honesty in the rules', () => {
    const s = buildCopilotSystemPrompt(workspace, campaigns, null);
    expect(s).toMatch(/[Nn]ever fabricate/);
    expect(s).toMatch(/say so plainly/i);
    expect(s).not.toContain('ACCOUNT BRIEFING'); // omitted when no briefing
  });

  it('is honest when no campaigns are synced', () => {
    const s = buildCopilotSystemPrompt(workspace, [], null);
    expect(s).toContain('No campaigns synced yet.');
  });

  it('never throws on empty/undefined inputs', () => {
    expect(() => buildCopilotSystemPrompt()).not.toThrow();
    expect(buildCopilotSystemPrompt()).toContain('WORKSPACE: Unknown');
  });
});

describe('buildCopilotUserPrompt', () => {
  it('returns just the question when there is no history', () => {
    expect(buildCopilotUserPrompt([], 'Why did CPA jump?')).toBe('Why did CPA jump?');
  });

  it('renders a labelled transcript before the current question', () => {
    const u = buildCopilotUserPrompt(
      [{ role: 'user', content: 'Which to pause?' }, { role: 'assistant', content: 'Ramadan Wave.' }],
      'Why that one?',
    );
    expect(u).toContain('User: Which to pause?');
    expect(u).toContain('Lumi: Ramadan Wave.');
    expect(u).toContain('Current question: Why that one?');
  });

  it('drops malformed turns', () => {
    const u = buildCopilotUserPrompt([{ role: 'system', content: 'x' }, { role: 'user' }, null], 'Q');
    expect(u).toBe('Q'); // nothing valid → just the question
  });
});
