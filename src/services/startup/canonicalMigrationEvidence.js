import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { types } from 'node:util';

// Standalone lab observation. No automatic caller, environment configuration,
// result import, connection factory override or database provisioner.
const seen = new Set();
const fields = ['host', 'port', 'database', 'login', 'systemIdentifier', 'versionMajor'];
const base = { scope: 'LAB_CANONICAL_NATIVE_HISTORY_ONLY', runtimeAdmission: 'NOT_WIRED', tenantPermissionBoundaries: 'NOT_MEASURED' };
const answer = (status, reason) => Object.freeze({ ...base, status, reason });
const sha = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
const exact = (v, keys) => v && typeof v === 'object' && !types.isProxy(v) && Object.getPrototypeOf(v) === Object.prototype
  && Reflect.ownKeys(v).sort().join('|') === [...keys].sort().join('|')
  && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, 'value'));
export const canonicalTargetBinding = t => sha(JSON.stringify(['LAB_CANONICAL_NATIVE_HISTORY_V1', ...fields.map(k => t?.[k])]));
function qualified(r, now) {
  if (!exact(r, ['target', 'url', 'challenge']) || !exact(r.target, fields) || typeof r.url !== 'string') return false;
  const t = r.target, c = r.challenge;
  if (t.host !== '127.0.0.1' || !Number.isInteger(t.port) || t.port < 1024 || t.port > 65535 || t.port === 5432
    || t.versionMajor !== 17 || typeof t.database !== 'string' || !/^lumi594_[a-z0-9_]{1,40}$/.test(t.database)
    || t.login !== 'lab594_observer' || typeof t.systemIdentifier !== 'string' || !/^[1-9][0-9]{18,19}$/.test(t.systemIdentifier)
    || BigInt(t.systemIdentifier) > 18446744073709551615n) return false;
  if (!exact(c, ['nonce', 'issuedAt', 'expiresAt', 'bindingHash']) || typeof c.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(c.nonce)
    || !Number.isSafeInteger(c.issuedAt) || c.issuedAt < 0 || c.issuedAt > now || !Number.isSafeInteger(c.expiresAt)
    || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 10000 || c.bindingHash !== canonicalTargetBinding(t)) return false;
  const u = new URL(r.url);
  return r.url === u.href && u.protocol === 'postgresql:' && u.hostname === t.host && Number(u.port) === t.port
    && u.username === t.login && u.pathname === '/' + t.database && !u.password && !u.search && !u.hash;
}
function sourceContract() {
  const root = new URL('../../../', import.meta.url);
  const text = readFileSync(new URL('prisma/canonical-provenance-v1.catalog.json', root), 'utf8');
  if (sha(text) !== '123870e3b285ff737cd28fd23f5d43ab79819d842c0a4d7371df1d5487b482b8') throw Error('source');
  const migrations = new URL('prisma/migrations/', root);
  const entries = readdirSync(migrations, { withFileTypes: true });
  const ancillary = { 'migration_lock.toml': 'd6bae7899f05da956e1070ba5703455503208ef79e161acb18c93bfe3c6cd236',
    'manual_add_execution_request_idempotency.sql': '8a9689713a56d7623fcca04385d1055465fe22a2261c9cff55e5212897ac0d0f' };
  if (entries.some(e => Object.hasOwn(ancillary,e.name) ? !e.isFile() : (!e.isDirectory() || !/^\d/.test(e.name)))) throw Error('source');
  for (const [name, checksum] of Object.entries(ancillary)) if (sha(readFileSync(new URL(name,migrations),'utf8')) !== checksum) throw Error('source');
  const bytes = new Map();
  const sources = entries.filter(e => e.isDirectory()).map(e => e.name).sort().map(name => {
    const source = readFileSync(new URL(name + '/migration.sql', migrations)); bytes.set(name,source);
    return { name, checksum: sha(source.toString('utf8')) };
  });
  if (sources.length !== 76 || sha(JSON.stringify(sources)) !== 'e511fc39d0b8fc00f70c7cdfdc04fff332106bf07fc30114fcbb8d9c77a04165') throw Error('source');
  const manifest = JSON.parse(text);
  if (manifest.migrationSha256 !== sources[75].checksum) throw Error('source');
  // The frozen diagnostic used public in its search path. Render those same
  // known public references explicitly for our catalog-only search path.
  for (const c of manifest.catalog.constraints) if (c.contype === 'f') c.definition = c.definition.replace('REFERENCES ', 'REFERENCES public.');
  for (const i of manifest.catalog.indexes) i.definition = i.definition.replace('::"MeasurementWindow"', '::public."MeasurementWindow"');
  // Authority is pinned with repository LF normalization. Prisma receipts hash
  // the actual bytes deployed, including this checkout's line endings. Require
  // that exact byte checksum; do not accept unrelated or repaired receipts.
  return { manifest, sources: sources.map(s => ({ name: s.name, checksum: createHash('sha256')
    .update(bytes.get(s.name)).digest('hex') })) };
}

