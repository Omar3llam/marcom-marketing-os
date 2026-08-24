// ============================================================
// Phase G — canonical snapshots are invisible to operational readers
// ------------------------------------------------------------
// Phase F put a SECOND population into metric_snapshots: a canonical 30-day row
// landed by the same sync run as the operational one, carrying the same
// entityId, the same source and the same `date`. Every reader that predates it
// was written against one population and could not tell them apart.
//
// The invariant this file defends, stated once:
//
//     adding a canonical row changes NOTHING that an operational reader sees.
//
// Every test is that sentence applied to one reader, and each is written as a
// BEFORE/AFTER pair over the same operational data rather than as an assertion
// about a fixed expected number — because the claim is "identical to what it was",
// not "equal to a value we chose today".
//
// Two layers, because the fix lives in two places. The behavioural tests prove
// what a reader COMPUTES once the canonical row is gone; the structural sweep at
// the bottom proves every reader actually ASKS for that population — a pure test
// downstream would keep passing if someone dropped a filter, since it never sees
// the query. Neither layer is sufficient alone.
//
// No module mocking here on purpose: it is the one pattern known to destabilise
// this repo's forks pool, and the structural sweep covers the query side without
// loading a service at all.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  MEASUREMENT_WINDOW, OPERATIONAL_MEASUREMENT_WINDOWS, OPERATIONAL_WINDOW_FILTER,
  isOperationalWindow,
} from './connectorTypes.js';
import { snapshotDayKey, dropShadowingZeros } from './snapshotSink.js';
import { effectiveByEntity, latestByEntity } from '../entity-graph/entityGraphEngine.js';
import { latestPerStream } from '../blended-truth/BlendedTruthService.js';

const W = MEASUREMENT_WINDOW;
const SYNC = new Date('2026-08-11T10:00:00Z');

/** The operational row a sync has always produced. */
const operational = (over = {}) => ({
  entityId: 'E1', entityLevel: 'CAMPAIGN', source: 'META', date: SYNC,
  measurementWindow: W.ROLLING_WINDOW,
  spendMinor: 900_000, revenueMinor: 990_000, roas: 1.1, ctr: 2.0,
  frequency: 8.0, reach: 500_000, conversions: 50, impressions: 100_000, clicks: 2_000,
  currency: 'USD', ...over,
});

/**
 * The canonical row Phase F now lands BESIDE it — same entity, same source, and
 * the same `date`, because ConnectorSyncService stamps one `now` per run. Every
 * metric differs, and deliberately: 2.0 vs 1.1 straddles BREAKEVEN_ROAS, and 4.0
 * vs 8.0 straddles FATIGUE_FREQ. Reading the wrong one is a different verdict,
 * not a rounding difference.
 */
const canonical = (over = {}) => operational({
  measurementWindow: W.CUMULATIVE_30D,
  spendMinor: 100_000, revenueMinor: 200_000, roas: 2.0, ctr: 3.5,
  frequency: 4.0, reach: 120_000, conversions: 12, impressions: 30_000, clicks: 1_050,
  ...over,
});

// ── THE POPULATION CONTRACT ─────────────────────────────────────────────────

describe('the operational allow-list', () => {
  it('admits exactly the two windows that existed before Phase F', () => {
    expect([...OPERATIONAL_MEASUREMENT_WINDOWS]).toEqual([W.LEGACY_UNKNOWN, W.ROLLING_WINDOW]);
  });

  it('keeps LEGACY_UNKNOWN — it carries every ACTUAL-revenue row', () => {
    // GA4 and MANUAL rows are LEGACY_UNKNOWN by Phase C's decision. Dropping this
    // value would blank actual revenue across blended truth and the overlay — a
    // far bigger behaviour change than the one Phase G exists to prevent.
    expect(isOperationalWindow(W.LEGACY_UNKNOWN)).toBe(true);
  });

  it('refuses CUMULATIVE_30D', () => {
    expect(isOperationalWindow(W.CUMULATIVE_30D)).toBe(false);
  });

  it('refuses DAILY — and now that Phase E ships a producer, this is the proof', () => {
    // This assertion was written BEFORE anything wrote a DAILY row, against the
    // day one would. That day is R8: metaDailyNormalize + dailySnapshotSink land
    // true daily observations, and every operational consumer must carry on
    // reading exactly what it read yesterday. A population no reader has been
    // designed for must not become an input the moment its first producer ships.
    expect(isOperationalWindow(W.DAILY)).toBe(false);
  });

  it('is an ALLOW-LIST, not an exclusion — this is the whole architectural point', () => {
    // `{ not: CUMULATIVE_30D }` would pass every test above except this one, and
    // would silently admit the next population added to the enum.
    expect(OPERATIONAL_WINDOW_FILTER).toEqual({ in: OPERATIONAL_MEASUREMENT_WINDOWS });
    expect(OPERATIONAL_WINDOW_FILTER).not.toHaveProperty('not');
  });
});

