// Metadata only: never selects from credential, user, workspace or session rows.
export const TABLES = ['marcom_credentials', 'marcom_projects', 'marcom_sessions', 'marcom_user_context'];
export async function collectStructure(sql) {
  const tables = await sql`SELECT c.relname,c.relkind,c.relpersistence,c.relispartition,c.reloptions,c.relreplident,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) ORDER BY c.relname`;
  const columns = await sql`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END AS collation
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
  const constraints = await sql`SELECT t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,
    pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY(${TABLES}) ORDER BY t.relname,c.conname`;
  const indexes = await sql`SELECT t.relname,i.relname AS name,ix.indisvalid,ix.indisready,ix.indislive,
    pg_get_indexdef(i.oid) AS definition FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid
    JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY(${TABLES}) ORDER BY t.relname,i.relname`;
  const triggers = await sql`SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) ORDER BY c.relname,t.tgname`;
  const functions = await sql`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_userbyid(p.proowner) AS owner,l.lanname,format_type(p.prorettype,NULL) AS returns,
    p.prosecdef,p.proleakproof,p.proisstrict,p.provolatile,p.proparallel,p.proconfig,p.prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname='touch_last_updated' ORDER BY arguments`;
  const extensions = await sql`SELECT e.extname,e.extversion,n.nspname,pg_get_userbyid(e.extowner) AS owner,e.extrelocatable
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'`;
  const sequences = await sql`SELECT s.relname,pg_get_userbyid(s.relowner) AS owner,t.relname AS table_name,a.attname
    FROM pg_class s JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i')
    JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE s.relkind='S' AND n.nspname='public' AND t.relname=ANY(${TABLES}) ORDER BY s.relname`;
  const policies = await sql`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid) AS qual,
    pg_get_expr(p.polwithcheck,p.polrelid) AS with_check FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) ORDER BY c.relname,p.polname`;
  const prerequisites = await sql`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    AND ((c.relname='users' AND a.attname IN ('id','clerkId','workspaceId')) OR (c.relname='workspaces' AND a.attname='id'))
    ORDER BY c.relname,a.attname`;
  const prerequisiteKeys = await sql`SELECT t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND ((t.relname IN ('users','workspaces') AND c.contype='p')
    OR (t.relname='users' AND c.conname IN ('users_clerkId_key','users_workspaceId_fkey'))) ORDER BY t.relname,c.conname`;
  return { tables:[...tables], columns:[...columns], constraints:[...constraints], indexes:[...indexes],
    triggers:[...triggers], functions:functions.map(f=>({...f,prosrc:f.prosrc.replaceAll('\r\n','\n')})), extensions:[...extensions], sequences:[...sequences], policies:[...policies],
    prerequisites:[...prerequisites], prerequisiteKeys:[...prerequisiteKeys] };
}
