import { TABLES } from './catalog.js';

// pg_catalog ACLs include grants invisible to information_schema.role_table_grants.
export async function collectAuthority(sql, { owner, runtime, auditor }) {
  const roles = [owner, runtime, auditor];
  const schemas = await sql`SELECT nspname,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'`;
  const database = await sql`SELECT pg_get_userbyid(datdba) AS owner,pg_encoding_to_char(encoding) AS encoding,
    datlocprovider,datcollate,datctype,datcollversion FROM pg_database WHERE datname=current_database()`;
  const acl = await sql`WITH objects AS (
    SELECT 'table' AS kind,c.relname AS object,c.relowner AS owner,COALESCE(c.relacl,acldefault('r',c.relowner)) AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${TABLES})
    UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.proowner,
      COALESCE(p.proacl,acldefault('f',p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='touch_last_updated'
    UNION ALL SELECT 'schema',nspname,nspowner,COALESCE(nspacl,acldefault('n',nspowner)) FROM pg_namespace WHERE nspname='public'
    UNION ALL SELECT 'database','<target>',datdba,COALESCE(datacl,acldefault('d',datdba)) FROM pg_database WHERE datname=current_database()
  ) SELECT o.kind,o.object,pg_get_userbyid(a.grantor) AS grantor,
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM objects o CROSS JOIN LATERAL aclexplode(o.acl) a ORDER BY o.kind,o.object,grantor,grantee,a.privilege_type`;
  const columnAcl = await sql`SELECT c.relname,a.attname,pg_get_userbyid(x.grantor) AS grantor,
    CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type,x.is_grantable
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE n.nspname='public' AND c.relname=ANY(${TABLES})
    ORDER BY c.relname,a.attname,grantor,grantee,x.privilege_type`;
  const defaultAcl = await sql`SELECT pg_get_userbyid(d.defaclrole) AS creator,COALESCE(n.nspname,'<global>') AS schema,
    d.defaclobjtype,pg_get_userbyid(x.grantor) AS grantor,
    CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type,x.is_grantable
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    WHERE d.defaclrole=ANY(SELECT oid FROM pg_roles WHERE rolname=ANY(${roles})) AND (d.defaclnamespace=0 OR n.nspname='public')
    ORDER BY creator,schema,d.defaclobjtype,grantor,grantee,x.privilege_type`;
  const roleFacts = await sql`WITH RECURSIVE closure AS (
    SELECT oid FROM pg_roles WHERE rolname=ANY(${roles}) UNION
    SELECT m.roleid FROM pg_auth_members m JOIN closure c ON c.oid=m.member
  ) SELECT r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls
    FROM pg_roles r JOIN closure c ON c.oid=r.oid ORDER BY r.rolname`;
  const memberships = await sql`WITH RECURSIVE closure AS (
    SELECT oid FROM pg_roles WHERE rolname=ANY(${roles}) UNION
    SELECT m.roleid FROM pg_auth_members m JOIN closure c ON c.oid=m.member
  ) SELECT pg_get_userbyid(m.member) AS member,pg_get_userbyid(m.roleid) AS role,pg_get_userbyid(m.grantor) AS grantor,
    m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m
    WHERE m.member IN (SELECT oid FROM closure) OR m.roleid IN (SELECT oid FROM closure) ORDER BY member,role,grantor`;
  const roleSettings = await sql`SELECT r.rolname,CASE WHEN s.setdatabase=0 THEN '<global>' ELSE '<target>' END AS database,s.setconfig
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname=ANY(${roles})
    AND (s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())) ORDER BY r.rolname,database`;
  const effective = await sql`SELECT r.rolname,c.relname,p.privilege,
    has_table_privilege(r.oid,c.oid,p.privilege) AS allowed FROM pg_roles r CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
    WHERE r.rolname=ANY(${roles}) AND n.nspname='public' AND c.relname=ANY(${TABLES}) ORDER BY r.rolname,c.relname,p.privilege`;
  const capabilities = await sql`SELECT rolname,has_schema_privilege(oid,'public','USAGE') AS schema_usage,
    has_schema_privilege(oid,'public','CREATE') AS schema_create,has_database_privilege(oid,current_database(),'CONNECT') AS db_connect,
    has_database_privilege(oid,current_database(),'CREATE') AS db_create,has_database_privilege(oid,current_database(),'TEMP') AS db_temp,
    pg_has_role(oid,${owner},'MEMBER') AS owner_member FROM pg_roles WHERE rolname=ANY(${roles}) ORDER BY rolname`;
  return { schemas:[...schemas], database:[...database], acl:[...acl], columnAcl:[...columnAcl], defaultAcl:[...defaultAcl],
    roleFacts:[...roleFacts], memberships:[...memberships], roleSettings:[...roleSettings], effective:[...effective], capabilities:[...capabilities] };
}
