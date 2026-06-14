// ============================================================
// MARCOM — Master Router  (POST /api/chat)
// Auth: Clerk requireAuth applied in server.js
// ============================================================
import { Router } from 'express';
import { getOrCreateSession, updateSession } from '../utils/sessionStore.js';
import { sendNotification, sendErrorAlert } from '../utils/email.js';
import { getProjectById } from '../models/project.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { validate, chatSchema } from '../middleware/validate.js';
import { logger } from '../utils/logger.js';
import { detectMode } from '../../config/mode-detector.js';
import { fetchUrlContent } from '../utils/scraper.js';
import { runMode1 } from '../modes/mode1-onboarding.js';
import { runMode2 } from '../modes/mode2-service.js';
import { runMode3 } from '../modes/mode3-social.js';
import { runMode4 } from '../modes/mode4-content.js';
import { runMode5 } from '../modes/mode5-campaign.js';
import { fetchMemories, writeMemory, extractMemoryFact } from '../utils/memoryStore.js';

export const masterRouter = Router();

const MAX_HISTORY  = 40;
const MAX_LOG_CHARS = 90_000;

function appendLog(existing = '', newEntry = '', maxChars = MAX_LOG_CHARS) {
  const joined = existing + `\n${'─'.repeat(60)}\n${new Date().toISOString()}\n` + newEntry;
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}

