// ============================================================
// MARCOM — Campaigns Router  (/api/campaigns)
//
// POST /api/campaigns/data-inject
//   Accepts either a raw CSV string or triggers a live Meta API
//   pull for the active project. Runs Mode 5 analysis internally
//   and returns the structured JSON response so the frontend can
//   render it with renderCampaign() immediately.
//
// POST /api/campaigns/fetch-meta
//   Fetches live insights from Meta Ads API using stored credentials,
//   then runs Mode 5 analysis. Returns same shape as data-inject.
// ============================================================
import { Router }          from 'express';
import multer              from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import { getOrCreateSession, updateSession } from '../utils/sessionStore.js';
import { getCredential }   from '../models/credential.js';
import { getProjectById }  from '../models/project.js';
import {
  fetchCampaignInsights,
  formatInsightsForPrompt,
} from '../services/metaAdsService.js';
import { runMode5 }        from '../modes/mode5-campaign.js';
import { classifyCampaignStage } from '../services/campaignClassifier.js';
import { generateAlerts }        from '../services/alertGenerator.js';
import { parseSmartCSV }        from '../utils/csvParser.js';
import { prisma }          from '../lib/prisma.js';
import { logger }          from '../utils/logger.js';
import { randomUUID }      from 'crypto';

export const campaignsRouter = Router();

// ── CSV upload — memoryStorage so Render's ephemeral disk is bypassed ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['text/csv', 'application/vnd.ms-excel', 'application/csv'].includes(file.mimetype)
            || /\.csv$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only .csv files are accepted'), ok);
  },
});

const MAX_CSV_CHARS  = 40_000;   // Hard cap so mode5 prompt stays sane
const MAX_HISTORY    = 40;

// ── SHARED: run analysis and return serialisable result ──────
async function runCampaignAnalysis(session, dataText) {
  const AUTO_PROMPT =
    `New campaign metrics loaded. Perform an executive analysis on Spend, CPA, CTR, and Conversions. `
    + `Provide 2 actionable strategic decisions to optimize the campaign.\n\n`
    + `--- CAMPAIGN DATA ---\n${dataText}\n--- END DATA ---`;

  const conversationHistory = session.conversation_history.slice(-MAX_HISTORY);
  conversationHistory.push({
    role: 'user',
    content: AUTO_PROMPT,
    timestamp: new Date().toISOString(),
  });

  const result = await runMode5(session, AUTO_PROMPT, conversationHistory);

  conversationHistory.push({
    role: 'assistant',
    content: result.aiResponse,
    mode: 5,
    service: result.currentService || 0,
    timestamp: new Date().toISOString(),
  });

  // Persist the session turn
  await updateSession(session.recordId, session.user_id, {
    current_mode:    5,
    current_section: result.currentSection ?? session.current_section,
    current_service: result.currentService ?? 0,
    context_locked:  result.contextLocked  ?? session.context_locked,
    context_summary: result.contextSummary || session.context_summary,
    conversation_history: conversationHistory.slice(-MAX_HISTORY),
    service_history:      Array.isArray(result.serviceHistory) ? result.serviceHistory
                                : (Array.isArray(session.service_history) ? session.service_history : []),
    campaign_analysis_log: result.campaignLog || '',
    status: 'active',
    last_updated: new Date().toISOString(),
  });

  return {
    status:          'ok',
    session_id:      session.session_id,
    message:         result.aiResponse,
    current_mode:    5,
    current_service: result.currentService || 0,
  };
}

// ── POST /api/campaigns/data-inject ─────────────────────────
// Body: { sessionId?, projectId, csvData }
// csvData is the raw text of the uploaded CSV file.
campaignsRouter.post('/data-inject', async (req, res) => {
  const userId    = req.userId;
  const { sessionId, projectId, csvData } = req.body;

  if (!csvData || typeof csvData !== 'string' || !csvData.trim()) {
    return res.status(400).json({ status: 'error', message: 'csvData is required' });
  }
  if (!projectId) {
    return res.status(400).json({ status: 'error', message: 'projectId is required' });
  }

  try {
    // Validate project ownership
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // Load or create session — always scoped to userId
    const session = await getOrCreateSession(sessionId || null, userId);

    // Inject project context if session is fresh
    if (!session.context_summary && project.context) {
      session.context_summary = project.context;
      session.context_locked  = true;
    }
    // Stamp project_id so sidebar query can find this session
    session.user_id    = userId;
    session.project_id = projectId;

    const truncated = csvData.trim().slice(0, MAX_CSV_CHARS);
    const dataText  = `[CSV CAMPAIGN DATA]\n${truncated}`;

    const payload = await runCampaignAnalysis(session, dataText);
    logger.info({ userId, projectId, sessionId: session.session_id }, '[campaigns] CSV inject complete');
    return res.json(payload);
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[campaigns] data-inject error');
    return res.status(500).json({ status: 'error', message: 'Campaign analysis failed' });
  }
});

