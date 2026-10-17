// Read-only native DDL audit. Prisma migrate diff does not see these safeguards.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

const MANIFEST = new URL('../prisma/canonical-provenance-v1.catalog.json', import.meta.url);
const MIGRATION = new URL('../prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql', import.meta.url);
const TABLES = ['canonical_refreshes', 'canonical_level_attempts', 'canonical_write_attempts', 'canonical_observations'];
const sha = (s) => createHash('sha256').update(s.replaceAll('\r\n', '\n')).digest('hex');

/** Explicit collection export permits independent review of the fixture. It is
 * never used to silently regenerate expected state by the verification command. */
export async function collectCanonicalProvenanceCatalog(sql) {
  const schemas = await sql`SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl,
    has_schema_privilege('lumi_canonical_app',oid,'CREATE') AS app_create FROM pg_namespace WHERE nspname='canonical_provenance'`;
  const tables = await sql`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) ORDER BY c.relname`;
  const columns = await sql`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
  const constraints = await sql`SELECT t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY(${TABLES}) AND c.contype<>'n' ORDER BY t.relname,c.conname`;
  // PG18 adds named NOT NULL pg_constraint rows. attnotnull above audits the
  // same invariant on PG15–18 without depending on that new catalog encoding.
  const indexes = await sql`SELECT t.relname,i.relname AS index_name,ix.indisvalid,ix.indisready,pg_get_indexdef(i.oid) AS definition
    FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND (t.relname=ANY(${TABLES}) OR i.relname='metric_snapshots_non_daily_identity_key') ORDER BY t.relname,i.relname`;
  const triggers = await sql`SELECT c.relname,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${TABLES}) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
  const definitions = await sql`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef,p.proconfig,p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p WHERE p.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='canonical_provenance') AND p.proname LIKE 'canonical_%' ORDER BY p.proname,arguments`;
  const functions = definitions.map(({ definition, ...rest }) => ({ ...rest, definitionSha256: sha(definition) }));
  const grants = await sql`SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=ANY(${TABLES}) ORDER BY table_name,grantee,privilege_type`;
  const columnGrants = await sql`SELECT table_name,grantee,privilege_type,array_agg(column_name::text ORDER BY column_name) AS columns FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name=ANY(${TABLES}) GROUP BY table_name,grantee,privilege_type ORDER BY table_name,grantee,privilege_type`;
  const roles = await sql`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles
    WHERE rolname=ANY(ARRAY['lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention']) ORDER BY rolname`;
  const [memberships] = await sql`SELECT pg_has_role('lumi_canonical_app','lumi_canonical_owner','MEMBER') AS app_owner,
    pg_has_role('lumi_canonical_app','lumi_canonical_retention','MEMBER') AS app_retention,
    pg_has_role('lumi_canonical_retention','lumi_canonical_owner','MEMBER') AS retention_owner`;
  return { schemas: [...schemas], tables: [...tables], columns: [...columns], constraints: [...constraints], indexes: [...indexes], triggers: [...triggers], functions,
    grants: [...grants], columnGrants: [...columnGrants], roles: [...roles], memberships };
}

export async function verifyCanonicalProvenanceCatalog(sql, { runtimeRole = 'lumi_canonical_app' } = {}) {
  const expected = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const actual = await collectCanonicalProvenanceCatalog(sql);
  const categories = [...new Set([...Object.keys(actual), ...Object.keys(expected.catalog)])];
  const mismatch = categories.filter((k) => JSON.stringify(expected.catalog[k]) !== JSON.stringify(actual[k]));
  if (expected.migrationSha256 !== sha(readFileSync(MIGRATION, 'utf8'))) mismatch.push('reviewed migration checksum');
  const [runtime] = await sql`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
    OR pg_has_role(rolname,'lumi_canonical_owner','MEMBER') OR pg_has_role(rolname,'lumi_canonical_retention','MEMBER')
    OR has_schema_privilege(rolname,'canonical_provenance','CREATE') AS unsafe
    FROM pg_roles WHERE rolname=${runtimeRole}`;
  if (!runtime || runtime.unsafe) mismatch.push('runtime capability isolation');
  if (mismatch.length) {
    const error = new Error(`Canonical native catalog drift: ${mismatch.join(', ')}`);
    error.code = 'CANONICAL_CATALOG_DRIFT'; throw error;
  }
  return { status: 'PASS', tables: actual.tables.length, constraints: actual.constraints.length, triggers: actual.triggers.length, functions: actual.functions.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.CANONICAL_CATALOG_DATABASE_URL;
  if (!url) throw new Error('Set CANONICAL_CATALOG_DATABASE_URL explicitly; no ambient database fallback.');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try { console.log(JSON.stringify(await sql.begin('read only', (tx) => verifyCanonicalProvenanceCatalog(tx,
    { runtimeRole: process.env.CANONICAL_CATALOG_RUNTIME_ROLE || 'lumi_canonical_app' })))); }
  finally { await sql.end(); }
}
