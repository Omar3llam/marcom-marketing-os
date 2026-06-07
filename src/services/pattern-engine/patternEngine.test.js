// ============================================================
// PatternEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { extractPatterns }            from './patternEngine.js';
import { PATTERN_KIND, PATTERN_STATUS } from './patternTypes.js';

const NOW = new Date('2026-06-09T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
function killAt(freq, { at = daysAgo(10), audienceTag = null, verdict = 'KILL', level = 'ADSET' } = {}) {
  const id = `d-${seq++}`;
  const entityId = `e-${seq}`;
  return {
    decision: { id, entityId, entityLevel: level, verdict, audienceTag, createdAt: at },
    snapshot: { entityId, date: at, frequency: freq, roas: 0.7, ctr: 0.5, spendMinor: 100000 },
    id,
  };
}
function scaleAt(roas, { at = daysAgo(10), level = 'CAMPAIGN', audienceTag = null } = {}) {
  const id = `d-${seq++}`;
  const entityId = `e-${seq}`;
  return {
    decision: { id, entityId, entityLevel: level, verdict: 'SCALE', audienceTag, createdAt: at },
    snapshot: { entityId, date: at, frequency: 1.4, roas, ctr: 2.4, spendMinor: 500000 },
    id,
  };
}
function build(events, sustainedFlags = {}) {
  return {
    decisions: events.map((e) => e.decision),
    snapshots: events.map((e) => e.snapshot),
    outcomes:  events.map((e) => ({ decisionId: e.id, sustained: sustainedFlags[e.id] ?? true })),
  };
}

describe('extractPatterns — FATIGUE_CEILING', () => {
  it('extracts an ESTABLISHED, promotable ceiling with accuracy from repeated sustained KILLs', () => {
    const events = [killAt(3.4), killAt(3.5), killAt(3.6), killAt(3.5)];
    const patterns = extractPatterns({ ...build(events), now: NOW });
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(fatigue).toBeTruthy();
    expect(fatigue.status).toBe(PATTERN_STATUS.ESTABLISHED);
    expect(fatigue.promotable).toBe(true);
    expect(fatigue.emitVerdict).toBe('KILL');
    expect(fatigue.metric).toBe('frequency');
    expect(fatigue.threshold).toBeGreaterThanOrEqual(3.4);
    expect(fatigue.threshold).toBeLessThanOrEqual(3.6);
    expect(fatigue.accuracy).toBe(1); // all sustained
  });

  it('stays EMERGING (and not promotable) at low support', () => {
    const events = [killAt(3.5), killAt(3.6)];
    const patterns = extractPatterns({ ...build(events), now: NOW });
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(fatigue.status).toBe(PATTERN_STATUS.EMERGING);
    expect(fatigue.promotable).toBe(false);
  });

  it('is NOT promotable when accuracy is below the floor even with enough support', () => {
    const events = [killAt(3.5), killAt(3.5), killAt(3.6), killAt(3.4)];
    // none of them sustained → accuracy 0
    const sustained = Object.fromEntries(events.map((e) => [e.id, false]));
    const patterns = extractPatterns({ ...build(events, sustained), now: NOW });
    const fatigue = patterns.find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(fatigue.accuracy).toBe(0);
    expect(fatigue.status).toBe(PATTERN_STATUS.EMERGING); // support ok, accuracy not
    expect(fatigue.promotable).toBe(false);
  });
});

describe('extractPatterns — recency decay', () => {
  it('the same evidence is ESTABLISHED when recent but decays to EMERGING when stale', () => {
    const fresh = [killAt(3.5, { at: daysAgo(10) }), killAt(3.5, { at: daysAgo(20) }),
                   killAt(3.6, { at: daysAgo(30) }), killAt(3.4, { at: daysAgo(15) })];
    const established = extractPatterns({ ...build(fresh), now: NOW })
      .find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    expect(established.status).toBe(PATTERN_STATUS.ESTABLISHED);

    const stale = [killAt(3.5, { at: daysAgo(150) }), killAt(3.5, { at: daysAgo(160) }),
                   killAt(3.6, { at: daysAgo(140) }), killAt(3.4, { at: daysAgo(155) })];
    const decayed = extractPatterns({ ...build(stale), now: NOW })
      .find((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING);
    // 4 × weight 0.5 = effectiveSupport 2.0 (≥ minSupport 2, < minEstablished 3) → EMERGING
    expect(decayed.status).toBe(PATTERN_STATUS.EMERGING);
    expect(decayed.effectiveSupport).toBeLessThan(established.effectiveSupport);
  });
});

describe('extractPatterns — conflict resolution', () => {
  it('flags two opposite, equally-accurate patterns on the same audience as CONFLICTED (neither promotable)', () => {
    const kills    = [killAt(3.5, { audienceTag: 'cold', verdict: 'KILL' }), killAt(3.6, { audienceTag: 'cold', verdict: 'KILL' }), killAt(3.5, { audienceTag: 'cold', verdict: 'KILL' })];
    const refreshes = [killAt(3.5, { audienceTag: 'cold', verdict: 'REFRESH' }), killAt(3.6, { audienceTag: 'cold', verdict: 'REFRESH' }), killAt(3.5, { audienceTag: 'cold', verdict: 'REFRESH' })];
    const events = [...kills, ...refreshes];
    const patterns = extractPatterns({ ...build(events), now: NOW });
    const fatigues = patterns.filter((p) => p.kind === PATTERN_KIND.FATIGUE_CEILING && p.audienceTag === 'cold');
    expect(fatigues).toHaveLength(2);
    for (const p of fatigues) {
      expect(p.status).toBe(PATTERN_STATUS.CONFLICTED);
      expect(p.promotable).toBe(false);
    }
  });

  it('supersedes the lower-accuracy pattern when one clearly wins', () => {
    const kills    = [killAt(3.5, { audienceTag: 'warm', verdict: 'KILL' }), killAt(3.6, { audienceTag: 'warm', verdict: 'KILL' }), killAt(3.5, { audienceTag: 'warm', verdict: 'KILL' }), killAt(3.4, { audienceTag: 'warm', verdict: 'KILL' })];
    const refreshes = [killAt(3.5, { audienceTag: 'warm', verdict: 'REFRESH' }), killAt(3.6, { audienceTag: 'warm', verdict: 'REFRESH' }), killAt(3.5, { audienceTag: 'warm', verdict: 'REFRESH' })];
    const sustained = {
      ...Object.fromEntries(kills.map((e) => [e.id, true])),     // KILL accuracy 1.0
      ...Object.fromEntries(refreshes.map((e) => [e.id, false])), // REFRESH accuracy 0.0
    };
    const patterns = extractPatterns({ ...build([...kills, ...refreshes], sustained), now: NOW });
    const kill    = patterns.find((p) => p.audienceTag === 'warm' && p.emitVerdict === 'KILL');
    const refresh = patterns.find((p) => p.audienceTag === 'warm' && p.emitVerdict === 'REFRESH');
    expect(kill.status).toBe(PATTERN_STATUS.ESTABLISHED);
    expect(kill.promotable).toBe(true);
    expect(refresh.status).toBe(PATTERN_STATUS.SUPERSEDED);
    expect(refresh.supersededByKey).toBe(kill.key);
    expect(refresh.promotable).toBe(false);
  });
});

describe('extractPatterns — SCALING_WINDOW + determinism', () => {
  it('extracts a promotable ROAS scaling floor', () => {
    const events = [scaleAt(3.0), scaleAt(3.2), scaleAt(2.9)];
    const patterns = extractPatterns({ ...build(events), now: NOW });
    const scaling = patterns.find((p) => p.kind === PATTERN_KIND.SCALING_WINDOW);
    expect(scaling).toBeTruthy();
    expect(scaling.metric).toBe('roas');
    expect(scaling.emitVerdict).toBe('SCALE');
    expect(scaling.threshold).toBeGreaterThan(2);
  });

  it('is deterministic', () => {
    const events = [killAt(3.5), killAt(3.6), killAt(3.5)];
    const inp = build(events);
    expect(extractPatterns({ ...inp, now: NOW })).toEqual(extractPatterns({ ...inp, now: NOW }));
  });
});
