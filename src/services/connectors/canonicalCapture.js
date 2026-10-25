// Capture-v1 uses the four existing native ledger tables. No completeness authority.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { canonicalCaptureSpecs } from '../metaAdsService.js';
import { canonicalContentHash } from '../verdict-engine/evidenceReference.js';
import { canonicalSourceFacts } from './normalize/metaNormalize.js';

export const captureHash = canonicalContentHash;
const hex = (x) => Buffer.from(x).toString('hex');
const json = (x) => JSON.stringify(x);
const externalOf = (r, level) => r[`${level}_id`] == null ? null : String(r[`${level}_id`]);
export async function beginCanonicalCapture(workspaceId, auth, now) {
  const specs = canonicalCaptureSpecs(now), range = specs[0].params.time_range;
  const refreshId = randomUUID(), account = auth.accountExternalId;
  const scope = { formatVersion: 1, workspaceId, platform: 'META', providerAccountId: account,
    accountSet: { ids: [account], revision: null }, requestedStart: range.since, requestedEnd: range.until,
    levels: specs, endpoint: 'AD_ACCOUNT_INSIGHTS', sdkVersion: { value: null, origin: 'UNKNOWN' },
    accountTimezone: auth.accountTimeZone ? { value: auth.accountTimeZone, origin: 'PROVIDER' } : { value: null, origin: 'UNKNOWN' },
    credentialBinding: { workspaceId, platform: 'meta_ads', accountId: account, origin: 'CONFIGURED_ACTIVE_CREDENTIAL' } };
  const scopeHash = captureHash(scope), attempts = new Map();
  await prisma.$executeRaw`INSERT INTO public.canonical_refreshes
    (workspace_id,id,provider_account_id,requested_start,requested_end,scope_descriptor,scope_hash,account_set_hash)
    VALUES (${workspaceId}::uuid,${refreshId}::uuid,${account},${range.since}::date,${range.until}::date,
      ${json(scope)}::jsonb,${scopeHash},${captureHash(scope.accountSet)})`;
  let selectionHash, writeId;
  const hooks = {
    async start(spec) {
      const request = { formatVersion: 1, scopeHash: hex(scopeHash), ...spec, maxPages: 50 };
      const id = randomUUID(), requestHash = captureHash(request);
      await prisma.$executeRaw`INSERT INTO public.canonical_level_attempts
        (workspace_id,refresh_id,id,level,ordinal,request_descriptor,request_hash,call_intent_at)
        VALUES (${workspaceId}::uuid,${refreshId}::uuid,${id}::uuid,${spec.level},1,${json(request)}::jsonb,${requestHash},clock_timestamp())`;
      attempts.set(spec.level, { id, requestHash, rows: [], pages: null, hasNextAtStop: null, truncated: null });
    },
    page(level, progress) { Object.assign(attempts.get(level), progress); },
    async finish(level, result) {
      const a = attempts.get(level);
      if (a.receipt) return;
      // The real collector reports progress; an aggregate count cannot invent it.
      if (result.outcome !== 'FAILED') a.rows = result.rows;
      const ids = a.rows.map((r) => externalOf(r, level));
      const bound = ids.every((id) => id !== null && /^[A-Za-z0-9_.:-]{1,128}$/.test(id));
      const outcome = result.outcome === 'FAILED' ? 'FAILED' : a.pages != null && a.hasNextAtStop === false ? 'EXHAUSTED'
        : a.pages === 50 && a.hasNextAtStop === true && a.truncated === true ? 'CAPPED' : 'UNPROVEN';
      const summary = (predicate) => a.rows.length === 0 ? 'UNKNOWN' : a.rows.every(predicate) ? 'REPORTED' : a.rows.some(predicate) ? 'MIXED' : 'MISSING';
      const receipt = { formatVersion: 1, level, requestHash: hex(a.requestHash), outcome, finishedAt: new Date().toISOString(),
        pagesObserved: a.pages, rowsObserved: a.rows.length, distinctIdsObserved: bound ? new Set(ids).size : null,
        hasNextAtStop: a.hasNextAtStop, truncated: a.truncated, returnedEntityIds: bound ? ids : null,
        fieldPresence: { sourceDates: summary((r) => {
          const f = canonicalSourceFacts(r, auth, 0); return f.rawDates.start.presence === 'VALID' && f.rawDates.stop.presence === 'VALID';
        }), metrics: summary((r) => {
          const f = canonicalSourceFacts(r, auth, 0); return ['spend','impressions','clicks'].every((k) => f.metricFields[k] === 'VALID');
        }) },
        errorCode: outcome === 'FAILED' ? (a.pages == null ? 'PROVIDER_READ_FAILED' : 'PAGE_READ_FAILED') : null };
      const hash = captureHash(receipt);
      await prisma.$executeRaw`UPDATE public.canonical_level_attempts SET source_receipt=${json(receipt)}::jsonb,
        receipt_hash=${hash},source_sealed_at=clock_timestamp() WHERE workspace_id=${workspaceId}::uuid AND refresh_id=${refreshId}::uuid AND id=${a.id}::uuid`;
      Object.assign(a, { receipt, receiptHash: hash });
    },
  };
  return {
    refreshId, hooks,
    async sealSources() {
      if (selectionHash) return;
      if ([...attempts.values()].some((a) => !a.receiptHash)) throw new Error('CANONICAL_SOURCE_UNSEALED');
      const selected = Object.fromEntries([...attempts].map(([level, a]) => [level, a.id]));
      const dispositions = [...attempts].map(([level, a]) => ({ level, attemptId: a.id, selected: true,
        receiptHash: a.receiptHash ? hex(a.receiptHash) : null, unknownAtSeal: !a.receiptHash }));
      const notStarted = specs.filter((s) => !attempts.has(s.level)).map((s) => s.level);
      const hash = captureHash({ selected, dispositions, notStarted });
      await prisma.$executeRaw`UPDATE public.canonical_refreshes SET selected_campaign_id=${selected.campaign ?? null}::uuid,
        selected_adset_id=${selected.adset ?? null}::uuid,selected_ad_id=${selected.ad ?? null}::uuid,
        not_started_levels=${json(notStarted)}::jsonb,attempt_dispositions=${json(dispositions)}::jsonb,
        selection_hash=${hash},source_sealed_at=clock_timestamp() WHERE workspace_id=${workspaceId}::uuid AND id=${refreshId}::uuid`;
      selectionHash = hash;
    },
    async admitWrite() {
      writeId = randomUUID();
      await prisma.$executeRaw`INSERT INTO public.canonical_write_attempts(workspace_id,refresh_id,id,ordinal,source_selection_hash)
        VALUES(${workspaceId}::uuid,${refreshId}::uuid,${writeId}::uuid,1,${selectionHash})`;
    },
    async failWrite() {
      if (!writeId) return;
      await prisma.$executeRaw`UPDATE public.canonical_write_attempts SET outcome='FAILED',error_code='TRANSACTION_ABORTED',
        outcome_hash=${captureHash({ outcome: 'FAILED', errorCode: 'TRANSACTION_ABORTED' })},sealed_at=clock_timestamp()
        WHERE workspace_id=${workspaceId}::uuid AND refresh_id=${refreshId}::uuid AND id=${writeId}::uuid AND outcome IS NULL`;
    },
    async commit(tx, rows, normalized) {
      const observations = [], exclusions = [], consumed = new Set(), campaigns = new Set();
      const counts = { ACCOUNT: 0, CAMPAIGN: 0, ADSET: 0, AD: 0 };
      await tx.$executeRaw`UPDATE public.canonical_write_attempts SET planned_payload_hash=${captureHash(rows)},planned_at=clock_timestamp()
        WHERE workspace_id=${workspaceId}::uuid AND refresh_id=${refreshId}::uuid AND id=${writeId}::uuid`;
      for (const row of [...rows].sort((a,b) => Number(a.entityLevel === 'ACCOUNT') - Number(b.entityLevel === 'ACCOUNT'))) {
        const n = normalized.find((x) => x.entityLevel === row.entityLevel && x.externalId === row.canonicalExternalId);
        const facts = n?.canonicalFacts, level = row.entityLevel === 'ACCOUNT' ? 'campaign' : row.entityLevel.toLowerCase();
        const a = attempts.get(level);
        if (!a?.receipt || a.receipt.outcome === 'FAILED' || !facts || facts.binding !== 'EXACT') continue;
        // A derived account can be captured only with all of its actual contributors.
        if (row.entityLevel === 'ACCOUNT' && !facts.contributorIds.every((id) => campaigns.has(id))) continue;
        if (facts.sourceRowIndices.some((i) => consumed.has(`${level}:${i}`))) continue;
        const [stored] = await tx.$queryRaw`SELECT to_jsonb(m) AS snapshot FROM public.metric_snapshots m
          WHERE m."workspaceId"=${workspaceId}::uuid AND m."entityId"=${row.entityId}::uuid AND m."entityLevel"::text=${row.entityLevel}
          AND m.date=(${row.date}::timestamptz AT TIME ZONE 'UTC') AND m.source::text=${row.source}
          AND m."measurementWindow"='CUMULATIVE_30D' AND m.granularity='DAILY'`;
        if (!stored) throw new Error('Canonical materialization missing');
        const projection = { formatVersion: 1, snapshot: stored.snapshot,
          attributes: { objective: n.objective ?? null, optimizationGoal: null } };
        const id = randomUUID(), hash = captureHash({ projection, facts });
        await tx.$executeRaw`INSERT INTO public.canonical_observations(workspace_id,id,refresh_id,write_id,source_attempt_id,
          entity_id,entity_level,external_entity_id,date,granularity,source,measurement_window,window_start,window_end,
          materialized_snapshot_id,committed_projection,source_facts,content_hash)
          VALUES(${workspaceId}::uuid,${id}::uuid,${refreshId}::uuid,${writeId}::uuid,${a.id}::uuid,
            ${row.entityId}::uuid,${row.entityLevel},${n.externalId},(${row.date}::timestamptz AT TIME ZONE 'UTC'),'DAILY','META','CUMULATIVE_30D',
            (${row.windowStart}::timestamptz AT TIME ZONE 'UTC'),(${row.windowEnd}::timestamptz AT TIME ZONE 'UTC'),
            ${stored.snapshot.id}::uuid,${json(projection)}::jsonb,${json(facts)}::jsonb,${hash})`;
        observations.push({ id, contentHash: hex(hash) }); counts[row.entityLevel]++;
        if (row.entityLevel === 'CAMPAIGN') campaigns.add(n.externalId);
        facts.sourceRowIndices.forEach((i) => consumed.add(`${level}:${i}`));
      }
      for (const [level, a] of attempts) a.rows.forEach((r, i) => {
        if (!consumed.has(`${level}:${i}`)) exclusions.push({ sourceAttemptId: a.id, rowIndex: i,
          externalEntityId: externalOf(r, level), reason: 'UNBOUND' });
      });
      const manifest = { formatVersion: 1, selectedSources: [...attempts].map(([level, a]) => ({ level, attemptId: a.id, receiptHash: hex(a.receiptHash) })),
        returnedCampaignIds: attempts.get('campaign')?.receipt.returnedEntityIds ?? null,
        observations, committedCounts: counts, exclusions, membershipCoverage: 'UNKNOWN', membershipProofRef: null, membershipEvidence: null };
      await tx.$executeRaw`UPDATE public.canonical_write_attempts SET outcome='COMMITTED',commit_manifest=${json(manifest)}::jsonb,
        outcome_hash=${captureHash(manifest)},sealed_at=clock_timestamp(),committed_at=clock_timestamp()
        WHERE workspace_id=${workspaceId}::uuid AND refresh_id=${refreshId}::uuid AND id=${writeId}::uuid`;
    },
  };
}
