// ============================================================
// C-04 — connector readiness, one axis at a time
// ------------------------------------------------------------
// The danger this file exists for is NOT that a fact is missing. It is that the
// projection turns several different facts into the same word, which is how a
// small dashboard lie becomes a policy.
//
// So there is one describe per axis, and inside each one the assertions that
// matter most are the NEGATIVE ones — `not.toBe(...)` against the state this
// one is most easily confused with. A test that only checks the happy value
// passes for an implementation that collapses everything else into it.
//
// FIXTURES COME FROM `nextHealth`, not from hand-built objects. That is
// deliberate and is the point of the two acceptance proofs C-04 was approved
// with: these functions must be correct about what the WRITER guarantees, not
// merely about the shape today's rows happen to have. A hand-built
// `{ lastError: null }` is not evidence of a successful attempt, and an
// implementation that reads it as one is fabricating the same class of claim
// the whole slice removes.
// ============================================================
import { describe, it, expect } from 'vitest';

import { nextHealth } from './connectorHealth.js';
import { DAILY_STATE } from './connectorConfig.js';
import {
  CONNECTION_STATE, AVAILABILITY_STATE, COMPLETENESS_STATE,
  READINESS_STATE, CAPABILITY_RUN, CAPABILITY,
  connectionOf, availabilityOf, completenessOf, readinessOf, freshnessOf, capabilitiesOf,
} from './connectorReadiness.js';

const T0 = new Date('2026-06-01T00:00:00.000Z');
const NOW = new Date('2026-06-01T06:00:00.000Z');       // 6h after T0
const LATER = new Date('2026-06-03T00:00:00.000Z');     // 48h after T0

/** A health record as the WRITER produces it. */
const synced   = (over = {}) => nextHealth({}, { platform: 'META', ok: true, records: 10, now: T0, ...over });
const failed   = (prev = {}) => nextHealth(prev, { platform: 'META', ok: false, error: 'boom', now: T0 });
const partial  = () => synced({ warning: 'Large account: some ad sets were not read this sync.' });

// ════════════════════════════════════════════════════════════
describe('CONNECTION — is there a live credential', () => {
  it('an active row is CONNECTED', () => {
    expect(connectionOf({ isActive: true })).toBe(CONNECTION_STATE.CONNECTED);
  });

  it('an inactive row is DISCONNECTED', () => {
    expect(connectionOf({ isActive: false })).toBe(CONNECTION_STATE.DISCONNECTED);
  });

  // CONNECTED says a credential exists. It says NOTHING about whether data is
  // flowing — that is READINESS, and conflating them is how a connected-but-
  // dead channel reads as healthy.
  it('says nothing about freshness — a connected row with no sync is still CONNECTED', () => {
    expect(connectionOf({ isActive: true, health: null })).toBe(CONNECTION_STATE.CONNECTED);
  });
});

// ════════════════════════════════════════════════════════════
describe('AVAILABILITY — did the last attempt work', () => {
  it('a recorded successful sync is OK', () => {
    expect(availabilityOf(synced())).toBe(AVAILABILITY_STATE.OK);
  });

  it('a recorded failure is FAILING', () => {
    expect(availabilityOf(failed())).toBe(AVAILABILITY_STATE.FAILING);
  });

  it('no health at all is NOT_RECORDED, never OK', () => {
    for (const h of [null, undefined, {}]) {
      expect(availabilityOf(h)).toBe(AVAILABILITY_STATE.NOT_RECORDED);
      expect(availabilityOf(h)).not.toBe(AVAILABILITY_STATE.OK);
    }
  });

  // ── ACCEPTANCE PROOF 1 (the condition C-04 was approved on) ───────────────
  // `lastError === null` must mean "an attempt was recorded and it succeeded",
  // not "no error key is present". Absence of an error is not evidence of a
  // success, and reading it as one would rebuild — inside the fix — exactly the
  // fabrication the fix exists to remove.
  it('a bare absence of error is NOT a success', () => {
    expect(availabilityOf({ lastError: null })).toBe(AVAILABILITY_STATE.NOT_RECORDED);
    expect(availabilityOf({ lastError: null })).not.toBe(AVAILABILITY_STATE.OK);
    expect(availabilityOf({ platform: 'META', lastError: null })).toBe(AVAILABILITY_STATE.NOT_RECORDED);
  });

  // …and the other half of that proof: what the writer emits on success DOES
  // carry the evidence. This is what makes the rule above implementable rather
  // than merely strict.
  it('the writer stamps the evidence OK depends on', () => {
    const h = synced();
    expect(h.lastAttemptedSync).toBe(T0.toISOString());
    expect(h.lastSuccessfulSync).toBe(h.lastAttemptedSync);
    expect(h.lastError).toBeNull();
  });

  it('FAILING is not NOT_RECORDED — one is an outage, the other is silence', () => {
    expect(availabilityOf(failed())).not.toBe(AVAILABILITY_STATE.NOT_RECORDED);
  });
});

