// Synthetic schema fixtures only. No connector/provider/runtime capture imports.
import { randomUUID, createHash } from 'node:crypto';

export const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest();
export const hex = (x) => Buffer.from(x).toString('hex');
export const H = digest('synthetic-schema-fixture');
export const LEVELS = ['campaign', 'adset', 'ad'];
export const fields = ['campaign_id', 'date_start', 'date_stop', 'spend'];
export const params = (level) => ({ level, time_range: { since: '2026-09-15', until: '2026-10-14' } });
export const scope = (ws, account = 'act_schema') => ({
  formatVersion: 1, workspaceId: ws, platform: 'META', providerAccountId: account,
  accountSet: { ids: [account], revision: null }, requestedStart: '2026-09-15', requestedEnd: '2026-10-14',
  levels: LEVELS.map((level) => ({ level, fields, params: params(level) })), endpoint: 'AD_ACCOUNT_INSIGHTS',
  sdkVersion: { value: null, origin: 'UNKNOWN' }, accountTimezone: { value: null, origin: 'UNKNOWN' },
  credentialBinding: { workspaceId: ws, platform: 'meta_ads', accountId: account, origin: 'CONFIGURED_ACTIVE_CREDENTIAL' },
});
export const request = (level = 'campaign') => ({ formatVersion: 1, scopeHash: hex(H), level, fields, params: params(level), maxPages: 50 });
export const receipt = (over = {}) => ({
  formatVersion: 1, level: 'campaign', requestHash: hex(H), outcome: 'EXHAUSTED',
  finishedAt: '2026-10-15T09:00:00.000Z', pagesObserved: 1, rowsObserved: 1, distinctIdsObserved: 1,
  hasNextAtStop: false, truncated: false, returnedEntityIds: ['campaign-schema'],
  fieldPresence: { sourceDates: 'MISSING', metrics: 'REPORTED' }, errorCode: null, ...over,
});
export const facts = (over = {}) => ({
  formatVersion: 1, rawDates: { start: { presence: 'MISSING', value: null }, stop: { presence: 'MISSING', value: null } },
  metricFields: { spend: 'VALID', revenue: 'MISSING', impressions: 'MISSING', clicks: 'MISSING', conversions: 'MISSING', reach: 'MISSING', frequency: 'MISSING', actions: 'MISSING', actionValues: 'MISSING' },
  providerAccountId: 'act_schema', providerBinding: 'CONFIGURED_CREDENTIAL',
  currency: { value: 'USD', origin: 'PROVIDER' }, timezone: { value: null, origin: 'UNKNOWN' },
  rowKind: 'DIRECT', contributorIds: [], binding: 'EXACT', sourceRowIndices: [0], ...over,
});
export const manifest = (g, observations = [], exclusions = []) => ({
  formatVersion: 1, selectedSources: [{ level: 'campaign', attemptId: g.aid, receiptHash: hex(H) }],
  returnedCampaignIds: ['campaign-schema'], observations: observations.map((id) => ({ id, contentHash: hex(H) })),
  committedCounts: { ACCOUNT: 0, CAMPAIGN: observations.length, ADSET: 0, AD: 0 }, exclusions,
  membershipCoverage: 'UNKNOWN', membershipProofRef: null, membershipEvidence: null,
});

