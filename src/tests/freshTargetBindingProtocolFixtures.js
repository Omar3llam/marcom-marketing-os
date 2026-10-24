// 03B-9A: synthetic test fixtures only. No production caller or migration runner.
import postgres from 'postgres';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { types } from 'node:util';

export const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function assertion(target) {
  const fields = ['systemIdentifier', 'databaseOid', 'database', 'login'];
  if (!target || types.isProxy(target) || Object.getPrototypeOf(target) !== Object.prototype
    || Reflect.ownKeys(target).sort().join('|') !== fields.sort().join('|')
    || Object.values(Object.getOwnPropertyDescriptors(target)).some(d => !Object.hasOwn(d, 'value'))
    || typeof target.systemIdentifier !== 'string' || !/^[1-9][0-9]{18,19}$/.test(target.systemIdentifier)
    || BigInt(target.systemIdentifier) > 18446744073709551615n
    || !Number.isSafeInteger(target.databaseOid) || target.databaseOid < 1
    || typeof target.database !== 'string' || !/^lumi_protocol_[a-z0-9_]+$/.test(target.database)
    || typeof target.login !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(target.login)) throw Error('UNQUALIFIED_TEST_TARGET');
  return `DO $lumi_binding$ BEGIN -- LUMI_BINDING_ASSERTION
    IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${literal(target.systemIdentifier)}
      OR (SELECT oid::bigint FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) IS DISTINCT FROM ${target.databaseOid}::bigint
      OR pg_catalog.current_database() IS DISTINCT FROM ${literal(target.database)}
      OR pg_catalog.current_setting('server_version_num')::int / 10000 IS DISTINCT FROM 17
      OR session_user::text IS DISTINCT FROM ${literal(target.login)} OR current_user::text IS DISTINCT FROM ${literal(target.login)}
    THEN RAISE EXCEPTION 'LUMI_TEST_BINDING_MISMATCH' USING ERRCODE='P0001'; END IF;
  END $lumi_binding$ LANGUAGE plpgsql;\n`;
}

export function candidate(sql, target) {
  const guard = assertion(target); // Capture validated values, not a mutable claim.
  let terminal = false;
  return Object.freeze({
    async write(payload) {
      if (terminal) throw Error('TEST_LEASE_TERMINAL');
      if (typeof payload !== 'string' || !payload.trim() || payload.includes('\0')) throw Error('UNQUALIFIED_TEST_PAYLOAD');
      try {
        // One Q, including both guard and unchanged payload. Never split SQL.
        return await sql.unsafe(guard + payload).simple();
      } catch (error) { terminal = true; throw error; }
    },
  });
}

// Reassemble stream bytes; TCP chunks are NOT PostgreSQL Query boundaries.
export class FrontendDecoder {
  constructor(onMessage) { this.pending = Buffer.alloc(0); this.startup = true; this.onMessage = onMessage; }
  push(bytes) {
    this.pending = Buffer.concat([this.pending, bytes]);
    while (this.pending.length >= (this.startup ? 4 : 5)) {
      const length = this.pending.readUInt32BE(this.startup ? 0 : 1);
      if (length < (this.startup ? 8 : 4) || length > 8 * 1024 * 1024) throw Error('INVALID_PROTOCOL_LENGTH');
      const total = length + (this.startup ? 0 : 1);
      if (this.pending.length < total) return;
      const frame = this.pending.subarray(0, total); this.pending = this.pending.subarray(total);
      const startup = this.startup; this.startup = false;
      const type = startup ? 'startup' : String.fromCharCode(frame[0]);
      if (type === 'Q' && frame.at(-1) !== 0) throw Error('UNTERMINATED_QUERY');
      this.onMessage({ type, frame, sql: type === 'Q' ? frame.subarray(5, -1).toString('utf8') : undefined });
    }
  }
}

