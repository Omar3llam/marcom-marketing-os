// ============================================================
// CampaignUploadService
// Business logic for CSV + document upload processing.
// Called exclusively by: src/routes/campaigns/upload.js
// ============================================================
import { parseMetaAdsCsv }                           from './metaAdsParser.js';
import { analyzeCampaignData, analyzeCampaignsBatch } from '../agents/orchestrator.js';
import { prisma }                                     from '../lib/prisma.js';
import { logger }                                     from '../utils/logger.js';
import { randomUUID }                                 from 'crypto';
import { parseUploadedFile }                          from '../utils/fileParser.js';
import fs                                             from 'fs';

const MAX_ROWS_ANALYZE = 20;
const MAX_ROWS         = 100;

/**
 * Signals a user-facing upload failure. Route maps statusCode → HTTP status
 * and body → JSON response, preserving the exact API contract.
 */
class UploadError extends Error {
  constructor(statusCode, body) {
    super(body.error || 'Upload error');
    this.statusCode = statusCode;
    this.body = body;
  }
}

function computeHealthScore(m = {}) {
  const roas = Math.max(0, Math.min(5, m.roas ?? 0)) / 5;
  const ctr  = Math.max(0, Math.min(5, m.ctr  ?? 0)) / 5;
  const freq = 1 - Math.min(1, Math.max(0, ((m.frequency ?? 0) - 1.5) / 4));
  return Math.round(((roas * 0.5) + (ctr * 0.3) + (freq * 0.2)) * 100) / 100;
}

function classifyStage(roas = 0, ctr = 0, frequency = 1) {
  if (roas < 0.5 || (ctr < 0.5 && frequency > 4)) return 'DYING';
  if (roas < 1.0 || frequency > 3 || ctr < 1.0)   return 'FATIGUED';
  if (roas >= 3.0 && ctr >= 2.0 && frequency < 2)  return 'SCALING';
  if (roas >= 1.5 && ctr >= 1.5)                   return 'STABLE';
  return 'TESTING';
}

function buildRationale(c) {
  const parts = [];
  if (c.roas      > 0) parts.push(`ROAS ${c.roas}x`);
  if (c.ctr       > 0) parts.push(`CTR ${c.ctr}%`);
  if (c.frequency > 0) parts.push(`Frequency ${c.frequency}`);
  if (c.spend     > 0) parts.push(`Spend ${c.spend} EGP`);
  return parts.length > 0 ? parts.join(' | ') : 'No metrics available';
}

/**
 * Process a file upload in "analyze" mode.
 * Parses the file, runs AI batch analysis, persists campaign state + actions.
 *
 * @param {import('multer').File} file  - Multer file object
 * @param {string}  workspaceId
 * @param {string}  userId
 * @returns {Promise<{ statusCode: number, body: object }>}
 * @throws {UploadError} for user-facing 400/500 failures
 */