// ════════════════════════════════════════════════════════════
describe('COMPLETENESS — did the data that landed arrive whole', () => {
  it('a clean successful sync is COMPLETE', () => {
    expect(completenessOf(synced())).toBe(COMPLETENESS_STATE.COMPLETE);
  });

  it('a successful sync carrying a warning is INCOMPLETE', () => {
    expect(completenessOf(partial())).toBe(COMPLETENESS_STATE.INCOMPLETE);
  });

  // INCOMPLETE means DATA LANDED and is short. It is not a failure, and it is
  // the axis the account owner is the one person currently not told about.
  it('INCOMPLETE is not FAILING — the data did arrive', () => {
    expect(availabilityOf(partial())).toBe(AVAILABILITY_STATE.OK);
    expect(completenessOf(partial())).toBe(COMPLETENESS_STATE.INCOMPLETE);
  });

  // ── ACCEPTANCE PROOF 2 (the condition C-04 was approved on) ───────────────
  // COMPLETE only after a successful RECORDED attempt. A connector that has
  // only ever failed carries no warning — and calling that COMPLETE would say
  // its data arrived whole when no data arrived at all.
  it('never-succeeded is NOT_RECORDED, never COMPLETE', () => {
    const neverWorked = failed();
    expect(neverWorked.lastSuccessfulSync).toBeNull();
    expect(neverWorked.lastWarning).toBeNull();          // no warning to report…
    expect(completenessOf(neverWorked)).toBe(COMPLETENESS_STATE.NOT_RECORDED);
    expect(completenessOf(neverWorked)).not.toBe(COMPLETENESS_STATE.COMPLETE);
  });

  it('a bare absence of warning is not completeness', () => {
    expect(completenessOf({ lastWarning: null })).toBe(COMPLETENESS_STATE.NOT_RECORDED);
    expect(completenessOf({ lastWarning: null })).not.toBe(COMPLETENESS_STATE.COMPLETE);
  });

  it('no health at all is NOT_RECORDED', () => {
    for (const h of [null, undefined, {}]) {
      expect(completenessOf(h)).toBe(COMPLETENESS_STATE.NOT_RECORDED);
    }
  });

  // The writer preserves a prior warning across a failure ON PURPOSE, so the
  // two axes can legitimately describe different runs. The projection states
  // both and reconciles neither — reconciliation would be an invention.
  it('a failure after a partial success reports FAILING and INCOMPLETE together', () => {
    const h = failed(partial());
    expect(availabilityOf(h)).toBe(AVAILABILITY_STATE.FAILING);
    expect(completenessOf(h)).toBe(COMPLETENESS_STATE.INCOMPLETE);
  });
});

