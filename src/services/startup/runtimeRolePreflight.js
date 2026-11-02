// Trusted internal callers supply actual clients, never rows or proof claims.
// This is only a current-session role-capability observation. It is not target,
// tenant, native-schema, future-connection or startup authorization. No I/O at import.
const LOGIN = 'lumi_backend_runtime';
const APP = 'lumi_canonical_app';
const base = Object.freeze({ scope: 'RUNTIME_ROLE_CAPABILITIES_ONLY', runtimeAdmission: 'NOT_WIRED',
  physicalTarget: 'UNQUALIFIED', tenantPermissionBoundaries: 'NOT_MEASURED', nativeSchema: 'NOT_MEASURED' });
const result = (driver, status, reason) => Object.freeze({ ...base, driver, status, reason });
const refusal = reason => { throw Object.assign(new Error(reason), { refusal: reason }); };
const boolean = value => typeof value === 'boolean';
const count = value => Number.isSafeInteger(value) && value >= 0;
const sessionMatches = r => r && r.login === LOGIN && r.session === LOGIN && r.major === 17
  && Number.isSafeInteger(r.pid) && r.pid > 0 && r.read_only === 'on'
  && r.isolation === 'repeatable read' && r.path === 'pg_catalog, pg_temp';

async function observe(query) {
  const started = performance.now();
  // PG17 bounds live SQL/transactions; no detached timeout races rollback.
  // Prisma also bounds acquisition (2s) and transaction (5s). postgres.js pool
  // acquisition retains the supplied client's limits; no global latency SLA.
  await query`SELECT pg_catalog.set_config('search_path','pg_catalog, pg_temp',true),
    pg_catalog.set_config('statement_timeout','1000ms',true),pg_catalog.set_config('lock_timeout','250ms',true),
    pg_catalog.set_config('transaction_timeout','4000ms',true),pg_catalog.set_config('idle_in_transaction_session_timeout','1000ms',true)`;
  const identity = async () => {
    const rows = await query`SELECT current_user AS login,session_user AS session,
      current_setting('server_version_num')::int/10000 AS major,pg_backend_pid() AS pid,
      current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,
      current_setting('search_path') AS path`;
    if (!Array.isArray(rows) || rows.length !== 1 || !sessionMatches(rows[0])) refusal('SESSION_PROFILE_MISMATCH');
    return rows[0];
  };
  const first = await identity();
  // Include noninheriting/nonsettable ancestors and implicit pg_database_owner.
  const roles = await query`SELECT rolname AS name,rolsuper AS superuser,rolcreaterole AS create_role,
    rolcreatedb AS create_db,rolreplication AS replication,rolbypassrls AS bypass_rls,
    rolcanlogin AS login,rolinherit AS inherit,pg_has_role(current_user,oid,'MEMBER') AS member,
    pg_has_role(current_user,oid,'USAGE') AS usage,pg_has_role(current_user,oid,'SET') AS settable,
    pg_has_role(current_user,oid,'MEMBER WITH ADMIN OPTION') AS admin
    FROM pg_roles WHERE rolname IN ('lumi_backend_runtime','lumi_canonical_app')
      OR pg_has_role(current_user,oid,'MEMBER') OR pg_has_role(current_user,oid,'USAGE')
      OR pg_has_role(current_user,oid,'SET')`;
  if (!Array.isArray(roles) || roles.length !== 2 || new Set(roles.map(r => r.name)).size !== 2
    || roles.some(r => ![LOGIN, APP].includes(r.name)
      || ['superuser','create_role','create_db','replication','bypass_rls'].some(k => r[k] !== false)
      || r.login !== (r.name === LOGIN) || r.inherit !== true || r.member !== true
      || r.usage !== true || r.settable !== true || !boolean(r.admin)
      || (r.name === APP && r.admin !== false))) refusal('ROLE_PROFILE_MISMATCH');
  const memberships = await query`WITH RECURSIVE reachable(oid) AS (
      SELECT oid FROM pg_roles WHERE rolname=current_user
      UNION SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON r.oid=m.member
    ) SELECT pg_get_userbyid(member) AS member,pg_get_userbyid(roleid) AS role,
      admin_option,inherit_option,set_option FROM pg_auth_members
    WHERE member IN (SELECT oid FROM reachable) OR roleid IN (SELECT oid FROM reachable)`;
  if (!Array.isArray(memberships) || memberships.length !== 1
    || memberships[0].member !== LOGIN || memberships[0].role !== APP
    || memberships[0].admin_option !== false || memberships[0].inherit_option !== true
    || memberships[0].set_option !== true) refusal('ROLE_MEMBERSHIP_MISMATCH');
  // Shared ownership dependencies cover all object kinds, including other DBs.
  // Effective checks include PUBLIC/inheritance. Full native/ACL equivalence,
  // including callable function bodies, still requires its separate proof.
  const rows = await query`SELECT
    has_database_privilege(current_user,d.oid,'CONNECT') AS connect,
    has_database_privilege(current_user,d.oid,'CREATE') AS create_db,
    has_database_privilege(current_user,d.oid,'TEMP') AS temp,
    (has_database_privilege(current_user,d.oid,'CONNECT WITH GRANT OPTION')
      OR has_database_privilege(current_user,d.oid,'CREATE WITH GRANT OPTION')
      OR has_database_privilege(current_user,d.oid,'TEMP WITH GRANT OPTION')) AS database_grant,
    (SELECT count(*)::int FROM pg_namespace) AS schemas,
    (SELECT count(*)::int FROM pg_namespace WHERE has_schema_privilege(current_user,oid,'CREATE')) AS schema_create,
    (SELECT count(*)::int FROM pg_namespace WHERE has_schema_privilege(current_user,oid,'USAGE WITH GRANT OPTION')
      OR has_schema_privilege(current_user,oid,'CREATE WITH GRANT OPTION')) AS schema_grant,
    (SELECT count(*)::int FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.deptype='o'
      AND s.refobjid IN (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_backend_runtime','lumi_canonical_app'))) AS owned_objects,
    (SELECT count(*)::int FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a
      WHERE CASE WHEN a.grantee=0 THEN true ELSE pg_has_role(current_user,a.grantee,'USAGE') END) AS parameter_grants,
    (SELECT count(*)::int FROM pg_db_role_setting
      WHERE (setrole=0 OR setrole IN (SELECT oid FROM pg_roles WHERE rolname IN ('lumi_backend_runtime','lumi_canonical_app')))
      AND (setdatabase=0 OR setdatabase=d.oid)) AS settings
    FROM pg_database d WHERE d.datname=current_database()`;
  const a = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!a || !['connect','create_db','temp','database_grant'].every(k => boolean(a[k]))
    || !['schemas','schema_create','schema_grant','owned_objects','parameter_grants','settings'].every(k => count(a[k]))
    || a.schemas === 0) refusal('CATALOG_INCOMPLETE');
  if (!a.connect || a.create_db || a.temp || a.database_grant || a.schema_create || a.schema_grant
    || a.owned_objects || a.parameter_grants || a.settings) refusal('ADMINISTRATIVE_CAPABILITY_PRESENT');
  const last = await identity();
  if (last.pid !== first.pid) refusal('SESSION_PROFILE_MISMATCH');
  if (performance.now() - started >= 4000) throw Object.assign(new Error('expired'), { code: '57014' });
}
function failed(driver, error) {
  if (['SESSION_PROFILE_MISMATCH','ROLE_PROFILE_MISMATCH','ROLE_MEMBERSHIP_MISMATCH',
    'CATALOG_INCOMPLETE','ADMINISTRATIVE_CAPABILITY_PRESENT'].includes(error?.refusal)) {
    return result(driver, 'INCOMPATIBLE', error.refusal);
  }
  const code = error?.code === 'P2010' ? error?.meta?.code : error?.code;
  return result(driver, 'FAILED', ['57014','55P03','25P04','P2028'].includes(code) ? 'PROBE_TIMEOUT'
    : code === '25006' ? 'READ_ONLY_VIOLATION' : 'CATALOG_OR_TRANSACTION_FAILED');
}

/** Caller retains pool ownership; this awaits commit or rollback completion. */
export async function inspectPrismaRuntimeRole(client) {
  const driver = 'PRISMA';
  try {
    if (!client || typeof client.$transaction !== 'function') return result(driver, 'UNKNOWN', 'CLIENT_UNQUALIFIED');
    await client.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await observe((strings, ...values) => tx.$queryRaw(strings, ...values));
    }, { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
    return result(driver, 'OBSERVED_MATCH', 'ROLE_CAPABILITIES_OBSERVED');
  } catch (error) { return failed(driver, error); }
}
export async function inspectPostgresRuntimeRole(client) {
  const driver = 'POSTGRES';
  try {
    if (typeof client !== 'function' || typeof client.begin !== 'function') return result(driver, 'UNKNOWN', 'CLIENT_UNQUALIFIED');
    await client.begin('isolation level repeatable read read only', tx => observe(tx));
    return result(driver, 'OBSERVED_MATCH', 'ROLE_CAPABILITIES_OBSERVED');
  } catch (error) { return failed(driver, error); }
}
