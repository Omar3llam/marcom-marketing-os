// ============================================================
// MARCOM — Master Router  (POST /api/chat)
// Auth: Clerk requireAuth applied in server.js
// ============================================================
import { Router } from 'express';
import { getOrCreateSession, updateSession } from '../utils/sessionStore.js';
import { sendNotification, sendErrorAlert } from '../utils/email.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { validate, chatSchema } from '../middleware/validate.js';
import { logger } from '../utils/logger.js';
import { detectMode } from '../../config/mode-detector.js';
import { runMode1 } from '../modes/mode1-onboarding.js';
import { runMode2 } from '../modes/mode2-service.js';
import { runMode3 } from '../modes/mode3-social.js';
import { runMode4 } from '../modes/mode4-content.js';
import { runMode5 } from '../modes/mode5-campaign.js';

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
    let { message, session_id, mode: forceMode, image_base64, image_media_type } = req.body;

    // Sanitize against prompt injection
    message = sanitizeMessage(message);
    if (!message) {
      return res.status(400).json({ status: 'error', message: 'Message was empty after sanitization.' });
    }

    const imageBase64    = image_base64     || null;
    const imageMediaType = image_media_type || 'image/jpeg';

    // Load or create session (scoped to userId)
    const session = await getOrCreateSession(session_id, userId);

    const conversationHistory = session.conversation_history.slice(-MAX_HISTORY);
    conversationHistory.push({ role: 'user', content: message, timestamp: new Date().toISOString(), has_image: !!imageBase64 });

    const currentMode = detectMode(session, message, forceMode);  // server-side only

    let modeResult;
    switch (currentMode) {
      case 1: modeResult = await runMode1(session, message, conversationHistory); break;
      case 2: modeResult = await runMode2(session, message, conversationHistory); break;
      case 3: modeResult = await runMode3(session, message, conversationHistory); break;
      case 4: modeResult = await runMode4(session, message, conversationHistory, imageBase64, imageMediaType); break;
      case 5: modeResult = await runMode5(session, message, conversationHistory); break;
      default: modeResult = await runMode1(session, message, conversationHistory);
    }

    conversationHistory.push({
      role: 'assistant', content: modeResult.aiResponse,
      mode: currentMode, service: modeResult.currentService || 0,
      timestamp: new Date().toISOString(),
    });

    await updateSession(session.recordId, userId, {
      current_mode:    modeResult.nextMode || currentMode,
      current_section: modeResult.currentSection  ?? session.current_section,
      current_service: modeResult.currentService  ?? session.current_service,
      context_locked:  modeResult.contextLocked   ?? session.context_locked,
      context_summary: modeResult.contextSummary  || session.context_summary,
      conversation_history: JSON.stringify(conversationHistory.slice(-MAX_HISTORY)),
      service_history:      JSON.stringify(modeResult.serviceHistory || session.service_history || []),
      content_interrogation_log: appendLog(session.content_interrogation_log, modeResult.contentLog   || ''),
      campaign_analysis_log:     appendLog(session.campaign_analysis_log,     modeResult.campaignLog  || ''),
      hybrid_raw_data:   (modeResult.hybridData || session.hybrid_raw_data || '').slice(0, 10_000),
      status: modeResult.contextLocked ? 'locked' : 'active',
      last_updated: new Date().toISOString(),
    });

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
      .catch(() => {});
    return res.status(500).json({
      status: 'error',
      message: 'A system error occurred. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
});

