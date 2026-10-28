import postgres from 'postgres';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadFreshContract, validateApproval, validateExclusiveTarget, plain, ROLES } from './contract.js';
import { collectCombinedCatalog, stable, bindPlatform } from './catalog.js';

const answer = (status, reason, phase) => ({ status, reason, phase, scope: 'FRESH_TARGET_PROVISIONING_ONLY', runtimeAdmission: 'NOT_WIRED' });
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const memberProfile = [
  { member: ROLES.migrator, role: ROLES.owner, admin_option: false, inherit_option: true, set_option: true },
  { member: ROLES.migrator, role: ROLES.canonicalOwner, admin_option: false, inherit_option: true, set_option: true },
  { member: ROLES.runtime, role: ROLES.canonicalApp, admin_option: false, inherit_option: true, set_option: true },
];

async function identity(sql, target) {
  const [i] = await sql`SELECT current_database() AS database,current_user AS login,session_user AS session,host(inet_server_addr()) AS address,
    inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major,
    (SELECT system_identifier::text FROM pg_control_system()) AS system,
    (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
    (SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()) AS encoding,
    (SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collate,
    (SELECT datctype FROM pg_database WHERE datname=current_database()) AS ctype,
    (SELECT datlocprovider FROM pg_database WHERE datname=current_database()) AS locale_provider,
    (SELECT rolsuper FROM pg_roles WHERE rolname=${target.platformOwner}) AS trusted_extension_owner`;
  if (i.database !== target.database || i.login !== ROLES.migrator || i.session !== ROLES.migrator || i.address !== target.serverAddress
    || i.port !== target.serverPort || i.major !== 17 || i.system !== target.systemIdentifier || i.database_oid !== target.databaseOid || i.owner !== ROLES.owner
    || i.trusted_extension_owner !== true) throw Error('IDENTITY_MISMATCH');
  // Same UTF8/C libc database contract as the sealed legacy PG17 fixture.
  // A different provider/locale needs a separately reviewed native profile.
  if (i.encoding !== 'UTF8' || i.collate !== 'C' || i.ctype !== 'C' || i.locale_provider !== 'c') throw Error('DATABASE_LOCALE_UNQUALIFIED');
}

