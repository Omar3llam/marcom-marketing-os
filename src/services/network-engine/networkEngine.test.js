// ============================================================
// NetworkEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { aggregateNetwork }  from './networkEngine.js';
import { NETWORK_STATUS }     from './networkTypes.js';

function contrib(workspaceKey, accuracy, { cohortTag = 'EG-apparel', kind = 'FATIGUE_CEILING', metric = 'frequency', threshold = 3.5, weight = 1 } = {}) {
  return { workspaceKey, accuracy, cohortTag, kind, metric, threshold, weight };
}

describe('aggregateNetwork — k-anonymity gate', () => {
  it('suppresses a cohort with fewer than K distinct workspaces', () => {
    const contributions = [contrib('w1', 0.8), contrib('w2', 0.8), contrib('w3', 0.8)]; // 3 < K(5)
    const [insight] = aggregateNetwork({ contributions, config: { k: 5, minSupport: 1 } });
    expect(insight.status).toBe(NETWORK_STATUS.INSUFFICIENT_DATA);
    expect(insight.contributingWorkspaces).toBe(3);
    expect(insight.holdRate).toBeUndefined();   // no claim emitted
    expect(insight.accuracyBand).toBeUndefined();
  });

  it('does not count repeated contributions from the same workspace toward K', () => {
    const contributions = [contrib('w1', 0.8), contrib('w1', 0.9), contrib('w1', 0.7), contrib('w2', 0.8)];
    const [insight] = aggregateNetwork({ contributions, config: { k: 5, minSupport: 1 } });
    expect(insight.status).toBe(NETWORK_STATUS.INSUFFICIENT_DATA);
    expect(insight.contributingWorkspaces).toBe(2); // distinct, not 4
  });
});

describe('aggregateNetwork — banded insight above the gate', () => {
  const contributions = [
    contrib('w1', 0.8), contrib('w2', 0.7), contrib('w3', 0.9),
    contrib('w4', 0.8), contrib('w5', 0.6), contrib('w6', 0.85),
  ]; // 6 distinct ≥ K(5)

  it('emits a banded insight with an anonymized count and NO identities', () => {
    const [insight] = aggregateNetwork({ contributions, config: { k: 5, minSupport: 5 } });
    expect(insight.status).toBe(NETWORK_STATUS.OK);
    expect(insight.contributingWorkspaces).toBe(6);
    // a band, never a point
    expect(Array.isArray(insight.accuracyBand)).toBe(true);
    expect(insight.accuracyBand[0]).toBeLessThan(insight.accuracyBand[1]);
    expect(insight.holdRate).toBeGreaterThan(0);
    // never leaks a workspace identity
    expect(JSON.stringify(insight)).not.toMatch(/w[1-6]/);
    expect(insight.workspaceKey).toBeUndefined();
  });

  it('computes a weighted hold-rate', () => {
    const [insight] = aggregateNetwork({ contributions, config: { k: 5, minSupport: 5 } });
    // mean of [.8,.7,.9,.8,.6,.85] = 0.775
    expect(insight.holdRate).toBeCloseTo(0.78, 1);
  });

  it('is deterministic', () => {
    const a = aggregateNetwork({ contributions, config: { k: 5, minSupport: 5 } });
    const b = aggregateNetwork({ contributions, config: { k: 5, minSupport: 5 } });
    expect(a).toEqual(b);
  });
});