describe('Test 9 — an unknown future window is not consumed', () => {
  for (const unknown of ['UNKNOWN_FUTURE', 'WEEKLY', 'CUMULATIVE_7D', '', null, undefined]) {
    it(`refuses ${JSON.stringify(unknown)}`, () => {
      expect(isOperationalWindow(unknown)).toBe(false);
    });
  }

  it('a reader\'s filter cannot match a value nobody has declared operational', () => {
    expect(OPERATIONAL_WINDOW_FILTER.in).not.toContain('UNKNOWN_FUTURE');
  });
});

// ── THE READERS ─────────────────────────────────────────────────────────────

describe('Test 1 + Test 2 — canonical rows cannot alter verdict input or EntityGraph', () => {
  it('effectiveByEntity is IDENTICAL before and after a canonical row is added', () => {
    // The projection that feeds verdicts, Campaigns, Copilot and the agenda.
    const before = effectiveByEntity([operational()]).get('E1');
    const after = effectiveByEntity([operational(), canonical()].filter(
      (r) => isOperationalWindow(r.measurementWindow),
    )).get('E1');
    expect(after).toEqual(before);
  });

  it('and the unfiltered version is NOT — proving the fixture is a real hazard', () => {
    // Guards the test itself: if these two rows were interchangeable, every
    // assertion above would pass for the wrong reason.
    const unfiltered = effectiveByEntity([canonical(), operational()]).get('E1');
    expect(unfiltered.roas).not.toBe(operational().roas);
  });
});

describe('Test 8 — order independence', () => {
  const rows = [operational(), canonical()];

  it('filtered input gives one answer whichever order the rows arrive in', () => {
    const forward = effectiveByEntity(rows.filter((r) => isOperationalWindow(r.measurementWindow)));
    const reverse = effectiveByEntity([...rows].reverse().filter((r) => isOperationalWindow(r.measurementWindow)));
    expect(forward.get('E1')).toEqual(reverse.get('E1'));
  });

  it('UNFILTERED input does not — this is the #362 heap-order defect, reproduced', () => {
    // Both rows share entityId, source AND `date`, and latestOf compares with a
    // strict `>`, so the winner is whichever Postgres returned first.
    const forward = effectiveByEntity(rows).get('E1');
    const reverse = effectiveByEntity([...rows].reverse()).get('E1');
    expect(forward.roas).not.toBe(reverse.roas);
    expect(forward.frequency).not.toBe(reverse.frequency);
  });

  it('latestByEntity has the same tie, so the filter is what fixes it, not the reducer', () => {
    const rowsF = rows.filter((r) => isOperationalWindow(r.measurementWindow));
    expect(latestByEntity(rowsF).get('E1')).toEqual(latestByEntity([...rowsF].reverse()).get('E1'));
  });
});

describe('Test 7 — Blended Truth keeps PR #357 intact', () => {
  it('latest-per-stream still collapses overlapping ROLLING_WINDOW rows (#357)', () => {
    // The correction Phase G must not regress: two rolling rows for one stream
    // are NOT summed, the newer wins.
    const older = operational({ date: new Date('2026-08-01T10:00:00Z'), spendMinor: 500_000 });
    const newer = operational({ date: new Date('2026-08-05T10:00:00Z'), spendMinor: 700_000 });
    const out = latestPerStream([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].spendMinor).toBe(700_000); // not 1_200_000
  });

  it('and still separates streams by source (cross-source behaviour unchanged)', () => {
    const meta = operational({ source: 'META' });
    const ga4 = operational({ source: 'GA4', measurementWindow: W.LEGACY_UNKNOWN, spendMinor: 0, revenueMinor: 400_000 });
    expect(latestPerStream([meta, ga4])).toHaveLength(2);
  });
});

