import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateStartupAdmission, admissionRequirements, forbiddenAutomaticWork } from '../services/startup/startupAdmission.js';

// All proof issuers here are synthetic. No DB, provider, startup or operator CLI
// is imported. A receipt is qualified by object identity in a trusted fixture Map,
// never by a COMPATIBLE property in an untrusted JSON object.
const NOW = 100_000;
const BINDING = Object.freeze({ target: 'a'.repeat(64), role: 'b'.repeat(64), binary: 'c'.repeat(64), observation: 'd'.repeat(64) });
function fixture(kind = 'API') {
  const requirements = admissionRequirements(kind);
  const input = { kind, now: NOW, proofs: {} };
  const trust = { context: 'SYNTHETIC', binding: { ...BINDING }, maxAgeMs: 1000, receipts: new Map() };
  const records = {};
  for (const requirement of requirements) {
    const token = {};
    const record = {
      issuer: 'SYNTHETIC_READ_ONLY_FIXTURE', kind, requirement: requirement.id,
      binding: { ...BINDING }, observedAt: NOW - 1, expiresAt: NOW + 1,
      readOnly: true, status: 'COMPATIBLE', coverage: [...requirement.coverage],
      nativeMatch: 'EXACT', migration76: 'APPLIED', history: 'COMPLETE_SUCCESS',
    };
    records[requirement.id] = record;
    input.proofs[requirement.id] = token;
    trust.receipts.set(token, record);
  }
  return { input, trust, records, run: () => evaluateStartupAdmission(input, trust) };
}

