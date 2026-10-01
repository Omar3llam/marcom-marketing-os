// ============================================================
// promoteTestToHoldout — the Phase-7C Testing→Incrementality bridge
// ============================================================
// Proves the bridge derives (never fabricates) the holdout's baseline from the
// concluded test's control arm, copies the entity binding, seeds mde from the
// observed lift, stamps the sourceTestId provenance FK, and refuses to promote
// a test that cannot honestly seed a power calc (not concluded / no control /
// zero control clicks). designTest() is called AS-IS — the engine is untouched.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../connectors/credentialStore.js', () => ({ resolveCredential: vi.fn() }));
vi.mock('../incrementality-engine/IncrementalityService.js', () => ({ designTest: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    testExperiment:     { findFirst: vi.fn() },
    incrementalityTest: { update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { designTest } from '../incrementality-engine/IncrementalityService.js';
import { promoteTestToHoldout } from './TestTrackerService.js';

const control = (over = {}) => ({ id: 'v-a', label: 'A', isControl: true,  clicks: 1000, conversions: 50, ...over });
const arm     = (over = {}) => ({ id: 'v-b', label: 'B', isControl: false, clicks: 1000, conversions: 80, ...over });

function concludedTest(over = {}) {
  return {
    id: 'test-1', workspaceId: 'ws-1', status: 'CONCLUDED',
    entityId: 'ent-1', entityLevel: 'ADSET', dimension: 'HOOK', lift: 31,
    variants: [control(), arm()],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  designTest.mockResolvedValue({ id: 'inc-1', design: { holdoutPct: 0.1, sampleSizePerArm: 1000, durationDays: 14 } });
  prisma.incrementalityTest.update.mockImplementation(async ({ data }) => ({ id: 'inc-1', status: 'DESIGNED', ...data }));
});

describe('promoteTestToHoldout — happy path', () => {
  it('derives baselineCvr from the control arm, copies the entity binding, defaults channel, and stamps sourceTestId', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest());

    const out = await promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 });

    // designTest called as-is with the DERIVED baseline (50/1000) + copied binding.
    const arg = designTest.mock.calls[0][1];
    expect(designTest.mock.calls[0][0]).toBe('ws-1');
    expect(arg.baselineCvr).toBeCloseTo(0.05, 6);
    expect(arg.entityId).toBe('ent-1');
    expect(arg.entityLevel).toBe('ADSET');
    expect(arg.channel).toBe('META');         // not on a TestExperiment → default
    expect(arg.dailyEligible).toBe(4000);

    // sourceTestId stamped after create (designTest never receives it).
    expect(arg.sourceTestId).toBeUndefined();
    expect(prisma.incrementalityTest.update).toHaveBeenCalledWith({
      where: { id: 'inc-1' }, data: { sourceTestId: 'test-1' },
    });
    expect(out.sourceTestId).toBe('test-1');
    expect(out.incrementalRevenueMinor).toBeNull();
    expect(out.monetary).toMatchObject({
      status: 'INSUFFICIENT_EVIDENCE', currency: null, incrementalRevenueMinor: null,
    });
    expect(out.design).toEqual({ holdoutPct: 0.1, sampleSizePerArm: 1000, durationDays: 14 });
  });

  it('seeds mde from the observed lift (percent → fraction) when not supplied', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest({ lift: 31 }));
    await promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 });
    expect(designTest.mock.calls[0][1].mde).toBeCloseTo(0.31, 6);
  });

  it('honours an operator-supplied mde and channel over the seeds', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest());
    await promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000, mde: 0.2, channel: 'GOOGLE' });
    const arg = designTest.mock.calls[0][1];
    expect(arg.mde).toBe(0.2);
    expect(arg.channel).toBe('GOOGLE');
  });

  it('falls back to a neutral mde when the test has no positive lift', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest({ lift: 0 }));
    await promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 });
    expect(designTest.mock.calls[0][1].mde).toBeCloseTo(0.1, 6);
  });
});

describe('promoteTestToHoldout — refuses to fabricate a holdout', () => {
  it('throws when the test is not CONCLUDED', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest({ status: 'RUNNING' }));
    await expect(promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 })).rejects.toThrow(/not CONCLUDED/);
    expect(designTest).not.toHaveBeenCalled();
  });

  it('throws when there is no control variant (no baseline to derive)', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest({ variants: [arm(), arm({ id: 'v-c' })] }));
    await expect(promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 })).rejects.toThrow(/no control variant/);
    expect(designTest).not.toHaveBeenCalled();
  });

  it('throws when the control arm has zero clicks (cannot derive baselineCvr)', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(concludedTest({ variants: [control({ clicks: 0 }), arm()] }));
    await expect(promoteTestToHoldout('ws-1', 'test-1', { dailyEligible: 4000 })).rejects.toThrow(/zero clicks/);
    expect(designTest).not.toHaveBeenCalled();
  });

  it('throws when the test is not found', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(null);
    await expect(promoteTestToHoldout('ws-1', 'missing', { dailyEligible: 4000 })).rejects.toThrow(/not found/);
  });
});