// ── POST /api/campaigns/fetch-meta ──────────────────────────
// Body: { sessionId?, projectId, datePreset? }
// Pulls live campaign insights from Meta Ads using stored credentials,
// then runs Mode 5 analysis. Returns same shape as data-inject.
campaignsRouter.post('/fetch-meta', async (req, res) => {
  const userId  = req.userId;
  const { sessionId, projectId, datePreset = 'last_30d' } = req.body;

  if (!projectId) {
    return res.status(400).json({ status: 'error', message: 'projectId is required' });
  }

  try {
    // Load credential
    const cred = await getCredential(userId, projectId, 'meta_ads');
    if (!cred || !cred.accessToken) {
      return res.status(404).json({ status: 'error', message: 'No Meta Ads credential found for this project. Connect Meta first.' });
    }
    if (!cred.accountId) {
      return res.status(400).json({ status: 'error', message: 'No Ad Account ID stored. Reconnect Meta Ads to auto-detect your account.' });
    }

    // Validate project ownership
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // Fetch live data from Meta
    logger.info({ userId, projectId, accountId: cred.accountId, datePreset }, '[campaigns] Fetching Meta insights');
    const insights = await fetchCampaignInsights(cred.accessToken, cred.accountId, datePreset);
    const dataText = formatInsightsForPrompt(insights, cred.accountId);

    // Load or create session
    const session = await getOrCreateSession(sessionId || null, userId);
    if (!session.context_summary && project.context) {
      session.context_summary = project.context;
      session.context_locked  = true;
    }
    session.user_id    = userId;
    session.project_id = projectId;

    const payload = await runCampaignAnalysis(session, dataText);
    logger.info({ userId, projectId, campaignCount: insights.length }, '[campaigns] Meta fetch + analysis complete');
    return res.json(payload);
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[campaigns] fetch-meta error');
    // Detect token expiry errors from Meta SDK
    if (err.message?.includes('OAuthException') || err.message?.includes('token') || err.message?.includes('190')) {
      return res.status(401).json({ status: 'error', message: 'Meta access token expired. Please reconnect Meta Ads.' });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to fetch Meta campaign data' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/campaigns/upload-csv
// ─────────────────────────────────────────────────────────────
// Multipart form: field "campaignData" → .csv file (≤10 MB).
// Parses Meta / Google Ads exports, normalizes, classifies into
// CampaignState rows, and seeds Action alerts. Workspace-scoped.
//
// Response: { uploaded, processed, alerts_created, errors }
// ─────────────────────────────────────────────────────────────
campaignsRouter.post('/upload-csv', upload.single('campaignData'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded — expected field "campaignData"' });
  }

  // workspaceId resolution: prefer the JWT path (set by requireJwt),
  // fall back to a deterministic per-user workspace id when only the
  // legacy Clerk middleware is active. Belt-and-braces for the cutover.
  const workspaceId = req.workspaceId || (req.userId ? `clerk:${req.userId}` : null);
  if (!workspaceId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  let rows;
  try {
    rows = csvParse(req.file.buffer, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
      bom:              true,
    });
  } catch (err) {
    logger.warn({ err: err.message }, '[campaigns/upload-csv] CSV parse failed');
    return res.status(422).json({ error: 'Could not parse CSV', detail: err.message });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(422).json({ error: 'CSV contained no data rows' });
  }

  const platform = detectPlatform(req.file.originalname || '');
  const errors   = [];
  let processed  = 0;
  let alertsCreated = 0;

  // ── Smart CSV parsing with fuzzy headers, garbage filtering, graceful defaults ──
  const smartRows = parseSmartCSV(rows, platform);
  if (smartRows.length === 0) {
    logger.warn({ workspaceId, uploaded: rows.length }, '[campaigns/upload-csv] no valid rows after smart parse');
    return res.json({
      uploaded:       rows.length,
      processed:      0,
      alerts_created: 0,
      errors:         [{ error: 'No valid campaign rows found — all rows were filtered as garbage or missing campaign names' }],
    });
  }

  for (const normalized of smartRows) {
    try {  // normalized is already cleaned by parseSmartCSV, ready for stage classification

      normalized.stage = classifyCampaignStage(normalized.metrics);
      const alerts     = generateAlerts(normalized);

      // ── Upsert CampaignState ─────────────────────────────────
      const cs = await prisma.campaignState.upsert({
        where:  { campaignId: normalized.campaignId },
        update: {
          stage:        normalized.stage,
          healthScore:  computeHealthScore(normalized.metrics),
          lastAnalysis: new Date(),
        },
        create: {
          campaignId:   normalized.campaignId,
          workspaceId,
          stage:        normalized.stage,
          healthScore:  computeHealthScore(normalized.metrics),
          lastAnalysis: new Date(),
        },
      });

      // ── Seed PENDING Action rows for each alert ──────────────
      for (const alert of alerts) {
        await prisma.action.create({
          data: {
            workspaceId,
            campaignId:     cs.campaignId,
            idempotencyKey: `csv:${cs.campaignId}:${alert.verdict}:${Date.now()}:${randomUUID().slice(0, 8)}`,
            status:         'PENDING',
            payload: {
              kind:        `lumi.${alert.verdict.toLowerCase()}`,
              priority:    alert.priority,
              verdict:     alert.verdict,
              rootCause:   alert.rootCause,
              rationale:   alert.rationale,
              campaignName: normalized.campaignName,
              platform:    normalized.platform,
              metrics:     normalized.metrics,
              dateRange:   normalized.dateRange,
              source:      'csv-upload',
            },
          },
        });
        alertsCreated++;
      }

      processed++;
    } catch (err) {
      logger.warn({ err: err.message, campaign: normalized.campaignName || '?' },
        '[campaigns/upload-csv] row processing failed');
      errors.push({ row: normalized.campaignName ?? '?', error: err.message });
    }
  }

  logger.info({ workspaceId, uploaded: rows.length, processed, alertsCreated, errors: errors.length },
    '[campaigns/upload-csv] complete');

  return res.json({
    uploaded:        rows.length,
    processed,
    alerts_created:  alertsCreated,
    errors,
  });
});

// ── /me/context — light user-context endpoints (B3) ──────────
// Onboarding writes here; the React router uses GET to gate /app
// behind a non-null context value.
campaignsRouter.get('/me/context', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { clerkId: userId }] },
      select: { context: true },
    }).catch(() => null);
    return res.json({ context: user?.context ?? null });
  } catch (err) {
    logger.warn({ err: err.message }, '[campaigns/me/context] read failed');
    return res.json({ context: null });
  }
});