export async function seed(sql) {
  const ws = randomUUID(), account = randomUUID(), campaign = randomUUID();
  await sql`INSERT INTO workspaces(id,name,"adChannels") VALUES(${ws},'schema-only fixture','{}')`;
  // This is the existing unmanaged credential shape; no real secret is stored.
  await sql`INSERT INTO marcom_credentials(project_id,user_id,workspace_id,platform,account_id,is_active)
    VALUES(${ws},'schema-fixture',${ws},'meta_ads','act_schema',true)`;
  await sql`INSERT INTO accounts(id,"workspaceId",channel,name,"externalId") VALUES(${account},${ws},'META','schema account','act_schema')`;
  await sql`INSERT INTO campaign_entities(id,"workspaceId","accountId",channel,name,"externalId") VALUES(${campaign},${ws},${account},'META','schema campaign','campaign-schema')`;
  return { ws, account, campaign };
}
export async function admit(sql, f, over = {}) {
  const id = randomUUID();
  await sql`INSERT INTO canonical_refreshes(workspace_id,id,provider_account_id,requested_start,requested_end,scope_descriptor,scope_hash,account_set_hash,retry_of_refresh_id)
    VALUES(${f.ws},${id},'act_schema','2026-09-15','2026-10-14',${sql.json(over.scope ?? scope(f.ws))},${H},${H},${over.retry ?? null})`;
  return { ...f, rid: id };
}
export async function level(sql, g, over = {}) {
  const aid = randomUUID(), name = over.level ?? 'campaign';
  await sql`INSERT INTO canonical_level_attempts(workspace_id,refresh_id,id,level,ordinal,retry_of_attempt_id,request_descriptor,request_hash,call_intent_at)
    VALUES(${g.ws},${g.rid},${aid},${name},${over.ordinal ?? 1},${over.retry ?? null},${sql.json(over.request ?? request(name))},${H},clock_timestamp())`;
  return { ...g, aid };
}
export async function sealSource(sql, g, over = {}) {
  await sql`UPDATE canonical_level_attempts SET source_receipt=${sql.json(receipt(over))},receipt_hash=${H},source_sealed_at=clock_timestamp()
    WHERE workspace_id=${g.ws} AND refresh_id=${g.rid} AND id=${g.aid}`;
}
export async function select(sql, g, dispositions) {
  const all = await sql`SELECT id,level,receipt_hash FROM canonical_level_attempts WHERE workspace_id=${g.ws} AND refresh_id=${g.rid} ORDER BY level,ordinal`;
  const d = dispositions ?? all.map((a) => ({ attemptId: a.id, level: a.level, selected: a.id === g.aid,
    receiptHash: a.receipt_hash ? hex(a.receipt_hash) : null, unknownAtSeal: !a.receipt_hash }));
  await sql`UPDATE canonical_refreshes SET selected_campaign_id=${g.aid},not_started_levels='["adset","ad"]',attempt_dispositions=${sql.json(d)},selection_hash=${H},source_sealed_at=clock_timestamp()
    WHERE workspace_id=${g.ws} AND id=${g.rid}`;
}
export async function graph(sql, f) { const g = await level(sql, await admit(sql, f)); await sealSource(sql, g); await select(sql, g); return g; }
export async function write(sql, g, over = {}) {
  const wid = randomUUID();
  await sql`INSERT INTO canonical_write_attempts(workspace_id,refresh_id,id,ordinal,retry_of_write_id,source_selection_hash)
    VALUES(${g.ws},${g.rid},${wid},${over.ordinal ?? 1},${over.retry ?? null},${H})`;
  return { ...g, wid };
}
export async function observation(sql, g, over = {}) {
  const oid = randomUUID();
  const entityLevel=over.entityLevel ?? 'CAMPAIGN', externalId=over.externalId ?? 'campaign-schema';
  const [m] = await sql`INSERT INTO metric_snapshots(id,"workspaceId","entityId","entityLevel",date,source,granularity,"measurementWindow","spendMinor",currency)
    VALUES(${randomUUID()},${g.ws},${over.entity ?? g.campaign},${entityLevel},'2026-10-15 09:00','META','DAILY','CUMULATIVE_30D',${over.spend ?? 101},'USD')
    ON CONFLICT("entityId","entityLevel",date,granularity,source,"measurementWindow") WHERE "measurementWindow"<>'DAILY'
    DO UPDATE SET "spendMinor"=excluded."spendMinor" RETURNING to_jsonb(metric_snapshots) AS snapshot`;
  const projection = { formatVersion: 1, snapshot: m.snapshot, attributes: { objective: null, optimizationGoal: null } };
  await sql`INSERT INTO canonical_observations(workspace_id,id,refresh_id,write_id,source_attempt_id,entity_id,entity_level,external_entity_id,date,granularity,source,measurement_window,window_start,window_end,materialized_snapshot_id,committed_projection,source_facts,content_hash)
    VALUES(${g.ws},${oid},${g.rid},${g.wid},${over.source ?? g.aid},${over.entity ?? g.campaign},${entityLevel},${externalId},'2026-10-15 09:00','DAILY','META','CUMULATIVE_30D',NULL,NULL,${m.snapshot.id},${sql.json(over.projection ?? projection)},${sql.json(over.facts ?? facts())},${H})`;
  return oid;
}
export async function commit(sql, g, ids, over = {}) {
  await sql`UPDATE canonical_write_attempts SET planned_payload_hash=${H},planned_at=clock_timestamp(),outcome='COMMITTED',commit_manifest=${sql.json(over.manifest ?? manifest(g, ids))},outcome_hash=${H},sealed_at=clock_timestamp(),committed_at=clock_timestamp()
    WHERE workspace_id=${g.ws} AND refresh_id=${g.rid} AND id=${g.wid}`;
}
