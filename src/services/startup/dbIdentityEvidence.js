import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Explicit local observation only. No environment/config, runtime callers, operator
// command, schema provisioner or supplied query/result/connection factory is used.
const PROFILE = 'LAB_READ_ONLY_V1';
// Shared by every invoker in this loaded module. Never evict still-replayable
// challenges; capacity exhaustion fails closed. No persistence/admission token.
const seenChallenges = new Set();
const keys = ['host', 'port', 'database', 'login', 'owner', 'reader', 'systemIdentifier', 'versionMajor'];
const exact = (value, fields) => value && typeof value === 'object' && !types.isProxy(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).sort().join('|') === [...fields].sort().join('|')
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const expectedIdentityBinding = target => hash([PROFILE, ...keys.map(key => target?.[key])]);
const base = { scope: 'LAB_IDENTITY_PRIVILEGES_ONLY', source: 'PG17_CATALOG_LOCAL',
  runtimeAdmission: 'NOT_WIRED', tenantPermissionBoundaries: 'NOT_MEASURED' };
const answer = (status, reason, metadata = {}) => Object.freeze({ ...base, status, reason, ...metadata });
function qualified(request, now) {
  if (!exact(request, ['url', 'target', 'profile', 'challenge']) || request.profile !== PROFILE) return false;
  const t = request.target, c = request.challenge;
  if (!exact(t, keys) || typeof request.url !== 'string' || t.host !== '127.0.0.1' || t.versionMajor !== 17
    || !Number.isInteger(t.port) || t.port < 1024 || t.port > 65535 || t.port === 5432
    || typeof t.database !== 'string' || !/^lumi591_[a-z0-9_]{1,40}$/.test(t.database)
    || !['login', 'owner', 'reader'].every(key => typeof t[key] === 'string' && /^lab591_[a-z0-9_]{1,40}$/.test(t[key]))
    || new Set([t.login, t.owner, t.reader]).size !== 3 || typeof t.systemIdentifier !== 'string' || !/^[1-9][0-9]{18,19}$/.test(t.systemIdentifier)
    || BigInt(t.systemIdentifier) > 18446744073709551615n) return false;
  if (!exact(c, ['nonce', 'issuedAt', 'expiresAt', 'bindingHash']) || typeof c.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(c.nonce)
    || !Number.isSafeInteger(c.issuedAt) || c.issuedAt < 0 || c.issuedAt > now
    || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now || c.expiresAt <= c.issuedAt
    || c.expiresAt - c.issuedAt > 10000 || c.bindingHash !== expectedIdentityBinding(t)) return false;
  const url = new URL(request.url);
  return request.url === url.href && url.protocol === 'postgresql:' && url.hostname === t.host && Number(url.port) === t.port
    && url.username === t.login && url.pathname === '/' + t.database && !url.password && !url.search && !url.hash;
}