campaignsRouter.put('/me/context', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const ctx = req.body?.context;
  if (!ctx || typeof ctx !== 'object') {
    return res.status(400).json({ error: 'context object required in body' });
  }

  const email = req.body?.email || `${userId}@unknown.local`;
  const workspaceName = req.body?.workspaceName || 'My Workspace';

  try {
    // ── Two-step upsert (resilient to orphaned User rows) ────
    // We can't rely on a single nested upsert because two failure
    // modes coexist:
    //   A. User row exists but lacks a Workspace (data drift)
    //   B. User row doesn't exist at all (first onboarding)
    // Doing the workspace creation outside the upsert handles both.
    let existing = await prisma.user.findUnique({
      where:  { clerkId: userId },
      select: { id: true, workspaceId: true },
    });

    if (!existing) {
      // Create workspace + user atomically
      const created = await prisma.user.create({
        data: {
          clerkId:   userId,
          email,
          context:   ctx,
          workspace: { create: { name: workspaceName } },
        },
        select: { id: true, workspaceId: true, context: true },
      });
      logger.info({ userId, userRowId: created.id, workspaceId: created.workspaceId },
        '[campaigns/me/context] created new user + workspace');
      return res.json({ ok: true, user: created, created: true });
    }

    // User row exists — just update context. If by some accident
    // workspaceId is null/missing, repair it inline.
    let workspaceId = existing.workspaceId;
    if (!workspaceId) {
      const ws = await prisma.workspace.create({ data: { name: workspaceName } });
      workspaceId = ws.id;
      await prisma.user.update({
        where: { id: existing.id },
        data:  { workspaceId },
      });
      logger.warn({ userId, repairedWorkspaceId: workspaceId },
        '[campaigns/me/context] repaired orphaned user (no workspace)');
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data:  { context: ctx },
      select: { id: true, workspaceId: true, context: true },
    });
    return res.json({ ok: true, user: updated, created: false });
  } catch (err) {
    // Verbose logging — Prisma errors carry a `code` (P2002, P2025,
    // etc.), `meta.target` (the column or constraint), and a long
    // `message` that's the most useful single line. Surface all of
    // it to Render's log stream and to the client (so the dev sees
    // it in DevTools without us hunting through deploy logs).
    const detail = {
      name:    err?.name,
      code:    err?.code,
      meta:    err?.meta,
      message: err?.message,
    };
    // eslint-disable-next-line no-console
    console.error('[campaigns/me/context] Prisma write failed:', JSON.stringify(detail, null, 2));
    logger.error(detail, '[campaigns/me/context] write failed');
    return res.status(500).json({
      error:  'Could not save context',
      code:   err?.code ?? null,
      detail: err?.message ?? 'Unknown error',
      hint:   err?.code === 'P2021' || /does not exist/i.test(err?.message || '')
        ? 'The User table or context column is missing. Build needs to run prisma db push against DATABASE_URL.'
        : null,
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────

function detectPlatform(filename) {
  const f = (filename || '').toLowerCase();
  if (/google|gads|adwords/.test(f)) return 'GOOGLE';
  if (/meta|facebook|fb|instagram|ig/.test(f)) return 'META';
  return 'META';
}

function computeHealthScore(m = {}) {
  const roas = Math.max(0, Math.min(5, m.roas ?? 0)) / 5;
  const ctr  = Math.max(0, Math.min(5, m.ctr  ?? 0)) / 5;
  const freq = 1 - Math.min(1, Math.max(0, ((m.frequency ?? 0) - 1.5) / 4));
  return Math.round(((roas * 0.5) + (ctr * 0.3) + (freq * 0.2)) * 100) / 100;
}