// ════════════════════════════════════════════════════════════
describe('READINESS — how old is the last SUCCESS', () => {
  it.each(['not-a-date', '2026-06-01T07:00:00.000Z'])('does not classify unusable success %s as CURRENT or NEVER_SYNCED', (timestamp) => {
    expect(readinessOf({ lastSuccessfulSync: timestamp }, NOW)).toBeNull();
  });

  it('a recent success is CURRENT', () => {
    expect(readinessOf(synced(), NOW)).toBe(READINESS_STATE.CURRENT);
  });

  it('an old success is STALE', () => {
    expect(readinessOf(synced(), LATER)).toBe(READINESS_STATE.STALE);
  });

  // THE DEFECT THIS AXIS CLOSES. `isStale(null) → true`, so a connector that
  // has never once succeeded is reported as "stale" — a word that claims we
  // used to have data and it aged. We never had any.
  it('never-synced is NEVER_SYNCED, and explicitly NOT stale', () => {
    for (const h of [null, undefined, {}, failed()]) {
      expect(readinessOf(h, NOW)).toBe(READINESS_STATE.NEVER_SYNCED);
      expect(readinessOf(h, NOW)).not.toBe(READINESS_STATE.STALE);
    }
  });

  // A failed attempt must not refresh the clock — the writer preserves the
  // prior success for exactly this reason, and the axis must honour it.
  it('a failure after a success keeps the success clock, not the attempt clock', () => {
    const h = failed(synced());
    expect(readinessOf(h, NOW)).toBe(READINESS_STATE.CURRENT);
    expect(readinessOf(h, LATER)).toBe(READINESS_STATE.STALE);
  });

  // R-8: the connector's 24h clock is not the verdict's 30-day window. This
  // axis describes the CONNECTOR and nothing downstream of it.
  it('is a three-state answer, never a boolean', () => {
    expect(new Set(Object.values(READINESS_STATE)).size).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════
describe('P7-05A — resolved freshness evidence', () => {
  it.each([[T0.toISOString(), NOW, 'CURRENT', false], [T0.toISOString(), LATER, 'STALE', true]])(
    'accepts legacy success %s without editing the source health', (timestamp, now, readiness, stale) => {
      const row = Object.freeze({ health: null, lastSyncedAt: timestamp });
      expect(freshnessOf(row, now)).toEqual({ lastSuccessfulSync: timestamp, readiness, readinessKnowledge: 'KNOWN', stale });
    },
  );

  it.each([null, undefined, {}])('has NEVER_SYNCED only when both sources are absent: %j', (row) => {
    expect(freshnessOf(row, NOW)).toEqual({ lastSuccessfulSync: null, readiness: 'NEVER_SYNCED', readinessKnowledge: 'NOTHING_THERE', stale: true });
  });

  it.each(['bad-date', '', 'Infinity', Number.NaN, Number.POSITIVE_INFINITY, 0, '2026-06-01T07:00:00.000Z'])(
    'unusable success %j is unavailable rather than a known freshness claim', (timestamp) => {
      for (const row of [{ health: { lastSuccessfulSync: timestamp } }, { lastSyncedAt: timestamp }]) {
        expect(freshnessOf(row, NOW)).toEqual({ lastSuccessfulSync: null, readiness: null, readinessKnowledge: null, stale: true });
      }
    },
  );

  it.each(['bad-date', '2026-06-01T07:00:00.000Z'])('uses independently valid legacy evidence when health success %s is unusable', (timestamp) => {
    const h = Object.freeze({ lastSuccessfulSync: timestamp });
    const row = Object.freeze({ health: h, lastSyncedAt: T0.toISOString() });
    expect(freshnessOf(row, NOW)).toEqual({ lastSuccessfulSync: T0.toISOString(), readiness: 'CURRENT', readinessKnowledge: 'KNOWN', stale: false });
    expect(h.lastSuccessfulSync).toBe(timestamp);
  });

  it('does not let invalid legacy evidence displace usable health authority', () => {
    expect(freshnessOf({ health: synced(), lastSyncedAt: 'bad-date' }, NOW).lastSuccessfulSync).toBe(T0.toISOString());
  });

  it('keeps the existing strict stale boundary and accepts success exactly at now', () => {
    const row = { lastSyncedAt: T0.toISOString() };
    expect(freshnessOf(row, T0).readiness).toBe('CURRENT');
    expect(freshnessOf(row, new Date(T0.getTime() + 24 * 3600000)).readiness).toBe('CURRENT');
    expect(freshnessOf(row, new Date(T0.getTime() + 24 * 3600000 + 1)).readiness).toBe('STALE');
    expect(freshnessOf(row, NOW, 4).readiness).toBe('STALE');
  });
});

// ════════════════════════════════════════════════════════════
describe('CAPABILITY — what this connector can be asked, and what happened', () => {
  const of = (platform, health) =>
    Object.fromEntries(capabilitiesOf(platform, health).map((c) => [c.capability, c]));

  it('publishes exactly the three capabilities that have a predicate in code', () => {
    expect(capabilitiesOf('META', synced()).map((c) => c.capability))
      .toEqual([CAPABILITY.DAILY_OBSERVATIONS, CAPABILITY.CANONICAL_WINDOW, CAPABILITY.EXECUTION]);
  });

  it('Meta implements daily; Google does not', () => {
    expect(of('META', synced())[CAPABILITY.DAILY_OBSERVATIONS].implemented).toBe(true);
    expect(of('GOOGLE', synced())[CAPABILITY.DAILY_OBSERVATIONS].implemented).toBe(false);
  });

  // "Lumi cannot answer this" is fixed by writing a connector. "The account
  // delivered nothing" is not a defect at all. Same screen, opposite meanings.
  it('an unimplemented capability never reports NO_DATA', () => {
    const cap = of('GOOGLE', synced())[CAPABILITY.DAILY_OBSERVATIONS];
    expect(cap.implemented).toBe(false);
    expect(cap.lastRun).not.toBe(DAILY_STATE.NO_DATA);
    expect(cap.lastRun).not.toBe(DAILY_STATE.SUCCESS);
  });

  it('a stored daily outcome is published verbatim', () => {
    const h = synced({ capabilities: { [CAPABILITY.DAILY_OBSERVATIONS]: DAILY_STATE.NO_DATA } });
    expect(of('META', h)[CAPABILITY.DAILY_OBSERVATIONS].lastRun).toBe(DAILY_STATE.NO_DATA);
  });

  it.each([
    [DAILY_STATE.DISABLED], [DAILY_STATE.UNIMPLEMENTED],
    [DAILY_STATE.NO_DATA], [DAILY_STATE.SUCCESS], [DAILY_STATE.FAILED],
  ])('all five DAILY_STATE values survive the projection: %s', (state) => {
    const h = synced({ capabilities: { [CAPABILITY.DAILY_OBSERVATIONS]: state } });
    expect(of('META', h)[CAPABILITY.DAILY_OBSERVATIONS].lastRun).toBe(state);
  });

  // A row synced before C-04 has no capability record. It is NOT_RECORDED, and
  // it is never back-filled by guessing — the same admission of the limits of
  // historical knowledge that legacyGuardrailScope() makes for guardrails.
  it('a pre-C-04 health record is NOT_RECORDED, not NO_DATA and not DISABLED', () => {
    const cap = of('META', synced())[CAPABILITY.DAILY_OBSERVATIONS];
    expect(cap.lastRun).toBe(CAPABILITY_RUN.NOT_RECORDED);
    expect(cap.lastRun).not.toBe(DAILY_STATE.NO_DATA);
    expect(cap.lastRun).not.toBe(DAILY_STATE.DISABLED);
  });

  // CANONICAL_WINDOW has a structural predicate but no run-outcome model: the
  // sync reports a bare count whose null means three different things. Saying
  // so is honest; inventing a state from the count would not be.
  it('canonical states its capability and refuses to state an outcome', () => {
    const cap = of('META', synced({ capabilities: { DAILY_OBSERVATIONS: DAILY_STATE.SUCCESS } }))[CAPABILITY.CANONICAL_WINDOW];
    expect(cap.implemented).toBe(true);
    expect(cap.lastRun).toBe(CAPABILITY_RUN.NOT_RECORDED);
  });

  // Execution is not exercised by the sync loop at all, which is a different
  // fact from "exercised but not recorded".
  it('execution is NOT_APPLICABLE, which is not NOT_RECORDED', () => {
    const cap = of('META', synced())[CAPABILITY.EXECUTION];
    expect(cap.lastRun).toBe(CAPABILITY_RUN.NOT_APPLICABLE);
    expect(CAPABILITY_RUN.NOT_APPLICABLE).not.toBe(CAPABILITY_RUN.NOT_RECORDED);
  });

  it('only META can be executed against today', () => {
    expect(of('META', synced())[CAPABILITY.EXECUTION].implemented).toBe(true);
    expect(of('GOOGLE', synced())[CAPABILITY.EXECUTION].implemented).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// The whole point, stated once: no two axes share a vocabulary, so no reader
// can accidentally compare them, and no state can drift into meaning another.
describe('the axes do not share words', () => {
  it('every state token appears in exactly one axis', () => {
    const axes = [CONNECTION_STATE, AVAILABILITY_STATE, COMPLETENESS_STATE, READINESS_STATE];
    const all = axes.flatMap((a) => Object.values(a));
    const shared = all.filter((v, i) => all.indexOf(v) !== i);
    // NOT_RECORDED is the ONE deliberate exception: it means the same thing on
    // every axis it appears on — we have no record — and three synonyms for one
    // fact would be worse than one shared word.
    expect([...new Set(shared)]).toEqual([AVAILABILITY_STATE.NOT_RECORDED]);
  });

  it('every axis is a closed frozen set', () => {
    for (const axis of [CONNECTION_STATE, AVAILABILITY_STATE, COMPLETENESS_STATE, READINESS_STATE, CAPABILITY_RUN, CAPABILITY]) {
      expect(Object.isFrozen(axis)).toBe(true);
    }
  });
});
