import { describe, it, expect } from 'vitest';
import { buildBuyerBand, buildStrategistBand, buildLoopStatus } from './AgentHomeService.js';

const agenda = {
  buyerBand: [{ id: 'verdict:d1', band: 'BUYER', type: 'VERDICT', title: 'KILL Cold #1', severity: 'HIGH', humanAction: 'confirm' }],
  strategistBand: [{ id: 'goal:g1', band: 'STRATEGIST', type: 'PLAN_ADJUSTMENT', title: 'Goal off track', severity: 'HIGH', humanAction: 'adjust' }],
  stageStatus: [{ stage: 'PLAN', state: 'ACTIVE', lastAt: '2026-06-07', count: 1 }],
  closed: true, staleStages: [], loopHealth: 'HEALTHY',
};

describe('AgentHomeService builders (pure, independent)', () => {
  it('buildBuyerBand shapes the "decide today" list', () => {
    const b = buildBuyerBand(agenda);
    expect(b.title).toMatch(/decision today/i);
    expect(b.count).toBe(1);
    expect(b.empty).toBe(false);
    expect(b.items[0].humanAction).toBe('confirm');
  });

  it('buildStrategistBand shapes the "tracking to goal" list', () => {
    const s = buildStrategistBand(agenda);
    expect(s.title).toMatch(/tracking to goal/i);
    expect(s.count).toBe(1);
  });

  it('builders report empty honestly', () => {
    expect(buildBuyerBand({ buyerBand: [] }).empty).toBe(true);
    expect(buildStrategistBand({ strategistBand: [] }).empty).toBe(true);
  });

  it('buildLoopStatus carries health + timing through', () => {
    const l = buildLoopStatus(agenda, { lastRunAt: '2026-06-09T00:00:00Z', nextRunAt: '2026-06-09T00:15:00Z', intervalMs: 900000 });
    expect(l.closed).toBe(true);
    expect(l.loopHealth).toBe('HEALTHY');
    expect(l.staleStages).toEqual([]);
    expect(l.lastRunAt).toBe('2026-06-09T00:00:00Z');
    expect(l.nextRunAt).toBe('2026-06-09T00:15:00Z');
  });

  it('buildLoopStatus defaults to STALLED when the agenda has no loop data', () => {
    const l = buildLoopStatus({});
    expect(l.loopHealth).toBe('STALLED');
    expect(l.closed).toBe(false);
  });
});