export async function processAnalyzeUpload(file, workspaceId, userId) {
  const uploadSessionId = `${workspaceId}:${Date.now()}:${randomUUID().slice(0, 8)}`;

  logger.info({ filename: file.originalname, size: file.size, mode: 'analyze', userId, workspaceId, uploadSessionId }, '[CSV_PIPELINE] CSV_RECEIVED');
  logger.info({ filename: file.originalname, size: file.size, userId, workspaceId }, '[campaigns/upload] ANALYZE mode');

  // ── Parse file (CSV, PDF, Excel, etc.) ────────────────────
  let parsedFile;
  try {
    parsedFile = await parseUploadedFile(file);
    logger.info({ type: parsedFile.type, format: parsedFile.format, rowCount: parsedFile.rowCount }, '[campaigns/upload] File parsed');
  } catch (err) {
    logger.error({ err: err.message, filename: file.originalname }, '[campaigns/upload] File parsing failed');
    throw new UploadError(400, { success: false, error: `Failed to parse file: ${err.message}` });
  } finally {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }

  // ── Route: structured (CSV) vs unstructured (PDF/text) ────
  if (parsedFile.format === 'structured' && parsedFile.type === 'csv') {
    const parsed = parsedFile.data;
    if (!parsed || parsed.length === 0)
      throw new UploadError(400, { success: false, error: 'No valid campaigns found in file', errors: parsedFile.errors || [] });
    if (parsed.length > MAX_ROWS_ANALYZE)
      throw new UploadError(400, { success: false, error: `File has ${parsed.length} rows. Maximum for analysis mode is ${MAX_ROWS_ANALYZE}.`, hint: 'Split your export into smaller date ranges.' });
    parsedFile.campaigns = parsed;
  } else {
    const extractionPrompt = `Extract campaign performance data from this document. Return a JSON array of campaigns with fields: campaignName, spend, impressions, results, ctr, frequency, reach, costPerResult.\n\nDocument content:\n${parsedFile.raw?.slice(0, 8000) || JSON.stringify(parsedFile.data)}`;
    try {
      const extracted = await analyzeCampaignData({ rawDocument: extractionPrompt }, 'document');
      if (!extracted || !Array.isArray(extracted.campaigns) || extracted.campaigns.length === 0) {
        throw new UploadError(400, {
          success: false,
          error: 'No campaign data found in document',
          hint: 'Make sure the file contains campaign performance metrics (spend, impressions, CTR, etc.)',
        });
      }
      parsedFile.campaigns = extracted.campaigns;
      logger.info({ extracted: extracted.campaigns.length }, '[campaigns/upload] AI extracted campaigns from unstructured data');
    } catch (err) {
      if (err instanceof UploadError) throw err;
      logger.error({ err: err.message }, '[campaigns/upload] AI extraction failed');
      throw new UploadError(400, { success: false, error: `AI extraction failed: ${err.message}` });
    }
  }

  const parsed = parsedFile.campaigns;
  if (!parsed || parsed.length === 0)
    throw new UploadError(400, { success: false, error: 'No valid campaigns found in file' });

  // ── Step 1: AI batch analysis ──────────────────────────────
  const campaignsForAnalysis = parsed.map(c => ({
    campaignId:     c.campaignId,
    campaignName:   c.campaignName,
    adsetName:      c.adsetName,
    metrics: {
      spend: c.spend, impressions: c.impressions, results: c.results,
      ctr: c.ctr, cpc: c.cpc, roas: c.roas,
      frequency: c.frequency, reach: c.reach, costPerResult: c.costPerResult,
    },
    deliveryStatus: c.deliveryStatus,
  }));

  let batchResult;
  try {
    batchResult = await analyzeCampaignsBatch(campaignsForAnalysis);
  } catch (err) {
    logger.error({ err: err.message }, '[campaigns/upload] Batch analysis failed');
    throw new UploadError(500, { success: false, error: `AI analysis failed: ${err.message}` });
  }

  // Map batch decisions back to campaigns, enrich with metadata
  const decisionMap = new Map(batchResult.decisions.map(d => [d.campaignId, d]));
  const results = parsed.map(c => {
    const decision = decisionMap.get(c.campaignId) || {
      verdict: 'HOLD', rootCause: 'No analysis',
      diagnosis: 'Analysis not available for this campaign', confidence: 'LOW',
      actionPlan: { primaryAction: 'Review manually', reasoning: 'Batch analysis did not include this campaign', steps: [] },
    };
    decision.campaignId    = c.campaignId;
    decision.campaignName  = c.campaignName;
    decision.adsetName     = c.adsetName;
    decision.sourceMetrics = {
      spend: c.spend ?? 0, impressions: c.impressions ?? 0, results: c.results ?? 0,
      ctr: c.ctr ?? 0, cpc: c.cpc ?? 0, roas: c.roas ?? 0,
      frequency: c.frequency ?? 0, reach: c.reach ?? 0, costPerResult: c.costPerResult ?? 0,
    };
    return { status: 'fulfilled', value: { decision, campaign: c } };
  });

  const decisions       = [];
  const errors          = [];
  const campaignsToSave = [];

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      decisions.push(result.value.decision);
      campaignsToSave.push(result.value);
    } else {
      logger.error({ err: result.reason?.message, campaignId: parsed[idx].campaignId }, '[campaigns/upload-csv] orchestrator.analyzeCampaignData failed');
      errors.push({ campaign: parsed[idx].campaignName, error: result.reason?.message || 'Analysis failed' });
    }
  });

  // ── Step 2: Persist (transaction-wrapped) ─────────────────
  const campaignIds = [];
  let processed     = 0;
  let alertsCreated = 0;

  await prisma.$transaction(async (tx) => {
    const upsertResults = await Promise.allSettled(
      campaignsToSave.map(({ campaign: c, decision }) => {
        const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
        const stage       = classifyStage(c.roas, c.ctr, c.frequency);
        return tx.campaignState.upsert({
          where:  { campaignId_workspaceId: { campaignId: c.campaignId, workspaceId } },
          update: { stage, healthScore, lastAnalysis: new Date() },
          create: { campaignId: c.campaignId, workspaceId, stage, healthScore, lastAnalysis: new Date() },
        }).then(cs => ({ c, cs, stage, decision }));
      }),
    );

    const actionData = [];
    upsertResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const { c, cs, decision } = result.value;
        actionData.push({
          workspaceId,
          campaignId:     cs.campaignId,
          idempotencyKey: `meta:csv:${uploadSessionId}:${cs.campaignId}`,
          status:         'PENDING',
          payload: {
            kind: 'lumi.csv-data-analyzed', source: 'csv-upload-analyze', platform: 'META',
            campaignName: c.campaignName, adsetName: c.adsetName,
            priority:  decision.verdict === 'KILL' ? 'HIGH' : decision.verdict === 'SCALE' ? 'MEDIUM' : 'LOW',
            verdict:   decision.verdict || 'HOLD',
            rootCause: decision.rootCause || decision.diagnosis,
            rationale: decision.diagnosis,
            strategicAnalysis: {
              verdict:    decision.verdict,
              rootCause:  decision.rootCause,
              diagnosis:  decision.diagnosis,
              actionPlan: decision.actionPlan,
            },
            metrics: { spend: c.spend, impressions: c.impressions, results: c.results, frequency: c.frequency, reach: c.reach, ctr: c.ctr, cpc: c.cpc, roas: c.roas, costPerResult: c.costPerResult },
            deliveryStatus: c.deliveryStatus,
            rawRecord:      c.rawRecord,
          },
        });
        campaignIds.push(cs.campaignId);
        processed++;
      } else {
        logger.error({ err: result.reason?.message, campaignId: campaignsToSave[idx]?.campaign?.campaignId }, '[campaigns/upload-csv] persistence failed');
        errors.push({ campaign: campaignsToSave[idx]?.campaign?.campaignName || 'Unknown', error: `Persistence failed: ${result.reason?.message || 'Unknown error'}` });
      }
    });

    if (actionData.length > 0) {
      await tx.action.createMany({ data: actionData });
      alertsCreated = actionData.length;
    }
  });

  if (alertsCreated > 0) {
    const totalSpend = campaignIds.reduce((sum, campaignId) => {
      const campaign = campaignsToSave.find(({ campaign: c }) => c.campaignId === campaignId)?.campaign;
      return sum + (campaign?.spend || 0);
    }, 0);
    logger.info({ workspaceId, campaignsPersisted: processed, actionsPersisted: alertsCreated, totalSpend }, '[CSV_PIPELINE] ANALYZE_MODE_CAMPAIGNS_PERSISTED');
  }

  const analyzed         = decisions.length;
  const isFullSuccess    = analyzed > 0 && processed === analyzed && errors.length === 0;
  const isPartialSuccess = analyzed > 0 && processed > 0 && processed < analyzed;

  logger.info({ userId, analyzed, errors: errors.length, totalRows: parsed.length, persisted: processed, isPartialSuccess }, '[campaigns/upload-csv] ANALYZE mode complete');

  return {
    statusCode: 200,
    body: {
      success: isFullSuccess,
      partial: isPartialSuccess,
      mode: 'analyze',
      decisions,
      errors,
      stats: {
        uploaded:        parsedFile.rowCount,
        analyzed,
        failed:          errors.length,
        persisted:       processed,
        alerts_created:  alertsCreated,
      },
      campaign_ids: campaignIds,
    },
  };
}

