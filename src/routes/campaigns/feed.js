import { getOrCreateSession, updateSession } from '../../utils/sessionStore.js';
import { getCredential }   from '../../models/credential.js';
import { getProjectById }  from '../../models/project.js';
import {
  fetchCampaignInsights,
  formatInsightsForPrompt,
  normalizeInsightsForAnalysis,
} from '../../services/metaAdsService.js';
import { runMode5 }          from '../../modes/mode5-campaign.js';
import { logger }            from '../../utils/logger.js';
import { contextGuard }      from '../../middleware/contextGuard.js';
import { analyzeCampaignData } from '../../agents/orchestrator.js';

const MAX_CSV_CHARS = 40_000;
const MAX_HISTORY   = 40;

async function runCampaignAnalysis(session, dataText, userContext) {
  const AUTO_PROMPT =
    `New campaign metrics loaded. Perform an executive analysis on Spend, CPA, CTR, and Conversions. `
    + `Provide 2 actionable strategic decisions to optimize the campaign.\n\n`
    + `--- CAMPAIGN DATA ---\n${dataText}\n--- END DATA ---`;

  const conversationHistory = session.conversation_history.slice(-MAX_HISTORY);
  conversationHistory.push({ role: 'user', content: AUTO_PROMPT, timestamp: new Date().toISOString() });

  const result = await runMode5(session, AUTO_PROMPT, conversationHistory, userContext);

  conversationHistory.push({ role: 'assistant', content: result.aiResponse, mode: 5, service: result.currentService || 0, timestamp: new Date().toISOString() });

  await updateSession(session.recordId, session.user_id, {
    current_mode:    5,
    current_section: result.currentSection ?? session.current_section,
    current_service: result.currentService ?? 0,
    context_locked:  result.contextLocked  ?? session.context_locked,
    context_summary: result.contextSummary || session.context_summary,
    conversation_history: conversationHistory.slice(-MAX_HISTORY),
    service_history:      Array.isArray(result.serviceHistory) ? result.serviceHistory : (Array.isArray(session.service_history) ? session.service_history : []),
    campaign_analysis_log: result.campaignLog || '',
    status: 'active',
    last_updated: new Date().toISOString(),
  });

  return { status: 'ok', session_id: session.session_id, message: result.aiResponse, current_mode: 5, current_service: result.currentService || 0 };
}

export function mountFeedRoutes(router) {
  router.post('/data-inject', contextGuard, async (req, res) => {
    const userId = req.userId;
    const userContext = req.context;
    const { sessionId, projectId, csvData } = req.body;

    if (!csvData || typeof csvData !== 'string' || !csvData.trim()) return res.status(400).json({ status: 'error', message: 'csvData is required' });
    if (!projectId) return res.status(400).json({ status: 'error', message: 'projectId is required' });

    try {
      const project = await getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ status: 'error', message: 'Project not found' });

      const session = await getOrCreateSession(sessionId || null, userId);
      if (!session.context_summary && project.context) { session.context_summary = project.context; session.context_locked = true; }
      session.user_id = userId;
      session.project_id = projectId;

      const truncated = csvData.trim().slice(0, MAX_CSV_CHARS);
      const payload = await runCampaignAnalysis(session, `[CSV CAMPAIGN DATA]\n${truncated}`, userContext);
      logger.info({ userId, projectId, sessionId: session.session_id }, '[campaigns] CSV inject complete');
      return res.json(payload);
    } catch (err) {
      logger.error({ err: err.message, userId, projectId }, '[campaigns] data-inject error');
      return res.status(500).json({ status: 'error', message: 'Campaign analysis failed' });
    }
  });

  router.post('/fetch-meta', async (req, res) => {
    const userId = req.userId;
    const { sessionId, projectId, datePreset = 'last_30d', mode } = req.body;

    if (!projectId) return res.status(400).json({ status: 'error', message: 'projectId is required' });

    try {
      const cred = await getCredential(userId, projectId, 'meta_ads');
      if (!cred || !cred.accessToken) return res.status(404).json({ status: 'error', message: 'No Meta Ads credential found for this project. Connect Meta first.' });
      if (!cred.accountId) return res.status(400).json({ status: 'error', message: 'No Ad Account ID stored. Reconnect Meta Ads to auto-detect your account.' });

      const project = await getProjectById(projectId, userId);
      if (!project) return res.status(404).json({ status: 'error', message: 'Project not found' });

      logger.info({ userId, projectId, accountId: cred.accountId, datePreset, mode }, '[campaigns] Fetching Meta insights');
      const insights = await fetchCampaignInsights(cred.accessToken, cred.accountId, datePreset);

      if (mode === 'analyze') {
        if (!insights || insights.length === 0) return res.status(404).json({ success: false, error: 'No campaigns found in Meta account for the selected date range', stats: { fetched: 0, analyzed: 0 } });

        const MAX_CAMPAIGNS = 20;
        if (insights.length > MAX_CAMPAIGNS) return res.status(400).json({ success: false, error: `Account has ${insights.length} campaigns. Maximum for analysis mode is ${MAX_CAMPAIGNS}.`, hint: 'Use a shorter date range (e.g., last_7d) or filter campaigns in Meta Ads Manager.' });

        const normalized = normalizeInsightsForAnalysis(insights);
        const decisions = [];
        const errors = [];

        for (const c of normalized) {
          try {
            const dataForClaude = { campaignId: c.campaignId, campaignName: c.campaignName, adsetName: c.adsetName, metrics: { spend: c.spend, impressions: c.impressions, results: c.results, ctr: c.ctr, cpc: c.cpc, roas: c.roas, frequency: c.frequency, reach: c.reach, costPerResult: c.costPerResult }, deliveryStatus: c.deliveryStatus, rawRecord: c.rawRecord };
            const decision = await analyzeCampaignData(dataForClaude, 'meta-api');
            decision.campaignId = c.campaignId;
            decision.campaignName = c.campaignName;
            decision.adsetName = c.adsetName;
            decisions.push(decision);
          } catch (err) {
            logger.error({ err: err.message, campaignId: c.campaignId }, '[campaigns/fetch-meta] orchestrator.analyzeCampaignData failed');
            errors.push({ campaign: c.campaignName, error: err.message });
          }
        }

        logger.info({ userId, projectId, fetched: insights.length, analyzed: decisions.length, errors: errors.length }, '[campaigns/fetch-meta] ANALYZE mode complete');
        return res.json({ success: true, mode: 'analyze', source: 'meta-api', decisions, errors, stats: { fetched: insights.length, analyzed: decisions.length, failed: errors.length }, datePreset, accountId: cred.accountId });
      }

      const dataText = formatInsightsForPrompt(insights, cred.accountId);
      const session = await getOrCreateSession(sessionId || null, userId);
      if (!session.context_summary && project.context) { session.context_summary = project.context; session.context_locked = true; }
      session.user_id = userId;
      session.project_id = projectId;

      const payload = await runCampaignAnalysis(session, dataText);
      logger.info({ userId, projectId, campaignCount: insights.length }, '[campaigns] Meta fetch + analysis complete');
      return res.json(payload);
    } catch (err) {
      logger.error({ err: err.message, userId, projectId }, '[campaigns] fetch-meta error');
      if (err.message?.includes('OAuthException') || err.message?.includes('token') || err.message?.includes('190')) {
        return res.status(401).json({ status: 'error', message: 'Meta access token expired. Please reconnect Meta Ads.' });
      }
      return res.status(500).json({ status: 'error', message: 'Failed to fetch Meta campaign data' });
    }
  });
}
