// Synthetic PG17 fixture only. Never imported by the operator diagnostic.
import { readFileSync } from 'node:fs';
import { ROOT, sourceInventory } from '../contract.js';
import { collectStructure } from '../catalog.js';
import { collectAuthority } from '../authority.js';
export const bindings={owner:'lab03b1a_owner',runtime:'lab03b1a_runtime',auditor:'lab03b1a_auditor'};
export function labUrl(raw) {
  const u=new URL(raw);
  if(u.hostname!=='127.0.0.1'||u.port!=='55438'||u.username!=='lab03b1a_admin'||!/^\/lumi03b1a_[a-z0-9_]+$/.test(u.pathname)||u.search)
    throw new Error('An explicit disposable loopback PG17 lab is required');
  return u;
}
export function fixtureDdl() {
  const statements=[];
  for(const [file,from,to] of [
    ['scripts/migrate.js','async function migrate()', 'migrate().catch'],
    ['src/models/chatSession.js','export async function ensureChatSessionSchema()', '// ── Helpers'],
    ['src/models/userContext.js','export async function ensureUserContextSchema()', '// ── Save'],
    ['src/models/project.js','export async function ensureProjectSchema()', '// ── CRUD'],
    ['src/models/credential.js','export async function ensureCredentialSchema()', 'async function backfillWorkspaceIds'],
  ]) {
    const source=readFileSync(new URL(file,ROOT),'utf8');
    const start=source.indexOf(from),end=source.indexOf(to,start);
    if(start<0||end<0)throw new Error('Fixture source boundary drift');
    for(const match of source.slice(start,end).matchAll(/await sql`([\s\S]*?)`/g)) {
      const query=match[1];
      if(query.includes('${')||!/^\s*(CREATE|ALTER|DROP TRIGGER|DO\b)/.test(query))throw new Error('Non-DDL fixture input');
      statements.push({file,query});
    }
  }
  if(statements.length!==26)throw new Error('Legacy DDL census drift');
  return statements;
}
async function assertLab(sql) {
  const [r]=await sql`SELECT current_database() AS db,session_user AS login,host(inet_server_addr()) AS host,
    inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major`;
  if(r.host!=='127.0.0.1'||r.port!==55438||r.major!==17||r.login!=='lab03b1a_admin'||!/^lumi03b1a_[a-z0-9_]+$/.test(r.db))
    throw new Error('Fixture target is not the disposable PG17 lab');
}
export async function prepareFixture(sql) {
  await assertLab(sql);
  await sql.unsafe('SET ROLE lab03b1a_owner');
  for(const {query} of fixtureDdl())await sql.unsafe(query);
  // Only source-required prerequisite columns/keys; no customer rows or capture schema.
  await sql`CREATE TABLE public.workspaces(id uuid PRIMARY KEY)`;
  // Match the actual baseline SQL, including nullable clerkId and its existing FK.
  await sql`CREATE TABLE public.users(id uuid PRIMARY KEY,"clerkId" text UNIQUE,"workspaceId" uuid NOT NULL,
    CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY("workspaceId") REFERENCES public.workspaces(id) ON DELETE CASCADE)`;
  await sql`CREATE TABLE public._prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,
    finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)`;
  let i=0;
  for(const m of sourceInventory().migrations)await sql`INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
    VALUES(${String(++i)},${m.checksum},now(),${m.name},1)`;
  await sql.unsafe('GRANT SELECT,INSERT,UPDATE,DELETE ON public.marcom_credentials,public.marcom_projects,public.marcom_sessions,public.marcom_user_context TO lab03b1a_runtime');
  await sql.unsafe('GRANT SELECT ON public._prisma_migrations TO lab03b1a_auditor');
  await sql.unsafe('RESET ROLE');
}
export async function fixtureManifest(sql) {
  await assertLab(sql);
  await sql`SET search_path=pg_catalog`;
  const catalog={...await collectStructure(sql),...await collectAuthority(sql,bindings)};
  let encoded=JSON.stringify(catalog);
  for(const [key,value] of Object.entries(bindings))encoded=encoded.replaceAll(value,'${'+key+'}');
  return {version:'legacy-native-v1',sourceCommit:'94232a32433de5f77b7d02874e9839f52a084b91',
    provenance:'Reviewed candidate from exact source DDL on synthetic PG17.11; NOT a production baseline. No credential DML executed.',
    source:sourceInventory(),catalog:JSON.parse(encoded)};
}