/**
 * Process a file upload in DB-write mode (no AI analysis).
 * Parses a Meta Ads CSV, persists campaign state + rule-based action records.
 *
 * @param {import('multer').File} file
 * @param {string}  workspaceId
 * @param {string}  userId
 * @returns {Promise<{ statusCode: number, body: object }>}
 * @throws {UploadError} for user-facing 400 failures
 */
export async function processDbWriteUpload(file, workspaceId, userId) {
  const uploadSessionId = `${workspaceId}:${Date.now()}:${randomUUID().slice(0, 8)}`;

  logger.info({ filename: file.originalname, size: file.size, mode: 'db-write', userId, workspaceId, uploadSessionId }, '[CSV_PIPELINE] CSV_RECEIVED');
  logger.info({ filename: file.originalname, size: file.size, workspaceId }, '[campaigns/upload-csv] DB WRITE mode');

  const { campaigns: parsed, errors: parseErrors, stats } = parseMetaAdsCsv(file.buffer);
  logger.info({ stats, parseErrors, totalRows: parsed?.length || 0 }, '[CSV_PIPELINE] CSV_PARSED');

  // ── Enhanced Debug Logging (PR #44) ───────────────────────
  console.log('\n========== CSV UPLOAD DEBUG ==========');
  console.log('📊 ROWS PARSED:', {
    totalRows:      stats?.total_rows || 0,
    validCampaigns: parsed?.length || 0,
    parseErrors:    parseErrors?.length || 0,
    workspaceId,
  });

  if (parsed && parsed.length > 0) {
    console.log('🔬 FIRST ROW NORMALIZED:', {
      campaignId:   parsed[0].campaignId,
      campaignName: parsed[0].campaignName,
      spend:        parsed[0].spend,
      impressions:  parsed[0].impressions,
      ctr:          parsed[0].ctr,
      roas:         parsed[0].roas,
      frequency:    parsed[0].frequency,
    });
    logger.info({
      sample: {
        campaignId:  parsed[0].campaignId,
        spend:       parsed[0].spend,
        impressions: parsed[0].impressions,
        ctr:         parsed[0].ctr,
        roas:        parsed[0].roas,
      },
    }, '[CSV_PIPELINE] ROWS_NORMALIZED - sample row');
  }

  if (!parsed || parsed.length === 0)
    throw new UploadError(400, {
      success: false,
      error:  'Upload succeeded but no campaigns were created. The CSV may be empty or invalid.',
      stats,
      errors: parseErrors ? parseErrors.slice(0, 5) : [],
      hint: [
        'Expected format: Meta Ads Manager CSV export.',
        'Required columns: "Campaign name", "Ad set name", "Amount spent (EGP)", "Impressions".',
        'Make sure you are exporting at campaign or ad set level.',
        'Row 2 (summary totals) is automatically skipped.',
      ],
    });

  if (parsed.length > MAX_ROWS)
    throw new UploadError(400, {
      success: false,
      error: `CSV has ${parsed.length} rows. Maximum is ${MAX_ROWS}.`,
      hint:  'Split your export into smaller date ranges and re-upload.',
    });

  const errors      = [];
  const campaignIds = [];
  let   processed   = 0;
  let   alertsCreated = 0;

  // ── Persist (transaction-wrapped) ─────────────────────────
  await prisma.$transaction(async (tx) => {
    const upsertResults = await Promise.allSettled(
      parsed.map(c => {
        const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
        const stage       = classifyStage(c.roas, c.ctr, c.frequency);
        const currency    = c.currency || 'USD';
        return tx.campaignState.upsert({
          where:  { campaignId_workspaceId: { campaignId: c.campaignId, workspaceId } },
          update: { stage, healthScore, currency, lastAnalysis: new Date() },
          create: { campaignId: c.campaignId, workspaceId, stage, healthScore, currency, lastAnalysis: new Date() },
        }).then(cs => ({ c, cs, stage }));
      }),
    );

    const actionData = [];
    upsertResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const { c, cs, stage } = result.value;
        actionData.push({
          workspaceId,
          campaignId:     cs.campaignId,
          idempotencyKey: `meta:csv:${uploadSessionId}:${cs.campaignId}`,
          status:         'PENDING',
          payload: {
            kind: 'lumi.csv-data', source: 'csv-upload', platform: 'META',
            campaignName: c.campaignName, adsetName: c.adsetName,
            priority:  stage === 'DYING' ? 'HIGH' : stage === 'FATIGUED' ? 'MEDIUM' : 'LOW',
            verdict:   stage === 'DYING' ? 'KILL' : stage === 'SCALING' ? 'SCALE' : 'HOLD',
            rootCause: stage === 'DYING' ? 'CRITICAL_PERFORMANCE_DECLINE' : stage === 'FATIGUED' ? 'CREATIVE_FATIGUE' : 'SCALING_OPPORTUNITY',
            rationale: buildRationale(c),
            metrics: { spend: c.spend, impressions: c.impressions, results: c.results, frequency: c.frequency, reach: c.reach, ctr: c.ctr, cpc: c.cpc, roas: c.roas, costPerResult: c.costPerResult },
            deliveryStatus: c.deliveryStatus,
            rawRecord:      c.rawRecord,
          },
        });
        campaignIds.push(cs.campaignId);
        processed++;
      } else {
        logger.warn({ err: result.reason?.message, campaignId: parsed[i].campaignId }, '[campaigns/upload-csv] row failed');
        errors.push({ campaign: parsed[i].campaignName, error: result.reason?.message || 'Unknown error' });
      }
    });

    if (actionData.length > 0) {
      await tx.action.createMany({ data: actionData });
      alertsCreated = actionData.length;
    }
  });

  if (alertsCreated > 0) {
    const totalSpend = parsed
      .filter(c => campaignIds.includes(c.campaignId))
      .reduce((sum, c) => sum + (c.spend || 0), 0);

    logger.info({ workspaceId, campaignsPersisted: processed, actionsPersisted: alertsCreated, totalSpend }, '[CSV_PIPELINE] CAMPAIGNS_PERSISTED');

    // ── Enhanced Debug Logging (PR #44) ─────────────────────
    console.log('💾 CAMPAIGNS CREATED:', {
      campaignsPersisted: processed,
      actionsPersisted:   alertsCreated,
      totalSpend:         `$${totalSpend.toFixed(2)}`,
      workspaceId,
    });
  }

  logger.info({ workspaceId, processed, alertsCreated, errors: errors.length }, '[CSV_PIPELINE] PIPELINE_COMPLETE');
  console.log('✅ PIPELINE COMPLETE:', { uploaded: stats.total_rows, processed, alertsCreated, errors: errors.length });
  console.log('======================================\n');

  return {
    statusCode: 200,
    body: { uploaded: stats.total_rows, processed, alerts_created: alertsCreated, campaign_ids: campaignIds, errors },
  };
}
