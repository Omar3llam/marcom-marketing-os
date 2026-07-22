import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate mode5 from the network (callClaude) and dialect resolution so the test
// exercises only the buildSystemPrompt path that PR#264 made null-safe.
vi.mock('../utils/claude.js', () => ({
  callClaude: vi.fn(),
  stripJsonFences: (s) => s,
}));
vi.mock('../utils/dialectContext.js', () => ({
  extractDialectContext: () => ({}),
  MODE_PLATFORM_HINTS: { mode5: 'b2b_email' },
}));

import { callClaude } from '../utils/claude.js';
import { runMode5 } from './mode5-campaign.js';

const session = {
  context_summary: '',
  campaign_analysis_log: '',
  current_section: 1,
  context_locked: false,
  service_history: [],
};

beforeEach(() => {
  callClaude.mockReset();
  callClaude.mockResolvedValue('{"summary":"ok"}');
});

describe('runMode5 — graceful context (PR#264)', () => {
  it('does not throw on a name-only context', async () => {
    await expect(runMode5(session, 'analyze', [], { name: 'Acme' })).resolves.toBeTruthy();
  });

  it('name-only → system prompt scopes to Market: MENA', async () => {
    await runMode5(session, 'analyze', [], { name: 'Acme' });
    const arg = callClaude.mock.calls[0][0];
    expect(arg.systemPrompt).toContain('Market: MENA');
  });

  it('name-only → system prompt omits the Industry line', async () => {
    await runMode5(session, 'analyze', [], { name: 'Acme' });
    const arg = callClaude.mock.calls[0][0];
    expect(arg.systemPrompt).not.toContain('Industry:');
  });
});