async function bootstrap(sql, target, contract) {
  const c = await collectCombinedCatalog(sql);
  if (c.roles.length !== 7 || c.roles.some(r => r.rolsuper || r.rolcreaterole || r.rolcreatedb || r.rolreplication || r.rolbypassrls
    || !r.rolinherit || r.rolconnlimit !== -1 || r.rolconfig !== null || r.rolcanlogin !== [ROLES.migrator, ROLES.runtime, ROLES.auditor].includes(r.rolname))
    || !equal(c.memberships, memberProfile) || c.defaults.length || c.settings.length) throw Error('BOOTSTRAP_ROLE_PROFILE_MISMATCH');
  if (!equal(bindPlatform(c.systemGrants, target.platformOwner), contract.profile.catalog.systemGrants)
    || !equal(c.systemCapabilities, contract.profile.catalog.systemCapabilities)) throw Error('BOOTSTRAP_SYSTEM_PRIVILEGE_MISMATCH');
  const dbAcl = c.acl.filter(a => a.kind === 'database');
  const expected = ['CREATE', 'CONNECT', 'TEMPORARY'].map(privilege_type => ({ kind: 'database', name: '<target>', grantor: ROLES.owner, grantee: ROLES.owner, privilege_type, is_grantable: false }));
  expected.push({ kind: 'database', name: '<target>', grantor: ROLES.owner, grantee: ROLES.migrator, privilege_type: 'CONNECT', is_grantable: false });
  if (!equal(dbAcl, expected)) throw Error('BOOTSTRAP_DATABASE_ACL_MISMATCH');
  const publicAcl = c.acl.filter(a => a.kind === 'schema' && a.name === 'public');
  const schemaExpected = [
    { kind: 'schema', name: 'public', grantor: 'pg_database_owner', grantee: 'pg_database_owner', privilege_type: 'USAGE', is_grantable: false },
    { kind: 'schema', name: 'public', grantor: 'pg_database_owner', grantee: 'pg_database_owner', privilege_type: 'CREATE', is_grantable: false },
    { kind: 'schema', name: 'public', grantor: 'pg_database_owner', grantee: 'PUBLIC', privilege_type: 'USAGE', is_grantable: false },
  ];
  if (!equal(publicAcl, schemaExpected)) throw Error('BOOTSTRAP_SCHEMA_ACL_MISMATCH');
  const [others] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND pid<>pg_backend_pid()`;
  if (others.n !== 0) throw Error('TARGET_NOT_EXCLUSIVE');
  if (c.schemas.length !== 1 || c.schemas[0].nspname !== 'public' || c.schemas[0].owner !== 'pg_database_owner'
    || c.tables.length || c.columns.length || c.constraints.length || c.functions.length || c.enums.length || c.triggers.length || c.policies.length || c.objects.length || c.events.length
    || c.extensions.length !== 1 || c.extensions[0].extname !== 'plpgsql') throw Error('TARGET_NOT_EMPTY');
}

async function applyLegacy(sql, contract) {
  await sql.begin(async tx => {
    await tx`SET LOCAL ROLE lumi_backend_owner`;
    // PostgreSQL implicitly searches pg_catalog first while creating objects
    // in public. Explicitly listing public before pg_catalog would bind UUID
    // defaults to the extension shim instead of the reviewed PG17 builtin.
    await tx`SET LOCAL search_path=public`;
    for (const { query } of contract.legacy) await tx.unsafe(query);
  });
}

async function migrate(url, exclusive, contract) {
  // Materialize only the preverified byte buffers. Never migrate a mutable repo
  // path or load ambient .env/provider settings into the Prisma subprocess.
  const temp = mkdtempSync(join(tmpdir(), 'lumi-fresh-migration-'));
  try {
    const schema = join(temp, 'prisma'); mkdirSync(schema);
    writeFileSync(join(schema, 'schema.prisma'), readFileSync(new URL('prisma/schema.prisma', contract.root)));
    const dir = join(schema, 'migrations'); mkdirSync(dir);
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
    for (const m of contract.migrations) { const d = join(dir, m.name); mkdirSync(d); writeFileSync(join(d, 'migration.sql'), m.bytes); }
    const u = new URL(url);
    const cert = join(temp, 'root.crt'); writeFileSync(cert, exclusive.caPem, { mode: 0o600 });
    u.searchParams.set('sslmode', 'require'); u.searchParams.set('sslcert', cert); u.searchParams.set('sslaccept', 'strict');
    const env = { PATH: dirname(process.execPath), ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}),
      TEMP: temp, TMP: temp, HOME: temp, USERPROFILE: temp, DATABASE_URL: u.href, DIRECT_URL: u.href,
      CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_SCHEMA_ENGINE_BINARY: exclusive.engine };
    // Select and verify the approved native issuer. Ambient engine overrides,
    // Node preload hooks, datasource URLs and .env files are never inherited.
    const version = spawnSync(exclusive.engine, ['--version'], { env, cwd: temp, encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (version.error || version.signal || version.status !== 0 || !version.stdout.includes('schema-engine-cli ' + exclusive.engineRevision)) throw Error('DEPENDENCY_UNQUALIFIED');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [exclusive.cli, 'migrate', 'deploy', '--schema', join(schema, 'schema.prisma')],
        { cwd: temp, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', truncated = false;
      const capture = bytes => { if (output.length + bytes.length > 262144) truncated = true; else output += bytes.toString(); };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120000);
      child.once('error', () => { clearTimeout(timer); reject(Error('MIGRATION_PROCESS_FAILED')); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        const password = decodeURIComponent(new URL(url).password);
        console.info('FRESH_TARGET_PRISMA_WRITER', JSON.stringify({ code, signal, timedOut, truncated,
          output: output.replaceAll(u.href, '<datasource>').replaceAll(password, '<credential>').replaceAll(temp, '<migration>') }));
        code === 0 && !signal && !timedOut && !truncated ? resolve() : reject(Error('MIGRATION_PROCESS_FAILED'));
      });
    });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

async function permissions(sql) {
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'canonical_%' ORDER BY tablename`;
  // The fresh schema was just made from pinned source; never call this on an
  // existing service. Canonical group grants/seals remain owned by migration76.
  for (const { tablename } of tables) await sql.unsafe(`ALTER TABLE public.${quote(tablename)} OWNER TO ${ROLES.owner}`);
  const enums = await sql`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`;
  for (const { typname } of enums) await sql.unsafe(`ALTER TYPE public.${quote(typname)} OWNER TO ${ROLES.owner}`);
  await sql.begin(async tx => {
    await tx`SET LOCAL ROLE lumi_backend_owner`;
    await tx`REVOKE ALL ON SCHEMA public FROM PUBLIC`;
    await tx`GRANT USAGE ON SCHEMA public TO lumi_backend_runtime,lumi_backend_auditor`;
    for (const { tablename } of tables) {
      await tx.unsafe(`REVOKE ALL ON TABLE public.${quote(tablename)} FROM PUBLIC`);
      await tx.unsafe(`GRANT ${tablename === '_prisma_migrations' ? 'SELECT' : 'SELECT,INSERT,UPDATE,DELETE'} ON TABLE public.${quote(tablename)} TO ${ROLES.runtime}`);
    }
    await tx`GRANT SELECT ON public._prisma_migrations TO lumi_backend_auditor`;
    // Migration76 could not grant these while the unmanaged vault was absent.
    // Repeat exactly its reviewed column capability after legacy provisioning.
    await tx`GRANT SELECT(workspace_id,platform,account_id,is_active,updated_at),UPDATE(account_id) ON public.marcom_credentials TO lumi_canonical_owner`;
    await tx`REVOKE ALL ON FUNCTION public.touch_last_updated() FROM PUBLIC`;
    // Trusted pgcrypto C functions belong to the approved platform superuser,
    // not the extension installer. Preserve their exact standard grants; the
    // pinned catalog rejects any extra function/grant or SECURITY DEFINER drift.
    for (const { typname } of enums) {
      await tx.unsafe(`REVOKE ALL ON TYPE public.${quote(typname)} FROM PUBLIC`);
      await tx.unsafe(`GRANT USAGE ON TYPE public.${quote(typname)} TO ${ROLES.runtime}`);
    }
    const [{ name }] = await tx`SELECT current_database() AS name`;
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${quote(name)} TO lumi_backend_runtime,lumi_backend_auditor`);
  });
}

async function qualify(sql, contract, target) {
  await sql`SET LOCAL search_path=pg_catalog,pg_temp`;
  const rows = await sql`SELECT migration_name,checksum,applied_steps_count,finished_at IS NOT NULL AS finished,
    rolled_back_at IS NOT NULL AS rolled_back,logs IS NULL OR logs='' AS clean_log,
    finished_at>=started_at AND finished_at<=clock_timestamp() AS ordered FROM public._prisma_migrations`;
  if (rows.length !== 76 || contract.migrations.some(m => rows.filter(r => r.migration_name === m.name && r.checksum === m.checksum
    && r.applied_steps_count === 1 && r.finished && !r.rolled_back && r.clean_log && r.ordered).length !== 1)) throw Error('MIGRATION_HISTORY_MISMATCH');
  const raw = await collectCombinedCatalog(sql);
  const catalog = bindPlatform(raw, target.platformOwner);
  if (!equal(catalog, contract.profile.catalog)) throw Object.assign(Error('COMBINED_NATIVE_PROFILE_MISMATCH'),
    { categories: Object.keys(catalog).filter(k => !equal(catalog[k], contract.profile.catalog[k])) });
  // New provisioning creates no onboarding, credential or tenant records.
  for (const table of catalog.tables.filter(t => t.relkind === 'r' && t.relname !== '_prisma_migrations')) {
    const [r] = await sql.unsafe(`SELECT EXISTS(SELECT FROM ${quote(table.nspname)}.${quote(table.relname)}) AS populated`);
    if (r.populated) throw Error('UNEXPECTED_APPLICATION_DATA');
  }
}

async function runFreshTarget(input, inspect) {
  let sql, phase = 'INPUT';
  try {
    if (!plain(input, ['approval', 'approvalSha256', 'url', 'caPem'])) throw Error('INPUT_UNQUALIFIED');
    const contract = loadFreshContract();
    if (!/^24\.20\./.test(process.versions.node)
      || JSON.parse(readFileSync(new URL('node_modules/prisma/package.json', contract.root))).version !== '5.22.0') throw Error('DEPENDENCY_UNQUALIFIED');
    const t = validateApproval(input.approval, input.approvalSha256, input.url, contract.artifactSha256);
    const loopback = t.host === '127.0.0.1';
    // Local qualification does not activate hosted provisioning. An explicit
    // independently sealed local policy is required even for numeric loopback.
    if (!inspect && !loopback) return answer('REFUSED', 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase);
    const exclusive = !inspect || input.approval.exclusiveTarget
      ? validateExclusiveTarget(input.approval, input.url, input.caPem, contract) : null;
    if (!loopback && (typeof input.caPem !== 'string' || !input.caPem.includes('-----BEGIN CERTIFICATE-----'))) throw Error('VERIFIED_TLS_REQUIRED');
    sql = postgres(input.url, { host: t.host, port: t.port, username: t.login, database: t.database,
      password: () => decodeURIComponent(new URL(input.url).password), ssl: loopback && !exclusive ? false : { rejectUnauthorized: true, ca: input.caPem },
      sslnegotiation: null, target_session_attrs: 'primary',
      max: 1, prepare: false, connect_timeout: 5, idle_timeout: 2, onnotice: () => {},
      connection: { application_name: 'lumi_fresh_operator', statement_timeout: 20000, lock_timeout: 3000, search_path: 'pg_catalog,pg_temp' } });
    phase = 'PREFLIGHT';
    if (inspect) {
      phase = 'QUALIFICATION';
      await sql.begin('isolation level repeatable read read only', async tx => { await identity(tx, t); await qualify(tx, contract, t); });
      if (Date.now() >= input.approval.expiresAt) throw Error('APPROVAL_EXPIRED');
      return answer('OBSERVED_MATCH', 'EXACT_PROFILE_AND76_RECEIPTS', phase);
    }
    await sql.begin('isolation level repeatable read read only', async tx => { await identity(tx, t); await bootstrap(tx, t, contract); });
    const [lock] = await sql`SELECT pg_try_advisory_lock(6087601) AS acquired`;
    if (!lock.acquired) throw Error('OPERATOR_ALREADY_RUNNING');
    // Recheck under the cooperative operator lock, before any DDL.
    await sql.begin('isolation level repeatable read read only', async tx => { await identity(tx, t); await bootstrap(tx, t, contract); });
    if (Date.now() >= input.approval.expiresAt) throw Error('APPROVAL_EXPIRED');
    // Revalidate the sealed record/trust/binary bytes immediately before the
    // subprocess as well. Network exclusivity remains an external controller
    // obligation; these checks do not physically bind a future connection.
    phase = 'MIGRATIONS'; await migrate(input.url, validateExclusiveTarget(input.approval, input.url, input.caPem, contract), contract);
    phase = 'LEGACY_DDL'; await applyLegacy(sql, contract);
    phase = 'PERMISSIONS'; await permissions(sql);
    phase = 'QUALIFICATION';
    await sql.begin('isolation level repeatable read read only', async tx => { await identity(tx, t); await qualify(tx, contract, t); });
    if (Date.now() >= input.approval.expiresAt) throw Error('APPROVAL_EXPIRED');
    return answer('PROVISIONED_MATCH', 'EXACT_PROFILE_AND76_RECEIPTS', phase);
  } catch (error) {
    const reasons = /^(INPUT_UNQUALIFIED|APPROVAL_UNQUALIFIED|APPROVAL_EXPIRED|TARGET_UNQUALIFIED|MIGRATION_TARGET_BINDING_UNQUALIFIED|SOURCE_UNQUALIFIED|MIGRATION_BYTES_UNQUALIFIED|PROFILE_UNQUALIFIED|DEPENDENCY_UNQUALIFIED|VERIFIED_TLS_REQUIRED|IDENTITY_MISMATCH|DATABASE_LOCALE_UNQUALIFIED|BOOTSTRAP_ROLE_PROFILE_MISMATCH|BOOTSTRAP_SYSTEM_PRIVILEGE_MISMATCH|BOOTSTRAP_DATABASE_ACL_MISMATCH|BOOTSTRAP_SCHEMA_ACL_MISMATCH|TARGET_NOT_EXCLUSIVE|TARGET_NOT_EMPTY|OPERATOR_ALREADY_RUNNING|MIGRATION_PROCESS_FAILED|MIGRATION_HISTORY_MISMATCH|COMBINED_NATIVE_PROFILE_MISMATCH|UNEXPECTED_APPLICATION_DATA)$/;
    return { ...answer('REFUSED', reasons.test(error?.message) ? error.message : 'PROVISIONING_FAILED', phase),
      ...(error?.message === 'COMBINED_NATIVE_PROFILE_MISMATCH' ? { mismatch: error.categories } : {}) };
  } finally {
    if (sql) {
      try { await sql.end({ timeout: 2 }); }
      catch { return answer('REFUSED', 'CONNECTION_CLEANUP_FAILED', 'CLEANUP'); }
    }
  }
}

export const provisionFreshTarget = input => runFreshTarget(input, false);
export const inspectFreshTarget = input => runFreshTarget(input, true);
