// ============================================================
// Phase 5 memory — promotion governance + network anonymization
// ============================================================
// Proves the moat ties into existing governance and never leaks/lies:
//   1. A promotable pattern shapes into a valid GuardrailRule (rides the
//      Phase-2 sweep → verdict → execute loop, no new code).
//   2. A SUPERSEDED / CONFLICTED / low-accuracy / informational pattern is
//      REJECTED (throws), so contradictory/unproven rules never ship.
//   3. Network contributions carry no workspace identity.
// Pure helpers only — no DB.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { patternToGuardrailData } from './PlaybookService.js';
import { buildContributions }     from '../network-engine/NetworkService.js';

function established(overrides = {}) {
  return {
    status: 'ESTABLISHED', accuracy: 0.85, statement: 'On cold adsets, KILL once frequency passes ~3.5',
    metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'cold', comparator: 'GTE',
    threshold: 3.5, unit: 'RATIO', emitVerdict: 'KILL', sustainedDays: 1, promotedRuleId: null,
    ...overrides,
  };
}

describe('patternToGuardrailData — promotion governance', () => {
  it('shapes a promotable pattern into a valid GuardrailRule', () => {
    const data = patternToGuardrailData(established(), 'ws-1');
    expect(data.workspaceId).toBe('ws-1');
    expect(data.enabled).toBe(true);
    expect(data.metric).toBe('frequency');
    expect(data.comparator).toBe('GTE');
    expect(data.unit).toBe('RATIO');
    expect(data.emitVerdict).toBe('KILL');
    expect(data.threshold).toBe(3.5);
    expect(data.name).toMatch(/^Learned: /);
  });

  it('rejects a CONFLICTED pattern (never ships a contradictory rule)', () => {
    expect(() => patternToGuardrailData(established({ status: 'CONFLICTED' }), 'ws-1')).toThrow(/contested|CONFLICTED/i);
  });

  it('rejects a SUPERSEDED pattern', () => {
    expect(() => patternToGuardrailData(established({ status: 'SUPERSEDED' }), 'ws-1')).toThrow(/SUPERSEDED|reconciled/i);
  });

  it('rejects an EMERGING (not yet proven) pattern', () => {
    expect(() => patternToGuardrailData(established({ status: 'EMERGING' }), 'ws-1')).toThrow(/ESTABLISHED/i);
  });

  it('rejects a low-accuracy pattern', () => {
    expect(() => patternToGuardrailData(established({ accuracy: 0.4 }), 'ws-1')).toThrow(/accuracy/i);
  });

  it('rejects an informational pattern with no executable spec', () => {
    expect(() => patternToGuardrailData(established({ emitVerdict: null, metric: null, threshold: null }), 'ws-1'))
      .toThrow(/informational|spec/i);
  });

  it('rejects an already-promoted pattern', () => {
    expect(() => patternToGuardrailData(established({ promotedRuleId: 'rule-1' }), 'ws-1')).toThrow(/already/i);
  });
});

describe('buildContributions — network anonymization', () => {
  const rows = [
    { workspaceId: 'ws-secret-1', status: 'ESTABLISHED', accuracy: 0.8, metric: 'frequency', kind: 'FATIGUE_CEILING', threshold: 3.5, effectiveSupport: 4 },
    { workspaceId: 'ws-secret-2', status: 'EMERGING',    accuracy: 0.9, metric: 'frequency', kind: 'FATIGUE_CEILING', threshold: 3.6, effectiveSupport: 2 },
  ];

  it('includes only ESTABLISHED patterns and never leaks a workspace id', () => {
    const contributions = buildContributions(rows, 'EG-apparel');
    expect(contributions).toHaveLength(1); // EMERGING dropped
    expect(contributions[0].weight).toBe(4); // weighted by effective support
    const blob = JSON.stringify(contributions);
    expect(blob).not.toMatch(/ws-secret/);
    expect(contributions[0].workspaceId).toBeUndefined();
    expect(typeof contributions[0].workspaceKey).toBe('string'); // opaque token only
  });
});