async function collect(sql, t) {
  const counts = {};
  const record = (name, rows) => { counts[name] = rows.length; return rows; };
  const fail = reason => answer('INCOMPATIBLE', reason, { counts });
  await sql`SET LOCAL statement_timeout='1000ms'`;
  await sql`SET LOCAL lock_timeout='250ms'`;
  await sql`SET LOCAL search_path=pg_catalog,pg_temp`;
  const identities = record('identity', await sql`SELECT current_database() AS database,current_user AS login,session_user AS session,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major,
    current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,
    current_setting('search_path') AS path,(SELECT system_identifier::text FROM pg_control_system()) AS system_id`);
  if (identities.length !== 1) return answer('UNKNOWN', 'CATALOG_INCOMPLETE', { counts });
  const i = identities[0];
  if (i.database !== t.database || i.login !== t.login || i.session !== t.login || i.address !== t.host || i.port !== t.port
    || i.major !== 17 || i.system_id !== t.systemIdentifier || i.read_only !== 'on' || i.isolation !== 'repeatable read'
    || i.path !== 'pg_catalog, pg_temp') return fail('SESSION_IDENTITY_MISMATCH');

  const roles = record('roles', await sql`WITH RECURSIVE closure AS (
    SELECT oid FROM pg_roles WHERE rolname=${t.login} UNION SELECT m.roleid FROM pg_auth_members m JOIN closure c ON c.oid=m.member
  ) SELECT oid,rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication,rolcanlogin,rolinherit,
    pg_has_role(${t.login},oid,'MEMBER') AS member,pg_has_role(${t.login},oid,'USAGE') AS inherited,
    pg_has_role(${t.login},oid,'SET') AS settable FROM pg_roles
    WHERE oid IN (SELECT oid FROM closure) OR rolname IN (${t.login},${t.owner},${t.reader})`);
  if (roles.length < 3) return answer('UNKNOWN', 'CATALOG_INCOMPLETE', { counts });
  if (roles.length !== 3 || roles.some(r => ![t.login, t.owner, t.reader].includes(r.rolname)
    || [r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolreplication].some(v => v !== false)
    || r.rolcanlogin !== (r.rolname === t.login) || r.rolinherit !== true
    || (r.rolname === t.owner && (r.member || r.inherited || r.settable)))) return fail('ROLE_PROFILE_MISMATCH');
  const memberships = record('memberships', await sql`WITH RECURSIVE closure AS (
    SELECT oid FROM pg_roles WHERE rolname=${t.login} UNION SELECT m.roleid FROM pg_auth_members m JOIN closure c ON c.oid=m.member
  ) SELECT pg_get_userbyid(member) AS member,pg_get_userbyid(roleid) AS role,admin_option,inherit_option,set_option
    FROM pg_auth_members WHERE member IN (SELECT oid FROM closure) OR roleid IN (SELECT oid FROM closure)`);
  if (memberships.length !== 1 || memberships.some(m => m.member !== t.login || m.role !== t.reader
    || m.admin_option !== false || m.inherit_option !== true || m.set_option !== false)) return fail('ROLE_MEMBERSHIP_MISMATCH');
  const settings = record('roleSettings', await sql`SELECT setconfig FROM pg_db_role_setting
    WHERE (setrole=0 OR setrole IN (SELECT oid FROM pg_roles WHERE rolname IN (${t.login},${t.owner},${t.reader})))
    AND (setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()))`);
  if (settings.length) return fail('ROLE_SETTINGS_UNQUALIFIED');

  const databases = record('database', await sql`SELECT pg_get_userbyid(datdba) AS owner,
    has_database_privilege(current_user,oid,'CONNECT') AS connect,has_database_privilege(current_user,oid,'CREATE') AS create,
    has_database_privilege(current_user,oid,'TEMP') AS temp FROM pg_database WHERE datname=current_database()`);
  if (databases.length !== 1) return answer('UNKNOWN', 'CATALOG_INCOMPLETE', { counts });
  if (databases[0].owner !== t.owner || databases[0].connect !== true || databases[0].create !== false || databases[0].temp !== false) return fail('DATABASE_CAPABILITIES_MISMATCH');
  const schemas = record('schemas', await sql`SELECT nspname,pg_get_userbyid(nspowner) AS owner,
    has_schema_privilege(current_user,oid,'USAGE') AS usage,has_schema_privilege(current_user,oid,'CREATE') AS create
    FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'`);
  if (schemas.length !== 2 || schemas.some(n => !['public', 'lab591_scope'].includes(n.nspname)
    || n.owner !== (n.nspname === 'public' ? 'pg_database_owner' : t.owner)
    || n.create !== false || n.usage !== (n.nspname === 'lab591_scope'))) return fail('SCHEMA_CAPABILITIES_MISMATCH');
  const relations = record('relations', await sql`SELECT n.nspname,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind NOT IN ('i','I')`);
  if (relations.length !== 2 || relations.some(r => r.nspname !== 'lab591_scope' || !['allowed', 'forbidden'].includes(r.relname)
    || r.owner !== t.owner || r.relkind !== 'r' || r.relpersistence !== 'p' || r.relrowsecurity !== false || r.relforcerowsecurity !== false)) return fail('OBJECT_SCOPE_MISMATCH');
  const columns = record('columns', await sql`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS select,
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS insert,
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS update,
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS references
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='lab591_scope' AND a.attnum>0 AND NOT a.attisdropped`);
  if (columns.length !== 4 || columns.some(c => !['id', 'payload'].includes(c.attname)
    || c.type !== (c.attname === 'id' ? 'integer' : 'text') || c.select !== (c.relname === 'allowed')
    || c.insert !== false || c.update !== false || c.references !== false)) return fail('COLUMN_CAPABILITIES_MISMATCH');
  const functions = record('functions', await sql`SELECT n.nspname,p.proname,p.pronargs,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);
  if (functions.length !== 1 || functions.some(f => f.nspname !== 'lab591_scope' || f.proname !== 'marker' || f.pronargs !== 0
    || f.prosecdef !== false || f.owner !== t.owner || f.execute !== false)) return fail('FUNCTION_CAPABILITIES_MISMATCH');

  const acl = record('acl', await sql`WITH objects AS (
    SELECT 'table' AS kind,c.relname AS object,c.relowner AS owner,COALESCE(c.relacl,acldefault('r',c.relowner)) AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lab591_scope' AND c.relkind='r'
    UNION ALL SELECT 'function',p.proname,p.proowner,COALESCE(p.proacl,acldefault('f',p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='lab591_scope'
    UNION ALL SELECT 'schema',nspname,nspowner,COALESCE(nspacl,acldefault('n',nspowner)) FROM pg_namespace WHERE nspname IN ('public','lab591_scope')
    UNION ALL SELECT 'database','target',datdba,COALESCE(datacl,acldefault('d',datdba)) FROM pg_database WHERE datname=current_database()
  ) SELECT kind,object,owner,a.grantor,a.grantee,a.privilege_type,a.is_grantable,
    pg_get_userbyid(owner) AS owner_name,pg_get_userbyid(a.grantor) AS grantor_name,pg_get_userbyid(a.grantee) AS grantee_name
    FROM objects CROSS JOIN LATERAL aclexplode(acl) a`);
  if (!acl.length || acl.some(a => a.grantee === 0 || a.is_grantable !== false || a.grantor !== a.owner
    || (a.grantee !== a.owner && !(a.kind === 'database' && a.grantee_name === t.login && a.privilege_type === 'CONNECT')
      && !(a.kind === 'schema' && a.object === 'lab591_scope' && a.grantee_name === t.reader && a.privilege_type === 'USAGE')
      && !(a.kind === 'table' && a.object === 'allowed' && a.grantee_name === t.reader && a.privilege_type === 'SELECT')))) return fail('OBJECT_ACL_MISMATCH');
  const columnAcl = record('columnAcl', await sql`SELECT a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lab591_scope' AND a.attnum>0 AND NOT a.attisdropped AND cardinality(a.attacl)>0`);
  if (columnAcl.length) return fail('COLUMN_ACL_MISMATCH');
  const defaults = record('defaultAcl', await sql`WITH creators AS (SELECT oid FROM pg_roles WHERE rolname IN (${t.login},${t.owner},${t.reader})),
    globals AS (SELECT r.oid AS creator,k.kind,COALESCE(d.defaclacl,acldefault(k.kind::"char",r.oid)) AS acl
      FROM creators r CROSS JOIN unnest(ARRAY['r','S','f','n']) k(kind)
      LEFT JOIN pg_default_acl d ON d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype=k.kind::"char"),
    scoped AS (SELECT defaclrole AS creator,defaclobjtype::text AS kind,defaclacl AS acl FROM pg_default_acl
      WHERE defaclrole IN (SELECT oid FROM creators) AND defaclnamespace<>0)
    SELECT creator,kind,x.grantor,x.grantee,x.is_grantable FROM (SELECT * FROM globals UNION ALL SELECT * FROM scoped) d
    CROSS JOIN LATERAL aclexplode(d.acl) x`);
  if (!defaults.length || defaults.some(d => d.grantee !== d.creator || d.grantor !== d.creator || d.is_grantable !== false)) return fail('DEFAULT_ACL_MISMATCH');
  const parameters = record('parameterAcl', await sql`SELECT p.parname FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a
    WHERE a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN (${t.login},${t.reader}))`);
  if (parameters.length) return fail('PARAMETER_ADMINISTRATION_UNQUALIFIED');
  const effective = record('effective', await sql`SELECT c.relname,p.privilege,has_table_privilege(current_user,c.oid,p.privilege) AS allowed,
    has_table_privilege(current_user,c.oid,p.privilege||' WITH GRANT OPTION') AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
    WHERE n.nspname='lab591_scope' AND c.relkind='r'`);
  if (effective.length !== 16 || effective.some(e => e.grantable !== false || e.allowed !== (e.relname === 'allowed' && e.privilege === 'SELECT'))) return fail('EFFECTIVE_PRIVILEGES_MISMATCH');
  return answer('OBSERVED_MATCH', 'LAB_PROFILE_OBSERVED', { counts });
}

/** In-process challenge replay protection; no result import or admission receipt.
 * A new instance always re-queries PostgreSQL; JSON output is not an authenticity
 * certificate. Durable replay/clock/target authorization require later approval. */
export function createDbIdentityProbe() {
  const consumed = new Set();
  return Object.freeze({ async observe(input) {
    let request;
    let bindingHash;
    try {
      if (!qualified(input, Date.now())) return answer('UNKNOWN', 'TARGET_OR_CHALLENGE_UNQUALIFIED');
      request = Object.freeze({ ...input, target: Object.freeze({ ...input.target }), challenge: Object.freeze({ ...input.challenge }) });
      if (seenChallenges.has(request.challenge.nonce)) return answer('UNKNOWN', 'CHALLENGE_REPLAYED');
      if (consumed.size >= 256) return answer('UNKNOWN', 'INVOKER_CAPACITY_EXHAUSTED');
      if (seenChallenges.size >= 4096) return answer('UNKNOWN', 'PROCESS_CAPACITY_EXHAUSTED');
      consumed.add(request.challenge.nonce); seenChallenges.add(request.challenge.nonce); bindingHash = request.challenge.bindingHash;
    } catch { return answer('UNKNOWN', 'TARGET_OR_CHALLENGE_UNQUALIFIED'); }
    let sql, result;
    try {
      const t = { ...request.target };
      sql = postgres(request.url, { host: t.host, port: t.port, username: t.login, database: t.database,
        password: () => '', ssl: false, sslnegotiation: null, max: 1, prepare: false, fetch_types: false,
        connect_timeout: 2, idle_timeout: 1, max_lifetime: 30, max_pipeline: 1, backoff: () => 0,
        target_session_attrs: 'primary', onnotice: () => {},
        connection: { application_name: 'lumi591_identity_probe', default_transaction_read_only: 'on', search_path: 'pg_catalog,pg_temp' } });
      result = await sql.begin('isolation level repeatable read read only', tx => collect(tx, t));
    } catch (error) {
      const code = error?.code;
      result = ['ECONNREFUSED', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', '08006'].includes(code)
        ? answer('NOT_CONNECTED', 'CONNECTION_UNAVAILABLE')
        : answer('FAILED', code === '25006' ? 'READ_ONLY_VIOLATION' : ['57014', '55P03'].includes(code) ? 'PROBE_TIMEOUT' : 'CATALOG_OR_SESSION_FAILED');
    } finally {
      try { if (sql) await sql.end({ timeout: 1 }); } catch { result = answer('FAILED', 'CONNECTION_CLEANUP_FAILED'); }
    }
    const observedAt = Date.now();
    if (result.status === 'OBSERVED_MATCH' && (observedAt < request.challenge.issuedAt || observedAt >= request.challenge.expiresAt)) result = answer('UNKNOWN', 'OBSERVATION_EXPIRED');
    return answer(result.status, result.reason, { ...(result.counts ? { counts: result.counts } : {}), bindingHash, observedAt });
  } });
}
