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
import { getOrCreateSession, updateSession } from '../utils/sessionStore.js';
import { getCredential }   from '../models/credential.js';
import { getProjectById }  from '../models/project.js';
import {
  fetchCampaignInsights,
  formatInsightsForPrompt,
} from '../services/metaAdsService.js';
import { runMode5 }        from '../modes/mode5-campaign.js';
import { logger }          from '../utils/logger.js';
import { sanitizeMessage } from '../utils/sanitize.js';

export const campaignsRouter = Router();

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