// Synthetic trust-auth, plaintext PG wire router. It switches only WHOLE Qs.
// This deliberately models loss of backend affinity, not a qualified pooler.
export async function wireRouter(physical, choose = () => 0, loseAck = () => false) {
  const trace = [], sockets = new Set(); let connections = 0;
  const server = net.createServer(front => {
    connections++; sockets.add(front); const backends = [], queued = []; let ready = 0, active = null;
    const destroy = () => { for (const back of backends) back.destroy(); };
    front.on('close', () => { sockets.delete(front); destroy(); }); front.on('error', destroy);
    const dispatch = message => {
      if (ready !== physical.length) { queued.push(message); return; }
      if (message.type === 'X') { for (const back of backends) back.write(message.frame); return; }
      if (message.type !== 'Q' || active) { front.destroy(Error('Unexpected protocol/pipelining')); return; }
      const route = choose(message.sql, trace.length);
      if (!Number.isInteger(route) || !backends[route]) { front.destroy(Error('Invalid owned route')); return; }
      active = { route, record: { sequence: trace.length, route, system: physical[route].system,
        bytes: message.frame.length, sha256: sha(message.frame), frameBase64: message.frame.toString('base64'), sql: message.sql, commands: [], ready: null } };
      trace.push(active.record); backends[route].write(message.frame);
    };
    const decoder = new FrontendDecoder(message => {
      if (message.type !== 'startup') return dispatch(message);
      const code = message.frame.readUInt32BE(4);
      if (code === 80877102) { // CancelRequest: selected A key, direct cancellation control only.
        const back = net.connect({ host: '127.0.0.1', port: physical[0].port }, () => back.end(message.frame));
        sockets.add(back); back.on('error', () => front.destroy()); back.on('close', () => { sockets.delete(back); front.end(); }); return;
      }
      if (code !== 196608) { front.destroy(Error('Only owned plaintext protocol3 is modeled')); return; }
      physical.forEach((p, index) => {
        const back = net.connect({ host: '127.0.0.1', port: p.port }, () => back.write(message.frame));
        backends.push(back); sockets.add(back); let pending = Buffer.alloc(0), boot = true;
        back.on('error', () => front.destroy()); back.on('close', () => { sockets.delete(back); if (!front.destroyed) front.destroy(); });
        back.on('data', data => {
          pending = Buffer.concat([pending, data]);
          while (pending.length >= 5) {
            const length = pending.readUInt32BE(1), size = length + 1;
            if (length < 4 || length > 8 * 1024 * 1024) { front.destroy(); return; }
            if (pending.length < size) break;
            const frame = pending.subarray(0, size); pending = pending.subarray(size); const type = String.fromCharCode(frame[0]);
            if (boot) {
              if (index === 0) front.write(frame);
              if (type === 'Z') { boot = false; ready++; if (ready === physical.length) for (const item of queued.splice(0)) dispatch(item); }
              continue;
            }
            if (!active || active.route !== index) { front.destroy(); return; }
            if (type === 'C') active.record.commands.push(frame.subarray(5, -1).toString('utf8'));
            if (type === 'E') active.record.error = frame.subarray(5, -1).toString('utf8').replaceAll('\0', '|');
            if (type === 'Z') {
              active.record.ready = String.fromCharCode(frame[5]); const drop = loseAck(active.record);
              active = null; if (drop) { front.destroy(); return; }
            }
            front.write(frame);
          }
        });
      });
    });
    front.on('data', bytes => { try { decoder.push(bytes); } catch { front.destroy(); } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, trace, get connections() { return connections; }, async stop() {
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  } };
}

export function client(port, database, username, fetchTypes = false) {
  return postgres({ host: '127.0.0.1', port, database, username, password: () => '', ssl: false,
    max: 1, prepare: false, fetch_types: fetchTypes, max_pipeline: 1, connect_timeout: 2, idle_timeout: 0,
    max_lifetime: null, onnotice: () => {}, connection: { application_name: 'lumi_protocol_test', search_path: 'pg_catalog,pg_temp' } });
}

export async function physicalLab() {
  const bin = process.env.FRESH_TARGET_TEST_PG_BIN, dirs = [], clients = []; let port, stopNative, evidence;
  const cleanup = async () => {
    const errors = [];
    const closed = await Promise.allSettled(clients.map(sql => sql.end({ timeout: 2 })));
    for (const result of closed) if (result.status === 'rejected') errors.push(result.reason);
    let control;
    try { control = await stopNative?.(); } catch (error) { errors.push(error); }
    for (const dir of dirs) try { rmSync(dir, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Owned lab teardown failed');
    return control;
  };
  const command = (exe, args) => {
    let result; const options = { encoding: 'utf8', timeout: 20000, windowsHide: true };
    if (process.platform === 'win32' && basename(exe).replace(/\.exe$/i, '') === 'pg_ctl' && args.at(-1) === 'start') {
      const dir = mkdtempSync(join(tmpdir(), 'lumi-protocol-command-')); dirs.push(dir);
      const out = join(dir, 'stdout'), err = join(dir, 'stderr'), a = openSync(out, 'w'), b = openSync(err, 'w');
      try { result = spawnSync(exe, args, { ...options, stdio: ['ignore', a, b] }); }
      finally { closeSync(a); closeSync(b); }
      result.stdout = readFileSync(out, 'utf8'); result.stderr = readFileSync(err, 'utf8');
    } else result = spawnSync(exe, args, options);
    if (result.error || result.status !== 0) throw Error(`Owned lab command failed: ${basename(exe)} ${result.error?.code || result.status}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const shutdown = (exe, args) => new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stdout.resume(); child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => { child.kill(); reject(Error('Owned shutdown command timed out')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`Owned shutdown failed: ${code}: ${stderr}`)); });
  });
  let admin;
  try {
  if (bin) {
    if (!command(join(bin, 'postgres'), ['--version']).includes(' 17.')) throw Error('PG17 required');
    const dir = mkdtempSync(join(tmpdir(), 'lumi-protocol-pg17-'));
    const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    command(join(bin, 'initdb'), ['-D', join(dir, 'data'), '-U', 'lab_protocol_admin', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    stopNative = async () => { if (existsSync(join(dir, 'data', 'postmaster.pid'))) await shutdown(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']);
      if (existsSync(join(dir, 'data', 'postmaster.pid'))) throw Error('Owned PID remains'); return command(join(bin, 'pg_controldata'), [join(dir, 'data')]); };
    evidence = { directory: dir, control: command(join(bin, 'pg_controldata'), [join(dir, 'data')]).replace(/^Mock authentication nonce:.*$/m, 'Mock authentication nonce: <omitted>') };
    command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  } else {
    if (process.platform !== 'linux') throw Error('Explicit local PG17 binaries required');
    const docker = args => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
    docker(['image', 'inspect', 'postgres:17']);
    const id = docker(['run', '--pull=never', '--rm', '-d', '--label', 'lumi.protocol.synthetic=true', '-e', 'POSTGRES_USER=lab_protocol_admin',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8', '-p', '127.0.0.1::5432', 'postgres:17']);
    stopNative = () => { docker(['stop', '-t', '5', id]); if (docker(['ps', '-aq', '--filter', `id=${id}`])) throw Error('Owned container remains'); return 'removed'; };
    evidence = { container: id, image: docker(['inspect', '--format', '{{.Image}}', id]) }; port = Number(docker(['port', id, '5432/tcp']).split(':').at(-1));
  }
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      admin = client(port, 'postgres', 'lab_protocol_admin', true);
      try { await admin`SELECT 1`; break; } catch { await admin.end({ timeout: 1 }); admin = null; }
    }
    if (!admin) throw Error('Owned lab startup unavailable'); clients.push(admin);
    const [identity] = await admin`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`;
    if (identity.major !== 17 || (evidence.control && !evidence.control.includes(identity.system))) throw Error('Physical identity mismatch');
    console.info('PROTOCOL_PHYSICAL_LAB', JSON.stringify({ ...evidence, port, ...identity }));
    return { admin, port, system: identity.system, evidence,
      open(database, username) { const sql = client(port, database, username, true); clients.push(sql); return sql; },
      async stop() {
        const control = (await cleanup()).replace(/^Mock authentication nonce:.*$/m, 'Mock authentication nonce: <omitted>');
        console.info('PROTOCOL_LAB_STOPPED', JSON.stringify({ ...evidence, port, system: identity.system, control, privateKeysCreated: 0 }));
      } };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Owned lab setup and teardown failed'); }
    throw error;
  }
}

export const databaseName = () => 'lumi_protocol_' + randomUUID().replaceAll('-', '').slice(0, 20);
export const receiptDDL = `CREATE TABLE public._prisma_migrations (
 id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
 migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0);`;