async function privilegeProfile(sql, t, catalog) {
  const groups = ['lumi_canonical_owner', 'lumi_canonical_app', 'lumi_canonical_retention'];
  const roles = await sql`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin,rolinherit
    FROM pg_roles WHERE rolname=${t.login}`;
  if (roles.length !== 1 || roles[0].rolcanlogin !== true || roles[0].rolinherit !== true
    || ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(k => roles[0][k] !== false)) return false;
  const memberships = await sql`SELECT pg_get_userbyid(member) AS member,pg_get_userbyid(roleid) AS role,admin_option,inherit_option,set_option
    FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login}))
    OR roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login}))`;
  if (memberships.length !== 1 || memberships[0].member !== 'lab594_migrator' || memberships[0].role !== groups[0]
    || !memberships[0].admin_option || !memberships[0].inherit_option || !memberships[0].set_option) return false;
  const settings = await sql`SELECT setconfig FROM pg_db_role_setting WHERE (setrole=0 OR setrole IN (
    SELECT oid FROM pg_roles WHERE rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login})))
    AND (setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()))`;
  if (settings.length) return false;
  const [db] = await sql`SELECT pg_get_userbyid(datdba) AS owner,has_database_privilege(current_user,oid,'CONNECT') AS connect,
    has_database_privilege(current_user,oid,'CREATE') AS create,has_database_privilege(current_user,oid,'TEMP') AS temp
    FROM pg_database WHERE datname=current_database()`;
  if (!db || db.owner !== 'lab594_migrator' || db.connect !== true || db.create !== false || db.temp !== false) return false;
  const dbAcl = await sql`SELECT pg_get_userbyid(a.grantee) AS grantee,a.privilege_type,a.is_grantable,
    a.grantor=d.datdba AS owner_grantor FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(datacl,acldefault('d',datdba))) a
    WHERE datname=current_database()`;
  if (dbAcl.length !== 4 || dbAcl.some(a => !a.owner_grantor || a.is_grantable || !(a.grantee === db.owner
    || (a.grantee === t.login && a.privilege_type === 'CONNECT')))) return false;
  const objects = await sql`SELECT n.nspname,c.relname,c.relkind,c.relpersistence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='canonical_provenance' OR (n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind NOT IN ('i','I'))`;
  if (objects.length !== 4 || objects.some(o => o.nspname !== 'public' || o.relkind !== 'r' || o.relpersistence !== 'p'
    || !catalog.tables.some(x => x.relname === o.relname))) return false;
  const extraTypes = await sql`SELECT typname FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='canonical_provenance')`;
  if (extraTypes.length) return false;
  const tableAcl = await sql`SELECT c.relname,pg_get_userbyid(a.grantee) AS grantee,a.privilege_type,a.is_grantable,a.grantor=c.relowner AS owner_grantor
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind='r'`;
  const expectedGrants = [...catalog.grants.map(g => `${g.table_name}|${g.grantee}|${g.privilege_type}`), ...catalog.tables.map(g => `${g.relname}|lumi_canonical_owner|MAINTAIN`)].sort();
  if (tableAcl.some(a => a.is_grantable || !a.owner_grantor) || JSON.stringify(tableAcl.map(a => `${a.relname}|${a.grantee}|${a.privilege_type}`).sort()) !== JSON.stringify(expectedGrants)) return false;
  const columns = await sql`SELECT c.relname,a.attname,pg_get_userbyid(x.grantee) AS grantee,x.privilege_type,x.is_grantable,x.grantor=c.relowner AS owner_grantor
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND a.attnum>0 AND NOT a.attisdropped`;
  const expectedColumns = catalog.columnGrants.filter(g => g.privilege_type === 'UPDATE' && g.grantee !== groups[0])
    .flatMap(g => g.columns.map(c => `${g.table_name}|${c}|${g.grantee}|UPDATE`)).sort();
  if (columns.some(a => a.is_grantable || !a.owner_grantor) || JSON.stringify(columns.map(a => `${a.relname}|${a.attname}|${a.grantee}|${a.privilege_type}`).sort()) !== JSON.stringify(expectedColumns)) return false;
  const defaults = await sql`WITH creators AS (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention','lab594_migrator',${t.login})),
    globals AS (SELECT r.oid AS creator,COALESCE(d.defaclacl,acldefault(k.kind::"char",r.oid)) AS acl FROM creators r
      CROSS JOIN unnest(ARRAY['r','S','f','n','T']) k(kind) LEFT JOIN pg_default_acl d ON d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype=k.kind::"char"),
    scoped AS (SELECT defaclrole AS creator,defaclacl AS acl FROM pg_default_acl WHERE defaclrole IN (SELECT oid FROM creators) AND defaclnamespace<>0)
    SELECT creator,a.grantee,a.grantor,a.is_grantable FROM (SELECT * FROM globals UNION ALL SELECT * FROM scoped) d CROSS JOIN LATERAL aclexplode(d.acl) a`;
  if (!defaults.length || defaults.some(a => a.grantee !== a.creator || a.grantor !== a.creator || a.is_grantable)) return false;
  const effective = await sql`SELECT c.relname,r.rolname,p.privilege,has_table_privilege(r.oid,c.oid,p.privilege) AS allowed,
    has_table_privilege(r.oid,c.oid,p.privilege||' WITH GRANT OPTION') AS grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN pg_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
    WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind='r' AND r.rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login})`;
  if (effective.length !== 128 || effective.some(e => e.allowed !== expectedGrants.includes(`${e.relname}|${e.rolname}|${e.privilege}`)
    || e.grantable !== (e.rolname === groups[0]))) return false;
  const functionRights = await sql`SELECT p.proname,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') AS execute
    FROM pg_proc p CROSS JOIN pg_roles r WHERE p.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='canonical_provenance')
    AND r.rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login})`;
  if (functionRights.length !== catalog.functions.length * 4 || functionRights.some(f => f.execute !== (f.rolname === groups[0]
    || (f.rolname === groups[2] && f.proname === 'canonical_delete_retained')))) return false;
  const schemaRights = await sql`SELECT n.nspname,r.rolname,has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,has_schema_privilege(r.oid,n.oid,'CREATE') AS create
    FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname IN ('canonical_provenance','public')
    AND r.rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login})`;
  if (schemaRights.length !== 8 || schemaRights.some(s => s.create !== (s.rolname === groups[0])
    || s.usage !== (s.nspname === 'public' || s.rolname !== t.login))) return false;
  const publicAcl = await sql`SELECT pg_get_userbyid(a.grantee) AS grantee,a.privilege_type,a.is_grantable,a.grantor=n.nspowner AS owner_grantor
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public'`;
  const publicExpected = ['pg_database_owner|USAGE','pg_database_owner|CREATE','lumi_canonical_owner|USAGE','lumi_canonical_owner|CREATE',
    'lumi_canonical_app|USAGE','lumi_canonical_retention|USAGE',`${t.login}|USAGE`].sort();
  if (publicAcl.some(a => a.is_grantable || !a.owner_grantor) || JSON.stringify(publicAcl.map(a => `${a.grantee}|${a.privilege_type}`).sort()) !== JSON.stringify(publicExpected)) return false;
  const historyObject = await sql`SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='_prisma_migrations'`;
  if (historyObject.length !== 1 || historyObject[0].relkind !== 'r' || historyObject[0].relpersistence !== 'p'
    || historyObject[0].relrowsecurity || historyObject[0].relforcerowsecurity || historyObject[0].owner !== 'lab594_migrator') return false;
  // A history read grant must not accidentally carry customer or write access,
  // including column-only rights that has_table_privilege would not reveal.
  const observerColumns = await sql`SELECT c.relname,a.attname,p.privilege,has_column_privilege(current_user,c.oid,a.attnum,p.privilege) AS allowed
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
    WHERE n.nspname IN ('public','canonical_provenance') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`;
  if (!observerColumns.length || observerColumns.some(a => a.allowed !== (a.relname === '_prisma_migrations' && a.privilege === 'SELECT'))) return false;
  const observerTables = await sql`SELECT c.relname,p.privilege,has_table_privilege(current_user,c.oid,p.privilege) AS allowed,
    has_table_privilege(current_user,c.oid,p.privilege||' WITH GRANT OPTION') AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
    WHERE n.nspname IN ('public','canonical_provenance') AND c.relkind='r'`;
  if (!observerTables.length || observerTables.some(a => a.grantable || a.allowed !== (a.relname === '_prisma_migrations' && a.privilege === 'SELECT'))) return false;
  const parameters = await sql`SELECT p.parname FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a
    WHERE a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention',${t.login}))`;
  if (parameters.length) return false;
  const indirect = await sql`SELECT c.oid FROM pg_constraint c JOIN pg_class target ON target.oid=c.confrelid JOIN pg_namespace n ON n.oid=target.relnamespace
    WHERE n.nspname='public' AND target.relname LIKE 'canonical_%' AND c.conrelid NOT IN (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'canonical_%')`;
  if (indirect.length) return false;
  const relationFeatures = await sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND (c.relname LIKE 'canonical_%' OR c.relname='_prisma_migrations') AND c.relkind='r'
    AND (c.relhasrules OR c.relhassubclass OR c.relispartition OR EXISTS(SELECT FROM pg_inherits i WHERE i.inhrelid=c.oid)
      OR EXISTS(SELECT FROM pg_policy p WHERE p.polrelid=c.oid))`;
  if (relationFeatures.length) return false;
  const historyColumns = await sql`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attgenerated,a.attidentity
    FROM pg_attribute a WHERE a.attrelid='public._prisma_migrations'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`;
  const historyExpected = [['id','character varying(36)',true],['checksum','character varying(64)',true],['finished_at','timestamp with time zone',false],
    ['migration_name','character varying(255)',true],['logs','text',false],['rolled_back_at','timestamp with time zone',false],
    ['started_at','timestamp with time zone',true],['applied_steps_count','integer',true]];
  if (historyColumns.length !== historyExpected.length || historyColumns.some((c,i) => c.attname !== historyExpected[i][0]
    || c.type !== historyExpected[i][1] || c.attnotnull !== historyExpected[i][2] || c.attgenerated !== '' || c.attidentity !== '')) return false;
  return true;
}
// This exported predicate is not an observation/result injection entrypoint.
// Every real observation independently reads every historical receipt below.
export function historyMatches(rows, sources) {
  return rows.length === 76 && sources.length === 76 && sources.every(s => {
    const matched = rows.filter(r => r.migration_name === s.name);
    return matched.length === 1 && matched[0].checksum === s.checksum && matched[0].finished === true
      && matched[0].rolled_back === false && matched[0].clean_log === true && matched[0].ordered === true && matched[0].applied_steps_count === 1;
  });
}

async function observeTransaction(sql, t, contract) {
  await sql`SET LOCAL statement_timeout='1000ms'`;
  await sql`SET LOCAL lock_timeout='250ms'`;
  await sql`SET LOCAL search_path=pg_catalog,pg_temp`;
  const identities = await sql`SELECT current_database() AS database,current_user AS login,session_user AS session,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major,
    current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,
    current_setting('search_path') AS path,(SELECT system_identifier::text FROM pg_control_system()) AS system_id`;
  const i = identities[0];
  if (identities.length !== 1 || i.database !== t.database || i.login !== t.login || i.session !== t.login || i.address !== t.host
    || i.port !== t.port || i.major !== 17 || i.system_id !== t.systemIdentifier || i.read_only !== 'on'
    || i.isolation !== 'repeatable read' || i.path !== 'pg_catalog, pg_temp') return answer('INCOMPATIBLE', 'SESSION_IDENTITY_MISMATCH');
  const native = await collectNative(sql);
  if (Object.keys(contract.manifest.catalog).some(k => JSON.stringify(native[k]) !== JSON.stringify(contract.manifest.catalog[k]))) return answer('INCOMPATIBLE', 'NATIVE_CATALOG_MISMATCH');
  if (!await privilegeProfile(sql, t, contract.manifest.catalog)) return answer('INCOMPATIBLE', 'NATIVE_PRIVILEGES_MISMATCH');
  const rows = await sql`SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back,
    logs IS NULL OR logs='' AS clean_log,started_at IS NOT NULL AND finished_at>=started_at AND finished_at<=clock_timestamp() AS ordered,
    applied_steps_count FROM public._prisma_migrations`;
  if (!historyMatches(rows, contract.sources)) return answer('INCOMPATIBLE', 'MIGRATION_HISTORY_UNQUALIFIED');
  return answer('OBSERVED_MATCH', 'LAB_NATIVE_HISTORY_OBSERVED');
}

/** Fresh native reads only; process-local nonce refusal is not durable proof
 * authenticity or authorization of a target. An independent physical preflight
 * must bind the caller's system ID, directory, binary, listener and owned lab. */
export function createCanonicalMigrationObserver() {
  return Object.freeze({ async observe(input) {
    let r, contract;
    try {
      if (!qualified(input, Date.now())) return answer('UNKNOWN', 'TARGET_OR_CHALLENGE_UNQUALIFIED');
      r = Object.freeze({ ...input, target: Object.freeze({ ...input.target }), challenge: Object.freeze({ ...input.challenge }) });
      if (seen.has(r.challenge.nonce)) return answer('UNKNOWN', 'CHALLENGE_REPLAYED');
      if (seen.size >= 4096) return answer('UNKNOWN', 'PROCESS_CAPACITY_EXHAUSTED');
      seen.add(r.challenge.nonce); contract = sourceContract();
    } catch { return answer('UNKNOWN', 'TARGET_OR_SOURCE_UNQUALIFIED'); }
    let sql, result;
    try {
      const t = r.target;
      sql = postgres(r.url, { host: t.host, port: t.port, username: t.login, database: t.database, password: () => '', ssl: false,
        sslnegotiation: null, max: 1, prepare: false, connect_timeout: 2, idle_timeout: 1, max_lifetime: 30, max_pipeline: 1,
        backoff: () => 0, target_session_attrs: 'primary', onnotice: () => {},
        connection: { application_name: 'lumi594_canonical_observer', default_transaction_read_only: 'on', search_path: 'pg_catalog,pg_temp' } });
      result = await sql.begin('isolation level repeatable read read only', tx => observeTransaction(tx, t, contract));
    } catch (error) {
      result = ['ECONNREFUSED', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', '08006'].includes(error?.code)
        ? answer('NOT_CONNECTED', 'CONNECTION_UNAVAILABLE') : answer('FAILED', ['57014', '55P03'].includes(error?.code) ? 'PROBE_TIMEOUT' : 'CATALOG_OR_SESSION_FAILED');
    } finally {
      try { if (sql) await sql.end({ timeout: 1 }); } catch { result = answer('FAILED', 'CONNECTION_CLEANUP_FAILED'); }
    }
    const now = Date.now();
    if (result.status === 'OBSERVED_MATCH' && (now < r.challenge.issuedAt || now >= r.challenge.expiresAt)) return answer('UNKNOWN', 'OBSERVATION_EXPIRED');
    return result;
  } });
}

async function collectNative(sql) {
  const schemas = await sql`SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl,
    has_schema_privilege('lumi_canonical_app',oid,'CREATE') AS app_create FROM pg_namespace WHERE nspname='canonical_provenance'`;
  const tables = await sql`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations']) ORDER BY c.relname`;
  const columns = await sql`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations']) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
  const constraints = await sql`SELECT t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY(ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations']) AND c.contype<>'n' ORDER BY t.relname,c.conname`;
  // PG18 adds named NOT NULL pg_constraint rows. attnotnull above audits the
  // same invariant on PG15–18 without depending on that new catalog encoding.
  const indexes = await sql`SELECT t.relname,i.relname AS index_name,ix.indisvalid,ix.indisready,pg_get_indexdef(i.oid) AS definition
    FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND (t.relname=ANY(ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations']) OR i.relname='metric_snapshots_non_daily_identity_key') ORDER BY t.relname,i.relname`;
  const triggers = await sql`SELECT c.relname,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations']) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
  const definitions = await sql`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef,p.proconfig,p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p WHERE p.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='canonical_provenance') ORDER BY p.proname,arguments`;
  const functions = definitions.map(({ definition, ...rest }) => ({ ...rest, definitionSha256: sha(definition) }));
  const grants = await sql`SELECT c.relname AS table_name,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind='r' AND a.privilege_type<>'MAINTAIN' ORDER BY table_name,grantee,privilege_type`;
  const columnGrants = await sql`WITH rights AS (
    SELECT c.oid,c.relname AS table_name,a.grantee,a.privilege_type,att.attname::text AS column_name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
      WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind='r' AND a.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES')
    UNION SELECT c.oid,c.relname,a.grantee,a.privilege_type,att.attname::text
      FROM pg_attribute att JOIN pg_class c ON c.oid=att.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(att.attacl) a WHERE n.nspname='public' AND c.relname LIKE 'canonical_%' AND c.relkind='r' AND att.attnum>0 AND NOT att.attisdropped
  ) SELECT table_name,CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END AS grantee,privilege_type,
    array_agg(column_name ORDER BY column_name) AS columns FROM rights GROUP BY table_name,grantee,privilege_type ORDER BY table_name,grantee,privilege_type`;
  const roles = await sql`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles
    WHERE rolname=ANY(ARRAY['lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention']) ORDER BY rolname`;
  const [memberships] = await sql`SELECT pg_has_role('lumi_canonical_app','lumi_canonical_owner','MEMBER') AS app_owner,
    pg_has_role('lumi_canonical_app','lumi_canonical_retention','MEMBER') AS app_retention,
    pg_has_role('lumi_canonical_retention','lumi_canonical_owner','MEMBER') AS retention_owner`;
  return { schemas: [...schemas], tables: [...tables], columns: [...columns], constraints: [...constraints], indexes: [...indexes], triggers: [...triggers], functions,
    grants: [...grants], columnGrants: [...columnGrants], roles: [...roles], memberships };
}