masterRouter.post('/chat', validate(chatSchema), async (req, res) => {
  const start = Date.now();
  const userId = req.userId;   // set by requireAuth

  try {
    let { message, session_id, mode: forceMode, image_base64, image_media_type, lumi_context, project_id } = req.body;

    // Sanitize against prompt injection
    message = sanitizeMessage(message);
    if (!message) {
      return res.status(400).json({ status: 'error', message: 'Message was empty after sanitization.' });
    }

    const imageBase64    = image_base64     || null;
    const imageMediaType = image_media_type || 'image/jpeg';

    // Load or create session (scoped to userId)
    const session = await getOrCreateSession(session_id, userId);

    // ── CONTEXT INJECTION ────────────────────────────────────────
    // Rule: whenever a project_id arrives, ALWAYS load that project's
    // context and stamp it onto the session. This guarantees that
    // switching projects mid-session never leaves stale context from
    // the previous project on the AI's system prompt.
    //
    // Legacy path (no project_id): only inject once, on first message,
    // when the session has no context yet.
    if (project_id) {
      try {
        // SECURITY: Ownership validated in query — returns null if user doesn't own project
        const project = await getProjectById(project_id, userId);
        if (project) {
          // Stamp project name on session so mode handlers can personalise responses.
          session.project_name = project.name || '';

          // context may be an empty string (new project not yet onboarded).
          // Only lock + inject when there is real content — use .trim() not truthiness
          // so an empty-string context ('') never falsely triggers a lock.
          if (project.context && project.context.trim()) {
            session.context_summary = project.context;
            session.context_locked  = true;
            logger.info(
              { userId, sessionId: session.session_id, project_id },
              'Project context injected/refreshed for this request'
            );
          }
        } else {
          // Project not found or user doesn't own it — log but continue (session proceeds without context)
          logger.warn({ userId, project_id }, 'Project not found or access denied — proceeding without context');
        }
      } catch (err) {
        logger.warn({ err: err.message, userId, project_id }, 'Project context lookup failed — proceeding without');
      }
    } else if (!session.context_locked && (!session.context_summary || !session.context_summary.trim())) {
      const resolvedContext = typeof lumi_context === 'string' && lumi_context.trim() ? lumi_context.trim() : null;
      if (resolvedContext) {
        session.context_summary = resolvedContext;
        session.context_locked  = true;
        logger.info({ userId, sessionId: session.session_id }, 'Context injected from request body');
      }
    }

    const conversationHistory = session.conversation_history.slice(-MAX_HISTORY);
    conversationHistory.push({ role: 'user', content: message, timestamp: new Date().toISOString(), has_image: !!imageBase64 });

    const currentMode = detectMode(session, message, forceMode);  // server-side only

    // ── AUTO URL SCRAPING (modes 2–5; mode 1 handles internally) ──
    // If the message contains a URL, fetch its content and append it
    // to the message so Claude has full page context automatically.
    let enrichedMessage = message;
    if (currentMode !== 1) {
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        try {
          const pageContent = await fetchUrlContent(urlMatch[0]);
          enrichedMessage = `${message}\n\n---\n[SCRAPED PAGE CONTENT FROM ${urlMatch[0]}]\n${pageContent}\n---`;
          logger.info({ url: urlMatch[0], mode: currentMode }, 'URL auto-scraped for context');
        } catch (err) {
          logger.warn({ err: err.message, url: urlMatch[0] }, 'URL scrape failed — continuing without page content');
          // Silent fallback — proceed with original message
        }
      }
    }

    // ── MEMORY STORE: recall relevant facts for this user ──────
    // Fires before mode routing so all mode handlers can benefit.
    // Gracefully no-ops when ANTHROPIC_MEMORY_STORE_ID is not set.
    const memoryBlock = await fetchMemories(userId, message);
    if (memoryBlock && !session.context_summary?.includes('LUMI MEMORY')) {
      // Prepend memory facts to the session context so mode prompts see them
      session.context_summary = memoryBlock
        + (session.context_summary ? `\n\n${session.context_summary}` : '');
    }

    let modeResult;
    switch (currentMode) {
      case 1: modeResult = await runMode1(session, message, conversationHistory); break;
      case 2: modeResult = await runMode2(session, enrichedMessage, conversationHistory); break;
      case 3: modeResult = await runMode3(session, enrichedMessage, conversationHistory); break;
      case 4: modeResult = await runMode4(session, enrichedMessage, conversationHistory, imageBase64, imageMediaType); break;
      case 5: modeResult = await runMode5(session, enrichedMessage, conversationHistory); break;
      default: modeResult = await runMode1(session, message, conversationHistory);
    }

    conversationHistory.push({
      role: 'assistant', content: modeResult.aiResponse,
      mode: currentMode, service: modeResult.currentService || 0,
      timestamp: new Date().toISOString(),
    });

    // ── BUGFIX: pass raw arrays, not JSON-encoded strings.
    // updateSession() type-checks with Array.isArray() and falls back to [],
    // so a stringified value here was silently persisting an empty array
    // — which is exactly why /api/history/:sessionId returned messages: [].
    await updateSession(session.recordId, userId, {
      current_mode:    modeResult.nextMode || currentMode,
      current_section: modeResult.currentSection  ?? session.current_section,
      current_service: modeResult.currentService  ?? session.current_service,
      context_locked:  modeResult.contextLocked   ?? session.context_locked,
      context_summary: modeResult.contextSummary  || session.context_summary,
      conversation_history: conversationHistory.slice(-MAX_HISTORY),
      service_history:      Array.isArray(modeResult.serviceHistory)
                              ? modeResult.serviceHistory
                              : (Array.isArray(session.service_history) ? session.service_history : []),
      content_interrogation_log: appendLog(session.content_interrogation_log, modeResult.contentLog   || ''),
      campaign_analysis_log:     appendLog(session.campaign_analysis_log,     modeResult.campaignLog  || ''),
      hybrid_raw_data:   (modeResult.hybridData || session.hybrid_raw_data || '').slice(0, 10_000),
      status: modeResult.contextLocked ? 'locked' : 'active',
      last_updated: new Date().toISOString(),
      // Stamp the active project onto the session so listSessions() can
      // filter by project_id. COALESCE in updateSession never overwrites
      // an existing project_id with null — safe to pass on every request.
      project_id: project_id || null,
    });

    // ── MEMORY STORE: persist new facts (fire-and-forget) ──────
    // Runs after updateSession so it never delays the HTTP response.
    // writeMemory() catches and logs its own errors — the .catch here
    // is a final safety net for unexpected promise rejections.
    const factToStore = extractMemoryFact(modeResult.aiResponse, message);
    if (factToStore) {
      writeMemory(userId, factToStore, project_id || null)
        .catch(err => logger.error({ err: err.message }, '[master] writeMemory fire-and-forget rejected'));
    }

    if (modeResult.onboardingComplete) {
      sendNotification({
        subject: `MARCOM — Context Locked | ${session.session_id}`,
        sessionId: session.session_id,
        contextSummary: modeResult.contextSummary,
      }).catch(err => logger.error({ err }, 'Notification email failed'));
    }

    logger.info({ mode: currentMode, userId, ms: Date.now() - start }, 'Chat handled');

    return res.json({
      status: 'ok',
      session_id:      session.session_id,
      message:         modeResult.aiResponse,
      current_mode:    modeResult.nextMode  || currentMode,
      current_section: modeResult.currentSection ?? session.current_section,
      current_service: modeResult.currentService ?? session.current_service,
      context_locked:  modeResult.contextLocked  ?? session.context_locked,
      response_time_ms: Date.now() - start,
    });

  } catch (err) {
    logger.error({ err, userId }, 'Master router error');
    sendErrorAlert({ error: err.message, sessionId: req.body?.session_id || 'unknown', mode: 'master-router' })
      .catch((alertErr) => logger.warn({ err: alertErr.message, userId }, 'Error alert email failed'));
    return res.status(500).json({
      status: 'error',
      message: 'A system error occurred. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
});

