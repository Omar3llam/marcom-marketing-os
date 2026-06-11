import { describe, expect, it } from 'vitest';
import { mapNarrativeToDecision } from './services.js';

describe('mapNarrativeToDecision', () => {
  it('extracts campaign, verdict, and relative timestamp', () => {
    const decision = mapNarrativeToDecision({
      id: 'memory-1',
      line: 'Summer Launch \u2014 SCALE because CPA improved',
      recorded: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    expect(decision.id).toBe('memory-1');
    expect(decision.campaign).toBe('Summer Launch');
    expect(decision.verdict).toBe('SCALE');
    expect(decision.timestamp).toBe('30m ago');
  });

  it('falls back safely for malformed narratives', () => {
    const decision = mapNarrativeToDecision({ id: 'memory-2', line: '', recorded: 'not-a-date' });

    expect(decision.campaign).toBe('Unknown');
    expect(decision.verdict).toBe('TEST');
    expect(decision.timestamp).toBe('recent');
  });
});