describe('startup admission candidate — synthetic, runtime NOT_WIRED', () => {
  it.each(['API', 'WORKER'])('accepts complete qualified synthetic %s evidence only', kind => {
    const result = fixture(kind).run();
    expect(result).toMatchObject({ status: 'READY', processKind: kind, scope: 'SYNTHETIC_ONLY', integration: 'BLOCKED', runtimeAdmission: 'NOT_WIRED' });
    expect(result.proofs).toHaveLength(admissionRequirements(kind).length);
    expect(result.proofs.every(p => p.status === 'READY' && p.issuer === 'SYNTHETIC_READ_ONLY_FIXTURE')).toBe(true);
  });
  it('does not default missing real issuers to a mock or live readiness', () => {
    expect(evaluateStartupAdmission()).toMatchObject({ status: 'UNKNOWN', reason: 'REAL_PROOF_SOURCES_UNDEFINED', integration: 'BLOCKED' });
    const f = fixture(); f.trust.context = 'PRODUCTION';
    expect(f.run().status).toBe('UNKNOWN');
  });
  it.each(['API', 'WORKER'])('%s rejects listener / HTTP200 / SELECT1 / migration-name-only claims', kind => {
    const f = fixture(kind);
    f.input.proofs = { listener: true, http: 200, select1: true, migrations: { ready: true, missing: [] } };
    expect(f.run().status).toBe('UNKNOWN');
    expect(f.run().proofs.every(p => p.reason === 'PROOF_MISSING')).toBe(true);
  });
  it('rejects self-reported compatibility, copied receipts and operator-only results', () => {
    for (const claim of [true, [], { status: 'COMPATIBLE' }, { status: 'COMPATIBLE', scope: 'LEGACY_NATIVE_DIAGNOSTIC_ONLY' }]) {
      const f = fixture(); f.input.proofs.IDENTITY = claim;
      expect(f.run().proofs[0]).toMatchObject({ status: 'UNKNOWN', reason: 'PROOF_UNQUALIFIED' });
    }
    const f = fixture(); f.input.proofs.IDENTITY = { ...f.input.proofs.IDENTITY };
    expect(f.run().status).toBe('UNKNOWN');
    const forged = fixture(); forged.input.proofs.IDENTITY = { ...forged.records.IDENTITY };
    expect(forged.run().status).toBe('UNKNOWN');
  });
  for (const kind of ['API', 'WORKER']) {
    for (const { id, coverage } of admissionRequirements(kind)) {
      it(`${kind}/${id}: missing, empty, partial and unqualified proof fails closed`, () => {
        const f = fixture(kind);
        delete f.input.proofs[id]; expect(f.run().status).toBe('UNKNOWN');
        f.input.proofs[id] = {}; expect(f.run().status).toBe('UNKNOWN');
        f.trust.receipts.set(f.input.proofs[id], f.records[id]);
        f.records[id].coverage = []; expect(f.run().status).toBe('UNKNOWN');
        for (const field of coverage) {
          f.records[id].coverage = coverage.filter(value => value !== field);
          expect(f.run().proofs.find(p => p.id === id)).toMatchObject({ status: 'UNKNOWN', reason: 'COVERAGE_INCOMPLETE' });
        }
      });
      it.each(['UNKNOWN', 'NOT_CONNECTED', 'FAILED', 'INCOMPATIBLE'])(`${kind}/${id}: preserves %s distinctly`, status => {
        const f = fixture(kind); f.records[id].status = status;
        expect(f.run().status).toBe(status);
        expect(f.run().proofs.find(p => p.id === id).status).toBe(status);
      });
      it(`${kind}/${id}: stale, future and invalid time cannot qualify`, () => {
        for (const patch of [{ observedAt: NOW - 1001 }, { observedAt: NOW + 1 }, { expiresAt: NOW }, { observedAt: NaN }, { expiresAt: Infinity }]) {
          const f = fixture(kind); Object.assign(f.records[id], patch);
          expect(f.run().status).toBe('UNKNOWN');
        }
      });
      it.each(Object.keys(BINDING))(`${kind}/${id}: rejects mismatched %s binding`, field => {
        const f = fixture(kind); f.records[id].binding[field] = 'e'.repeat(64);
        expect(f.run().status).toBe('INCOMPATIBLE');
      });
      it(`${kind}/${id}: rejects wrong source, scope, requirement and mutable-work qualification`, () => {
        for (const patch of [{ issuer: 'OPERATOR' }, { kind: kind === 'API' ? 'WORKER' : 'API' }, { requirement: 'SELECT1' }, { readOnly: false }, { status: true }]) {
          const f = fixture(kind); Object.assign(f.records[id], patch);
          expect(f.run().status).not.toBe('READY');
        }
      });
    }
  }
  it.each(['LEGACY_NATIVE', 'CANONICAL_76'])('%s requires exact native evidence even with COMPATIBLE', id => {
    const f = fixture(); f.records[id].nativeMatch = 'MISMATCH';
    expect(f.run()).toMatchObject({ status: 'INCOMPATIBLE' });
  });
  it.each(['CANONICAL_76', 'MIGRATION_HISTORY'])('%s rejects failed / rolled-back / unknown #76 and bad history', id => {
    for (const migration76 of ['FAILED', 'ROLLED_BACK', 'UNKNOWN', undefined]) {
      const f = fixture(); f.records[id].migration76 = migration76;
      expect(f.run().status).toBe('INCOMPATIBLE');
    }
    for (const history of ['NAME_LIST_ONLY', 'PARTIAL', 'ERROR', 'ROLLED_BACK', undefined]) {
      const f = fixture(); f.records[id].history = history;
      expect(f.run().status).toBe('INCOMPATIBLE');
    }
  });
  it('has deterministic failure precedence without hiding individual outcomes', () => {
    const f = fixture(); f.records.IDENTITY.status = 'FAILED'; f.records.LEGACY_NATIVE.status = 'NOT_CONNECTED';
    delete f.input.proofs.AUTH;
    expect(f.run().status).toBe('FAILED');
    expect(f.run().proofs.map(p => p.status)).toEqual(expect.arrayContaining(['FAILED', 'NOT_CONNECTED', 'UNKNOWN']));
    f.records.CANONICAL_76.status = 'INCOMPATIBLE'; expect(f.run().status).toBe('INCOMPATIBLE');
  });
  it('does not mutate input or allow returned coverage to rewrite the contract', () => {
    const f = fixture(); const before = JSON.stringify([...f.trust.receipts.values()]);
    const first = f.run(); expect(f.run()).toEqual(first);
    first.proofs[0].coverage.length = 0;
    expect(f.run().status).toBe('READY');
    expect(JSON.stringify([...f.trust.receipts.values()])).toBe(before);
  });
  it('sanitizes malformed and thrown proof inputs without emitting customer data', () => {
    const secret = 'synthetic-private-account-token-SQL-error';
    const f = fixture(); f.records.IDENTITY.error = secret; f.records.IDENTITY.issuer = secret;
    expect(JSON.stringify(f.run())).not.toContain(secret);
    const hostile = new Proxy({}, { get() { throw new Error(secret); } });
    expect(evaluateStartupAdmission(hostile, f.trust)).toMatchObject({ status: 'UNKNOWN', reason: 'MALFORMED_EVIDENCE' });
    expect(JSON.stringify(evaluateStartupAdmission(hostile, f.trust))).not.toContain(secret);
  });
  it.each([undefined, null, [], {}, { context: 'SYNTHETIC', receipts: true }])('malformed qualification fails closed: %j', trust => {
    expect(evaluateStartupAdmission({ kind: 'API' }, trust).status).toBe('UNKNOWN');
  });
  it('rejects invalid kind, clock, lifetime and empty binding', () => {
    for (const kind of ['', 'api', null, 'BOTH']) { const f = fixture(); f.input.kind = kind; expect(f.run().status).toBe('UNKNOWN'); }
    for (const now of [undefined, NaN, Infinity, -1]) { const f = fixture(); f.input.now = now; expect(f.run().status).toBe('UNKNOWN'); }
    for (const maxAgeMs of [undefined, 0, -1, Infinity]) { const f = fixture(); f.trust.maxAgeMs = maxAgeMs; expect(f.run().status).toBe('UNKNOWN'); }
    const f = fixture(); f.trust.binding = {}; expect(f.run().status).toBe('UNKNOWN');
  });
  it.each(['API', 'WORKER'])('%s proposed simulation: refused evidence starts nothing; healthy synthetic path is explicit', kind => {
    const simulate = f => {
      const effects = { bootstrapWrites: 0, workerStarts: 0, schedules: 0, listeners: 0 };
      const result = f.run();
      if (result.status === 'READY') {
        if (kind === 'API') effects.listeners++; else { effects.workerStarts++; effects.schedules++; }
      }
      return effects;
    };
    const f = fixture(kind); f.records.IDENTITY.status = 'NOT_CONNECTED';
    expect(simulate(f)).toEqual({ bootstrapWrites: 0, workerStarts: 0, schedules: 0, listeners: 0 });
    f.records.IDENTITY.status = 'COMPATIBLE';
    expect(simulate(f)).toEqual({ bootstrapWrites: 0, workerStarts: kind === 'WORKER' ? 1 : 0, schedules: kind === 'WORKER' ? 1 : 0, listeners: kind === 'API' ? 1 : 0 });
    // Counters only. Actual server/worker is never imported or run.
  });
  it('API and Worker each require the full process-specific dependency set', () => {
    expect(admissionRequirements('API').map(p => p.id)).toEqual(['IDENTITY', 'LEGACY_NATIVE', 'CANONICAL_76', 'MIGRATION_HISTORY', 'AUTH', 'API_SESSIONS_OAUTH_CREDENTIALS', 'BINARY_COMPATIBILITY']);
    expect(admissionRequirements('WORKER').map(p => p.id)).toEqual(['IDENTITY', 'LEGACY_NATIVE', 'CANONICAL_76', 'MIGRATION_HISTORY', 'AUTH', 'WORKER_CREDENTIALS', 'WORKER_EFFECTS', 'BINARY_COMPATIBILITY']);
    expect(admissionRequirements('unknown')).toEqual([]);
    expect(admissionRequirements(['API'])).toEqual([]);
    expect(admissionRequirements({ toString() { throw new Error('must not coerce process kind'); } })).toEqual([]);
    expect(Object.isFrozen(admissionRequirements('API')[0].coverage)).toBe(true);
  });
});

