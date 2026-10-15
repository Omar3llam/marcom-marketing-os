import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import postgres from 'postgres';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbAvailable } from '../tests/dbProbe.js';
import { seed, admit, level, sealSource, select, graph, write, observation, commit, manifest, facts, request, scope, H } from './canonicalProvenanceFixtures.js';

// New destructive schema fixtures only run inside test:full's physical worker
// databases. Fast mode never falls back to an ambient development database.
const DB_OK = process.env.REQUIRE_DB === '1' ? await dbAvailable() : false;
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const owned = [], peers = [];
let f, app, appName, maintenance, maintenanceName;
const fixture = async () => { const x = await seed(sql); owned.push(x.ws); return x; };
const refuse = (p, code = '23514') => expect(p).rejects.toMatchObject({ code });
const openWrite = async () => write(sql, await graph(sql, f));
const success = (g, over = {}) => sql.begin(async (tx) => { const oid = await observation(tx, g); await commit(tx, g, [oid], over); return oid; });
async function peer() {
  const p = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} }); peers.push(p);
  const q = await p.reserve(); await q`BEGIN`; const [{ pid }] = await q`SELECT pg_backend_pid() AS pid`;
  return { q, pid, release: async () => { await q`ROLLBACK`; q.release(); } };
}
async function barrier(waiter, holder) {
  const limit = performance.now() + 3000;
  while (performance.now() < limit) { const [r] = await sql`SELECT ${holder}::int=ANY(pg_blocking_pids(${waiter}::int)) AS yes`; if (r.yes) return; }
  throw new Error('blocking barrier was not reached');
}
async function login(group) {
  const name = `cp_${randomUUID().replaceAll('-', '')}`, password = randomBytes(24).toString('hex');
  await sql.unsafe(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await sql.unsafe(`GRANT ${group} TO "${name}"`);
  const u = new URL(process.env.DATABASE_URL); u.username = name; u.password = password;
  const client = postgres(u.toString(), { max: 1, onnotice: () => {} });
  return { name, client };
}
async function expire(ids) {
  // Owner-only clock fixture, not an application path or pruning implementation.
  await sql.begin(async(tx)=>{await tx`ALTER TABLE canonical_refreshes DISABLE TRIGGER canonical_guard`;
    await tx`UPDATE canonical_refreshes SET created_at=clock_timestamp()-interval '100 days',retain_until=clock_timestamp()-interval '1 day' WHERE id=ANY(${ids}::uuid[])`;
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;await tx`ALTER TABLE canonical_refreshes ENABLE TRIGGER canonical_guard`;});
}

describe.skipIf(!DB_OK)('02B-1 additive canonical provenance / real PostgreSQL', () => {
  beforeAll(async () => {
    // Mirrors existing unmanaged vault DDL; no token content is needed.
    await sql`CREATE TABLE IF NOT EXISTS marcom_credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id text NOT NULL,user_id text NOT NULL,platform text NOT NULL,access_token_enc text,refresh_token_enc text,account_id text,scopes text,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,platform))`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS workspace_id text`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`;
    await sql`ALTER TABLE marcom_credentials ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;
    // Vault may be created after Prisma migrations. Capture must refuse until
    // this narrowly scoped DBA grant exists; no runtime bootstrap is changed.
    await sql`DO $$BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='lumi_canonical_owner') THEN GRANT SELECT(workspace_id,platform,account_id,is_active,updated_at),UPDATE(account_id) ON public.marcom_credentials TO lumi_canonical_owner; END IF; END $$`;
  });
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    for (const p of peers.splice(0)) await p.end({ timeout: 1 });
    for (const ws of owned.splice(0)) { await sql`DELETE FROM workspaces WHERE id=${ws}`; await sql`DELETE FROM marcom_credentials WHERE workspace_id=${ws}`; }
  });
  afterAll(async () => {
    for (const [client, name] of [[app, appName], [maintenance, maintenanceName]]) if (client) { await client.end(); await sql.unsafe(`DROP OWNED BY "${name}"`); await sql.unsafe(`DROP ROLE "${name}"`); }
    await sql.end();
  });

  it('has exactly four ledger tables and preserves the existing partial snapshot index', async () => {
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'canonical_%'`;
    expect(rows.map((r) => r.tablename).sort()).toEqual(['canonical_level_attempts','canonical_observations','canonical_refreshes','canonical_write_attempts']);
    const [r] = await sql`SELECT pg_get_indexdef('metric_snapshots_non_daily_identity_key'::regclass) AS def`;
    expect(r.def).toContain(`WHERE ("measurementWindow" <> 'DAILY'::"MeasurementWindow")`);
  });
  it('DB-stamps admission and computes an exact universal 90-day floor', async () => {
    const g = await admit(sql, f);
    const [r] = await sql`SELECT extract(epoch FROM retain_until-created_at)/86400 AS days FROM canonical_refreshes WHERE id=${g.rid}`;
    expect(Number(r.days)).toBe(90);
  });
  it('rejects inactive or mismatched credential ownership', async () => {
    await sql`UPDATE marcom_credentials SET is_active=false WHERE workspace_id=${f.ws}`;
    await refuse(admit(sql, f), '23503');
  });
  it('rejects an older active binding when the credential reader selects a newer account',async()=>{
    await sql`INSERT INTO marcom_credentials(project_id,user_id,workspace_id,platform,account_id,is_active,updated_at)
      VALUES(${randomUUID()},'schema-fixture',${f.ws},'meta_ads','act_newer',true,clock_timestamp()+interval '1 hour')`;
    await refuse(admit(sql,f),'23503');
  });
  it('rejects cross-workspace root retry and conflicting descriptor identity', async () => {
    const g = await admit(sql, await fixture());
    await refuse(admit(sql, f, { retry: g.rid }), '23503');
    await refuse(admit(sql, f, { scope: { ...scope(f.ws), workspaceId: g.ws } }));
  });
  it('rejects cross-workspace composite attempt/write/selection references', async () => {
    const g = await graph(sql, await fixture());
    await refuse(write(sql, { ...g, ws: f.ws }), '23503');
    const r = await admit(sql, f);
    await refuse(sql.begin((tx) => select(tx, { ...r, aid: g.aid })), '23503');
  });
  it('requires terminal correctly levelled selected attempts at deferred commit', async () => {
    const g = await level(sql, await admit(sql, f));
    await refuse(select(sql, g));
    await sealSource(sql, g); await select(sql, g);
    await refuse(sql`UPDATE canonical_refreshes SET selection_hash=${Buffer.alloc(32)} WHERE id=${g.rid}`);
  });
  it('cannot label an admitted open level as not-started', async () => {
    const g = await level(sql, await admit(sql, f));
    await refuse(sql`UPDATE canonical_refreshes SET not_started_levels='["campaign","adset","ad"]',attempt_dispositions='[]',selection_hash=${H},source_sealed_at=clock_timestamp() WHERE id=${g.rid}`);
  });
  it('rejects mutable admission fields and partial source seal groups', async () => {
    const g = await level(sql, await admit(sql, f));
    await refuse(sql`UPDATE canonical_level_attempts SET ordinal=2 WHERE id=${g.aid}`);
    await refuse(sql`UPDATE canonical_level_attempts SET receipt_hash=${H} WHERE id=${g.aid}`);
  });
  it('seals source only once, preserving failed/unknown distinctions', async () => {
    const g = await level(sql, await admit(sql, f));
    await sealSource(sql, g, { outcome: 'FAILED', errorCode: 'PROVIDER_READ_FAILED', hasNextAtStop: null, truncated: null, returnedEntityIds: null, rowsObserved: null, distinctIdsObserved: null });
    await refuse(sealSource(sql, g));
  });
  it.each([
    ['false exhaustion', { hasNextAtStop: null }], ['false cap', { outcome: 'CAPPED' }],
    ['invented count', { distinctIdsObserved: 2 }], ['raw error text', { errorCode: 'customer token secret' }],
    ['unknown key', { accessToken: 'never allowed' }], ['invalid timestamp', { finishedAt: 'yesterday' }],
  ])('rejects invalid v1 receipt: %s', async (_name, changes) => {
    const g = await level(sql, await admit(sql, f)); await refuse(sealSource(sql, g, changes));
  });
  it('binds request descriptor to parent scope, level and canonical dates', async () => {
    const r = await admit(sql, f);
    await refuse(level(sql, r, { request: { ...request(), scopeHash: '0'.repeat(64) } }));
  });
  it('rejects an unobserved SDK version rather than borrowing a raw Graph fallback',async()=>{
    await refuse(admit(sql,f,{scope:{...scope(f.ws),sdkVersion:{value:'v21.0',origin:'REQUEST_FALLBACK'}}}));
    await admit(sql,f,{scope:{...scope(f.ws),sdkVersion:{value:'24.0.1',origin:'OBSERVED'}}});
  });
  it('preserves retries without rewriting frozen dispositions or accepting late admission', async () => {
    const r = await admit(sql, f), a = await level(sql, r), b = await level(sql, r, { retry: a.aid, ordinal: 2 });
    await sealSource(sql, b); await select(sql, b);
    const [before] = await sql`SELECT attempt_dispositions FROM canonical_refreshes WHERE id=${r.rid}`;
    await sealSource(sql, a, { outcome: 'UNPROVEN', hasNextAtStop: null, truncated: null });
    const [after] = await sql`SELECT attempt_dispositions FROM canonical_refreshes WHERE id=${r.rid}`;
    expect(after).toEqual(before); await refuse(level(sql, r, { ordinal: 3 }));
  });
  it('rejects wrong-level retry ancestry and self/forward root retry', async () => {
    const g = await level(sql, await admit(sql, f));
    await refuse(level(sql, g, { retry: g.aid, ordinal: 2, level: 'ad' }));
    await refuse(admit(sql, f, { retry: randomUUID() }), '23503');
  });
  it('allows an open write then one FAILED seal without observations', async () => {
    const g = await openWrite();
    await sql`UPDATE canonical_write_attempts SET outcome='FAILED',error_code='NORMALIZATION_FAILED',outcome_hash=${H},sealed_at=clock_timestamp() WHERE id=${g.wid}`;
    await refuse(commit(sql, g, []));
  });
  it('rejects incomplete terminal groups and changing a sealed plan', async () => {
    const g = await openWrite(); await refuse(sql`UPDATE canonical_write_attempts SET outcome='COMMITTED' WHERE id=${g.wid}`);
    await sql`UPDATE canonical_write_attempts SET planned_payload_hash=${H},planned_at=clock_timestamp() WHERE id=${g.wid}`;
    await refuse(sql`UPDATE canonical_write_attempts SET planned_payload_hash=${Buffer.alloc(32)} WHERE id=${g.wid}`);
  });
  it('commits observations and manifest atomically with exact stored values', async () => {
    const g = await openWrite(), oid = await success(g);
    const [r] = await sql`SELECT committed_projection->'snapshot'->>'spendMinor' AS spend FROM canonical_observations WHERE id=${oid}`;
    expect(r.spend).toBe('101');
    await sql`UPDATE metric_snapshots SET "spendMinor"=202 WHERE "entityId"=${f.campaign}`;
    const [old] = await sql`SELECT committed_projection->'snapshot'->>'spendMinor' AS spend FROM canonical_observations WHERE id=${oid}`; expect(old.spend).toBe('101');
  });
  it('rejects restatement after observation insertion within the same transaction', async () => {
    const g=await openWrite();
    await refuse(sql.begin(async(tx)=>{const id=await observation(tx,g);await tx`UPDATE metric_snapshots SET "spendMinor"=999 WHERE "entityId"=${f.campaign}`;await commit(tx,g,[id]);}));
  });
  it('rejects non-finite stored ratios and raw string action payloads in v1 projections',async()=>{
    const g=await openWrite();
    for(const bad of ['NaN','Infinity','-Infinity']){
      await sql`INSERT INTO metric_snapshots(id,"workspaceId","entityId","entityLevel",date,source,granularity,"measurementWindow","spendMinor",currency,roas)
        VALUES(${randomUUID()},${f.ws},${f.campaign},'CAMPAIGN','2026-10-15 09:00','META','DAILY','CUMULATIVE_30D',101,'USD',${bad}::float8)
        ON CONFLICT("entityId","entityLevel",date,granularity,source,"measurementWindow") WHERE "measurementWindow"<>'DAILY' DO UPDATE SET roas=excluded.roas`;
      await refuse(success(g));
      const [r]=await sql`SELECT roas::text AS value FROM metric_snapshots WHERE "entityId"=${f.campaign}`;expect(r.value).toBe(bad);
    }
    await sql`UPDATE metric_snapshots SET roas=NULL,"actionMetrics"='{"purchase":"not a numeric metric"}' WHERE "entityId"=${f.campaign}`;
    await refuse(success(g));
  });
  it('does not create new observations from a selected FAILED source', async () => {
    const a=await level(sql,await admit(sql,f));
    await sealSource(sql,a,{outcome:'FAILED',errorCode:'PROVIDER_READ_FAILED',hasNextAtStop:null,truncated:null,returnedEntityIds:null,rowsObserved:null,distinctIdsObserved:null});
    await select(sql,a);const g=await write(sql,a);
    await refuse(sql.begin(async(tx)=>{const id=await observation(tx,g,{facts:facts({binding:'UNKNOWN',sourceRowIndices:null})});await commit(tx,g,[id],{manifest:{...manifest(g,[id]),returnedCampaignIds:null}});}));
  });
  it('preserves genuine exhausted empty and terminal UNPROVEN receipts', async()=>{
    const a=await level(sql,await admit(sql,f));await sealSource(sql,a,{rowsObserved:0,distinctIdsObserved:0,returnedEntityIds:[]});await select(sql,a);
    const g=await write(sql,a);await commit(sql,g,[],{manifest:{...manifest(g,[]),returnedCampaignIds:[]}});
    const b=await level(sql,await admit(sql,f));await sealSource(sql,b,{outcome:'UNPROVEN',hasNextAtStop:null,truncated:null});
  });
  it('rejects forged observation hashes, duplicate dispositions and wrong source IDs', async()=>{
    const g=await openWrite();
    await refuse(sql.begin(async(tx)=>{const id=await observation(tx,g);const m=manifest(g,[id]);m.observations[0].contentHash='0'.repeat(64);await commit(tx,g,[id],{manifest:m});}));
    await refuse(commit(sql,g,[],{manifest:manifest(g,[],[{sourceAttemptId:randomUUID(),rowIndex:0,externalEntityId:'campaign-schema',reason:'ORPHAN'}])}));
  });
  it('rejects open-write observations at commit and rolls back materialization', async () => {
    const g = await openWrite(); await refuse(sql.begin((tx) => observation(tx, g)));
    const [r] = await sql`SELECT count(*)::int AS n FROM metric_snapshots WHERE "workspaceId"=${f.ws}`; expect(r.n).toBe(0);
  });
  it('rejects manifest omission, incorrect counts/hash and fabricated membership', async () => {
    const g = await openWrite();
    for (const patch of [{ observations: [] }, { committedCounts: { ACCOUNT:0,CAMPAIGN:99,ADSET:0,AD:0 } }, { membershipCoverage:'COMPLETE' }, { membershipProofRef:'invented' }]) {
      await refuse(sql.begin(async (tx) => { const id = await observation(tx, g); await commit(tx, g, [id], { manifest: { ...manifest(g,[id]), ...patch } }); }));
    }
  });
  it('reconciles every returned source row to an observation or explicit exclusion', async () => {
    const g = await openWrite(); await refuse(commit(sql, g, []));
    await commit(sql, g, [], { manifest: manifest(g,[],[{ sourceAttemptId:g.aid,rowIndex:0,externalEntityId:'campaign-schema',reason:'ORPHAN' }]) });
  });
  it('rejects forged projection, cross-workspace entity and unselected source binding', async () => {
    const g = await openWrite(), other = await fixture();
    await refuse(sql.begin((tx) => observation(tx, g, { projection: { formatVersion:1,snapshot:{},attributes:{} } })));
    await refuse(sql.begin((tx) => observation(tx, g, { entity:other.campaign })), '23503');
  });
  it('validates all three real entity paths and the derived ACCOUNT exception',async()=>{
    const adset=randomUUID(),ad=randomUUID();
    await sql`INSERT INTO ad_sets(id,"workspaceId","campaignId",channel,name,"externalId") VALUES(${adset},${f.ws},${f.campaign},'META','set','set-schema')`;
    await sql`INSERT INTO ads(id,"workspaceId","adSetId",channel,name,"externalId") VALUES(${ad},${f.ws},${adset},'META','ad','ad-schema')`;
    const r=await admit(sql,f),c=await level(sql,r),s=await level(sql,r,{level:'adset'}),a=await level(sql,r,{level:'ad'});
    await sealSource(sql,c);await sealSource(sql,s,{level:'adset',returnedEntityIds:['set-schema']});await sealSource(sql,a,{level:'ad',returnedEntityIds:['ad-schema']});
    const selected=[c,s,a].map((x,i)=>({attemptId:x.aid,level:['campaign','adset','ad'][i],selected:true,receiptHash:H.toString('hex'),unknownAtSeal:false}));
    await sql`UPDATE canonical_refreshes SET selected_campaign_id=${c.aid},selected_adset_id=${s.aid},selected_ad_id=${a.aid},not_started_levels='[]',attempt_dispositions=${sql.json(selected)},selection_hash=${H},source_sealed_at=clock_timestamp() WHERE id=${r.rid}`;
    const g=await write(sql,c);
    await refuse(sql.begin(tx=>observation(tx,g,{entity:adset,entityLevel:'ADSET',externalId:'set-schema',source:c.aid})));
    await sql.begin(async(tx)=>{
      const ids=[await observation(tx,g),await observation(tx,g,{entity:adset,entityLevel:'ADSET',externalId:'set-schema',source:s.aid}),await observation(tx,g,{entity:ad,entityLevel:'AD',externalId:'ad-schema',source:a.aid}),
        await observation(tx,g,{entity:f.account,entityLevel:'ACCOUNT',externalId:'act_schema',facts:facts({rowKind:'DERIVED_ACCOUNT_ROLLUP',contributorIds:['campaign-schema'],sourceRowIndices:[],binding:'UNKNOWN'})})];
      const m=manifest(g,ids);m.selectedSources=selected.map(({attemptId,level,receiptHash})=>({attemptId,level,receiptHash}));m.committedCounts={ACCOUNT:1,CAMPAIGN:1,ADSET:1,AD:1};await commit(tx,g,ids,{manifest:m});
    });
  });
  it('rejects an entity pointing into a different provider account in the same tenant',async()=>{
    const g=await openWrite(),other=randomUUID();await sql`INSERT INTO accounts(id,"workspaceId",channel,name,"externalId") VALUES(${other},${f.ws},'META','other','act_other')`;
    await sql`UPDATE campaign_entities SET "accountId"=${other} WHERE id=${f.campaign}`;
    await refuse(sql.begin(tx=>observation(tx,g)),'23503');
  });
  it('accepts identical artifact replay but rejects changed content under the same ID/hash',async()=>{
    const g=await openWrite(),id=await success(g);
    await sql`INSERT INTO canonical_observations SELECT * FROM canonical_observations WHERE id=${id}`;
    const [n]=await sql`SELECT count(*)::int AS n FROM canonical_observations WHERE id=${id}`;expect(n.n).toBe(1);
    await refuse(sql`INSERT INTO canonical_refreshes(workspace_id,id,provider_account_id,requested_start,requested_end,scope_descriptor,scope_hash,account_set_hash)
      SELECT workspace_id,id,provider_account_id,requested_start,requested_end,jsonb_set(scope_descriptor,'{accountSet,revision}','"changed"'),scope_hash,account_set_hash FROM canonical_refreshes WHERE id=${g.rid}`);
  });
  it('rejects invalid raw facts without manufacturing source dates or metrics', async () => {
    const g = await openWrite();
    await refuse(sql.begin((tx) => observation(tx, g, { facts: facts({ rawDates:{start:{presence:'VALID',value:null},stop:{presence:'MISSING',value:null}} }) })));
  });
  it('forbids observation UPDATE, direct DELETE and post-seal insertion', async () => {
    const g = await openWrite(), id = await success(g);
    await refuse(sql`UPDATE canonical_observations SET source_facts='{}' WHERE id=${id}`);
    await refuse(sql`DELETE FROM canonical_observations WHERE id=${id}`, '42501');
    await refuse(sql.begin((tx) => observation(tx, g)));
  });
  it('atomically extends retention on later source/write admission and seals', async () => {
    const g = await openWrite(); await success(g);
    const [r] = await sql`SELECT r.retain_until>=w.sealed_at+interval '2160 hours' AS safe FROM canonical_refreshes r JOIN canonical_write_attempts w ON w.refresh_id=r.id AND w.workspace_id=r.workspace_id WHERE w.id=${g.wid}`;
    expect(r.safe).toBe(true);
  });
  it('workspace CASCADE removes selection and retry cycles without child-guard refusal', async () => {
    const r = await admit(sql, f), g = await graph(sql, f); await admit(sql,f,{retry:r.rid}); const w = await write(sql,g); await success(w);
    await sql`DELETE FROM workspaces WHERE id=${f.ws}`;
    const [row] = await sql`SELECT count(*)::int AS n FROM canonical_observations WHERE workspace_id=${f.ws}`; expect(row.n).toBe(0);
  });
  it('real restricted app role cannot extend/delete/alter/truncate or inherit maintenance', async () => {
    if (!app) { const l = await login('lumi_canonical_app'); app=l.client; appName=l.name; }
    const g = await admit(app,f);
    await refuse(app`UPDATE canonical_refreshes SET retain_until=clock_timestamp() WHERE id=${g.rid}`, '42501');
    await refuse(app`DELETE FROM canonical_refreshes WHERE id=${g.rid}`, '42501');
    await refuse(app`ALTER TABLE canonical_observations DISABLE TRIGGER ALL`, '42501');
    await refuse(app`TRUNCATE canonical_observations`, '42501');
    await refuse(app`SET ROLE lumi_canonical_retention`, '42501');
  });
  it('maintenance cannot purge before retention expiry; workspace deletion still wins', async () => {
    if (!maintenance) { const l = await login('lumi_canonical_retention'); maintenance=l.client; maintenanceName=l.name; }
    const g=await admit(sql,f); await refuse(maintenance`SELECT canonical_provenance.canonical_delete_retained(${g.ws},${[g.rid]}::uuid[])`, '42501');
  });
  it('expired ancestors are protected by retries and future restrictive pins',async()=>{
    if (!maintenance) {const l=await login('lumi_canonical_retention');maintenance=l.client;maintenanceName=l.name;}
    const a=await admit(sql,f), b=await admit(sql,f,{retry:a.rid});await expire([a.rid]);
    await refuse(maintenance`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[a.rid]}::uuid[])`,'23503');
    await refuse(maintenance`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[a.rid,b.rid]}::uuid[])`,'42501');
    await expire([b.rid]);
    // Future consumer-reference compatibility only; no actual Decision table edit.
    await sql`CREATE TABLE canonical_future_pin(ws uuid REFERENCES workspaces(id) ON DELETE CASCADE,refresh_id uuid,FOREIGN KEY(ws,refresh_id) REFERENCES canonical_refreshes(workspace_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED)`;
    try{await sql`INSERT INTO canonical_future_pin VALUES(${f.ws},${b.rid})`;
      await refuse(maintenance`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[a.rid,b.rid]}::uuid[])`,'23503');
      await sql`DELETE FROM canonical_future_pin`;
      const [r]=await maintenance`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[a.rid,b.rid]}::uuid[]) AS n`;expect(Number(r.n)).toBe(2);
      const c=await admit(sql,f);await sql`INSERT INTO canonical_future_pin VALUES(${f.ws},${c.rid})`;
      await sql`DELETE FROM workspaces WHERE id=${f.ws}`;
      const [remaining]=await sql`SELECT count(*)::int AS n FROM canonical_future_pin`;expect(remaining.n).toBe(0);
    }finally{await sql`DROP TABLE canonical_future_pin`;}
  });
  it('retention deletes a complete source/write retry and selection cycle as one graph',async()=>{
    if(!maintenance){const l=await login('lumi_canonical_retention');maintenance=l.client;maintenanceName=l.name;}
    const parent=await admit(sql,f),r=await admit(sql,f,{retry:parent.rid}),a=await level(sql,r);
    await sealSource(sql,a,{outcome:'FAILED',errorCode:'PROVIDER_READ_FAILED',hasNextAtStop:null,truncated:null,returnedEntityIds:null,rowsObserved:null,distinctIdsObserved:null});
    const b=await level(sql,r,{retry:a.aid,ordinal:2});await sealSource(sql,b);await select(sql,b);
    const first=await write(sql,b);await sql`UPDATE canonical_write_attempts SET outcome='FAILED',error_code='METRIC_WRITE_FAILED',outcome_hash=${H},sealed_at=clock_timestamp() WHERE id=${first.wid}`;
    const second=await write(sql,b,{retry:first.wid,ordinal:2});await success(second);
    const [old]=await sql`SELECT outcome FROM canonical_write_attempts WHERE id=${first.wid}`;expect(old.outcome).toBe('FAILED');
    await expire([parent.rid,r.rid]);await maintenance`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[parent.rid,r.rid]}::uuid[])`;
    const [remaining]=await sql`SELECT (SELECT count(*) FROM canonical_observations WHERE workspace_id=${f.ws})::int AS observations,(SELECT count(*) FROM canonical_write_attempts WHERE workspace_id=${f.ws})::int AS writes,(SELECT count(*) FROM canonical_level_attempts WHERE workspace_id=${f.ws})::int AS sources`;
    expect(remaining).toEqual({observations:0,writes:0,sources:0});
  });
  it('real restricted app can seal a complete graph while lacking retention powers',async()=>{
    if(!app){const l=await login('lumi_canonical_app');app=l.client;appName=l.name;}
    await sql.unsafe(`GRANT SELECT,INSERT,UPDATE ON metric_snapshots TO "${appName}"`);
    const g=await write(app,await graph(app,f));
    const id=await app.begin(async(tx)=>{await tx`SELECT id FROM canonical_refreshes WHERE id=${g.rid} FOR UPDATE`;const oid=await observation(tx,g);await commit(tx,g,[oid]);return oid;});
    expect(id).toBeTruthy();await refuse(app`SELECT canonical_provenance.canonical_delete_retained(${f.ws},${[g.rid]}::uuid[])`,'42501');
  });
  it('private helper namespace defeats public overload shadowing by a legacy CREATE role',async()=>{
    if(!app){const l=await login('lumi_canonical_app');app=l.client;appName=l.name;}
    await sql.unsafe(`GRANT CREATE ON SCHEMA public TO "${appName}"`);
    try{await app`CREATE FUNCTION public.canonical_v1_keys(jsonb,text[]) RETURNS boolean LANGUAGE sql AS 'SELECT true'`;
      await refuse(admit(app,f,{scope:{...scope(f.ws),accessToken:'forbidden'}}));
      await refuse(app`CREATE FUNCTION canonical_provenance.canonical_v1_keys(jsonb,text[]) RETURNS boolean LANGUAGE sql AS 'SELECT true'`,'42501');
    }finally{await sql`DROP FUNCTION IF EXISTS public.canonical_v1_keys(jsonb,text[])`;await sql.unsafe(`REVOKE CREATE ON SCHEMA public FROM "${appName}"`);}
  });
  it('serializes captured commits with NO KEY UPDATE while permitting KEY SHARE', async () => {
    await admit(sql,f); const a=await peer(), b=await peer(), c=await peer();
    try {
      await a.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR NO KEY UPDATE`;
      await c.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR KEY SHARE`;
      const waiting=b.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR NO KEY UPDATE`.execute();
      await barrier(b.pid,a.pid); await a.q`COMMIT`; await waiting;
    } finally { await Promise.all([a.release(),b.release(),c.release()]); }
  });
  it('workspace deletion waits for admission and cannot resurrect deleted ownership', async () => {
    await admit(sql,f); const a=await peer(),b=await peer();
    try {
      await a.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR KEY SHARE`;
      const waiting=b.q`DELETE FROM workspaces WHERE id=${f.ws}`.execute();
      await barrier(b.pid,a.pid); await a.q`COMMIT`; await waiting; await b.q`COMMIT`;
      await refuse(admit(sql,f),'23503');
    } finally { await Promise.all([a.release(),b.release()]); }
  });
  it('serializes actual competing level admissions through the root lock',async()=>{
    const r=await admit(sql,f),a=await peer(),b=await peer();
    try{await level(a.q,r);const waiting=level(b.q,r,{ordinal:2});await barrier(b.pid,a.pid);await a.q`COMMIT`;await waiting;await b.q`COMMIT`;}finally{await Promise.all([a.release(),b.release()]);}
  });
  it('credential account switch waits for admission FOR SHARE; later mismatches refuse',async()=>{
    const a=await peer(),b=await peer();
    try{await admit(a.q,f);const waiting=b.q`UPDATE marcom_credentials SET account_id='act_other' WHERE workspace_id=${f.ws}`.execute();await barrier(b.pid,a.pid);await a.q`COMMIT`;await waiting;await b.q`COMMIT`;await refuse(admit(sql,f),'23503');}finally{await Promise.all([a.release(),b.release()]);}
  });
  it('two captured same-key writes preserve exact immutable projections under one snapshot UUID',async()=>{
    const x=await openWrite(),y=await openWrite(),a=await peer(),b=await peer();
    try{await a.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR NO KEY UPDATE`;const oid=await observation(a.q,x);await commit(a.q,x,[oid]);
      const waiting=b.q`SELECT id FROM workspaces WHERE id=${f.ws} FOR NO KEY UPDATE`.execute();await barrier(b.pid,a.pid);await a.q`COMMIT`;await waiting;
      const oid2=await observation(b.q,y,{spend:202});await commit(b.q,y,[oid2]);await b.q`COMMIT`;
      const rows=await sql`SELECT committed_projection->'snapshot'->>'id' AS id,(committed_projection->'snapshot'->>'spendMinor')::int AS spend FROM canonical_observations WHERE workspace_id=${f.ws} ORDER BY spend`;
      expect(rows.map(r=>r.spend)).toEqual([101,202]);expect(rows[0].id).toBe(rows[1].id);
    }finally{await Promise.all([a.release(),b.release()]);}
  });
  it('concurrent sealing cannot turn the first terminal source into another outcome',async()=>{
    const g=await level(sql,await admit(sql,f)),a=await peer(),b=await peer();
    try{await sealSource(a.q,g);const waiting=sealSource(b.q,g,{outcome:'UNPROVEN',hasNextAtStop:null,truncated:null});await barrier(b.pid,a.pid);await a.q`COMMIT`;await refuse(waiting);}finally{await Promise.all([a.release(),b.release()]);}
  });
  it('lock timeout aborts a contending transaction without a receipt mutation',async()=>{
    const g=await admit(sql,f),a=await peer(),b=await peer();
    try{await a.q`SELECT id FROM canonical_refreshes WHERE id=${g.rid} FOR UPDATE`;await b.q`SET LOCAL lock_timeout='100ms'`;await refuse(level(b.q,g),'55P03');}finally{await Promise.all([a.release(),b.release()]);}
  });
  it('catalog verifier fails for missing triggers and lost selection deferrability', async () => {
    const { verifyCanonicalProvenanceCatalog } = await import('../../scripts/verify-canonical-provenance-catalog.js');
    await verifyCanonicalProvenanceCatalog(sql);
    await refuse(sql.begin(async (tx) => { await tx`ALTER TABLE canonical_refreshes ALTER CONSTRAINT canonical_selection_campaign_fk NOT DEFERRABLE`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`DROP TRIGGER canonical_guard ON canonical_observations`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`ALTER TABLE canonical_refreshes DISABLE TRIGGER canonical_guard`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`ALTER TABLE canonical_write_attempts DROP CONSTRAINT canonical_write_shape`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`ALTER TABLE canonical_observations ALTER COLUMN source_facts DROP NOT NULL`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`ALTER FUNCTION canonical_provenance.canonical_guard() SET search_path TO public`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
    await refuse(sql.begin(async (tx) => { await tx`GRANT DELETE ON canonical_observations TO lumi_canonical_app`; await verifyCanonicalProvenanceCatalog(tx); }), 'CANONICAL_CATALOG_DRIFT');
  });
  it('migration is explicitly transactional and failed DDL rolls back', async () => {
    const text=readFileSync(new URL('../../prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql',import.meta.url),'utf8');
    expect(text).toMatch(/BEGIN;/); expect(text.trim()).toMatch(/COMMIT;$/);
    await refuse(sql.begin(async(tx)=>{await tx`CREATE TABLE canonical_ddl_rollback_probe(id integer)`;await tx`SELECT 1/0`;}),'22012');
    const [r]=await sql`SELECT to_regclass('public.canonical_ddl_rollback_probe') AS value`;expect(r.value).toBeNull();
  });
});
