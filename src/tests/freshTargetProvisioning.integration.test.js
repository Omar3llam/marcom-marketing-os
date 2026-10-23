import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { provisionFreshTarget, inspectFreshTarget } from '../../scripts/fresh-target/provision.js';
import { loadFreshContract, digest, ROLES } from '../../scripts/fresh-target/contract.js';
import { collectCombinedCatalog, stable, bindPlatform } from '../../scripts/fresh-target/catalog.js';
import { collectStructure } from '../../scripts/legacy-schema/catalog.js';
import { bind } from '../../scripts/legacy-schema/contract.js';
import { verifyCanonicalProvenanceCatalog } from '../../scripts/verify-canonical-provenance-catalog.js';
import { seed, admit, level } from './canonicalProvenanceFixtures.js';
import { sealTemplate } from './dbIsolation.js';

const enabled = process.env.REQUIRE_DB === '1';
const command = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (r.status !== 0) throw Error(`Fresh lab command failed: ${exe} (${r.status}): ${r.stderr || r.error?.code}`);
  return r.stdout.trim();
};
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const clusters = [], clients = [];
async function physicalCluster() {
  const bin = process.env.FRESH_TARGET_TEST_PG_BIN;
  let port, stop, evidence;
  if (bin) {
    if (!command(join(bin, 'postgres'), ['--version']).includes(' 17.')) throw Error('PG17 binary required');
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-pg17-')); port = await freePort();
    command(join(bin, 'initdb'), ['-D', join(dir, 'data'), '-U', 'lab_fresh_admin', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    stop = () => { command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']); expect(existsSync(join(dir, 'data', 'postmaster.pid'))).toBe(false); };
    clusters.push({ stop });
    command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    evidence = { physicalDirectory: dir, physicalControl: command(join(bin, 'pg_controldata'), [join(dir, 'data')]) };
  } else {
    // CI's explicitly approved postgres:17 service supplies this cached image.
    // Never pull/install/fall back to a remote database from a test.
    if (process.platform !== 'linux') throw Error('Supply an explicit local PG17 binary directory');
    const docker = args => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
    docker(['image', 'inspect', 'postgres:17']);
    const id = docker(['run', '--pull=never', '--rm', '-d', '--label', 'lumi.fresh-target.synthetic=true',
      '-e', 'POSTGRES_USER=lab_fresh_admin', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8', '-p', '127.0.0.1::5432', 'postgres:17']);
    stop = () => { docker(['stop', '-t', '5', id]); expect(docker(['ps', '-aq', '--filter', `id=${id}`])).toBe(''); };
    clusters.push({ stop });
    port = Number(docker(['port', id, '5432/tcp']).split(':').at(-1));
    evidence = { container: id, image: docker(['inspect', '--format', '{{.Image}}', id]) };
  }
  let admin;
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    admin = postgres({ host: '127.0.0.1', port, database: 'postgres', username: 'lab_fresh_admin', password: () => '', ssl: false, max: 1, connect_timeout: 1, onnotice: () => {} });
    try { await admin`SELECT 1`; break; } catch { await admin.end({ timeout: 1 }); admin = null; }
  }
  if (!admin) throw Error('New PG17 lab did not become ready');
  clients.push(admin);
  const [identity] = await admin`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`;
  expect(identity.major).toBe(17);
  if (bin) expect(evidence.physicalControl).toContain(identity.system);
  console.info('FRESH_TARGET_PHYSICAL_LAB', JSON.stringify({ port, ...identity, ...evidence }));
  const open = (database, username) => { const q = postgres({ host: '127.0.0.1', port, database, username, password: () => '', ssl: false, max: 1, onnotice: () => {} }); clients.push(q); return q; };
  return { admin, port, system: identity.system, open };
}

describe.skipIf(!enabled)('fresh PG17 operator / independent physical labs', () => {
  let lab, other, valid, db;
  beforeAll(async () => {
    // Full verification already owns a different physical PG17 service. Use
    // its read-only identity as the independent wrong-target witness rather
    // than initializing a redundant second cluster inside the hook budget.
    const witness = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try { [other] = await witness`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`; }
    finally { await witness.end({ timeout: 2 }); }
    expect(other.major).toBe(17);
    lab = await physicalCluster();
    expect(lab.system).not.toBe(other.system);
    // Keep the built-in template0 sealed; use the same enforced copy boundary
    // as every other test provisioner. Never reopen this built-in template.
    await sealTemplate(statement => lab.admin.unsafe(statement), 'template0');
    for (const [kind, name] of Object.entries(ROLES)) await lab.admin.unsafe(`CREATE ROLE ${name} ${['migrator', 'runtime', 'auditor'].includes(kind) ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await lab.admin`GRANT lumi_backend_owner,lumi_canonical_owner TO lumi_backend_migrator`;
    await lab.admin`GRANT lumi_canonical_app TO lumi_backend_runtime`;
    await lab.admin`GRANT EXECUTE ON FUNCTION pg_control_system() TO lumi_backend_migrator`;
  }, 30000);
  afterAll(async () => {
    for (const q of clients.reverse()) await q.end({ timeout: 2 }).catch(() => {});
    for (const c of clusters.reverse()) c.stop();
    console.info('FRESH_TARGET_LABS_STOPPED', clusters.length);
  }, 15000);
  async function target(encoding = 'UTF8') {
    const name = 'lumi_fresh_test_' + randomUUID().replaceAll('-', '').slice(0, 24);
    if (!['UTF8', 'SQL_ASCII'].includes(encoding)) throw Error('Unknown synthetic encoding');
    await lab.admin.unsafe(`CREATE DATABASE "${name}" OWNER ${ROLES.owner} TEMPLATE template0 ENCODING '${encoding}' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const q = lab.open(name, 'lab_fresh_admin');
    await q.unsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await q.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO ${ROLES.migrator}`);
    const [i] = await q`SELECT (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid,host(inet_server_addr()) AS address,inet_server_port() AS port`;
    await q.end();
    const approval = { version: 1, operation: 'PROVISION_EMPTY_PG17', expiresAt: Date.now() + 3600000, artifactSha256: loadFreshContract().artifactSha256,
      target: { host: '127.0.0.1', port: lab.port, database: name, login: ROLES.migrator, serverAddress: i.address, serverPort: i.port, systemIdentifier: lab.system, databaseOid: i.oid, platformOwner: 'lab_fresh_admin' } };
    return { approval, approvalSha256: digest(JSON.stringify(approval)), url: `postgresql://${ROLES.migrator}@127.0.0.1:${lab.port}/${name}`, caPem: undefined };
  }
  const reseal = r => { r.approvalSha256 = digest(JSON.stringify(r.approval)); return r; };
  const inventory = async r => {
    const q = lab.open(r.approval.target.database, 'lab_fresh_admin');
    try { return await q`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`; } finally { await q.end(); }
  };
  it('refuses a different physical cluster identity before DDL', async () => {
    const r = await target(); r.approval.target.systemIdentifier = other.system; reseal(r);
    expect((await provisionFreshTarget(r)).reason).toBe('IDENTITY_MISMATCH'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses an unsupported database encoding before DDL', async () => {
    const r = await target('SQL_ASCII');
    expect((await provisionFreshTarget(r)).reason).toBe('DATABASE_LOCALE_UNQUALIFIED'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses a conflicting preexisting table and an unreferenced domain before DDL', async () => {
    for (const ddl of ['CREATE TABLE marcom_sessions(id int)', 'CREATE DOMAIN unapproved_domain AS text']) {
      const r = await target(); const q = lab.open(r.approval.target.database, 'lab_fresh_admin'); await q.unsafe(ddl); await q.end();
      const before = await inventory(r); expect((await provisionFreshTarget(r)).reason).toBe('TARGET_NOT_EMPTY'); expect(await inventory(r)).toEqual(before);
    }
  });
  it('refuses excess runtime role privileges and unauthorized membership before DDL', async () => {
    const r = await target();
    await lab.admin`ALTER ROLE lumi_backend_runtime CREATEROLE`;
    try { expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); } finally { await lab.admin`ALTER ROLE lumi_backend_runtime NOCREATEROLE`; }
    await lab.admin`GRANT lumi_backend_owner TO lumi_backend_runtime`;
    try { expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); } finally { await lab.admin`REVOKE lumi_backend_owner FROM lumi_backend_runtime`; }
    expect(await inventory(r)).toEqual([]);
  });
  it('refuses excess PUBLIC database grants before DDL', async () => {
    const r = await target(), name = r.approval.target.database;
    await lab.admin.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO PUBLIC`);
    expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_DATABASE_ACL_MISMATCH'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses direct sensitive system-function grants and foreign default privileges before DDL', async () => {
    const r = await target(), q = lab.open(r.approval.target.database, 'lab_fresh_admin');
    await q`GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO lumi_backend_runtime`;
    await q.end();
    expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_SYSTEM_PRIVILEGE_MISMATCH'); expect(await inventory(r)).toEqual([]);
    const next = await target(), defaults = lab.open(next.approval.target.database, 'lab_fresh_admin');
    await defaults`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO lumi_backend_runtime`; await defaults.end();
    expect((await provisionFreshTarget(next)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); expect(await inventory(next)).toEqual([]);
  });
  it('provisions exact76 receipts plus all4 legacy tables and the combined authority profile', async () => {
    valid = await target();
    const result = await provisionFreshTarget(valid);
    console.info('FRESH_PROVISION_RESULT', JSON.stringify(result));
    if (result.mismatch) {
      const q = lab.open(valid.approval.target.database, ROLES.migrator);
      const actual = await q.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectCombinedCatalog(tx); });
      for (const key of result.mismatch) {
        const expected = loadFreshContract().profile.catalog[key];
        console.info('FRESH_PROFILE_DIFFERENCE', JSON.stringify({ key,
          actual: actual[key].filter(x => !expected.some(y => JSON.stringify(x) === JSON.stringify(y))).slice(0, 2),
          expected: expected.filter(x => !actual[key].some(y => JSON.stringify(x) === JSON.stringify(y))).slice(0, 2) }));
      }
      await q.end();
    }
    expect(result).toMatchObject({ status: 'PROVISIONED_MATCH', runtimeAdmission: 'NOT_WIRED' });
    db = lab.open(valid.approval.target.database, ROLES.migrator);
    const native = await db.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectCombinedCatalog(tx); });
    expect(stable(bindPlatform(native, 'lab_fresh_admin'))).toEqual(stable(loadFreshContract().profile.catalog));
    const frozen = JSON.parse(readFileSync(new URL('../../scripts/legacy-schema/manifest.v2.json', import.meta.url)));
    const legacy = await db.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectStructure(tx); });
    const expected = bind(frozen.catalog, { owner: ROLES.owner, runtime: ROLES.runtime, auditor: ROLES.auditor });
    for (const key of Object.keys(legacy)) expect(stable(legacy[key]), key).toEqual(stable(expected[key]));
    expect(await verifyCanonicalProvenanceCatalog(db)).toMatchObject({ status: 'PASS' });
    const rows = await db`SELECT migration_name,checksum,applied_steps_count FROM _prisma_migrations`;
    expect(rows).toHaveLength(76);
    for (const m of loadFreshContract().migrations) expect(rows.filter(r => r.migration_name === m.name && r.checksum === m.checksum && r.applied_steps_count === 1)).toHaveLength(1);
    await db.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  }, 30000);
  it('refuses repeated provisioning without changing receipts or creating application records', async () => {
    const q = lab.open(valid.approval.target.database, ROLES.migrator);
    const before = await q`SELECT to_jsonb(m) AS receipt FROM _prisma_migrations m ORDER BY id`;
    await q.end();
    expect((await provisionFreshTarget(valid)).status).toBe('REFUSED');
    const audit = lab.open(valid.approval.target.database, ROLES.auditor);
    expect(await audit`SELECT to_jsonb(m) AS receipt FROM _prisma_migrations m ORDER BY id`).toEqual(before);
    await expect(audit`SELECT * FROM marcom_credentials`).rejects.toMatchObject({ code: '42501' }); await audit.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('denies runtime DDL, receipt writes, truncation and owner/retention escalation', async () => {
    const q = lab.open(valid.approval.target.database, ROLES.runtime);
    for (const query of ['CREATE TABLE public.forbidden(id int)', 'DELETE FROM _prisma_migrations', 'TRUNCATE canonical_refreshes',
      'SET ROLE lumi_backend_owner', 'SET ROLE lumi_canonical_owner', 'SET ROLE lumi_canonical_retention', 'CREATE ROLE forbidden']) await expect(q.unsafe(query)).rejects.toMatchObject({ code: '42501' });
    await q.end();
  });
  it('preserves canonical tenant parent integrity under the actual runtime login', async () => {
    const owner = lab.open(valid.approval.target.database, 'lab_fresh_admin'), runtime = lab.open(valid.approval.target.database, ROLES.runtime);
    const a = await seed(owner), b = await seed(owner); const g = await admit(runtime, a); await level(runtime, g);
    await expect(level(runtime, { ...g, ws: b.ws })).rejects.toMatchObject({ code: '23503' });
    // RLS is deliberately not invented. Request authorization remains in the
    // existing middleware and its unchanged negative integration tests.
    for (const ws of [a.ws, b.ws]) { await owner`DELETE FROM workspaces WHERE id=${ws}`; await owner`DELETE FROM marcom_credentials WHERE workspace_id=${ws}`; }
    await runtime.end(); await owner.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('rejects changed column collation and UNLOGGED storage without hiding either drift', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`ALTER TABLE marcom_sessions ALTER COLUMN hybrid_raw_data TYPE text COLLATE "C"`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    await q`ALTER TABLE marcom_sessions ALTER COLUMN hybrid_raw_data TYPE text COLLATE "default"`;
    await q`ALTER TABLE marcom_user_context SET UNLOGGED`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    const [r] = await q`SELECT relpersistence FROM pg_class WHERE oid='marcom_user_context'::regclass`; expect(r.relpersistence).toBe('u');
    await q`ALTER TABLE marcom_user_context SET LOGGED`; await q.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('fails exact qualification on extra grants and structural drift without repairing either', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`GRANT SELECT ON marcom_credentials TO PUBLIC`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    const [r] = await q`SELECT EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='marcom_credentials'::regclass AND a.grantee=0 AND a.privilege_type='SELECT') AS still_granted`; expect(r.still_granted).toBe(true);
    await q`REVOKE SELECT ON marcom_credentials FROM PUBLIC`; await q`ALTER TABLE marcom_sessions ADD COLUMN drift text`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    await q.end();
  });
  it('rejects tampered receipts and preserves the failed history evidence', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='20261015000000_canonical_provenance_v1'`;
    expect((await inspectFreshTarget(valid)).reason).toBe('MIGRATION_HISTORY_MISMATCH');
    const [r] = await q`SELECT checksum FROM _prisma_migrations WHERE migration_name='20261015000000_canonical_provenance_v1'`; expect(r.checksum).toBe('0'.repeat(64)); await q.end();
  });
});
