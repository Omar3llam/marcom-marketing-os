// ============================================================
// pdfExport — honesty of the pure report helpers
// ------------------------------------------------------------
// These pin the two rules the audit cared about without booting jsPDF (it's
// dynamically imported inside generateCampaignReport, so importing the pure
// helpers never loads it):
//   • a null health score is an honest "— / 100" in a neutral tone, never a
//     green "null / 100"
//   • the verdict distribution counts ALL six engine verdicts, collapsed into
//     three lanes whose percentages always sum to 100
// ============================================================
import { describe, it, expect } from 'vitest';
import { healthDisplay, buildVerdictLanes, VERDICT_LANES } from './pdfExport.js';

describe('healthDisplay — honest null health', () => {
  it('null score → "— / 100", neutral tone, never green', () => {
    const hd = healthDisplay(null, null);
    expect(hd.scoreText).toBe('— / 100');
    expect(hd.tone).toBe('neutral');
    expect(hd.labelText).toBe('SYNC META TO SCORE');
  });

  it('a real score keeps its value and maps tone by threshold', () => {
    expect(healthDisplay(35, 'critical')).toMatchObject({ scoreText: '35 / 100', tone: 'danger' });
    expect(healthDisplay(55, 'fair')).toMatchObject({ scoreText: '55 / 100', tone: 'warning' });
    expect(healthDisplay(85, 'healthy')).toMatchObject({ scoreText: '85 / 100', tone: 'success' });
  });

  it('uppercases the engine label', () => {
    expect(healthDisplay(70, 'Improving').labelText).toBe('IMPROVING');
  });
});

describe('buildVerdictLanes — all six verdicts, lanes sum to 100%', () => {
  it('counts KILL/REALLOCATE, HOLD/WATCH/REFRESH, SCALE (nothing dropped)', () => {
    const campaigns = [
      { verdict: 'KILL' }, { verdict: 'REALLOCATE' },      // kill lane → 2
      { verdict: 'HOLD' }, { verdict: 'WATCH' }, { verdict: 'REFRESH' }, // hold lane → 3
      { verdict: 'SCALE' },                                 // scale lane → 1
      { verdict: null },                                    // gated — excluded from denominator
    ];
    const lanes = buildVerdictLanes(campaigns);
    expect(lanes.map((l) => l.count)).toEqual([2, 3, 1]);
    // Every SCORED verdict is counted exactly once (WATCH/REFRESH/REALLOCATE not lost).
    expect(lanes.reduce((s, l) => s + l.count, 0)).toBe(6);
    // The three integer percentages always sum to 100.
    expect(lanes.reduce((s, l) => s + l.pct, 0)).toBe(100);
  });

  it('the three lanes together cover all six engine verdicts', () => {
    const covered = VERDICT_LANES.flatMap((l) => l.verdicts).sort();
    expect(covered).toEqual(['HOLD', 'KILL', 'REALLOCATE', 'REFRESH', 'SCALE', 'WATCH']);
  });

  it('no scored campaigns → zero counts, no divide-by-zero', () => {
    const lanes = buildVerdictLanes([{ verdict: null }, {}]);
    expect(lanes.map((l) => l.count)).toEqual([0, 0, 0]);
    expect(lanes.reduce((s, l) => s + l.pct, 0)).toBe(0);
  });
});