// One eager source snapshot; never repeat recursive filesystem reads in cases.
const root = new URL('../../', import.meta.url);
const sources = new Map();
beforeAll(() => {
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(child);
      else if (/\.jsx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) sources.set(fileURLToPath(child), readFileSync(child, 'utf8').replaceAll('\r\n', '\n'));
    }
  }
  walk(new URL('src/', root));
});
const source = path => sources.get(fileURLToPath(new URL(path, root)));
describe('runtime isolation and source-only credential repair removal — not an operational PASS', () => {
  it('candidate is import-free, with no runtime I/O, clocks, environment or startup execution', () => {
    const candidate = source('src/services/startup/startupAdmission.js');
    expect(candidate).toBeTruthy();
    expect(candidate).not.toMatch(/\bimport\s|\brequire\s*\(|\bprocess\s*\.|\bconsole\s*\.|\bDate\b|\bset(?:Timeout|Interval)\s*\(|\beval\s*\(|\bFunction\s*\(/);
  });
  it('no other runtime source imports or references the candidate (including barrels/dynamic imports)', () => {
    expect(sources.size).toBeGreaterThan(400);
    for (const [path, text] of sources) {
      if (path.endsWith('startupAdmission.js')) continue;
      expect(text, path).not.toMatch(/startupAdmission|evaluateStartupAdmission/);
    }
  });
  it('pins existing listener, health, worker, execution and model code unchanged', () => {
    const pins = {
      'src/server.js': '669b2c1e47be3cdc809791d6964c74a795d71911',
      'src/workers/index.js': '79417697c7f6c1df648bbfce751f2a878851cde7',
      'src/models/chatSession.js': 'a576f0bc473cb9167293b79b9122894bb81d7a25',
      'src/models/userContext.js': '04261772174bb107ca6cbe14dc2df821ded2d65f',
      'src/models/project.js': 'b4182fa480a91e6578111f7683634dcede5e5efe',
      'src/models/credential.js': '4fd9e1dd12f68e68c982f089f31e95dd898abd77',
      'src/services/execution/schemaReadiness.js': '55eb55c11eb4a61d6e82a27286037f9640fa0967',
    };
    for (const [path, hash] of Object.entries(pins)) {
      const content = source(path);
      expect(createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex'), path).toBe(hash);
    }
  });
  it('pins four remaining legacy boot ensures and refuses automatic credential backfill', () => {
    expect(forbiddenAutomaticWork).toEqual(['ensureChatSessionSchema', 'ensureUserContextSchema', 'ensureProjectSchema', 'ensureCredentialSchema', 'backfillWorkspaceIds']);
    expect(Object.isFrozen(forbiddenAutomaticWork)).toBe(true);
    for (const name of forbiddenAutomaticWork.slice(0, 4)) {
      expect(source('src/server.js')).toContain(`${name}().catch`);
    }
    expect(source('src/models/credential.js')).not.toContain('backfillWorkspaceIds');
    const credential = source('src/models/credential.js');
    const start = credential.indexOf('export async function ensureCredentialSchema()');
    const end = credential.indexOf('// ── PUBLIC API', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const ensureOnly = credential.slice(start, end);
    expect([...ensureOnly.matchAll(/await sql`/g)]).toHaveLength(8);
    expect(ensureOnly).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\s+(?:INTO\s+|FROM\s+)?marcom_credentials\b/i);
    expect(source('src/server.js').indexOf('app.listen(')).toBeLessThan(source('src/server.js').indexOf('ensureChatSessionSchema().catch'));
    expect(source('src/workers/index.js')).toContain('const executionWorker = startExecutionWorker()');
  });
});
