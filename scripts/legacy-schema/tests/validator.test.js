import { describe,it,expect,beforeAll,afterAll,beforeEach,afterEach } from 'vitest';
import postgres from 'postgres';
import { writeFileSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyLegacySchema } from '../verify.js';
import { labUrl,bindings } from './fixture.js';

const base=labUrl(process.env.LEGACY_SCHEMA_LAB_URL); // Missing target throws, never skips.
const control=new URL(base);control.pathname='/postgres';
const admin=postgres(control.toString(),{max:1,onnotice:()=>{}});
let db,url,owner,options,serial=0,results=[];
const observed=[];
const ledger=[];
function open(target,config){return postgres(target,{...config,debug:(_id,query)=>observed.push(query)});}
const check=async over=>{const result=await verifyLegacySchema({...options,...over});results.push(result);return result;};
beforeAll(async()=>{const [r]=await admin`SHOW server_version_num`;expect(Math.trunc(Number(r.server_version_num)/10000)).toBe(17);});
beforeEach(async()=>{
  db='lumi03b1a_case_'+process.pid+'_'+(++serial);
  await admin.unsafe(`CREATE DATABASE "${db}" OWNER lab03b1a_owner TEMPLATE "${base.pathname.slice(1)}"`);
  url=new URL(base);url.pathname='/'+db;
  owner=postgres(url.toString(),{max:1,onnotice:()=>{}});
  const audit=new URL(url);audit.username=bindings.auditor;
  options={url:audit.toString(),bindings,open,target:{hostname:'127.0.0.1',port:55438,serverAddress:'127.0.0.1',serverPort:55438,
    database:db,login:bindings.auditor,versionMajor:17,tls:'disabled-loopback'}};
  observed.length=0;
  results=[];
  // Each negative must start from a genuinely matching database, not an earlier
  // identity/query failure that would make every mutation falsely look covered.
  expect((await check()).status).toBe('COMPATIBLE');
});
afterEach(async()=>{
  ledger.push({name:expect.getState().currentTestName,results,queries:[...observed]});
  // Always restore cluster-global role mutations, even when an assertion fails.
  await admin.unsafe('REVOKE pg_write_all_data,lab03b1a_owner FROM lab03b1a_runtime');
  await admin.unsafe('ALTER ROLE lab03b1a_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await admin.unsafe('ALTER ROLE lab03b1a_runtime RESET ALL');
  await owner.end();
  await admin.unsafe(`DROP DATABASE "${db}" WITH (FORCE)`);
  expect(observed.filter(q=>!/^\s*(SELECT|WITH|SET LOCAL|BEGIN|COMMIT|ROLLBACK)\b/i.test(q))).toEqual([]);
  expect(observed.filter(q=>/\bFROM\s+(?:public\.)?marcom_/i.test(q))).toEqual([]);
});
afterAll(async()=>{
  await admin.end();
  if(process.env.LEGACY_SCHEMA_EVIDENCE_FILE)writeFileSync(process.env.LEGACY_SCHEMA_EVIDENCE_FILE,JSON.stringify(ledger,null,2));
});

describe('03B-1A real PG17 metadata negatives; no application migrations',()=>{
  it('matches exact native shape and authority using a metadata-only auditor',async()=>{
    const result=await check();expect(result).toMatchObject({status:'COMPATIBLE',reasons:[]});
    expect(result.inventory.tables).toBe(4);
    expect(observed.some(q=>q.toLowerCase().includes('repeatable read read only'))).toBe(true);
  });
  for(const table of ['marcom_sessions','marcom_credentials','marcom_projects','marcom_user_context'])
    it('rejects absent '+table+' despite 76 successful synthetic receipts',async()=>{
      await owner.unsafe(`DROP TABLE public.${table} CASCADE`);
      const result=await check();expect(result.status).toBe('INCOMPATIBLE');expect(result.reasons).toContain('tables');
    });
  const negatives=[
    ['missing session column', 'ALTER TABLE public.marcom_sessions DROP COLUMN title'],
    ['missing credential column','ALTER TABLE public.marcom_credentials DROP COLUMN health'],
    ['missing project column','ALTER TABLE public.marcom_projects DROP COLUMN context'],
    ['missing context column','ALTER TABLE public.marcom_user_context DROP COLUMN saved_at'],
    ['extra column','ALTER TABLE public.marcom_projects ADD COLUMN unexpected text'],
    ['wrong type','ALTER TABLE public.marcom_projects ALTER COLUMN name TYPE varchar(80)'],
    ['wrong nullability','ALTER TABLE public.marcom_credentials ALTER COLUMN user_id DROP NOT NULL'],
    ['wrong default','ALTER TABLE public.marcom_credentials ALTER COLUMN is_active SET DEFAULT false'],
    ['missing primary key','ALTER TABLE public.marcom_projects DROP CONSTRAINT marcom_projects_pkey'],
    ['missing unique arbiter','ALTER TABLE public.marcom_sessions DROP CONSTRAINT marcom_sessions_session_id_key'],
    ['missing credential unique','ALTER TABLE public.marcom_credentials DROP CONSTRAINT marcom_credentials_project_id_platform_key'],
    ['missing status check','ALTER TABLE public.marcom_sessions DROP CONSTRAINT marcom_sessions_status_check'],
    ['missing index','DROP INDEX public.idx_sessions_user_lastupdated'],
    ['wrong index expression','DROP INDEX public.idx_projects_user_updated; CREATE INDEX idx_projects_user_updated ON public.marcom_projects(user_id,created_at)'],
    ['missing function','DROP FUNCTION public.touch_last_updated() CASCADE'],
    ['wrong function body',"CREATE OR REPLACE FUNCTION public.touch_last_updated() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'"],
    ['security definer','ALTER FUNCTION public.touch_last_updated() SECURITY DEFINER'],
    ['function search_path','ALTER FUNCTION public.touch_last_updated() SET search_path=public'],
    ['wrong function owner','ALTER FUNCTION public.touch_last_updated() OWNER TO lab03b1a_runtime'],
    ['missing trigger','DROP TRIGGER trg_touch_last_updated ON public.marcom_sessions'],
    ['disabled trigger','ALTER TABLE public.marcom_sessions DISABLE TRIGGER trg_touch_last_updated'],
    ['wrong trigger event','DROP TRIGGER trg_touch_last_updated ON public.marcom_sessions; CREATE TRIGGER trg_touch_last_updated BEFORE INSERT ON public.marcom_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_last_updated()'],
    ['wrong table owner','ALTER TABLE public.marcom_credentials OWNER TO lab03b1a_runtime'],
    ['missing extension','DROP EXTENSION pgcrypto'],
    ['PUBLIC table grant','GRANT SELECT ON public.marcom_credentials TO PUBLIC'],
    ['runtime destructive grant','GRANT TRUNCATE ON public.marcom_credentials TO lab03b1a_runtime'],
    ['column grant','GRANT SELECT(access_token_enc) ON public.marcom_credentials TO lab03b1a_auditor'],
    ['function PUBLIC revoke','REVOKE EXECUTE ON FUNCTION public.touch_last_updated() FROM PUBLIC'],
    ['schema PUBLIC create','GRANT CREATE ON SCHEMA public TO PUBLIC'],
    ['default privilege drift','ALTER DEFAULT PRIVILEGES FOR ROLE lab03b1a_owner IN SCHEMA public GRANT SELECT ON TABLES TO lab03b1a_runtime'],
    ['inherited broad grant','GRANT pg_write_all_data TO lab03b1a_runtime'],
    ['owner role membership','GRANT lab03b1a_owner TO lab03b1a_runtime'],
    ['runtime admin capability','ALTER ROLE lab03b1a_runtime CREATEROLE'],
    ['role configuration drift',"ALTER ROLE lab03b1a_runtime SET search_path='pg_catalog'"],
    ['prerequisite missing key','ALTER TABLE public.users DROP CONSTRAINT "users_clerkId_key"'],
    ['prerequisite missing FK','ALTER TABLE public.users DROP CONSTRAINT "users_workspaceId_fkey"'],
    ['prerequisite FK action','ALTER TABLE public.users DROP CONSTRAINT "users_workspaceId_fkey"; ALTER TABLE public.users ADD CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY("workspaceId") REFERENCES public.workspaces(id) ON DELETE RESTRICT'],
    ['prerequisite invented not-null','ALTER TABLE public.users ALTER COLUMN "clerkId" SET NOT NULL'],
    ['prerequisite missing column','ALTER TABLE public.users DROP COLUMN "workspaceId"'],
    ['prerequisite wrong type','ALTER TABLE public.users DROP CONSTRAINT "users_workspaceId_fkey"; ALTER TABLE public.workspaces ALTER COLUMN id TYPE text'],
    ['migration missing76',"DELETE FROM public._prisma_migrations WHERE migration_name='20261015000000_canonical_provenance_v1'"],
    ['migration failed76',"UPDATE public._prisma_migrations SET finished_at=NULL,applied_steps_count=0 WHERE migration_name='20261015000000_canonical_provenance_v1'"],
    ['migration rolled back H1',"UPDATE public._prisma_migrations SET finished_at=NULL,rolled_back_at=now(),applied_steps_count=0 WHERE migration_name='20261015000000_canonical_provenance_v1'"],
    ['migration checksum mismatch',"UPDATE public._prisma_migrations SET checksum=repeat('a',64) WHERE migration_name='20261015000000_canonical_provenance_v1'"],
  ];
  for(const [name,query] of negatives)it('rejects '+name,async()=>{
    await owner.unsafe(query);const result=await check();expect(result.status).toBe('INCOMPATIBLE');
    expect(result.reasons).not.toContain('TARGET_IDENTITY_MISMATCH');expect(result.inventory).toBeDefined();
    if(name.startsWith('migration'))expect(result.reasons).toContain('migrationHistory');
  });
  it('fails rather than guessing when a catalog is unreadable',async()=>{
    await owner.unsafe('REVOKE SELECT ON pg_catalog.pg_attribute FROM PUBLIC');expect((await check()).status).toBe('FAILED');
  });
  it('fails on unreadable history',async()=>{
    await owner.unsafe('REVOKE SELECT ON public._prisma_migrations FROM lab03b1a_auditor');expect((await check()).status).toBe('FAILED');
  });
  it('refuses an inconsistent target without opening any connection',async()=>{
    let reached=false;const result=await check({target:{...options.target,database:'other'},open:()=>{reached=true;}});
    expect(result.status).toBe('UNKNOWN');expect(reached).toBe(false);
  });
  it('checks server-side target identity inside the read-only transaction',async()=>{
    expect((await check({target:{...options.target,serverAddress:'127.0.0.2'}})).status).toBe('INCOMPATIBLE');
  });
  it('runs the actual CLI using only an explicit local target file and audit URL',async()=>{
    const config=join(mkdtempSync(join(tmpdir(),'legacy-audit-cli-')),'target.json');
    writeFileSync(config,JSON.stringify({target:options.target,bindings}));
    const run=spawnSync(process.execPath,['scripts/verify-legacy-schema.js'],{encoding:'utf8',env:{
      SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,LEGACY_SCHEMA_AUDIT_TARGET_FILE:config,LEGACY_SCHEMA_AUDIT_URL:options.url}});
    expect(run.status).toBe(0);expect(JSON.parse(run.stdout)).toMatchObject({status:'COMPATIBLE',scope:'LEGACY_NATIVE_DIAGNOSTIC_ONLY'});
    expect(run.stderr).toBe('');
  });
});