describe('Test 3 — Plan actuals do not double-count', () => {
  it('summing by day over a filtered set counts each operational row once', () => {
    // The defect in shape: both rows fall in the same UTC day bucket, and this
    // aggregation SUMS rather than picking a latest.
    const rows = [operational(), canonical()].filter((r) => isOperationalWindow(r.measurementWindow));
    const total = rows.reduce((n, r) => n + r.spendMinor, 0);
    expect(total).toBe(900_000); // not 1_000_000
  });
});

describe('Test 4 + Test 5 — no second observation in any series', () => {
  const day1 = operational({ date: new Date('2026-08-10T10:00:00Z'), frequency: 3.0 });
  const day2 = operational({ date: new Date('2026-08-11T10:00:00Z'), frequency: 3.2 });
  const day2canonical = canonical({ date: new Date('2026-08-11T10:00:00Z'), frequency: 4.0 });

  it('the operational series is [day1, day2] — not [day1, day2, day2]', () => {
    const series = [day1, day2, day2canonical]
      .filter((r) => isOperationalWindow(r.measurementWindow))
      .map((r) => r.date.toISOString());
    expect(series).toEqual([day1.date.toISOString(), day2.date.toISOString()]);
  });

  it('a single-observation entity stays single — it cannot reach the ≥2 forecast gate', () => {
    // ScenarioService requires 2 points to fit a velocity. Before Phase G the
    // canonical row supplied the second one, so entities that were correctly
    // skipped began emitting breach forecasts from a slope between two readings
    // of different periods.
    const oneSync = [operational(), canonical()].filter((r) => isOperationalWindow(r.measurementWindow));
    expect(oneSync).toHaveLength(1);
  });

  it('no deduplication is used as a substitute — both operational days survive', () => {
    // A "collapse to latest per day" fix would also make the series look right
    // while destroying real multi-sync history. The filter must be what removes
    // the canonical row, and nothing else.
    const kept = [day1, day2].filter((r) => isOperationalWindow(r.measurementWindow));
    expect(kept).toHaveLength(2);
  });
});

// ── Test 6 — guardZeroShadows ───────────────────────────────────────────────

describe('Test 6 — a canonical zero is not shadowed by an operational positive', () => {
  const positiveOperational = operational({ spendMinor: 900_000 });
  const zeroCanonical = canonical({ spendMinor: 0 });

  it('the two rows do not share a shadow key', () => {
    expect(snapshotDayKey(zeroCanonical)).not.toBe(snapshotDayKey(positiveOperational));
  });

  it('the canonical zero SURVIVES the guard', () => {
    // The account shape this protects is ordinary, not exotic: a campaign with
    // lifetime spend that delivered nothing in the last 30 days. Its canonical
    // spend really is 0, and that measurement is exactly what a KILL rests on.
    const positives = new Set([snapshotDayKey(positiveOperational)]);
    expect(dropShadowingZeros([zeroCanonical], positives)).toHaveLength(1);
  });

  it('but a zero IS still dropped by a positive in its OWN window (behaviour preserved)', () => {
    const zeroOperational = operational({ spendMinor: 0 });
    const positives = new Set([snapshotDayKey(positiveOperational)]);
    expect(dropShadowingZeros([zeroOperational], positives)).toHaveLength(0);
  });

  it('inverse: an operational zero is not shadowed by a canonical positive', () => {
    const positiveCanonical = canonical({ spendMinor: 100_000 });
    const zeroOperational = operational({ spendMinor: 0 });
    const positives = new Set([snapshotDayKey(positiveCanonical)]);
    expect(dropShadowingZeros([zeroOperational], positives)).toHaveLength(1);
  });

  it('a positive row is never dropped, in either window', () => {
    const positives = new Set([snapshotDayKey(positiveOperational), snapshotDayKey(canonical())]);
    expect(dropShadowingZeros([positiveOperational, canonical()], positives)).toHaveLength(2);
  });
});

