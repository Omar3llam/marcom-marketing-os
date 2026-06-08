import { describe, it, expect } from 'vitest';
import { incrementalityToMemory } from './IncrementalityService.js';

describe('incrementalityToMemory — closes the loop into Phase-5 memory', () => {
  const test = { workspaceId: 'ws-1', channel: 'META', entityId: 'ent-1' };

  it('writes a sustainable causal learning for a confident positive lift', () => {
    const readout = { conclusive: true, liftPct: 18.2, ci: [0.01, 0.03], confidenceLabel: 'HIGH', rationale: '...' };
    const mem = incrementalityToMemory(test, readout);
    expect(mem.actionType).toBe('incrementality:META');
    expect(mem.isSustainable).toBe(true);
    expect(mem.rationale).toMatch(/incremental/i);
    expect(mem.workspaceId).toBe('ws-1');
  });

  it('records an inconclusive holdout honestly (not sustainable)', () => {
    const readout = { conclusive: false, liftPct: 4, ci: [-0.01, 0.02], confidenceLabel: 'LOW', rationale: 'CI includes zero — INCONCLUSIVE.' };
    const mem = incrementalityToMemory(test, readout);
    expect(mem.isSustainable).toBe(false);
    expect(mem.rationale).toMatch(/INCONCLUSIVE/i);
  });

  it('throws without a workspace', () => {
    expect(() => incrementalityToMemory({}, { conclusive: false })).toThrow(/workspaceId/);
  });
});
