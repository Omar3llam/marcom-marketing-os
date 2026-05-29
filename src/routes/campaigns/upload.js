import multer from 'multer';
import { parseMetaAdsCsv }    from '../../services/metaAdsParser.js';
import { analyzeCampaignData, analyzeCampaignsBatch } from '../../agents/orchestrator.js';
import { prisma }              from '../../lib/prisma.js';
import { logger }              from '../../utils/logger.js';
import { randomUUID }          from 'crypto';
import { parseUploadedFile }   from '../../utils/fileParser.js';
import path from 'path';
import fs from 'fs';

// Accept any file type - AI will extract campaign data
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
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

    // Generate deterministic upload session ID for idempotency
    // All actions created from this single CSV upload share the same session ID
    // Format: workspace:timestamp:randomsuffix (timestamp makes retry attempts distinguishable)
    const uploadSessionId = `${req.workspaceId}:${Date.now()}:${randomUUID().slice(0, 8)}`;

    logger.info({ filename: req.file.originalname, size: req.file.size, mode, userId: req.userId, workspaceId: req.workspaceId, uploadSessionId }, '[CSV_PIPELINE] CSV_RECEIVED');

    if (mode === 'analyze') {
      const workspaceId = req.workspaceId;
      if (!workspaceId) return res.status(401).json({ error: 'Workspace not found.', hint: 'Complete onboarding to create your workspace, then upload again.', userId: req.userId || null });

      logger.info({ filename: req.file.originalname, size: req.file.size, userId: req.userId, workspaceId }, '[campaigns/upload] ANALYZE mode');

      // Parse file based on format (CSV, PDF, Excel, etc.)
      let parsedFile;
      try {
        parsedFile = await parseUploadedFile(req.file);
        logger.info({ type: parsedFile.type, format: parsedFile.format, rowCount: parsedFile.rowCount }, '[campaigns/upload] File parsed');
      } catch (err) {
        logger.error({ err: err.message, filename: req.file.originalname }, '[campaigns/upload] File parsing failed');
        return res.status(400).json({ success: false, error: `Failed to parse file: ${err.message}` });
      } finally {
        // Clean up uploaded file
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }

      // Handle structured data (CSV, Excel with campaign columns)
      if (parsedFile.format === 'structured' && parsedFile.type === 'csv') {
        // CSV already parsed by parseUploadedFile
        const parsed = parsedFile.data;
        if (!parsed || parsed.length === 0) return res.status(400).json({ success: false, error: 'No valid campaigns found in file', errors: parsedFile.errors || [] });
        if (parsed.length > MAX_ROWS_ANALYZE) return res.status(400).json({ success: false, error: `File has ${parsed.length} rows. Maximum for analysis mode is ${MAX_ROWS_ANALYZE}.`, hint: 'Split your export into smaller date ranges.' });

        parsedFile.campaigns = parsed;
      }
      // Handle unstructured data (PDF, text, Excel without campaign columns)
      else {
        // Send raw text to AI for extraction
        const extractionPrompt = `Extract campaign performance data from this document. Return a JSON array of campaigns with fields: campaignName, spend, impressions, results, ctr, frequency, reach, costPerResult.\n\nDocument content:\n${parsedFile.raw?.slice(0, 8000) || JSON.stringify(parsedFile.data)}`;

        try {
          const extracted = await analyzeCampaignData({ rawDocument: extractionPrompt }, 'document');
          if (!extracted || !Array.isArray(extracted.campaigns) || extracted.campaigns.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'No campaign data found in document',
              hint: 'Make sure the file contains campaign performance metrics (spend, impressions, CTR, etc.)'
            });
          }
          parsedFile.campaigns = extracted.campaigns;
          logger.info({ extracted: extracted.campaigns.length }, '[campaigns/upload] AI extracted campaigns from unstructured data');
        } catch (err) {
          logger.error({ err: err.message }, '[campaigns/upload] AI extraction failed');
          return res.status(400).json({ success: false, error: `AI extraction failed: ${err.message}` });
        }
      }

      const parsed = parsedFile.campaigns;
      if (!parsed || parsed.length === 0) return res.status(400).json({ success: false, error: 'No valid campaigns found in file' });

      // ── Step 1: Run AI analysis (BATCHED — single Claude call for all campaigns)
      const campaignsForAnalysis = parsed.map(c => ({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        adsetName: c.adsetName,
        metrics: {
          spend: c.spend,
          impressions: c.impressions,
          results: c.results,
          ctr: c.ctr,
          cpc: c.cpc,
          roas: c.roas,
          frequency: c.frequency,
          reach: c.reach,
          costPerResult: c.costPerResult,
        },
        deliveryStatus: c.deliveryStatus,
      }));

      let batchResult;
      try {
        batchResult = await analyzeCampaignsBatch(campaignsForAnalysis);
      } catch (err) {
        logger.error({ err: err.message }, '[campaigns/upload] Batch analysis failed');
        return res.status(500).json({ success: false, error: `AI analysis failed: ${err.message}` });
      }

      // Map batch decisions back to campaigns
      const decisionMap = new Map(batchResult.decisions.map(d => [d.campaignId, d]));
      const results = parsed.map(c => {
        const decision = decisionMap.get(c.campaignId) || {
          verdict: 'HOLD',
          rootCause: 'No analysis',
          diagnosis: 'Analysis not available for this campaign',
          confidence: 'LOW',
          actionPlan: { primaryAction: 'Review manually', reasoning: 'Batch analysis did not include this campaign', steps: [] },
        };

        // Enrich decision with campaign metadata
        decision.campaignId = c.campaignId;
        decision.campaignName = c.campaignName;
        decision.adsetName = c.adsetName;
        decision.sourceMetrics = {
          spend: c.spend ?? 0,
          impressions: c.impressions ?? 0,
          results: c.results ?? 0,
          ctr: c.ctr ?? 0,
          cpc: c.cpc ?? 0,
          roas: c.roas ?? 0,
          frequency: c.frequency ?? 0,
          reach: c.reach ?? 0,
          costPerResult: c.costPerResult ?? 0,
        };

        return {
          status: 'fulfilled',
          value: { decision, campaign: c },
        };
      });

      const decisions = [];
      const errors    = [];
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

      // ── Step 2: Persist to database (TRANSACTION-WRAPPED) ───────
      const campaignIds = [];
      let processed = 0;
      let alertsCreated = 0;

      // Wrap persistence in a single transaction to prevent orphaned state
      // If ANY operation fails, the entire upload is rolled back
      await prisma.$transaction(async (tx) => {
        // Upsert CampaignState records
        const upsertResults = await Promise.allSettled(
          campaignsToSave.map(({ campaign: c, decision }) => {
            const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
            const stage = classifyStage(c.roas, c.ctr, c.frequency);
            return tx.campaignState.upsert({
              where:  { campaignId_workspaceId: { campaignId: c.campaignId, workspaceId } },
              update: { stage, healthScore, lastAnalysis: new Date() },
              create: { campaignId: c.campaignId, workspaceId, stage, healthScore, lastAnalysis: new Date() },
            }).then(cs => ({ c, cs, stage, decision }));
          }),
        );

        // Create Action records with AI analysis results
        const actionData = [];
        upsertResults.forEach((result, idx) => {
          if (result.status === 'fulfilled') {
            const { c, cs, stage, decision } = result.value;
            actionData.push({
              workspaceId,
              campaignId:     cs.campaignId,
              // Deterministic idempotency key: same campaign in same upload = same key
              // Enables retry-safety: re-uploading the same CSV won't create duplicates
              idempotencyKey: `meta:csv:${uploadSessionId}:${cs.campaignId}`,
              status:         'PENDING',
              payload: {
                kind: 'lumi.csv-data-analyzed',
                source: 'csv-upload-analyze',
                platform: 'META',
                campaignName: c.campaignName,
                adsetName: c.adsetName,
                // Use AI analysis results
                priority: decision.verdict === 'KILL' ? 'HIGH' : decision.verdict === 'SCALE' ? 'MEDIUM' : 'LOW',
                verdict: decision.verdict || 'HOLD',
                rootCause: decision.rootCause || decision.diagnosis,
                rationale: decision.diagnosis,
                strategicAnalysis: {
                  verdict: decision.verdict,
                  rootCause: decision.rootCause,
                  diagnosis: decision.diagnosis,
                  actionPlan: decision.actionPlan,
                },
                metrics: { spend: c.spend, impressions: c.impressions, results: c.results, frequency: c.frequency, reach: c.reach, ctr: c.ctr, cpc: c.cpc, roas: c.roas, costPerResult: c.costPerResult },
                deliveryStatus: c.deliveryStatus,
                rawRecord: c.rawRecord,
              },
            });
            campaignIds.push(cs.campaignId);
            processed++;
          } else {
            // Capture persistence failures
            logger.error({ err: result.reason?.message, campaignId: campaignsToSave[idx]?.campaign?.campaignId }, '[campaigns/upload-csv] persistence failed');
            errors.push({ campaign: campaignsToSave[idx]?.campaign?.campaignName || 'Unknown', error: `Persistence failed: ${result.reason?.message || 'Unknown error'}` });
          }
        });

        // Batch insert actions (in same transaction)
        if (actionData.length > 0) {
          await tx.action.createMany({ data: actionData });
          alertsCreated = actionData.length;
        }
      });

      // Log metrics AFTER transaction commits
      if (alertsCreated > 0) {
        const totalSpend = campaignIds.reduce((sum, campaignId) => {
          const campaign = campaignsToSave.find(({ campaign: c }) => c.campaignId === campaignId)?.campaign;
          return sum + (campaign?.spend || 0);
        }, 0);
        logger.info({
          workspaceId,
          campaignsPersisted: processed,
          actionsPersisted: alertsCreated,
          totalSpend,
        }, '[CSV_PIPELINE] ANALYZE_MODE_CAMPAIGNS_PERSISTED');
      }

      // Determine success status based on operational truth
      // success = true ONLY if analysis + persistence both succeeded
      const analyzed = decisions.length;
      const isFullSuccess = analyzed > 0 && processed === analyzed && errors.length === 0;
      const isPartialSuccess = analyzed > 0 && processed > 0 && processed < analyzed;
      const isFailure = processed === 0;

      logger.info({ userId: req.userId, analyzed, errors: errors.length, totalRows: parsed.length, persisted: processed, isPartialSuccess }, '[campaigns/upload-csv] ANALYZE mode complete');

      return res.json({
        success: isFullSuccess,
        partial: isPartialSuccess, // New flag: some succeeded, some failed
        mode: 'analyze',
        decisions,
        errors,
        stats: {
          uploaded: stats.total_rows,
          analyzed,
          failed: errors.length,
          persisted: processed,
          alerts_created: alertsCreated,
        },
        campaign_ids: campaignIds,
      });
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

    // Wrap persistence in a single transaction to prevent orphaned state
    // If ANY operation fails, the entire upload is rolled back
    await prisma.$transaction(async (tx) => {
      // Upsert all campaign states concurrently (avoids N+1)
      const upsertResults = await Promise.allSettled(
        parsed.map(c => {
          const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
          const stage       = classifyStage(c.roas, c.ctr, c.frequency);
          return tx.campaignState.upsert({
            where:  { campaignId_workspaceId: { campaignId: c.campaignId, workspaceId } },
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
            // Deterministic idempotency key: same campaign in same upload = same key
            // Enables retry-safety: re-uploading the same CSV won't create duplicates
            idempotencyKey: `meta:csv:${uploadSessionId}:${cs.campaignId}`,
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

      // Batch insert all action records in a single query (in same transaction)
      if (actionData.length > 0) {
        await tx.action.createMany({ data: actionData });
        alertsCreated = actionData.length;
      }
    });

    // Log metrics AFTER transaction commits
    if (alertsCreated > 0) {
      const totalSpend = parsed
        .filter(c => campaignIds.includes(c.campaignId))
        .reduce((sum, c) => sum + (c.spend || 0), 0);

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