// ── Structural sweep ────────────────────────────────────────────────────────

describe('every operational MetricSnapshot reader declares its population', () => {
  // The read sites Phase G audited, each of which used to STATE the operational
  // population inline. R3 emptied this list one PR at a time; R3.10 took the
  // last entry (Plan's entity scan). It stays here, empty, rather than being
  // deleted: the `it.each` over an empty array is vacuous, but the constant is
  // where a newly added inline reader would have to be listed, and the
  // completion invariant at the bottom is what actually fails if one appears.
  const READERS = [];

  // R3: consumers that have handed the query to the Evidence layer. They still
  // read the operational population — the invariant is unchanged — but they no
  // longer STATE it, so asserting the filter against their source would now fail
  // for the right reason and prove the wrong thing.
  //
  // Moved here rather than deleted, for the same reason CANONICAL_READERS exists
  // below: the three lists must stay jointly exhaustive. A reader that belongs to
  // none of them is exactly what this sweep is for, and dropping a migrated file
  // off the end would create the blind spot instead of closing it.
  //
  // This list grows by one per R3 PR, and READERS shrinks by the same one.
  const EVIDENCE_SEAM_READERS = [
    'guardrail-engine/GuardrailSweepService.js',
    'pattern-engine/PatternService.js',
    'blended-truth/BlendedTruthService.js',
    'unit-economics/EconomicsService.js',
    'attribution-engine/AttributionService.js',
    'test-generator/TestGeneratorService.js',
    // R3.10, the last one: BOTH of Plan's reads now go through the seam — the
    // actuals series and the distinct/take:50 entity scan.
    'planning/PlanService.js',
  ];

  // R3.8: RevenueCsv reads through the seam like the list above, but it is also
  // a WRITER — it lands MANUAL actual rows — so it must keep saying
  // `measurementWindow` in the row it constructs and in the upsert's natural key.
  // The blanket "states no population of its own" assertion cannot be applied to
  // it without either failing for the wrong reason or being weakened for
  // everyone, so it gets its own entry: same read contract, write vocabulary
  // intact, and an explicit assertion that what remains is a write rather than a
  // filter that survived the migration.
  const EVIDENCE_SEAM_READER_WRITERS = ['revenue/RevenueCsvService.js'];

  // R3.9: EntityGraph reads BOTH populations — operational through the seam for
  // the Campaigns surface, canonical through selectCanonicalVerdictSnapshots for
  // the verdict path — and that duality is deliberate, not a half-migration.
  // It gets its own entry for one narrow reason: the file's METRIC_SELECT comment
  // names `measurementWindow` in prose, to point at the Phase-C provenance test
  // that asserts the projection does NOT read that column. The blanket "mentions
  // it nowhere" rule cannot tell a comment from a filter, and rewording the
  // comment to satisfy a regex would delete the pointer to the test. So the
  // assertion below is TIGHTER instead of looser: no `measurementWindow:` in any
  // CODE position — not as a predicate, and not as a projected column either.
  const EVIDENCE_SEAM_DUAL_POPULATION_READERS = ['entity-graph/EntityGraphService.js'];

  // Phase K: these read CUMULATIVE_30D through the shared fatigue selector and
  // must therefore NOT carry the operational filter. Listed here rather than
  // deleted so the two populations stay jointly exhaustive — a reader that
  // belongs to neither list is the thing this whole sweep exists to catch.
  const CANONICAL_READERS = [
    'analysis/FatigueForecastService.js',
    'fatigue-forecaster/FatigueSweepService.js',
    'scenario-engine/ScenarioService.js',
  ];

  const read = async (rel) => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  };

  it.each(READERS)('%s filters every read by measurementWindow', async (rel) => {
    const src = await read(rel);
    const reads = (src.match(/metricSnapshot\.findMany/g) || []).length;
    const filters = (src.match(/measurementWindow: OPERATIONAL_WINDOW_FILTER/g) || []).length;
    expect(reads).toBeGreaterThan(0);
    expect(filters).toBe(reads);
  });

  it.each(READERS)('%s uses the shared allow-list, not a hand-rolled exclusion', async (rel) => {
    const src = await read(rel);
    // An inline `not: 'CUMULATIVE_30D'` would satisfy the count above while
    // re-admitting DAILY and everything after it. Naming the constant is what
    // makes the population one decision instead of thirteen.
    expect(src).not.toMatch(/measurementWindow:\s*\{\s*not:/);
    expect(src).toMatch(/import .*OPERATIONAL_WINDOW_FILTER.* from .*connectorTypes\.js/);
  });

  // The R3 half: a migrated consumer must own NO part of the population
  // decision. Half a migration — asking the seam while keeping the old filter,
  // or keeping a second direct read beside it — is the state that looks migrated
  // and is not, so both halves are asserted rather than just the new call.
  it.each(EVIDENCE_SEAM_READERS)('%s reads through the Evidence seam and states no population of its own', async (rel) => {
    const src = await read(rel);
    expect(src).toMatch(/selectOperationalSnapshots/);
    expect(src).not.toMatch(/metricSnapshot\.findMany/);
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    expect(src).not.toMatch(/measurementWindow/);
  });

  it.each(EVIDENCE_SEAM_READER_WRITERS)('%s reads through the Evidence seam and keeps only its WRITE population', async (rel) => {
    const src = await read(rel);
    expect(src).toMatch(/selectOperationalSnapshots/);
    expect(src).not.toMatch(/metricSnapshot\.findMany/);
    // The read-side population is gone: no allow-list import, and no predicate
    // shape. `measurementWindow: { ... }` is what a filter looks like; the write
    // sites are `measurementWindow: MEASUREMENT_WINDOW.X` and
    // `measurementWindow: r.measurementWindow`, which are values, not predicates.
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    // `\b` matters: the upsert's compound-key name ENDS in `_measurementWindow`
    // and is followed by `{`, so an unanchored pattern flags the write it is
    // supposed to permit.
    expect(src).not.toMatch(/\bmeasurementWindow:\s*\{/);
    // …and it really is still a writer, so the exemption above is not a hole
    // somebody could quietly widen by deleting the write.
    expect(src).toMatch(/upsertNonDailyMetricSnapshot/);
    expect(src).toMatch(/measurementWindow: MEASUREMENT_WINDOW\./);
  });

  it.each(EVIDENCE_SEAM_DUAL_POPULATION_READERS)('%s reads operational through the seam and canonical through its own selector', async (rel) => {
    const src = await read(rel);
    // The operational half: delegated, and stating nothing of its own.
    expect(src).toMatch(/selectOperationalSnapshots/);
    expect(src).not.toMatch(/metricSnapshot\.findMany/);
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    // R13-C splits what Phase C forbade wholesale.
    //
    // FORBIDDEN, still: `measurementWindow: { ... }` — a PREDICATE. This reader
    // does not choose its population by window; the seam does, from one
    // allow-list, and a second opinion here is how the two populations merge.
    expect(src).not.toMatch(/\bmeasurementWindow:\s*\{/);
    // PERMITTED, now: `measurementWindow: true` — a PROJECTION. Phase C withheld
    // it as a proxy for "does not resolve by window", which also left the row
    // unable to say what period it covered. That is how a ~37-month aggregate
    // reached a surface labelled "last 30 days" with nothing able to contradict
    // it. Selecting a column is not filtering on one.
    expect(src).toMatch(/\bmeasurementWindow:\s*true/);
    // The canonical half: STILL HERE, and still its own selector. If this fails,
    // somebody unified two populations that are different measurements, which is
    // the exact merge the D-track exists to prevent.
    expect(src).toMatch(/selectCanonicalVerdictSnapshots/);
    // …and the canonical read is NOT what the operational assertions above are
    // about. It goes through a selector, so it must not be re-inlined either.
    expect(src).not.toMatch(/CANONICAL_VERDICT_WINDOW_FILTER/);
  });

  // R3.6 left PlanService half migrated and this test pinned that state, so that
  // finishing the job would FAIL it and force the file to move lists. R3.10
  // finished the job, so it did, and it has: PlanService is in
  // EVIDENCE_SEAM_READERS above. The pin is replaced by its successor — both
  // reads on the seam, and the second one still asking for its own reduction.
  it('planning/PlanService.js is fully migrated, reduction and all', async () => {
    const src = await read('planning/PlanService.js');
    expect(src).not.toMatch(/metricSnapshot/);
    // Two seam reads, not one: a migration that dropped the entity scan instead
    // of moving it would satisfy every other assertion in this file.
    expect((src.match(/selectOperationalSnapshots\(/g) || []).length).toBe(2);
    // The reduction survived the move. It is the only reduction in the codebase
    // and the reason the seam has the option at all.
    expect(src).toMatch(/distinct:\s*\['entityId'\]/);
    expect(src).toMatch(/take:\s*50/);
  });

  // ── THE R3 COMPLETION INVARIANT ──────────────────────────────────────────
  //
  // Every operational consumer is migrated, so the claim is no longer "each
  // reader declares its population" — it is that there are no readers left to
  // declare one. Stated as an allow-list of the files that may legitimately
  // touch metricSnapshot.findMany at all, with the reason each is exempt:
  //
  //   the Evidence seam        it IS the read
  //   the two canonical        selectCanonicalVerdictSnapshots and
  //   selectors                selectCanonicalFatigueSnapshots answer a
  //                            DIFFERENT population, deliberately and forever
  //   snapshotSink             a WRITE-path guard, not a consumer: it reads back
  //                            the windows the INCOMING batch belongs to (which
  //                            includes canonical rows) to avoid shadowing a
  //                            legitimate zero. Its window predicate is derived
  //                            from the batch, not from the operational
  //                            allow-list, so classifying it as an operational
  //                            reader would be simply wrong.
  //   dailySnapshotSink        the same class, and exempt on the same grounds
  //                            (R8): its read is the write path's LOGICAL
  //                            IDENTITY lookup — "does a row for this entity on
  //                            this day already exist" — because the shared
  //                            unique key cannot express a daily identity. It is
  //                            scoped to `measurementWindow: DAILY`, a population
  //                            that is by definition not the operational one, and
  //                            the test below pins that scope so the exemption
  //                            cannot quietly widen into a reader.
  //   dailyObservation-        the THIRD population selector, exempt on exactly
  //   Reader                   the canonical selectors' grounds (R9): it answers
  //                            the DAILY population, which the operational
  //                            allow-list excludes by construction and always
  //                            will. It is a genuine reader — unlike the sinks
  //                            above — so the assertion below pins that it names
  //                            DAILY and reaches for nothing operational, which
  //                            is the whole basis of the exemption.
  //
  // Anything else that appears here is a new direct reader, and this is where it
  // gets caught — before it has a surface to be wrong on.
  it('R3 IS COMPLETE — nothing outside the Evidence layer reads the operational population', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');

    const ROOT = fileURLToPath(new URL('..', import.meta.url));
    const ALLOWED = new Set([
      'evidence/operationalEvidence.js',
      'verdict-engine/canonicalVerdictEvidence.js',
      'fatigue-forecaster/canonicalFatigueEvidence.js',
      'connectors/snapshotSink.js',
      'connectors/dailySnapshotSink.js',
      'daily-observations/dailyObservationReader.js',
    ]);

    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.js') && !e.name.includes('.test.') ? [full] : [];
    });

    // COMMENTS ARE STRIPPED FIRST, and that is not a convenience. `evidence/
    // index.js` explains the seam by quoting the very call it exists to remove,
    // and R3.9 already lost time to a guard that could not tell prose from a
    // predicate. The invariant is about CODE; a scanner that flags a sentence
    // would have to be exempted file by file, and each exemption would then also
    // permit the real thing.
    const codeOf = (f) => readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const offenders = walk(ROOT)
      .filter((f) => /prisma\.metricSnapshot\.findMany/.test(codeOf(f)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel));

    expect(offenders).toEqual([]);
  });

  // The R8 exemption is SCOPED, and this is what keeps it that way. A
  // write-path identity lookup that stopped naming its own population would
  // become a reader of whatever the query happened to match — which is the exact
  // thing the allow-list exists to prevent, arriving through the door the
  // allow-list just opened.
  it('the daily sink reads ONLY the population it writes', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./dailySnapshotSink.js', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const query = src.slice(src.indexOf('prisma.metricSnapshot.findMany'));
    expect(query).toMatch(/measurementWindow:\s*MEASUREMENT_WINDOW\.DAILY/);
    // …and it must not reach for the operational population by any name.
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER|OPERATIONAL_MEASUREMENT_WINDOWS/);
  });

  // The R9 exemption is SCOPED in the same way, and needs it more: this one is a
  // genuine READER, so it is the only entry on the list that could widen into
  // the thing the list exists to catch. A third population selector is harmless
  // only while it stays a THIRD population — the day it learns to read
  // ROLLING_WINDOW rows, every guarantee this file makes about operational
  // readers stops holding, and it would have been let through the door the
  // allow-list just opened.
  it('the daily reader reads ONLY the DAILY population', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../daily-observations/dailyObservationReader.js', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const query = src.slice(src.indexOf('prisma.metricSnapshot.findMany'));
    expect(query).toMatch(/measurementWindow:\s*MEASUREMENT_WINDOW\.DAILY/);
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER|OPERATIONAL_MEASUREMENT_WINDOWS|selectOperationalSnapshots/);
    // …and it must not reach the canonical populations either. Three populations,
    // three readers, no blending — the seam's own rule.
    expect(src).not.toMatch(/CUMULATIVE_30D|CANONICAL_VERDICT_WINDOW|selectCanonical/);
  });

  it('…and every one of the nine migrated consumers is genuinely clean', async () => {
    // The roll-call, by file content rather than by roadmap. Each of these once
    // held its own `prisma.metricSnapshot.findMany` and its own window filter.
    const NINE = [
      'guardrail-engine/GuardrailSweepService.js',
      'pattern-engine/PatternService.js',
      'blended-truth/BlendedTruthService.js',
      'unit-economics/EconomicsService.js',
      'attribution-engine/AttributionService.js',
      'planning/PlanService.js',
      'test-generator/TestGeneratorService.js',
      'revenue/RevenueCsvService.js',
      'entity-graph/EntityGraphService.js',
    ];
    for (const rel of NINE) {
      const src = await read(rel);
      expect(src, rel).toMatch(/selectOperationalSnapshots/);
      expect(src, rel).not.toMatch(/prisma\.metricSnapshot\.findMany/);
      expect(src, rel).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    }
  });

  // …and the population it delegated to is still declared, one level down. The
  // filter did not disappear when it moved; if this fails, every migrated
  // consumer above silently lost its window filter at once.
  it('the Evidence layer states the operational population it now owns', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../evidence/operationalEvidence.js', import.meta.url)), 'utf8',
    );
    const reads   = (src.match(/metricSnapshot\.findMany/g) || []).length;
    const filters = (src.match(/measurementWindow: OPERATIONAL_WINDOW_FILTER/g) || []).length;
    expect(reads).toBeGreaterThan(0);
    expect(filters).toBe(reads);
    expect(src).not.toMatch(/measurementWindow:\s*\{\s*not:/);
    expect(src).toMatch(/import .*OPERATIONAL_WINDOW_FILTER.* from .*connectorTypes\.js/);
  });

  // The Phase K half of the same invariant: a fatigue consumer must go through
  // the shared selector and must NOT hold an operational filter of its own. A
  // file carrying both would be reading two populations into one judgement,
  // which is precisely the split Phase K removed.
  it.each(CANONICAL_READERS)('%s reads canonical evidence, and only that', async (rel) => {
    const src = await read(rel);
    expect(src).toMatch(/selectCanonicalFatigueSnapshots/);
    expect(src).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    expect(src).not.toMatch(/metricSnapshot\.findMany/);
  });
});
