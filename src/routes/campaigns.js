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
import { getOrCreateSession, updateSession } from '../utils/sessionStore.js';
import { getCredential }   from '../models/credential.js';
import { getProjectById }  from '../models/project.js';
import {
  fetchCampaignInsights,
  formatInsightsForPrompt,
} from '../services/metaAdsService.js';
import { runMode5 }        from '../modes/mode5-campaign.js';
import { parseMetaAdsCsv }      from '../services/metaAdsParser.js';
import { prisma }          from '../lib/prisma.js';
import { logger }          from '../utils/logger.js';
import { contextGuard }    from '../middleware/contextGuard.js';
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
async function runCampaignAnalysis(session, dataText, userContext) {
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

  const result = await runMode5(session, AUTO_PROMPT, conversationHistory, userContext);

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
// PROTECTED: contextGuard ensures user has complete workspace context
campaignsRouter.post('/data-inject', contextGuard, async (req, res) => {
  const userId    = req.userId;
  const userContext = req.context;
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

    const payload = await runCampaignAnalysis(session, dataText, userContext);
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
// Parses Meta Ads Manager exports (ad-set level), normalises into
// CampaignState rows, and seeds Action alerts. Workspace-scoped.
//
// Response: { uploaded, processed, alerts_created, campaign_ids, errors }
// ─────────────────────────────────────────────────────────────
campaignsRouter.post('/upload-csv', upload.single('campaignData'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded — expected field "campaignData"' });
  }

  // workspaceId MUST be a real UUID from the User → Workspace FK chain.
  // req.workspaceId is populated by firebaseAuthMiddleware (Prisma lookup).
  // Falling back to a non-UUID string causes every prisma.upsert to fail
  // with "invalid input syntax for type uuid" — do NOT do that.
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    return res.status(401).json({
      error:   'Workspace not found.',
      hint:    'Complete onboarding to create your workspace, then upload again.',
      userId:  req.userId || null,
    });
  }

  logger.info({
    filename:    req.file.originalname,
    size:        req.file.size,
    workspaceId,
  }, '[campaigns/upload-csv] received');

  // ── Parse with the Meta-aware parser ─────────────────────────
  const { campaigns: parsed, errors: parseErrors, stats } = parseMetaAdsCsv(req.file.buffer);

  logger.info({ stats, parseErrors }, '[campaigns/upload-csv] parse complete');

  if (!parsed || parsed.length === 0) {
    return res.status(400).json({
      success:  false,
      error:    'Upload succeeded but no campaigns were created. The CSV may be empty or invalid.',
      stats,
      errors:   parseErrors ? parseErrors.slice(0, 5) : [],
      hint: [
        'Expected format: Meta Ads Manager CSV export.',
        'Required columns: "Campaign name", "Ad set name", "Amount spent (EGP)", "Impressions".',
        'Make sure you are exporting at campaign or ad set level.',
        'Row 2 (summary totals) is automatically skipped.',
      ],
    });
  }

  const errors      = [];
  const campaignIds = [];
  let   processed   = 0;
  let   alertsCreated = 0;

  const MAX_ROWS = 100;
  if (parsed.length > MAX_ROWS) {
    return res.status(400).json({
      success: false,
      error: `CSV has ${parsed.length} rows. Maximum is ${MAX_ROWS}.`,
      hint: 'Split your export into smaller date ranges and re-upload.',
    });
  }

  for (const c of parsed) {
    try {
      // ── Upsert CampaignState (stable slug ID → no duplicates) ──
      // Schema fields: campaignId, workspaceId, stage, healthScore, lastAnalysis
      const healthScore = computeHealthScore({ roas: c.roas, ctr: c.ctr, frequency: c.frequency });
      const stage       = classifyStage(c.roas, c.ctr, c.frequency);

      const cs = await prisma.campaignState.upsert({
        where:  { campaignId: c.campaignId },
        update: {
          stage,
          healthScore,
          lastAnalysis: new Date(),
        },
        create: {
          campaignId:   c.campaignId,
          workspaceId,
          stage,
          healthScore,
          lastAnalysis: new Date(),
        },
      });

      // ── Seed PENDING Action with full parsed metrics ────────────
      await prisma.action.create({
        data: {
          workspaceId,
          campaignId:     cs.campaignId,
          idempotencyKey: `meta:${cs.campaignId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
          status:         'PENDING',
          payload: {
            kind:         'lumi.csv-data',
            source:       'csv-upload',
            platform:     'META',
            campaignName: c.campaignName,
            adsetName:    c.adsetName,
            priority:     stage === 'DYING' ? 'HIGH' : stage === 'FATIGUED' ? 'MEDIUM' : 'LOW',
            verdict:      stage === 'DYING'    ? 'KILL'
                        : stage === 'SCALING'  ? 'SCALE'
                        : stage === 'FATIGUED' ? 'HOLD' : 'HOLD',
            rootCause:    stage === 'DYING'    ? 'CRITICAL_PERFORMANCE_DECLINE'
                        : stage === 'FATIGUED' ? 'CREATIVE_FATIGUE'
                        : 'SCALING_OPPORTUNITY',
            rationale:    buildRationale(c),
            metrics: {
              spend:          c.spend,
              impressions:    c.impressions,
              results:        c.results,
              frequency:      c.frequency,
              reach:          c.reach,
              ctr:            c.ctr,
              cpc:            c.cpc,
              roas:           c.roas,
              costPerResult:  c.costPerResult,
            },
            deliveryStatus: c.deliveryStatus,
            // Raw record for Claude context
            rawRecord: c.rawRecord,
          },
        },
      });

      alertsCreated++;
      campaignIds.push(cs.campaignId);
      processed++;
    } catch (err) {
      logger.warn({ err: err.message, campaignId: c.campaignId },
        '[campaigns/upload-csv] row failed');
      errors.push({ campaign: c.campaignName, error: err.message });
    }
  }

  logger.info({ workspaceId, processed, alertsCreated, errors: errors.length },
    '[campaigns/upload-csv] complete');

  return res.json({
    uploaded:        stats.total_rows,
    processed,
    alerts_created:  alertsCreated,
    campaign_ids:    campaignIds,
    errors,
  });
});

// ── /me/context — light user-context endpoints (B3) ──────────
// Onboarding writes here; the React router uses GET to gate /app
// behind a non-null context value.
campaignsRouter.get('/me/context', async (req, res) => {
  const userId = req.userId;  // Firebase UID from firebaseAuth middleware
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    // First try to find by Firebase UID (stored in clerkId column for backward compat)
    // Then fall back to email from Firebase token
    const email = req.user?.email;
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { clerkId: userId },  // Firebase UID stored here
          ...(email ? [{ email }] : []),
        ],
      },
      select: { context: true },
    }).catch(() => null);
    return res.json({ context: user?.context ?? null });
  } catch (err) {
    logger.warn({ err: err.message }, '[campaigns/me/context] read failed');
    return res.json({ context: null });
  }
});

campaignsRouter.put('/me/context', async (req, res) => {
  const userId = req.userId;  // Firebase UID
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
  const ctx = req.body?.context;
  if (!ctx || typeof ctx !== 'object') {
    return res.status(400).json({ error: 'context object required in body' });
  }

  // Get email from Firebase token or request body
  const email = req.user?.email || req.body?.email || `${userId}@unknown.local`;
  const workspaceName = req.body?.workspaceName || 'My Workspace';

  try {
    // ── Robust upsert: find by Firebase UID (stored in clerkId) OR email ────
    // Handles three scenarios:
    //   A. User exists with matching Firebase UID → update context
    //   B. User exists with matching email but no/different Firebase UID → update UID + context
    //   C. User doesn't exist at all → create new user + workspace
    let existing = await prisma.user.findFirst({
      where: {
        OR: [
          { clerkId: userId },  // Firebase UID stored here
          { email },
        ],
      },
      select: { id: true, workspaceId: true, clerkId: true, email: true },
    });

    if (!existing) {
      // No existing user — create workspace + user atomically
      // Store Firebase UID in clerkId column for backward compatibility
      const created = await prisma.user.create({
        data: {
          clerkId:   userId,  // Firebase UID
          email,
          context:   ctx,
          workspace: { create: { name: workspaceName } },
        },
        select: { id: true, workspaceId: true, context: true },
      });
      logger.info({ firebaseUid: userId, userRowId: created.id, workspaceId: created.workspaceId },
        '[campaigns/me/context] created new user + workspace (Firebase)');
      return res.json({ ok: true, user: created, created: true });
    }

    // User exists — update context and ensure clerkId + email are current.
    // If by some accident workspaceId is null/missing, repair it inline.
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

    // Update context + sync Firebase UID/email in case they've changed
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data:  {
        context:  ctx,
        clerkId:  userId,  // Sync Firebase UID (stored in clerkId column)
        email,             // Sync email if it changed
      },
      select: { id: true, workspaceId: true, context: true },
    });
    logger.info({ firebaseUid: userId, userRowId: updated.id, wasUidMissing: !existing.clerkId },
      '[campaigns/me/context] updated existing user (Firebase)');
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

function computeHealthScore(m = {}) {
  const roas = Math.max(0, Math.min(5, m.roas ?? 0)) / 5;
  const ctr  = Math.max(0, Math.min(5, m.ctr  ?? 0)) / 5;
  const freq = 1 - Math.min(1, Math.max(0, ((m.frequency ?? 0) - 1.5) / 4));
  return Math.round(((roas * 0.5) + (ctr * 0.3) + (freq * 0.2)) * 100) / 100;
}

/** Map metrics → CampaignStage enum (must match prisma schema). */
function classifyStage(roas = 0, ctr = 0, frequency = 1) {
  if (roas < 0.5 || (ctr < 0.5 && frequency > 4)) return 'DYING';
  if (roas < 1.0 || frequency > 3 || ctr < 1.0)   return 'FATIGUED';
  if (roas >= 3.0 && ctr >= 2.0 && frequency < 2)  return 'SCALING';
  if (roas >= 1.5 && ctr >= 1.5)                   return 'STABLE';
  return 'TESTING';
}

/** Build a one-line rationale for the Action.payload from parsed metrics. */
function buildRationale(c) {
  const parts = [];
  if (c.roas  > 0) parts.push(`ROAS ${c.roas}x`);
  if (c.ctr   > 0) parts.push(`CTR ${c.ctr}%`);
  if (c.frequency > 0) parts.push(`Frequency ${c.frequency}`);
  if (c.spend > 0) parts.push(`Spend ${c.spend} EGP`);
  return parts.length > 0 ? parts.join(' | ') : 'No metrics available';
}
