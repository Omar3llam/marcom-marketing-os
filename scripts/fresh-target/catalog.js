import { digest, ROLES } from './contract.js';

export const stable = value => Array.isArray(value) ? value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;

// The target approval binds this exact platform superuser independently. No
// arbitrary owner is ignored: every other role/name/grant remains literal.
export const bindPlatform = (value, name) => Array.isArray(value) ? value.map(v => bindPlatform(v, name))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bindPlatform(v, name)]))
    : value === name ? '<platform_owner>' : value;

/** Read-only collection. No target/manifest generation and no data repair. */
export async function collectCombinedCatalog(sql) {
  const schemas = await sql`SELECT nspname,pg_get_userbyid(nspowner) AS owner FROM pg_namespace
    WHERE nspname!~'^pg_' AND nspname<>'information_schema' ORDER BY nspname`;
  const tables = await sql`SELECT n.nspname,c.relname,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','canonical_provenance') AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname,c.relname`;
  const columns = await sql`SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid) AS expression,cn.nspname||'.'||co.collname AS collation FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
    WHERE n.nspname IN ('public','canonical_provenance') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`;
  const constraints = await sql`SELECT n.nspname,c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','canonical_provenance') ORDER BY n.nspname,c.relname,k.conname`;
  const indexes = await sql`SELECT n.nspname,t.relname,i.relname AS name,x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('public','canonical_provenance') ORDER BY n.nspname,t.relname,i.relname`;
  const triggers = await sql`SELECT n.nspname,c.relname,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','canonical_provenance') AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`;
  const definitions = await sql`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','canonical_provenance') ORDER BY n.nspname,p.proname,arguments`;
  const functions = definitions.map(({ definition, ...row }) => ({ ...row, sha256: digest(definition.replaceAll('\r\n', '\n')) }));
  const enums = await sql`SELECT n.nspname,t.typname,pg_get_userbyid(t.typowner) AS owner,e.enumsortorder,e.enumlabel
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`;
  const extensions = await sql`SELECT e.extname,e.extversion,n.nspname,
    CASE WHEN e.extname='plpgsql' THEN '<platform>' ELSE pg_get_userbyid(e.extowner) END AS owner
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname`;
  const acl = await sql`WITH objects AS (
    SELECT 'relation' AS kind,n.nspname||'.'||c.relname AS name,c.relowner AS owner,COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END::"char",c.relowner)) AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','canonical_provenance') AND c.relkind IN ('r','p','v','m','S','f')
    UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.proowner,COALESCE(p.proacl,acldefault('f',p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','canonical_provenance')
    UNION ALL SELECT 'schema',nspname,nspowner,COALESCE(nspacl,acldefault('n',nspowner)) FROM pg_namespace WHERE nspname IN ('public','canonical_provenance')
    UNION ALL SELECT 'database','<target>',datdba,COALESCE(datacl,acldefault('d',datdba)) FROM pg_database WHERE datname=current_database()
    UNION ALL SELECT 'type',n.nspname||'.'||t.typname,t.typowner,COALESCE(t.typacl,acldefault('T',t.typowner)) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'
  ) SELECT kind,name,pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM objects CROSS JOIN LATERAL aclexplode(acl) a ORDER BY kind,name,grantor,grantee,a.privilege_type`;
  const columnAcl = await sql`SELECT n.nspname,c.relname,a.attname,pg_get_userbyid(x.grantor) AS grantor,
    CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type,x.is_grantable
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE n.nspname IN ('public','canonical_provenance') ORDER BY n.nspname,c.relname,a.attname,grantor,grantee,x.privilege_type`;
  const roles = await sql`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname=ANY(${Object.values(ROLES)}) ORDER BY rolname`;
  const memberships = await sql`SELECT pg_get_userbyid(m.member) AS member,pg_get_userbyid(m.roleid) AS role,m.admin_option,m.inherit_option,m.set_option
    FROM pg_auth_members m WHERE m.member IN (SELECT oid FROM pg_roles WHERE rolname=ANY(${Object.values(ROLES)})) OR m.roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY(${Object.values(ROLES)})) ORDER BY member,role`;
  const defaults = await sql`SELECT pg_get_userbyid(d.defaclrole) AS role,COALESCE(n.nspname,'<global>') AS schema,d.defaclobjtype,
    pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    ORDER BY role,schema,d.defaclobjtype,grantee,a.privilege_type`;
  const settings = await sql`SELECT pg_get_userbyid(setrole) AS role,CASE WHEN setdatabase=0 THEN '<global>' ELSE '<target>' END AS database,setconfig
    FROM pg_db_role_setting WHERE (setrole IN (SELECT oid FROM pg_roles WHERE rolname=ANY(${Object.values(ROLES)})) OR setrole=0)
    AND (setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())) ORDER BY role,database`;
  const policies = await sql`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','canonical_provenance') ORDER BY schemaname,tablename,policyname`;
  // Catch unreferenced domains/types/operators/collations and other namespace
  // objects too; an empty table list alone cannot prove an empty target.
  const objects = await sql`SELECT DISTINCT o.type,o.schema,o.name,o.identity FROM pg_depend d
    CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) o
    WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','canonical_provenance'))
    ORDER BY o.type,o.schema,o.name,o.identity`;
  const events = await sql`SELECT evtname,evtevent,evtenabled,evttags,pg_get_userbyid(evtowner) AS owner,evtfoid::regprocedure::text AS function FROM pg_event_trigger ORDER BY evtname`;
  const systemGrants = await sql`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_userbyid(a.grantor) AS grantor,pg_get_userbyid(a.grantee) AS grantee,a.privilege_type,a.is_grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='pg_catalog' AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname=ANY(${Object.values(ROLES)})) ORDER BY p.proname,arguments,grantee`;
  const systemCapabilities = await sql`SELECT r.rolname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
    WHERE n.nspname='pg_catalog' AND r.rolname=ANY(${Object.values(ROLES)})
    AND p.proname~'^(pg_read_(binary_)?file|pg_stat_file|pg_ls_(dir|logdir|waldir|archive_statusdir|tmpdir)|lo_(import|export)|pg_(terminate|cancel)_backend|pg_reload_conf|pg_rotate_logfile)$'
    ORDER BY r.rolname,p.proname,arguments`;
  return stable({ schemas, tables, columns, constraints, indexes, triggers, functions, enums, extensions, acl, columnAcl, roles, memberships, defaults, settings, policies, objects, events, systemGrants, systemCapabilities });
}
