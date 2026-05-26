import multer from 'multer';
import { parseMetaAdsCsv }    from '../../services/metaAdsParser.js';
import { analyzeCampaignData } from '../../agents/orchestrator.js';
import { prisma }              from '../../lib/prisma.js';
import { logger }              from '../../utils/logger.js';
import { randomUUID }          from 'crypto';

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['text/csv', 'application/vnd.ms-excel', 'application/csv'].includes(file.mimetype)
            || /\.csv$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only .csv files are accepted'), ok);
  },
});

const MAX_ROWS_ANALYZE = 20;
const MAX_ROWS         = 100;

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
  if (c.roas  > 0) parts.push(`ROAS ${c.roas}x`);
  if (c.ctr   > 0) parts.push(`CTR ${c.ctr}%`);
  if (c.frequency > 0) parts.push(`Frequency ${c.frequency}`);
  if (c.spend > 0) parts.push(`Spend ${c.spend} EGP`);
  return parts.length > 0 ? parts.join(' | ') : 'No metrics available';
}

export function mountUploadRoutes(router) {
  router.post('/upload-csv', upload.single('campaignData'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded — expected field "campaignData"' });

    const mode = req.query.mode;
    logger.info({ filename: req.file.originalname, size: req.file.size, mode, userId: req.userId, workspaceId: req.workspaceId }, '[CSV_PIPELINE] CSV_RECEIVED');

    if (mode === 'analyze') {
      logger.info({ filename: req.file.originalname, size: req.file.size, userId: req.userId }, '[campaigns/upload-csv] ANALYZE mode');

      const { campaigns: parsed, errors: parseErrors, stats } = parseMetaAdsCsv(req.file.buffer);
      if (!parsed || parsed.length === 0) return res.status(400).json({ success: false, error: 'No valid campaigns found in CSV', stats, errors: parseErrors || [] });
      if (parsed.length > MAX_ROWS_ANALYZE) return res.status(400).json({ success: false, error: `CSV has ${parsed.length} rows. Maximum for analysis mode is ${MAX_ROWS_ANALYZE}.`, hint: 'Split your export into smaller date ranges or use default mode for bulk DB storage.' });

      const results = await Promise.allSettled(
        parsed.map(async (c) => {
          const dataForClaude = {
            campaignId: c.campaignId, campaignName: c.campaignName, adsetName: c.adsetName,
            metrics: { spend: c.spend, impressions: c.impressions, results: c.results, ctr: c.ctr, cpc: c.cpc, roas: c.roas, frequency: c.frequency, reach: c.reach, costPerResult: c.costPerResult },
            deliveryStatus: c.deliveryStatus, rawRecord: c.rawRecord,
          };
          const decision = await analyzeCampaignData(dataForClaude, 'csv');
          decision.campaignId = c.campaignId;
          decision.campaignName = c.campaignName;
          decision.adsetName = c.adsetName;
          decision.sourceMetrics = { spend: c.spend ?? 0, impressions: c.impressions ?? 0, results: c.results ?? 0, ctr: c.ctr ?? 0, cpc: c.cpc ?? 0, roas: c.roas ?? 0, frequency: c.frequency ?? 0, reach: c.reach ?? 0, costPerResult: c.costPerResult ?? 0 };
          return decision;
        }),
      );

      const decisions = [];
      const errors    = [];
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') { decisions.push(result.value); }
        else {
          logger.error({ err: result.reason?.message, campaignId: parsed[idx].campaignId }, '[campaigns/upload-csv] orchestrator.analyzeCampaignData failed');
          errors.push({ campaign: parsed[idx].campaignName, error: result.reason?.message || 'Analysis failed' });
        }
      });

      logger.info({ userId: req.userId, analyzed: decisions.length, errors: errors.length, totalRows: parsed.length }, '[campaigns/upload-csv] ANALYZE mode complete');
      return res.json({ success: true, mode: 'analyze', decisions, errors, stats: { uploaded: stats.total_rows, analyzed: decisions.length, failed: errors.length } });
    }

    const workspaceId = req.workspaceId;
    if (!workspaceId) return res.status(401).json({ error: 'Workspace not found.', hint: 'Complete onboarding to create your workspace, then upload again.', userId: req.userId || null });

    logger.info({ filename: req.file.originalname, size: req.file.size, workspaceId }, '[campaigns/upload-csv] DB WRITE mode');

    const { campaigns: parsed, errors: parseErrors, stats } = parseMetaAdsCsv(req.file.buffer);
    logger.info({ stats, parseErrors, totalRows: parsed?.length || 0 }, '[CSV_PIPELINE] CSV_PARSED');

    // ── Enhanced Debug Logging (PR #44) ───────────────────────────
    console.log('\n========== CSV UPLOAD DEBUG ==========');
    console.log('📊 ROWS PARSED:', {
      totalRows: stats?.total_rows || 0,
      validCampaigns: parsed?.length || 0,
      parseErrors: parseErrors?.length || 0,
      workspaceId,
    });

    // Log first campaign metrics to verify parsing (diagnostic aid)
    if (parsed && parsed.length > 0) {
      console.log('🔬 FIRST ROW NORMALIZED:', {
        campaignId: parsed[0].campaignId,
        campaignName: parsed[0].campaignName,
        spend: parsed[0].spend,
        impressions: parsed[0].impressions,
        ctr: parsed[0].ctr,
        roas: parsed[0].roas,
        frequency: parsed[0].frequency,
      });
      logger.info({
        sample: {
          campaignId: parsed[0].campaignId,
          spend: parsed[0].spend,
          impressions: parsed[0].impressions,
          ctr: parsed[0].ctr,
          roas: parsed[0].roas,
        }
      }, '[CSV_PIPELINE] ROWS_NORMALIZED - sample row');
    }

    if (!parsed || parsed.length === 0) return res.status(400).json({ success: false, error: 'Upload succeeded but no campaigns were created. The CSV may be empty or invalid.', stats, errors: parseErrors ? parseErrors.slice(0, 5) : [], hint: ['Expected format: Meta Ads Manager CSV export.', 'Required columns: "Campaign name", "Ad set name", "Amount spent (EGP)", "Impressions".', 'Make sure you are exporting at campaign or ad set level.', 'Row 2 (summary totals) is automatically skipped.'] });
    if (parsed.length > MAX_ROWS) return res.status(400).json({ success: false, error: `CSV has ${parsed.length} rows. Maximum is ${MAX_ROWS}.`, hint: 'Split your export into smaller date ranges and re-upload.' });

    const errors      = [];
    const campaignIds = [];
    let   processed   = 0;
    let   alertsCreated = 0;

    // Upsert all campaign states concurrently (avoids N+1)
    const upsertResults = await Promise.allSettled(
      parsed.map(c => {
        const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
        const stage       = classifyStage(c.roas, c.ctr, c.frequency);
        return prisma.campaignState.upsert({
          where:  { campaignId: c.campaignId },
          update: { stage, healthScore, lastAnalysis: new Date() },
          create: { campaignId: c.campaignId, workspaceId, stage, healthScore, lastAnalysis: new Date() },
        }).then(cs => ({ c, cs, stage }));
      }),
    );

    // Collect successful upserts into action records
    const actionData = [];
    upsertResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const { c, cs, stage } = result.value;
        actionData.push({
          workspaceId,
          campaignId:     cs.campaignId,
          idempotencyKey: `meta:${cs.campaignId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
          status:         'PENDING',
          payload: {
            kind: 'lumi.csv-data', source: 'csv-upload', platform: 'META',
            campaignName: c.campaignName, adsetName: c.adsetName,
            priority: stage === 'DYING' ? 'HIGH' : stage === 'FATIGUED' ? 'MEDIUM' : 'LOW',
            verdict:  stage === 'DYING' ? 'KILL' : stage === 'SCALING' ? 'SCALE' : 'HOLD',
            rootCause: stage === 'DYING' ? 'CRITICAL_PERFORMANCE_DECLINE' : stage === 'FATIGUED' ? 'CREATIVE_FATIGUE' : 'SCALING_OPPORTUNITY',
            rationale: buildRationale(c),
            metrics: { spend: c.spend, impressions: c.impressions, results: c.results, frequency: c.frequency, reach: c.reach, ctr: c.ctr, cpc: c.cpc, roas: c.roas, costPerResult: c.costPerResult },
            deliveryStatus: c.deliveryStatus,
            rawRecord: c.rawRecord,
          },
        });
        campaignIds.push(cs.campaignId);
        processed++;
      } else {
        logger.warn({ err: result.reason?.message, campaignId: parsed[i].campaignId }, '[campaigns/upload-csv] row failed');
        errors.push({ campaign: parsed[i].campaignName, error: result.reason?.message || 'Unknown error' });
      }
    });

    // Batch insert all action records in a single query
    if (actionData.length > 0) {
      await prisma.action.createMany({ data: actionData });
      alertsCreated = actionData.length;
      const totalSpend = actionData.reduce((sum, a) => sum + (a.payload?.metrics?.spend || 0), 0);
      logger.info({
        workspaceId,
        campaignsPersisted: processed,
        actionsPersisted: alertsCreated,
        totalSpend,
      }, '[CSV_PIPELINE] CAMPAIGNS_PERSISTED');

      // ── Enhanced Debug Logging (PR #44) ───────────────────────────
      console.log('💾 CAMPAIGNS CREATED:', {
        campaignsPersisted: processed,
        actionsPersisted: alertsCreated,
        totalSpend: `$${totalSpend.toFixed(2)}`,
        workspaceId,
      });
    }

    logger.info({ workspaceId, processed, alertsCreated, errors: errors.length }, '[CSV_PIPELINE] PIPELINE_COMPLETE');
    console.log('✅ PIPELINE COMPLETE:', {
      uploaded: stats.total_rows,
      processed,
      alertsCreated,
      errors: errors.length,
    });
    console.log('======================================\n');

    return res.json({ uploaded: stats.total_rows, processed, alerts_created: alertsCreated, campaign_ids: campaignIds, errors });
  });
}
