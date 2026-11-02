import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import postgres from 'postgres';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { dbAvailable } from '../tests/dbProbe.js';
import { sealTemplate } from './dbIsolation.js';
import { inspectPrismaRuntimeRole, inspectPostgresRuntimeRole } from '../services/startup/runtimeRolePreflight.js';

const DB_OK = await dbAvailable();
const labs = [];
const clients = [];
const LOGIN = 'lumi_backend_runtime';
const APP = 'lumi_canonical_app';
const database = 'lumi_role_preflight';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const journal = [];
function command(exe, args) {
  const env = {};
  for (const key of ['PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP','USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
  // Background postmasters inherit handles on Windows. File handles avoid a
  // successful pg_ctl waiting on pipe EOF from its still-running child.
  const logs = mkdtempSync(join(tmpdir(), 'lumi-role-command-'));
  const out = join(logs, 'stdout.log'), err = join(logs, 'stderr.log');
  const stdout = openSync(out, 'w'), stderr = openSync(err, 'w');
  let r;
  const started = performance.now();
  try { r = spawnSync(exe, args, { env, windowsHide: true, timeout: 10000, stdio: ['ignore',stdout,stderr] }); }
  finally { closeSync(stdout); closeSync(stderr); }
  r.stdout = readFileSync(out, 'utf8'); r.stderr = readFileSync(err, 'utf8');
  const receipt = { exe, args, status: r.status, signal: r.signal, error: r.error?.code,
    pid: r.pid, elapsedMs: performance.now() - started, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  console.info('ROLE_FIXTURE_COMMAND', JSON.stringify(receipt));
  expect(r.error, 'owned fixture command error').toBeUndefined();
  expect(r.signal).toBeNull(); expect(r.status).toBe(0);
  return (r.stdout ?? '').trim();
}
const docker = args => command('docker', ['--host','unix:///var/run/docker.sock',...args]);
const openPort = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.setTimeout(500, () => { socket.destroy(); resolve(true); }); // inconclusive is not absence
});
async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function connection(lab, name = database, username = 'lab_role_admin') {
  const sql = postgres({ host: '127.0.0.1', port: lab.port, database: name, username,
    password: () => '', ssl: false, max: 1, connect_timeout: 2, onnotice: () => {} });
  clients.push(() => sql.end({ timeout: 2 }));
  return sql;
}
async function cluster() {
  const dir = mkdtempSync(join(tmpdir(), 'lumi-role-preflight-'));
  const token = randomUUID();
  const lab = { dir, token, started: false };
  labs.push(lab);
  writeFileSync(join(dir, 'OWNERSHIP.json'), JSON.stringify({ task: 'runtime-role-preflight', token }));
  const bin = process.env.FRESH_TARGET_TEST_PG_BIN;
  if (bin) {
    lab.bin = bin; lab.port = await unusedPort();
    expect(command(join(bin, 'postgres'), ['--version'])).toContain(' 17.');
    command(join(bin, 'initdb'), ['-D',join(dir,'data'),'-U','lab_role_admin','--auth=trust','--no-locale','--encoding=UTF8']);
    lab.control = command(join(bin, 'pg_controldata'), [join(dir,'data')]);
    lab.system = lab.control.match(/Database system identifier:\s+(\d+)/)?.[1];
    expect(lab.system).toMatch(/^\d+$/);
    command(join(bin, 'pg_ctl'), ['-D',join(dir,'data'),'-l',join(dir,'server.log'),'-o','-h 127.0.0.1 -p '+lab.port,'-w','start']);
    lab.started = true;
  } else {
    expect(process.platform, 'explicit PG17 binaries are required off Linux').toBe('linux');
    docker(['image','inspect','postgres:17']);
    mkdirSync(join(dir,'data'));
    // Exact owned bind mount is retained after this owned container is removed.
    lab.id = docker(['run','--pull=never','-d','--label','lumi.role-preflight='+token,
      '--mount','type=bind,source='+join(dir,'data')+',target=/var/lib/postgresql/data',
      '-e','POSTGRES_USER=lab_role_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust',
      '-e','POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8','-p','127.0.0.1::5432','postgres:17']);
    expect(lab.id).toMatch(/^[a-f0-9]{64}$/); lab.started = true;
    lab.port = Number(docker(['port',lab.id,'5432/tcp']).split(':').at(-1));
  }
  expect(lab.port).toBeGreaterThan(1024); expect(lab.port).not.toBe(5432);
  const maintenance = connection(lab, 'postgres');
  const until = Date.now() + 8000;
  let identity;
  while (Date.now() < until) {
    try {
      [identity] = await maintenance.unsafe("SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major,host(inet_server_addr()) AS address,inet_server_port() AS port FROM pg_control_system()");
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  expect(identity?.major).toBe(17);
  if (lab.bin) expect(identity.address).toBe('127.0.0.1');
  else {
    const [owned] = JSON.parse(docker(['inspect',lab.id]));
    expect(owned.Config.Labels['lumi.role-preflight']).toBe(token);
    expect(owned.Mounts.some(m => m.Source === join(dir,'data') && m.Destination === '/var/lib/postgresql/data')).toBe(true);
    expect(Object.values(owned.NetworkSettings.Networks).map(n => n.IPAddress)).toContain(identity.address);
  }
  expect(identity.port).toBe(lab.bin ? lab.port : 5432);
  if (!lab.bin) lab.control = docker(['exec',lab.id,'pg_controldata','/var/lib/postgresql/data']);
  expect(lab.control).toContain(identity.system);
  lab.system = identity.system;
  console.info('ROLE_PHYSICAL_IDENTITY', JSON.stringify({ dir, token, port: lab.port, system: lab.system, container: lab.id, control: lab.control }));
  for (const role of ['lumi_backend_owner','lumi_backend_migrator',LOGIN,'lumi_backend_auditor','lumi_canonical_owner',APP,'lumi_canonical_retention','lab_role_other']) {
    await maintenance.unsafe('CREATE ROLE '+role+' '+([LOGIN,'lab_role_other'].includes(role) ? 'LOGIN' : 'NOLOGIN')+' INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  }
  await maintenance.unsafe('GRANT '+APP+' TO '+LOGIN+' WITH ADMIN FALSE, INHERIT TRUE, SET TRUE');
  // template0 is normally already closed; enforce the shared copy contract
  // against this independently owned cluster before cloning it.
  await sealTemplate(statement => maintenance.unsafe(statement), 'template0');
  expect((await maintenance.unsafe("SELECT datallowconn FROM pg_database WHERE datname='template0'"))[0].datallowconn).toBe(false);
  await maintenance.unsafe('CREATE DATABASE '+database+' OWNER lumi_backend_owner TEMPLATE template0');
  await maintenance.unsafe('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');
  await maintenance.unsafe('GRANT CONNECT ON DATABASE '+database+' TO '+LOGIN+',lab_role_other');
  lab.admin = connection(lab);
  await lab.admin.unsafe('CREATE TABLE public.synthetic_payload(id integer PRIMARY KEY,payload text)');
  await lab.admin.unsafe("INSERT INTO public.synthetic_payload VALUES(1,'synthetic-only')");
  await lab.admin.unsafe('GRANT SELECT ON public.synthetic_payload TO '+LOGIN);
  lab.sql = connection(lab, database, LOGIN);
  lab.prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://'+LOGIN+'@127.0.0.1:'+lab.port+'/'+database+'?connection_limit=1&connect_timeout=2&pool_timeout=2' } }, log: [] });
  clients.push(() => lab.prisma.$disconnect());
  lab.identities = [];
  const record = (driver, text, rows) => {
    if (text.includes('AS read_only')) lab.identities.push({ driver, ...rows[0] });
    journal.push({ system: lab.system, driver, sql: text });
  };
  // Transparent instrumentation: every query and transaction executes in the
  // real driver; rows are never replaced with fixture answers.
  const transaction = lab.prisma.$transaction.bind(lab.prisma);
  vi.spyOn(lab.prisma, '$transaction').mockImplementation((fn, options) => transaction(tx => fn(new Proxy(tx, {
    get(target, key) {
      if (key === '$queryRaw') return async (strings, ...values) => {
        const rows = await target.$queryRaw(strings, ...values); record('PRISMA', strings.join('?'), rows); return rows;
      };
      return Reflect.get(target, key);
    },
  })), options));
  const begin = lab.sql.begin;
  vi.spyOn(lab.sql, 'begin').mockImplementation((options, fn) => begin(options, tx => fn(async (strings, ...values) => {
    const rows = await tx(strings, ...values); record('POSTGRES', strings.join('?'), rows); return rows;
  })));
  return lab;
}
async function snapshot(lab) {
  const [row] = await lab.admin.unsafe("SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r WHERE rolname LIKE 'lumi_%' OR rolname LIKE 'lab_role_%'),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'database',(SELECT to_jsonb(d) FROM pg_database d WHERE datname=current_database()),'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n),'objects',(SELECT jsonb_agg(jsonb_build_array(relname,relowner,relacl) ORDER BY oid) FROM pg_class WHERE relnamespace='public'::regnamespace),'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM pg_db_role_setting s),'parameters',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_parameter_acl p),'data',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.synthetic_payload t)) AS state");
  return hash(row.state);
}
async function observe(lab, driver) {
  const before = await snapshot(lab);
  const result = await (driver === 'PRISMA' ? inspectPrismaRuntimeRole(lab.prisma) : inspectPostgresRuntimeRole(lab.sql));
  expect(await snapshot(lab), 'observer must not change catalogs or data').toBe(before);
  expect(result).toMatchObject({ runtimeAdmission: 'NOT_WIRED', physicalTarget: 'UNQUALIFIED',
    tenantPermissionBoundaries: 'NOT_MEASURED', nativeSchema: 'NOT_MEASURED' });
  console.info('ROLE_OBSERVATION', JSON.stringify({ system: lab.system, driver, before, after: before, result }));
  return result;
}

describe.skipIf(!DB_OK)('actual PG17 runtime role capability preflight', () => {
  let a, b;
  beforeAll(async () => {
    a = await cluster(); b = await cluster();
    expect(a.system).not.toBe(b.system); expect(a.port).not.toBe(b.port);
  }, 30000);
  afterAll(async () => {
    const failures = [];
    for (const lab of labs) {
      if (lab.bin && lab.admin) {
        try { lab.pids = (await lab.admin.unsafe('SELECT pid FROM pg_stat_activity')).map(r => r.pid); }
        catch (error) { failures.push(error); }
      }
    }
    for (const close of clients.reverse()) { try { await close(); } catch (error) { failures.push(error); } }
    for (const lab of labs.reverse()) {
      try {
        expect(JSON.parse(readFileSync(join(lab.dir,'OWNERSHIP.json'))).token).toBe(lab.token);
        if (lab.started || (lab.bin && existsSync(join(lab.dir,'data','postmaster.pid')))) {
          if (lab.bin) {
            expect(command(join(lab.bin,'pg_controldata'),[join(lab.dir,'data')])).toContain(lab.system);
            const postmaster = Number(readFileSync(join(lab.dir,'data','postmaster.pid'),'utf8').split(/\r?\n/)[0]);
            command(join(lab.bin,'pg_ctl'),['-D',join(lab.dir,'data'),'-m','fast','-w','stop']);
            expect(command(join(lab.bin,'pg_controldata'),[join(lab.dir,'data')])).toContain('shut down');
            expect(existsSync(join(lab.dir,'data','postmaster.pid'))).toBe(false);
            for (const pid of [postmaster,...(lab.pids ?? [])]) {
              let absent = false;
              try { process.kill(pid,0); } catch (error) { absent = error.code === 'ESRCH'; }
              expect(absent, 'owned PostgreSQL process must be absent: '+pid).toBe(true);
            }
          } else {
            const [owned] = JSON.parse(docker(['inspect',lab.id]));
            expect(owned.Config.Labels['lumi.role-preflight']).toBe(lab.token);
            expect(owned.Mounts.some(m => m.Source === join(lab.dir,'data'))).toBe(true);
            docker(['stop','-t','3',lab.id]);
            expect(docker(['inspect','--format','{{.State.Running}}',lab.id])).toBe('false');
            docker(['rm',lab.id]);
            expect(docker(['ps','-aq','--filter','id='+lab.id])).toBe('');
          }
        }
        if (lab.bin) expect(existsSync(join(lab.dir,'data','postmaster.pid'))).toBe(false);
        if (lab.port) expect(await openPort(lab.port)).toBe(false);
        writeFileSync(join(lab.dir,'QUERY_JOURNAL.json'),JSON.stringify(journal.filter(r => r.system === lab.system),null,2));
        console.info('ROLE_TEARDOWN', JSON.stringify({ system:lab.system,port:lab.port,stopped:lab.started,notStarted:!lab.started,portClosed:Boolean(lab.port),
          processEvidence:lab.bin ? { absent:lab.pids } : 'OWNED_CONTAINER_STOPPED_AND_REMOVED',directoryRetained:existsSync(join(lab.dir,'data')) }));
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures,'Owned runtime-role fixture teardown failed');
  }, 15000);

  for (const driver of ['PRISMA','POSTGRES']) {
    it(driver+': observes the restricted session in one read-only transaction', async () => {
      a.identities.length = 0;
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
      const rows = a.identities.filter(r => r.driver === driver);
      expect(rows).toHaveLength(2); expect(rows[0].pid).toBe(rows[1].pid);
      expect(rows[0]).toMatchObject({ login:LOGIN,session:LOGIN,major:17,read_only:'on',isolation:'repeatable read' });
      console.info('ROLE_SESSION_PROPERTIES',JSON.stringify(rows));
    });
    it(driver+': refuses a different authenticated login', async () => {
      const before = await snapshot(a);
      const client = driver === 'PRISMA'
        ? new PrismaClient({ datasources: { db: { url:'postgresql://lab_role_other@127.0.0.1:'+a.port+'/'+database+'?connection_limit=1&connect_timeout=2&pool_timeout=2' } }, log:[] })
        : connection(a,database,'lab_role_other');
      let result;
      try { result = await (driver === 'PRISMA' ? inspectPrismaRuntimeRole : inspectPostgresRuntimeRole)(client); }
      finally { await (driver === 'PRISMA' ? client.$disconnect() : client.end()); }
      expect(result).toMatchObject({ status:'INCOMPATIBLE',reason:'SESSION_PROFILE_MISMATCH' });
      expect(await snapshot(a)).toBe(before);
      console.info('ROLE_WRONG_AUTHENTICATED_LOGIN',JSON.stringify({ driver,result,before }));
    });
    it(driver+': refuses SET ROLE on the authenticated runtime session', async () => {
      const execute = sql => driver === 'PRISMA' ? a.prisma.$executeRawUnsafe(sql) : a.sql.unsafe(sql);
      await execute('SET ROLE lumi_canonical_app');
      try { expect(await observe(a,driver)).toMatchObject({ status:'INCOMPATIBLE',reason:'SESSION_PROFILE_MISMATCH' }); }
      finally { await execute('RESET ROLE'); }
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
    });
    const cases = [
      ['superuser','ALTER ROLE '+LOGIN+' SUPERUSER','ALTER ROLE '+LOGIN+' NOSUPERUSER'],
      ['create role','ALTER ROLE '+LOGIN+' CREATEROLE','ALTER ROLE '+LOGIN+' NOCREATEROLE'],
      ['create database','ALTER ROLE '+LOGIN+' CREATEDB','ALTER ROLE '+LOGIN+' NOCREATEDB'],
      ['bypass RLS','ALTER ROLE '+LOGIN+' BYPASSRLS','ALTER ROLE '+LOGIN+' NOBYPASSRLS'],
      ['replication','ALTER ROLE '+LOGIN+' REPLICATION','ALTER ROLE '+LOGIN+' NOREPLICATION'],
      ['owner ancestry','GRANT lumi_backend_owner TO '+APP,'REVOKE lumi_backend_owner FROM '+APP],
      ['retention ancestry','GRANT lumi_canonical_retention TO '+LOGIN,'REVOKE lumi_canonical_retention FROM '+LOGIN],
      ['noninheriting ancestry','GRANT pg_monitor TO '+LOGIN+' WITH INHERIT FALSE, SET FALSE','REVOKE pg_monitor FROM '+LOGIN],
      ['ADMIN option','GRANT '+APP+' TO '+LOGIN+' WITH ADMIN TRUE','REVOKE ADMIN OPTION FOR '+APP+' FROM '+LOGIN],
      ['missing inherit','GRANT '+APP+' TO '+LOGIN+' WITH INHERIT FALSE','GRANT '+APP+' TO '+LOGIN+' WITH INHERIT TRUE'],
      ['missing SET','GRANT '+APP+' TO '+LOGIN+' WITH SET FALSE','GRANT '+APP+' TO '+LOGIN+' WITH SET TRUE'],
      ['incoming membership','GRANT '+LOGIN+' TO lab_role_other','REVOKE '+LOGIN+' FROM lab_role_other'],
      ['PUBLIC create','GRANT CREATE ON SCHEMA public TO PUBLIC','REVOKE CREATE ON SCHEMA public FROM PUBLIC'],
      ['inherited create','GRANT CREATE ON SCHEMA public TO '+APP,'REVOKE CREATE ON SCHEMA public FROM '+APP],
      ['PUBLIC temp','GRANT TEMP ON DATABASE '+database+' TO PUBLIC','REVOKE TEMP ON DATABASE '+database+' FROM PUBLIC'],
      ['schema grant option','GRANT USAGE ON SCHEMA public TO '+LOGIN+' WITH GRANT OPTION','REVOKE ALL ON SCHEMA public FROM '+LOGIN],
      ['owned relation','ALTER TABLE public.synthetic_payload OWNER TO '+APP,'ALTER TABLE public.synthetic_payload OWNER TO lab_role_admin'],
      // ALTER OWNER rewrites owner ACL entries; restore the original explicit
      // login CONNECT grant as well as ownership for subsequent cases.
      ['database ownership','ALTER DATABASE '+database+' OWNER TO '+LOGIN,
        ['ALTER DATABASE '+database+' OWNER TO lumi_backend_owner','GRANT CONNECT ON DATABASE '+database+' TO '+LOGIN]],
      ['parameter grant','GRANT SET ON PARAMETER log_statement TO '+APP,'REVOKE SET ON PARAMETER log_statement FROM '+APP],
      ['role settings','ALTER ROLE '+LOGIN+" SET work_mem='4MB'",'ALTER ROLE '+LOGIN+' RESET work_mem'],
    ];
    it.each(cases)(driver+': refuses %s without mutation', async (_name, enable, undo) => {
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
      await a.admin.unsafe(enable);
      try { expect((await observe(a,driver)).status).toBe('INCOMPATIBLE'); }
      finally { for (const statement of Array.isArray(undo) ? undo : [undo]) await a.admin.unsafe(statement); }
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
    });
    it(driver+': unreadable catalog is failure, not empty/safe', async () => {
      await a.admin.unsafe('REVOKE SELECT ON pg_catalog.pg_auth_members FROM PUBLIC');
      try { expect((await observe(a,driver)).status).toBe('FAILED'); }
      finally { await a.admin.unsafe('GRANT SELECT ON pg_catalog.pg_auth_members TO PUBLIC'); }
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
    });
    it(driver+': lock timeout waits for driver rollback before returning', async () => {
      let release, locked;
      const acquired = new Promise(resolve => { locked = resolve; });
      const locker = connection(a);
      const pending = locker.begin(async tx => {
        await tx.unsafe('LOCK TABLE pg_catalog.pg_shdepend IN ACCESS EXCLUSIVE MODE');
        locked(); await new Promise(resolve => { release = resolve; });
      });
      await acquired;
      try {
        // Snapshot queries do not touch pg_shdepend; the production query does.
        expect(await observe(a,driver)).toMatchObject({ status: 'FAILED', reason: 'PROBE_TIMEOUT' });
      } finally { release(); await pending; await locker.end(); }
      expect((await observe(a,driver)).status).toBe('OBSERVED_MATCH');
    });
  }
  it('different physical targets with identical names never create physical-target authority', async () => {
    const [one,two] = await Promise.all([observe(a,'PRISMA'),observe(b,'POSTGRES')]);
    expect(one.status).toBe('OBSERVED_MATCH'); expect(two.status).toBe('OBSERVED_MATCH');
    expect(one.physicalTarget).toBe('UNQUALIFIED'); expect(two.physicalTarget).toBe('UNQUALIFIED');
    await b.admin.unsafe('ALTER ROLE '+LOGIN+' CREATEROLE');
    try {
      const results = await Promise.all([observe(a,'POSTGRES'),observe(b,'PRISMA')]);
      expect(results[0].status).toBe('OBSERVED_MATCH'); expect(results[1].status).toBe('INCOMPATIBLE');
    } finally { await b.admin.unsafe('ALTER ROLE '+LOGIN+' NOCREATEROLE'); }
  });
});
