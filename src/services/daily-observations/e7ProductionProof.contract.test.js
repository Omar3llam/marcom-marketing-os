// ============================================================
// B4-E7 — controls on the production proof instrument
// ============================================================
// The instrument runs INSIDE production, once, against the database that serves
// users. Nobody will code-review its output; they will paste it. So the two
// things it must never get wrong are guarded here:
//
//   1. it must not WRITE — E7 forbids repairing anything it finds, and a script
//      that can mutate the production snapshot table is one typo from doing it;
//   2. it must not call a run "production" that was not.
//
// The second is not hypothetical. The first version of this script printed
//     COMPLETE — PRODUCTION PROVEN
// against a local disposable database, because the verdict was computed from
// the evidence alone and never asked which database had answered. That is the
// exact provenance failure this whole program exists to close, in the strongest
// possible wording, on the one line a human would quote.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { environmentClass, compare, E7 } from '../../../scripts/e7-production-proof.js';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../scripts/e7-production-proof.js', import.meta.url)), 'utf8',
);
/** Source with comments removed — a word in prose is not a call. */
const CODE = SOURCE.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('B4-E7 · the instrument is structurally read-only', () => {
  // Matched as CALLS, not substrings: `orderBy: { createdAt }` is a read, and a
  // ratchet that cannot tell those apart teaches people to work around it.
  it.each(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])(
    'never calls .%s()', (op) => {
      expect(CODE).not.toMatch(new RegExp('\\.' + op + '\\s*\\('));
    });

  it('never uses an executing raw query', () => {
    expect(CODE).not.toMatch(/\$executeRaw/);
  });

  it('never calls the verdict WRITE twin', () => {
    // evaluateConnectorVerdicts computes and returns; persistLevelVerdicts is
    // the one that writes Decisions. E7 §11 runs the pipeline to observe it,
    // not to record what it saw.
    expect(CODE).not.toMatch(/persistLevelVerdicts/);
  });

  it('never triggers a sync', () => {
    // §6 is a human action through the normal application path. An instrument
    // that could start a sync could also start one nobody asked for.
    expect(CODE).not.toMatch(/runConnectorSync|landDailySnapshots|landSnapshots\s*\(/);
  });

  it('never prints the connection string', () => {
    // The host and database NAME are printed so the reader knows which database
    // answered. The URL itself must never reach a terminal, a log or a PR.
    expect(CODE).not.toMatch(/console\.log\([^)]*DATABASE_URL/);
    expect(CODE).not.toMatch(/\$\{\s*raw\s*\}/);
  });

  it('is import-safe — importing it must not measure anything', () => {
    // This test file imports the module. If main() ran on import, the suite
    // would open a database connection and the guarded functions could never be
    // unit-tested at all.
    expect(CODE).toMatch(/invokedDirectly/);
    expect(CODE).toMatch(/if \(invokedDirectly\) \{/);
  });
});

describe('B4-E7 · a run may not call itself production unless it is', () => {
  const ENV_KEYS = ['RENDER_GIT_COMMIT', 'RENDER_SERVICE_NAME'];
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const clearRender = () => { for (const k of ENV_KEYS) delete process.env[k]; };

  it.each([
    ['localhost:5432', 'a local host'],
    ['127.0.0.1:5432', 'a loopback host'],
    ['[::1]:5432', 'an IPv6 loopback host'],
  ])('refuses production for %s', (host) => {
    clearRender();
    const out = environmentClass({ host, nodeEnv: 'production' });
    expect(out.production).toBe(false);
    expect(out.why).toMatch(/local/);
  });

  it('refuses production when DATABASE_URL was unparseable', () => {
    clearRender();
    expect(environmentClass({ host: null, nodeEnv: 'production' }).production).toBe(false);
  });

  it('refuses a remote host that is neither Render nor NODE_ENV=production', () => {
    clearRender();
    // A staging replica, or a restored snapshot someone is poking at.
    const out = environmentClass({ host: 'db.staging.example.com:5432', nodeEnv: 'development' });
    expect(out.production).toBe(false);
    expect(out.why).toMatch(/Render|NODE_ENV/);
  });

  it('accepts a remote host inside the deployed Render service', () => {
    clearRender();
    process.env.RENDER_SERVICE_NAME = 'lumi-backend';
    expect(environmentClass({ host: 'dpg-abc.oregon-postgres.render.com:5432', nodeEnv: 'production' }))
      .toEqual({ production: true, why: null });
  });

  it('accepts a remote host running as production without Render metadata', () => {
    clearRender();
    expect(environmentClass({ host: 'dpg-abc.oregon-postgres.render.com:5432', nodeEnv: 'production' }).production)
      .toBe(true);
  });
});

describe('B4-E7 · retry comparison (§9) reports what a re-sync actually did', () => {
  const row = (id, over = {}) => ({
    id, observedAt: '2026-08-24T05:00:00.000Z',
    spendMinor: 31050, impressions: 12000, clicks: 340, conversions: 7, ...over,
  });
  const snap = (byKey) => ({
    takenAt: '2026-08-24T05:00:00.000Z',
    totalRows: Object.values(byKey).flat().length,
    keys: Object.keys(byKey).length,
    byKey,
  });

  const A = 'ws|e1|CAMPAIGN|META|2026-08-20T00:00:00.000Z';
  const B = 'ws|e1|CAMPAIGN|META|2026-08-21T00:00:00.000Z';

  it('a day that was not there before is CREATED', () => {
    const out = compare(snap({ [A]: [row('r1')] }), snap({ [A]: [row('r1')], [B]: [row('r2')] }));
    expect(out.created.map((c) => c.key)).toEqual([B]);
    expect(out.restated).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it('a day whose numbers moved is RESTATED, and id stability is reported', () => {
    const out = compare(
      snap({ [A]: [row('r1')] }),
      snap({ [A]: [row('r1', { spendMinor: 99900, observedAt: '2026-08-25T05:00:00.000Z' })] }),
    );
    expect(out.created).toEqual([]);
    expect(out.restated).toHaveLength(1);
    expect(out.restated[0].idStable).toBe(true);
    expect(out.restated[0].changed.map((c) => c.field).sort()).toEqual(['observedAt', 'spendMinor']);
  });

  it('a restatement that MOVED the row is reported as unstable, not hidden', () => {
    const out = compare(
      snap({ [A]: [row('r1')] }),
      snap({ [A]: [row('r-new', { spendMinor: 99900 })] }),
    );
    expect(out.restated[0].idStable).toBe(false);
  });

  it('an identical re-sync changes nothing and stays clean', () => {
    const out = compare(snap({ [A]: [row('r1')] }), snap({ [A]: [row('r1')] }));
    expect(out).toMatchObject({ ok: true, created: [], restated: [], duplicated: [], unchangedCount: 1 });
  });

  it('two rows under ONE logical key is E7-8, the failure this mode exists for', () => {
    // The sink's documented race: two syncs each see no row and both create one.
    const out = compare(snap({ [A]: [row('r1')] }), snap({ [A]: [row('r1'), row('r2')] }));
    expect(out.ok).toBe(false);
    expect(out.code).toBe(E7.RETRY_DUPLICATION);
    expect(out.duplicated).toHaveLength(1);
  });

  it('a day that disappeared is reported rather than silently dropped', () => {
    const out = compare(snap({ [A]: [row('r1')], [B]: [row('r2')] }), snap({ [A]: [row('r1')] }));
    expect(out.vanished).toEqual([B]);
  });
});
