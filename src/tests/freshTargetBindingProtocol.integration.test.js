import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertion, candidate, client, databaseName, physicalLab, receiptDDL, sha, wireRouter } from './freshTargetBindingProtocolFixtures.js';
import { loadFreshContract, ROLES } from '../../scripts/fresh-target/contract.js';
import { bindPlatform, collectCombinedCatalog, stable } from '../../scripts/fresh-target/catalog.js';
import { sealTemplate } from './dbIsolation.js';

const quote = s => '"' + s.replaceAll('"', '""') + '"';
const literal = s => "'" + s.replaceAll("'", "''") + "'";
const evidence = (kind, value) => console.info('PROTOCOL_QUALIFICATION', JSON.stringify({ kind, ...value }));

describe.skipIf(process.env.REQUIRE_DB !== '1')('03B-9A / owned physical PG17 protocol qualification', () => {
  const labs = [], routers = [], connections = []; let a, b, recreatedFixture;
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const lab = await physicalLab(); labs.push(lab);
      await sealTemplate(text => lab.admin.unsafe(text), 'template0');
      for (const [kind, role] of Object.entries(ROLES)) await lab.admin.unsafe(`CREATE ROLE ${role} ${['migrator', 'runtime', 'auditor'].includes(kind) ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await lab.admin`GRANT lumi_backend_owner,lumi_canonical_owner TO lumi_backend_migrator`;
      await lab.admin`GRANT lumi_canonical_app TO lumi_backend_runtime`;
    }
    [a, b] = labs; expect(a.system).not.toBe(b.system);
    await b.admin`CREATE DATABASE lumi_protocol_oid_offset TEMPLATE template0`;
    const name = databaseName();
    await a.admin.unsafe(`CREATE DATABASE ${quote(name)} OWNER ${ROLES.owner} TEMPLATE template0;`);
    const [{ oid: old }] = await a.admin`SELECT oid::int AS oid FROM pg_database WHERE datname=${name}`;
    await a.admin.unsafe(`DROP DATABASE ${quote(name)} WITH (FORCE);`);
    await a.admin.unsafe(`CREATE DATABASE ${quote(name)} OWNER ${ROLES.owner} TEMPLATE template0;`);
    recreatedFixture = { name, old, target: { systemIdentifier: a.system, databaseOid: old, database: name, login: ROLES.migrator } };
  }, 30000);
  afterAll(async () => {
    const errors = [], started = Date.now(); let phase = 0;
    for (const group of [routers.map(router => () => router.stop()), connections.map(sql => () => sql.end({ timeout: 2 })), labs.map(lab => () => lab.stop())]) {
      const results = await Promise.allSettled(group.map(close => close()));
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason.message);
      evidence('TEARDOWN_PHASE', { phase: phase++, elapsedMs: Date.now() - started, failures: errors });
    }
    if (errors.length) throw Error('Owned teardown incomplete: ' + errors.join(';'));
  }, 15000);
  async function pair(setup = true) {
    const name = databaseName(), targets = [];
    for (const lab of [a, b]) {
      await lab.admin.unsafe(`CREATE DATABASE ${quote(name)} OWNER ${ROLES.owner} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
      const sql = lab.open(name, 'lab_protocol_admin');
      await sql.unsafe(`REVOKE ALL ON DATABASE ${quote(name)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${quote(name)} TO ${ROLES.migrator},${ROLES.runtime};`);
      if (setup) await sql.unsafe('CREATE TABLE public.protocol_payload(id int);' + receiptDDL
        + 'ALTER TABLE public.protocol_payload OWNER TO lumi_backend_owner; ALTER TABLE public._prisma_migrations OWNER TO lumi_backend_owner;');
      const [{ oid }] = await sql`SELECT oid::int AS oid FROM pg_database WHERE datname=current_database()`;
      targets.push({ systemIdentifier: lab.system, databaseOid: oid, database: name, login: ROLES.migrator }); await sql.end();
    }
    // OIDs are cluster-local; identical numeric OIDs must not defeat system binding.
    expect(new Set(targets.map(t => t.systemIdentifier + ':' + t.databaseOid)).size).toBe(2);
    return { name, target: targets[0], targets };
  }
  async function snapshot(lab, name) {
    const sql = lab.open(name, 'lab_protocol_admin');
    try {
      return await sql.begin('read only', async tx => {
        await tx`SET LOCAL search_path=pg_catalog,pg_temp`;
        const catalog = await collectCombinedCatalog(tx), receipts = catalog.tables.some(t => t.relname === '_prisma_migrations')
          ? await tx`SELECT to_jsonb(m) AS row FROM public._prisma_migrations m ORDER BY id` : [];
        const app = catalog.tables.some(t => t.relname === 'protocol_payload') ? await tx`SELECT * FROM public.protocol_payload ORDER BY id` : [];
        const identityAcl = await tx`SELECT proacl::text FROM pg_proc WHERE oid='pg_catalog.pg_control_system()'::regprocedure`;
        return stable({ catalog, receipts, app, identityAcl });
      });
    } finally { await sql.end(); }
  }
  async function routed(test, choose = () => 0, loseAck) {
    const router = await wireRouter([a, b], choose, loseAck); routers.push(router);
    const sql = client(router.port, test.name, ROLES.migrator); connections.push(sql);
    return { router, sql, lease: candidate(sql, test.target) };
  }
  it('RED control: separate identity on A does not authorize the following write on B', async () => {
    const test = await pair(), { router, sql } = await routed(test, text => text.includes('protocol_payload') ? 1 : 0);
    await sql.unsafe(assertion(test.target)).simple(); await sql.unsafe('INSERT INTO public.protocol_payload VALUES(611);').simple();
    const after = await snapshot(b, test.name);
    evidence('SEPARATE_PREQUERY_RED', { targets: test.targets, routes: router.trace, wrongTargetRows: after.app });
    expect(router.trace.map(r => r.route)).toEqual([0, 1]); expect(after.app).toEqual([{ id: 611 }]);
  });
  it('routes between assertion and payload: guarded one Query refuses B with no writes', async () => {
    const test = await pair(), before = await snapshot(b, test.name);
    const { router, lease } = await routed(test, text => text.includes('protocol_payload') ? 1 : 0);
    let failure; try { await lease.write('INSERT INTO public.protocol_payload VALUES(612);'); } catch (error) { failure = error; }
    const after = await snapshot(b, test.name);
    evidence('ONE_QUERY_GREEN_OR_RED', { targets: test.targets, trace: router.trace, code: failure?.code,
      before: sha(JSON.stringify(before)), after: sha(JSON.stringify(after)), wrongTargetRows: after.app });
    evidence('B_READ_ONLY_SQL_SNAPSHOTS', { before, after });
    expect(failure).toMatchObject({ code: 'P0001' }); expect(after).toEqual(before);
    expect(router.trace).toHaveLength(1); expect(router.trace[0]).toMatchObject({ route: 1, ready: 'I' });
    expect(router.trace[0].sql).toContain('LUMI_BINDING_ASSERTION'); expect(router.trace[0].sql).toContain('INSERT INTO public.protocol_payload');
  });
  it('accepts A on the observed wire and rejects every B mutation class', async () => {
    const test = await pair(), { router, lease } = await routed(test);
    await lease.write('INSERT INTO public.protocol_payload VALUES(9);');
    expect((await snapshot(a, test.name)).app).toEqual([{ id: 9 }]); expect(router.trace).toHaveLength(1);
    const before = await snapshot(b, test.name);
    for (const payload of ['CREATE TABLE public.unapproved(id int);', 'INSERT INTO public.protocol_payload VALUES(1);',
      "INSERT INTO public._prisma_migrations(id,checksum,migration_name) VALUES('x','bad','started');",
      'UPDATE public._prisma_migrations SET applied_steps_count=1;', 'UPDATE public._prisma_migrations SET finished_at=now();',
      "UPDATE public._prisma_migrations SET logs='failure';", 'ALTER TABLE public.protocol_payload OWNER TO lumi_backend_owner;',
      'GRANT SELECT ON public.protocol_payload TO PUBLIC;', 'CREATE TABLE public.receipt_initialization(id int);']) {
      const run = await routed(test, () => 1); await expect(run.lease.write(payload)).rejects.toMatchObject({ code: 'P0001' });
      expect(run.router.trace).toHaveLength(1); expect(run.router.trace[0].commands).toEqual([]);
    }
    const after = await snapshot(b, test.name); expect(after).toEqual(before);
    evidence('MUTATION_CLASSES', { target: test.target, before: sha(JSON.stringify(before)), after: sha(JSON.stringify(after)), classes: 9 });
  });
  it('rechecks the executing backend after switching between write units', async () => {
    const test = await pair(), before = await snapshot(b, test.name);
    const run = await routed(test, (_text, sequence) => sequence === 0 ? 0 : 1);
    await run.lease.write('INSERT INTO public.protocol_payload VALUES(41);');
    await expect(run.lease.write('INSERT INTO public.protocol_payload VALUES(42);')).rejects.toMatchObject({ code: 'P0001' });
    await expect(run.lease.write('INSERT INTO public.protocol_payload VALUES(43);')).rejects.toThrow('TEST_LEASE_TERMINAL');
    expect((await snapshot(a, test.name)).app).toEqual([{ id: 41 }]);
    expect(await snapshot(b, test.name)).toEqual(before);
    expect(run.router.trace.map(t => t.route)).toEqual([0, 1]); expect(run.router.connections).toBe(1);
    evidence('BETWEEN_UNIT_SWITCH', { targets: test.targets, trace: run.router.trace, unauthorizedRows: 0, retries: 0 });
  });
  it('refuses wrong OID, wrong login and inaccessible identity before payload', async () => {
    const test = await pair(), before = await snapshot(a, test.name);
    const wrong = await routed(test); await expect(candidate(wrong.sql, { ...test.target, databaseOid: test.target.databaseOid + 1 }).write('INSERT INTO public.protocol_payload VALUES(1);')).rejects.toMatchObject({ code: 'P0001' });
    const wrongName = await routed(test); await expect(candidate(wrongName.sql, { ...test.target, database: 'lumi_protocol_wrong_name' }).write('INSERT INTO public.protocol_payload VALUES(4);')).rejects.toMatchObject({ code: 'P0001' });
    const runtime = client(a.port, test.name, ROLES.runtime); connections.push(runtime);
    await expect(candidate(runtime, test.target).write('INSERT INTO public.protocol_payload VALUES(2);')).rejects.toMatchObject({ code: 'P0001' });
    const admin = a.open(test.name, 'lab_protocol_admin');
    await admin`REVOKE EXECUTE ON FUNCTION pg_control_system() FROM PUBLIC,lumi_backend_migrator`;
    const [{ allowed }] = await admin`SELECT has_function_privilege('lumi_backend_migrator','pg_control_system()','EXECUTE') AS allowed`; expect(allowed).toBe(false);
    const denied = await routed(test); await expect(denied.lease.write('INSERT INTO public.protocol_payload VALUES(3);')).rejects.toMatchObject({ code: '42501' });
    const after = await snapshot(a, test.name); expect(after.app).toEqual(before.app); expect(after.receipts).toEqual(before.receipts); await admin.end();
    evidence('IDENTITY_DENIAL', { wrongOid: true, wrongRole: true, effectiveExecute: allowed, payloadRows: after.app });
  });
  it('refuses a recreated database with the old approved OID', async () => {
    const test = recreatedFixture, old = test.old;
    const [{ oid: recreated }] = await a.admin`SELECT oid::int AS oid FROM pg_database WHERE datname=${test.name}`;
    expect(recreated).not.toBe(old);
    const router = await wireRouter([a]); routers.push(router);
    const sql = client(router.port, test.name, ROLES.migrator); connections.push(sql);
    const run = { router, lease: candidate(sql, test.target) };
    await expect(run.lease.write('CREATE TABLE public.unapproved(id int);')).rejects.toMatchObject({ code: 'P0001' });
    const state = await snapshot(a, test.name); expect(state.catalog.tables).toEqual([]);
    evidence('RECREATED_DATABASE', { oldOid: old, recreatedOid: recreated, target: test.target, trace: run.router.trace });
  });
  it('preserves migration76 BEGIN/COMMIT and qualifies all76 exact payloads, history, legacy and role profile', async () => {
    const test = await pair(false), { router, lease } = await routed(test), contract = loadFreshContract();
    // Compatibility experiment, not an exportable replacement migration executor.
    await lease.write(receiptDDL);
    for (const migration of contract.migrations) {
      expect(sha(migration.bytes)).toBe(migration.checksum); const id = randomUUID();
      await lease.write(`INSERT INTO public._prisma_migrations(id,checksum,migration_name) VALUES(${literal(id)},${literal(migration.checksum)},${literal(migration.name)});`);
      await lease.write('SET search_path=public;\n' + migration.bytes.toString('utf8'));
      await lease.write(`UPDATE public._prisma_migrations SET applied_steps_count=applied_steps_count+1 WHERE id=${literal(id)};`);
      await lease.write(`UPDATE public._prisma_migrations SET finished_at=clock_timestamp() WHERE id=${literal(id)};`);
    }
    await lease.write('BEGIN; SET LOCAL ROLE lumi_backend_owner; SET LOCAL search_path=public; DO $$ BEGIN IF current_user<>\'lumi_backend_owner\' THEN RAISE EXCEPTION \'WRONG_ROLE\'; END IF; END $$;' + contract.legacy.map(d => d.query).join(';\n') + '; COMMIT;');
    const admin = a.open(test.name, 'lab_protocol_admin');
    const tables = await admin`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'canonical_%' ORDER BY tablename`;
    for (const { tablename } of tables) await lease.write(`ALTER TABLE public.${quote(tablename)} OWNER TO lumi_backend_owner;`);
    const enums = await admin`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`;
    for (const { typname } of enums) await lease.write(`ALTER TYPE public.${quote(typname)} OWNER TO lumi_backend_owner;`);
    let grants = 'BEGIN; SET LOCAL ROLE lumi_backend_owner; SET LOCAL search_path=public; REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO lumi_backend_runtime,lumi_backend_auditor;';
    for (const { tablename } of tables) grants += `REVOKE ALL ON TABLE public.${quote(tablename)} FROM PUBLIC; GRANT ${tablename === '_prisma_migrations' ? 'SELECT' : 'SELECT,INSERT,UPDATE,DELETE'} ON TABLE public.${quote(tablename)} TO lumi_backend_runtime;`;
    grants += 'GRANT SELECT ON public._prisma_migrations TO lumi_backend_auditor; GRANT SELECT(workspace_id,platform,account_id,is_active,updated_at),UPDATE(account_id) ON public.marcom_credentials TO lumi_canonical_owner; REVOKE ALL ON FUNCTION public.touch_last_updated() FROM PUBLIC;';
    for (const { typname } of enums) grants += `REVOKE ALL ON TYPE public.${quote(typname)} FROM PUBLIC; GRANT USAGE ON TYPE public.${quote(typname)} TO lumi_backend_runtime;`;
    await lease.write(grants + `GRANT CONNECT ON DATABASE ${quote(test.name)} TO lumi_backend_runtime,lumi_backend_auditor; COMMIT;`);
    const final = await snapshot(a, test.name);
    expect(stable(bindPlatform(final.catalog, 'lab_protocol_admin'))).toEqual(stable(contract.profile.catalog));
    expect(final.receipts).toHaveLength(76);
    for (const m of contract.migrations) expect(final.receipts.filter(({ row }) => row.migration_name === m.name && row.checksum === m.checksum && row.applied_steps_count === 1 && row.finished_at && !row.rolled_back_at && row.logs === null)).toHaveLength(1);
    const sqlFile = readFileSync(new URL('../../prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql', import.meta.url));
    const frame76 = router.trace.find(t => t.sql.endsWith(sqlFile.toString('utf8')));
    expect(frame76.ready).toBe('I'); expect(frame76.commands).toContain('BEGIN'); expect(frame76.commands).toContain('COMMIT');
    expect(router.trace.every(t => t.sql.includes('LUMI_BINDING_ASSERTION'))).toBe(true);
    evidence('ALL76_NATIVE_COMPATIBILITY', { target: test.target, checksums: contract.migrations.map(m => ({ name: m.name, checksum: m.checksum })),
      frames: router.trace.map(t => ({ bytes: t.bytes, sha256: t.sha256, frameBase64: t.frameBase64, commands: t.commands, ready: t.ready })), receipts: final.receipts,
      nativeDigest: sha(JSON.stringify(final.catalog)), legacy: contract.legacy.length, receiptIssuer: 'TEST_CANDIDATE_NOT_PRISMA' }); await admin.end();
    evidence('FINAL_NATIVE_SQL_SNAPSHOT', { target: test.target, catalog: final.catalog });
  }, 30000);
  it('records failed history without fabricating finished success and rolls back an open failed transaction', async () => {
    const test = await pair(), run = await routed(test);
    await run.lease.write("INSERT INTO public._prisma_migrations(id,checksum,migration_name) VALUES('failed','bad','synthetic_failure');");
    await expect(run.lease.write('BEGIN; INSERT INTO public.protocol_payload VALUES(1); SELECT 1/0; COMMIT;')).rejects.toMatchObject({ code: '22012' });
    expect(run.router.trace.at(-1).ready).toBe('E');
    await run.sql.end({ timeout: 2 }); // Closing rolls back the open transaction; never replay it.
    const after = await snapshot(a, test.name); expect(after.app).toEqual([]); expect(after.receipts[0].row.finished_at).toBeNull();
    const logger = await routed(test); await logger.lease.write("UPDATE public._prisma_migrations SET logs='synthetic failure' WHERE id='failed';");
    const failed = await snapshot(a, test.name); expect(failed.receipts[0].row).toMatchObject({ applied_steps_count: 0, finished_at: null, rolled_back_at: null, logs: 'synthetic failure' });
    evidence('FAILED_HISTORY', { receipts: failed.receipts, transactionState: run.router.trace.at(-1).ready });
  });
  it('keeps same-session locks, cancellation and post-commit acknowledgement loss distinct', async () => {
    const test = await pair(), run = await routed(test);
    await run.lease.write('SELECT pg_catalog.pg_advisory_lock(6087601); SELECT pg_catalog.pg_advisory_lock(72707369);');
    const contender = a.open(test.name, ROLES.migrator);
    const [locks] = await contender`SELECT pg_try_advisory_lock(6087601) AS parent,pg_try_advisory_lock(72707369) AS migration`;
    expect(locks).toEqual({ parent: false, migration: false }); await contender.end();
    const query = run.sql.unsafe(assertion(test.target) + 'SELECT pg_sleep(2); INSERT INTO public.protocol_payload VALUES(77);').simple();
    const pending = query.execute(); let cancelError;
    const timer = setTimeout(() => { Promise.resolve(query.cancel()).catch(error => { cancelError = error; }); }, 60);
    try { await expect(pending).rejects.toMatchObject({ code: '57014' }); } finally { clearTimeout(timer); }
    expect(cancelError).toBeUndefined();
    expect((await snapshot(a, test.name)).app).toEqual([]);
    const loss = await routed(test, () => 0, record => record.sql.includes('VALUES(88)'));
    await expect(loss.lease.write('INSERT INTO public.protocol_payload VALUES(88);')).rejects.toBeDefined();
    await expect(loss.lease.write('INSERT INTO public.protocol_payload VALUES(89);')).rejects.toThrow('TEST_LEASE_TERMINAL');
    expect(loss.router.trace).toHaveLength(1); expect((await snapshot(a, test.name)).app).toEqual([{ id: 88 }]);
    evidence('CANCEL_LOCK_AMBIGUOUS_COMMIT', { locks, cancellation: '57014', committedWithoutClientAck: 88, packets: loss.router.trace, reconnects: loss.router.connections - 1 });
  }, 10000);
});
