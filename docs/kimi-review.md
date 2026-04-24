# MARCOM — AI Marketing Co-pilot: Code Review Request

## Context for the Reviewer

You are reviewing **MARCOM**, a full-stack AI marketing co-pilot SaaS application.

**Stack:** Vanilla JS frontend + Node.js/Express backend (ES Modules).  
**AI Engine:** Anthropic Claude (claude-sonnet-4-5).  
**Auth:** Clerk (JWT on `/api/*`, webhook secret on `/webhook/*`).  
**Database:** Airtable (session persistence).  
**Integrations:** ScrapingBee (URL scraping), Gmail (notifications), n8n (CRM export webhook).

**What we would like your opinion on:**

1. **Architecture & Security** — Is the auth split (Clerk for `/api/*`, secret for `/webhook/*`) sound? Any vulnerabilities?
2. **Backend Logic** — Mode detection, session state machine, agentic URL scraping with graceful degradation — correct? Edge cases missed?
3. **AI Prompt Design** — Are the system prompts (Modes 1–5) well-structured? Do they enforce JSON reliably? Any prompt injection risks?
4. **Frontend Code Quality** — Vanilla JS patterns, Clerk integration, JSON renderers, wizard flow — clean or problematic?
5. **Performance & Scalability** — Airtable as a session store, 20-message history trimming, image compression — concerns?
6. **Anything else** you notice — bugs, anti-patterns, missing error handling, UX issues.

Be direct. Point to specific files and line ranges where relevant.

---

## Project Structure

```
marketing-os-v3/
├── package.json
├── .env.example
├── frontend/
│   └── index.html              (1360 lines — Marshmallow Light UI)
└── src/
    ├── server.js
    ├── routes/
    │   ├── master.js
    │   └── export.js
    ├── modes/
    │   ├── mode1-onboarding.js
    │   ├── mode2-service.js
    │   ├── mode3-social.js
    │   ├── mode4-content.js
    │   └── mode5-campaign.js
    ├── utils/
    │   ├── claude.js
    │   ├── airtable.js
    │   ├── scraper.js
    │   └── email.js
    └── middleware/
        ├── clerkAuth.js
        ├── errorHandler.js
        └── validateWebhook.js
```

---

## FILE: package.json

```json
{
  "name": "marketing-os-v3",
  "version": "3.0.0",
  "description": "MARCOM — AI Marketing Co-pilot SaaS",
  "main": "src/server.js",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "setup": "node scripts/setup-airtable.js",
    "test": "node scripts/test-system.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@clerk/clerk-sdk-node": "^4.13.23",
    "airtable": "^0.12.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-fetch": "^3.3.2",
    "nodemailer": "^6.9.13"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## FILE: .env.example

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-5

CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

AIRTABLE_API_KEY=patYourPersonalAccessTokenHere
AIRTABLE_BASE_ID=appYourBaseIdHere
AIRTABLE_TABLE_NAME=MARCOM_Sessions

GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password
NOTIFICATION_EMAIL=alerts@yourdomain.com

SCRAPINGBEE_API_KEY=your-scrapingbee-key-here

N8N_EXPORT_WEBHOOK=https://your-n8n.com/webhook/marcom-export

PORT=3000
NODE_ENV=development
WEBHOOK_SECRET=your-random-secret-string
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

---

## FILE: src/server.js

```javascript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { masterRouter } from './routes/master.js';
import { exportRouter } from './routes/export.js';
import { errorHandler } from './middleware/errorHandler.js';
import { validateWebhook } from './middleware/validateWebhook.js';
import { requireAuth, handleAuthError } from './middleware/clerkAuth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-secret'],
}));

app.use(express.static('frontend'));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'MARCOM',
    version: '4.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// /webhook/* — protected by WEBHOOK_SECRET header (used by n8n)
app.use('/webhook', validateWebhook, masterRouter);

// /api/* — protected by Clerk JWT
app.use('/api', requireAuth, handleAuthError, exportRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`MARCOM v4 online — http://localhost:${PORT}`);
});

export default app;
```

---

## FILE: src/middleware/clerkAuth.js

```javascript
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';

export const requireAuth = ClerkExpressRequireAuth({
  onError: (err, req, res, next) => {
    return res.status(401).json({ error: 'Unauthenticated' });
  },
});

export function handleAuthError(err, req, res, next) {
  if (
    err &&
    (err.status === 401 ||
      err.statusCode === 401 ||
      err.message?.toLowerCase().includes('unauthorized') ||
      err.message?.toLowerCase().includes('unauthenticated'))
  ) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  next(err);
}
```

---

## FILE: src/middleware/validateWebhook.js

```javascript
export function validateWebhook(req, res, next) {
  if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_SECRET) {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: Invalid webhook secret.',
      });
    }
  }
  next();
}
```

---

## FILE: src/middleware/errorHandler.js

```javascript
export function errorHandler(err, req, res, next) {
  console.error('[GLOBAL ERROR]', err);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
```

---

## FILE: src/routes/master.js

```javascript
import { Router } from 'express';
import { getOrCreateSession, updateSession } from '../utils/airtable.js';
import { sendNotification, sendErrorAlert } from '../utils/email.js';
import { runMode1 } from '../modes/mode1-onboarding.js';
import { runMode2 } from '../modes/mode2-service.js';
import { runMode3 } from '../modes/mode3-social.js';
import { runMode4 } from '../modes/mode4-content.js';
import { runMode5 } from '../modes/mode5-campaign.js';

export const masterRouter = Router();

masterRouter.post('/chat', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      message,
      session_id,
      mode: forceMode,
      image_base64,
      image_media_type,
    } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Missing or empty message field.' });
    }

    if (image_base64 && typeof image_base64 !== 'string') {
      return res.status(400).json({ status: 'error', message: 'image_base64 must be a string.' });
    }

    const imageBase64 = image_base64 || null;
    const imageMediaType = image_media_type || 'image/jpeg';

    const session = await getOrCreateSession(session_id);

    const conversationHistory = session.conversation_history || [];
    conversationHistory.push({
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString(),
      has_image: !!imageBase64,
    });

    let currentMode = detectMode(session, message, forceMode);

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
      role: 'assistant',
      content: modeResult.aiResponse,
      mode: currentMode,
      service: modeResult.currentService || 0,
      timestamp: new Date().toISOString(),
    });

    await updateSession(session.recordId, {
      current_mode: modeResult.nextMode || currentMode,
      current_section: modeResult.currentSection ?? session.current_section,
      current_service: modeResult.currentService ?? session.current_service,
      context_locked: modeResult.contextLocked ?? session.context_locked,
      context_summary: modeResult.contextSummary || session.context_summary,
      conversation_history: JSON.stringify(conversationHistory),
      service_history: JSON.stringify(modeResult.serviceHistory || session.service_history || []),
      content_interrogation_log: modeResult.contentLog || session.content_interrogation_log || '',
      campaign_analysis_log: modeResult.campaignLog || session.campaign_analysis_log || '',
      hybrid_raw_data: modeResult.hybridData || session.hybrid_raw_data || '',
      status: modeResult.contextLocked ? 'locked' : 'active',
      last_updated: new Date().toISOString(),
    });

    if (modeResult.onboardingComplete) {
      await sendNotification({
        subject: `MARCOM — Context Locked | ${session.session_id}`,
        sessionId: session.session_id,
        contextSummary: modeResult.contextSummary,
      }).catch(err => console.error('Notification email failed:', err));
    }

    return res.json({
      status: 'ok',
      session_id: session.session_id,
      message: modeResult.aiResponse,
      current_mode: modeResult.nextMode || currentMode,
      current_section: modeResult.currentSection ?? session.current_section,
      current_service: modeResult.currentService ?? session.current_service,
      context_locked: modeResult.contextLocked ?? session.context_locked,
      response_time_ms: Date.now() - startTime,
    });

  } catch (err) {
    console.error('[MASTER ROUTER ERROR]', err);
    await sendErrorAlert({
      error: err.message,
      sessionId: req.body?.session_id || 'unknown',
      mode: 'master-router',
    }).catch(() => {});

    return res.status(500).json({
      status: 'error',
      message: 'A system error occurred. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

function detectMode(session, message, forceMode) {
  if (forceMode && [1, 2, 3, 4, 5].includes(parseInt(forceMode))) {
    return parseInt(forceMode);
  }

  if (!session.context_locked) return 1;

  const msg = message.toLowerCase();

  const socialTriggers = [
    'social media calendar', 'content calendar', 'social calendar',
    'social strategy', 'content plan', 'content schedule',
    '4-week calendar', 'social media plan', 'tool 03', 'tool03',
  ];
  const contentTriggers = [
    'interrogate', 'evaluate content', 'check my content',
    'assess this content', 'review this post', 'score my content',
    'content interrogation', 'evaluate this', 'tool 09', 'tool09',
  ];
  const campaignTriggers = [
    'campaign metrics', 'campaign results', 'ad performance',
    'my campaign', 'campaign analysis', 'paid results',
    'meta metrics', 'google ads metrics', 'roas', 'cpa results',
    'cpm', 'ctr results', 'ad spend analysis', 'tool 06', 'tool06',
  ];

  if (socialTriggers.some(t => msg.includes(t))) return 3;
  if (contentTriggers.some(t => msg.includes(t))) return 4;
  if (campaignTriggers.some(t => msg.includes(t))) return 5;
  return 2;
}
```

---

## FILE: src/routes/export.js

```javascript
import { Router } from 'express';

export const exportRouter = Router();

const N8N_WEBHOOK = process.env.N8N_EXPORT_WEBHOOK || '';

exportRouter.post('/export', async (req, res) => {
  try {
    const { session_id, export_type, payload, label } = req.body;

    if (!export_type || !payload) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: export_type and payload.',
      });
    }

    const userId = req.auth?.userId || 'anonymous';

    const exportPackage = {
      source: 'MARCOM',
      user_id: userId,
      session_id: session_id || 'anonymous',
      export_type,
      label: label || export_type,
      timestamp: new Date().toISOString(),
      payload,
    };

    if (!N8N_WEBHOOK) {
      return res.json({
        status: 'ok',
        message: 'Export prepared. Configure N8N_EXPORT_WEBHOOK to enable auto-sync.',
        export_id: `EXP_${Date.now()}`,
        export_type,
        timestamp: exportPackage.timestamp,
        webhook_forwarded: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let n8nResponse;
    try {
      const fwdRes = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MARCOM-ExportHub/4.0',
        },
        body: JSON.stringify(exportPackage),
        signal: controller.signal,
      });
      n8nResponse = { status: fwdRes.status, ok: fwdRes.ok };
    } catch (fetchErr) {
      console.warn('[EXPORT] n8n forward failed:', fetchErr.message);
      return res.json({
        status: 'partial',
        message: 'Export prepared but CRM delivery failed.',
        export_id: `EXP_${Date.now()}`,
        export_type,
        webhook_forwarded: false,
        error: fetchErr.message,
      });
    } finally {
      clearTimeout(timeout);
    }

    return res.json({
      status: 'ok',
      message: 'Export synced to CRM.',
      export_id: `EXP_${Date.now()}`,
      export_type,
      timestamp: exportPackage.timestamp,
      webhook_forwarded: n8nResponse.ok,
      webhook_status: n8nResponse.status,
    });

  } catch (err) {
    console.error('[EXPORT ROUTER ERROR]', err);
    return res.status(500).json({
      status: 'error',
      message: 'Export failed. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});
```

---

## FILE: src/utils/claude.js

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_HISTORY_MESSAGES = 20;

export async function callClaude({
  systemPrompt,
  conversationHistory = [],
  userMessage,
  maxTokens = 2048,
  model = DEFAULT_MODEL,
  imageBase64 = null,
  imageMediaType = 'image/jpeg',
}) {
  const trimmedHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages = trimmedHistory
    .filter(m => m.role && m.content)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

  let finalUserContent;
  if (imageBase64) {
    finalUserContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageMediaType,
          data: imageBase64,
        },
      },
      { type: 'text', text: userMessage },
    ];
  } else {
    finalUserContent = userMessage;
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: finalUserContent });
  } else {
    messages[messages.length - 1].content = finalUserContent;
  }

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent) throw new Error('No text content in Claude response');
    return textContent.text;

  } catch (err) {
    console.error('[CLAUDE API ERROR]', err.message);
    if (err.status === 429) throw new Error('Rate limit reached. Please wait and try again.');
    if (err.status === 401) throw new Error('Invalid Anthropic API key.');
    if (err.status === 400) throw new Error('Request too large or malformed.');
    throw err;
  }
}
```

---

## FILE: src/utils/airtable.js

```javascript
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = process.env.AIRTABLE_TABLE_NAME || 'MARCOM_Sessions';

export async function getOrCreateSession(sessionId) {
  if (sessionId) {
    try {
      const records = await base(TABLE).select({
        filterByFormula: `{session_id} = '${sessionId}'`,
        maxRecords: 1,
      }).firstPage();
      if (records.length > 0) return parseRecord(records[0]);
    } catch (err) {
      console.error('[AIRTABLE] Load session error:', err.message);
    }
  }
  return createSession();
}

async function createSession() {
  const newSessionId = `MARCOM_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const record = await base(TABLE).create({
    session_id: newSessionId,
    current_mode: 1,
    current_section: 0,
    current_service: 0,
    context_locked: false,
    conversation_history: '[]',
    service_history: '[]',
    active_service_context: '{}',
    content_interrogation_log: '',
    campaign_analysis_log: '',
    hybrid_raw_data: '',
    status: 'active',
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  });
  return parseRecord(record);
}

export async function updateSession(recordId, fields) {
  try {
    const safeFields = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.length > 95000) {
        safeFields[key] = value.slice(-95000);
      } else {
        safeFields[key] = value;
      }
    }
    const record = await base(TABLE).update(recordId, safeFields);
    return parseRecord(record);
  } catch (err) {
    console.error('[AIRTABLE] Update session error:', err.message);
    throw err;
  }
}

function parseRecord(record) {
  const f = record.fields;
  let conversationHistory = [];
  let serviceHistory = [];
  try { conversationHistory = JSON.parse(f.conversation_history || '[]'); } catch {}
  try { serviceHistory = JSON.parse(f.service_history || '[]'); } catch {}
  return {
    recordId: record.id,
    session_id: f.session_id,
    current_mode: parseInt(f.current_mode) || 1,
    current_section: parseInt(f.current_section) || 0,
    current_service: parseInt(f.current_service) || 0,
    context_locked: f.context_locked || false,
    context_summary: f.context_summary || '',
    conversation_history: conversationHistory,
    service_history: serviceHistory,
    content_interrogation_log: f.content_interrogation_log || '',
    campaign_analysis_log: f.campaign_analysis_log || '',
    hybrid_raw_data: f.hybrid_raw_data || '',
    status: f.status || 'active',
  };
}
```

---

## FILE: src/utils/scraper.js

```javascript
export async function fetchUrlContent(url) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error('SCRAPINGBEE_API_KEY not configured.');

  const endpoint = new URL('https://app.scrapingbee.com/api/v1/');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('render_js', 'false');
  endpoint.searchParams.set('extract_rules', JSON.stringify({ text: 'body' }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(endpoint.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`ScrapingBee returned ${response.status}: ${response.statusText}`);
    const data = await response.json();
    const rawText = data.text || data.body || '';
    return rawText.replace(/\s+/g, ' ').trim().slice(0, 8000) || 'No content extracted.';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('URL fetch timed out.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## FILE: src/utils/email.js

```javascript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

export async function sendNotification({ subject, sessionId, contextSummary }) {
  if (!process.env.GMAIL_USER) return;
  await transporter.sendMail({
    from: `"MARCOM" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject,
    html: `<h2>Context Locked</h2><p>Session: ${sessionId}</p><pre>${contextSummary}</pre>`,
  });
}

export async function sendErrorAlert({ error, sessionId, mode }) {
  if (!process.env.GMAIL_USER) return;
  await transporter.sendMail({
    from: `"MARCOM Alerts" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `MARCOM Error | ${mode} | Session ${sessionId}`,
    html: `<h2>Error</h2><p>Mode: ${mode}</p><p>Session: ${sessionId}</p><pre>${error}</pre>`,
  });
}
```

---

## FILE: src/modes/mode1-onboarding.js

```javascript
import { callClaude } from '../utils/claude.js';
import { fetchUrlContent } from '../utils/scraper.js';

export async function runMode1(session, userMessage, conversationHistory) {
  let currentSection = parseInt(session.current_section) || 0;

  const urlMatch = userMessage.match(/https?:\/\/[^\s]+/);
  let scrapedContext = '';
  let isAgenticTrigger = false;
  let fetchFailed = false;

  if (urlMatch && currentSection === 0) {
    isAgenticTrigger = true;
    try {
      const content = await fetchUrlContent(urlMatch[0]);
      if (!content || content.length < 100) throw new Error('Insufficient content extracted');
      scrapedContext = content;
    } catch (err) {
      console.warn('[MODE1 SCRAPE FAIL]', err.message);
      fetchFailed = true;
    }
  }

  const aiResponse = await callClaude({
    systemPrompt: buildContextPrompt(currentSection, scrapedContext, isAgenticTrigger, fetchFailed),
    conversationHistory,
    userMessage,
    maxTokens: 2000,
  });

  const isSubstantive = userMessage.trim().length > 15;
  if (isSubstantive && currentSection < 9) currentSection += 1;
  if (isAgenticTrigger && !fetchFailed) currentSection = 9;
  if (fetchFailed) currentSection = 0;

  const confirmationWords = ['yes', 'confirm', 'correct', 'accurate', 'looks good', 'approved', 'lock it', 'good to go', 'lock the context'];
  const userConfirmed = confirmationWords.some(w => userMessage.toLowerCase().includes(w));
  const contextLocked = currentSection >= 9 && userConfirmed;

  let contextSummary = session.context_summary || '';
  if (currentSection >= 9 && aiResponse.includes('COMPANY CONTEXT')) {
    contextSummary = aiResponse;
  }

  return {
    aiResponse,
    currentSection,
    currentService: session.current_service || 0,
    contextLocked,
    contextSummary,
    nextMode: contextLocked ? 2 : 1,
    onboardingComplete: contextLocked,
    serviceHistory: session.service_history || [],
  };
}

function buildContextPrompt(currentSection, scrapedContext, isAgenticTrigger, fetchFailed) {
  if (isAgenticTrigger && fetchFailed) {
    return `You are MARCOM — an agentic marketing decision engine.

The user provided a URL but the system could not retrieve the page (likely Cloudflare/bot protection).

Respond warmly. Do NOT mention technical errors. Say:
"We weren't able to access that site directly — it's likely protected from automated access. No problem. Drop a 2–3 sentence description of your company and I'll generate your full context in seconds."

Keep it brief and forward-moving.`;
  }

  if (isAgenticTrigger && scrapedContext) {
    return `You are MARCOM — an elite agentic marketing decision engine.

Tone: executive, direct, consultative. Treat the user as a sophisticated peer.

WEBSITE CONTENT SCRAPED:
${scrapedContext.slice(0, 6000)}

TASK: Analyze this website and auto-populate all 9 COMPANY CONTEXT sections.
Assign a Confidence Level to each section:
- HIGH — Explicitly stated on the website
- MEDIUM / INFERRED — Reasonably inferred; state your reasoning
- MISSING — Cannot be determined; flag and ask user to fill in

Output structure:
---
CONTEXT ANALYSIS — PRELIMINARY ⚡

**Company Foundation** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Business Model & Commercial Reality** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Target Customer Profile** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Competitor & Market Intelligence** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Marketing History & Channel Reality** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Brand Voice & Content Identity** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Local Market & Cultural Context** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Trends & Market Awareness** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

**Commercial Goals & Budget** [HIGH / MEDIUM-INFERRED / MISSING]
[Data]

---
**Confident about:** [HIGH items]
**Inferred:** [MEDIUM items + reasoning]
**Missing:** [what you need from the user]

End with: "Does this look right? Correct anything, fill in the gaps, and I'll lock the context."

RULES: Be specific. Never write vague placeholders. Never fabricate data.`;
  }

  return `You are MARCOM — an agentic marketing decision engine.

Tone: executive, consultative, warm but not wordy.

CURRENT CONTEXT STAGE: ${currentSection}

STAGE 0 — Welcome
Introduce yourself as MARCOM. Offer: URL analysis, 2–3 sentence description, or step-by-step questions.

STAGE 1 — Company Foundation
Ask all 8: name/tagline, one-sentence description, industry, operating duration, markets/geographies, content languages (with regional variants), credentials, biggest differentiator.

STAGE 2 — Business Model & Commercial Reality
Ask all 7: B2B/B2C/both, revenue model, average deal size (local currency), sales cycle length, business stage, annual marketing goal with numbers, monthly budget range.

STAGE 3 — Target Customer Profile
B2B: decision maker title, influencer roles, company size, client industries, top 3 problems, trigger events, most common objection, cost of not working with them.
B2C: customer profile, functional problem, emotional need, online/offline habits, purchase emotion, pre-buy objection, competitive alternatives, life after purchase.

STAGE 4 — Competitor & Market Intelligence
Top 3 competitors, what each does well, each competitor's gap, an admired brand and why, customer frustrations, what customer searches before finding them.

STAGE 5 — Marketing History & Channel Reality
Primary channel, channels trying to grow, what worked historically and why, what failed and lessons, content production capacity, tools used, paid media details.

STAGE 6 — Brand Voice & Content Identity
Brand voice in 3 words, guidelines status, formats produced, languages published, visual identity status, UGC/testimonials/case studies available.

STAGE 7 — Local Market & Cultural Context
Countries targeted, cultural/religious/national occasions, local platform preferences, regulatory constraints, pricing differences by market, localization approach.

STAGE 8 — Trends & Market Awareness
Biggest industry trend, AI impact, regulatory/seasonal factors, what customer cares about now vs 2 years ago, emerging competitor or behavior shift.

STAGE 9 — Context Lock
Generate full COMPANY CONTEXT summary in this format:

COMPANY CONTEXT — LOCKED ✓

Company: [Name] | Tagline: [Tagline]
Industry: [Industry] | Business Model: [B2B / B2C / Both]
Geography: [Markets] | Languages: [Languages]
Stage: [Stage]
Primary Decision Maker: [Role]
Top Customer Problem: [Problem]
Key Differentiator: [Differentiator]
Key Credentials: [Credentials]
Marketing Goal: [Goal + Number]
Monthly Budget: [Range]
Primary Channel: [Channel] | Growing Channel: [Channel]
Current Paid Media: [Yes/No + Platforms]
Brand Voice: [3 words]
Local Cultural Moments: [Key dates]
Local Platform Specifics: [Non-global platforms]
Local Regulations: [Constraints]
Top 3 Competitors: [Names + gaps]
Biggest Marketing Challenge: [Challenge]
Industry Trend: [Trend]
Admired Brand: [Brand + reason]

Then ask: "Is this accurate? Correct anything and I'll lock the context."

RULES: One stage per response. Never fabricate data. No filler phrases.`;
}
```

---

## FILE: src/modes/mode2-service.js (condensed — full 18-tool prompt library)

```javascript
import { callClaude } from '../utils/claude.js';
import { fetchUrlContent } from '../utils/scraper.js';

const HYBRID_SERVICES = [5, 8];  // require URL scraping
const CAMPAIGN_SERVICES = [6];   // require manual metric input

export async function runMode2(session, userMessage, conversationHistory) {
  const currentService = detectService(userMessage, session.current_service);
  const serviceType = getServiceType(currentService);
  let hybridData = session.hybrid_raw_data || '';

  if (serviceType === 'hybrid') {
    const extractedUrl = extractUrl(userMessage);
    if (extractedUrl) {
      try {
        const content = await fetchUrlContent(extractedUrl);
        hybridData = JSON.stringify({ url: extractedUrl, fetched_at: new Date().toISOString(), content });
      } catch (err) {
        hybridData = JSON.stringify({ url: extractedUrl, error: 'Fetch failed — paste content manually.' });
      }
    }
  }

  const aiResponse = await callClaude({
    systemPrompt: buildServicePrompt(currentService, session.context_summary, hybridData),
    conversationHistory,
    userMessage,
    maxTokens: 2500,
  });

  const serviceHistory = session.service_history || [];
  if (currentService > 0 && !serviceHistory.includes(currentService)) serviceHistory.push(currentService);

  return {
    aiResponse,
    currentSection: session.current_section,
    currentService,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 2,
    serviceHistory,
    hybridData,
    onboardingComplete: false,
  };
}

function detectService(message, currentService) {
  const match = message.match(/\b(0?[1-9]|1[0-8])\b/);
  if (match) return parseInt(match[0]);
  const keywords = {
    1: ['full strategy', 'marketing strategy'],
    2: ['content assessment'],
    3: ['social media', 'content calendar'],
    4: ['media buying', 'ad strategy'],
    5: ['seo', 'search optimization'],
    6: ['campaign analysis', 'campaign metrics', 'ad performance'],
    7: ['market analysis', 'swot'],
    8: ['competitor', 'competitor analysis'],
    9: ['content interrogation', 'evaluate content'],
    10: ['lead generation', 'lead gen'],
    11: ['email marketing', 'email sequence'],
    12: ['buyer persona', 'customer research'],
    13: ['brand positioning'],
    14: ['crisis'],
    15: ['employer brand', 'talent marketing'],
    16: ['ai marketing', 'marketing ops'],
    17: ['localization'],
    18: ['go-to-market', 'gtm'],
  };
  const msg = message.toLowerCase();
  for (const [service, terms] of Object.entries(keywords)) {
    if (terms.some(t => msg.includes(t))) return parseInt(service);
  }
  return currentService || 0;
}

function getServiceType(n) {
  if (HYBRID_SERVICES.includes(n)) return 'hybrid';
  if (CAMPAIGN_SERVICES.includes(n)) return 'campaign';
  if (n === 0) return 'menu';
  return 'conversational';
}

function extractUrl(message) {
  const match = message.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// buildServicePrompt returns system prompt with full 18-tool guide library.
// Each tool includes: clarifying questions to ask first, then full deliverable spec.
// Tools 05 and 08 inject hybridData (scraped URL content) into the prompt.
// System identity: "executive and consultative, direct without being cold."
```

---

## FILE: src/modes/mode3-social.js

```javascript
import { callClaude } from '../utils/claude.js';

export async function runMode3(session, userMessage, conversationHistory) {
  const aiResponse = await callClaude({
    systemPrompt: buildSocialPrompt(session.context_summary),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
  });
  // Returns JSON: { pillars[], calendar[], hook_bank{}, summary, cultural_moments[] }
  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: 3,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 3,
    serviceHistory: session.service_history || [],
    campaignLog: (session.campaign_analysis_log || '') + aiResponse,
    onboardingComplete: false,
  };
}

// Prompt enforces: strict JSON only, 4-week calendar, commercial ratios,
// TOFU-before-BOFU sequencing, platform-native hooks, MENA cultural moments.
// Pre-flight: asks for platforms, production capacity, formats, frequency, goal.
```

---

## FILE: src/modes/mode4-content.js

```javascript
import { callClaude } from '../utils/claude.js';

export async function runMode4(session, userMessage, conversationHistory, imageBase64 = null, imageMediaType = 'image/jpeg') {
  const aiResponse = await callClaude({
    systemPrompt: buildContentPrompt(session.context_summary, !!imageBase64),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
    imageBase64,
    imageMediaType,
  });
  // Returns strict JSON scorecard
  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: session.current_service,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 4,
    serviceHistory: session.service_history || [],
    contentLog: (session.content_interrogation_log || '') + aiResponse,
    onboardingComplete: false,
  };
}

// Prompt: 10-step engine → strict JSON output:
// { scorecard: { ai_probability, hook_score, audience_conviction, authority_signal,
//   differentiation, cultural_resonance, closing_line, commercial_impact,
//   visual_impact_score (if image), text_design_harmony (if image), overall },
//   rewrite_required, verdict, brutal_insight, rewritten_content, what_changed[] }
// Pre-flight: platform, funnel_stage, format, audience.
// Auto-rewrite if any gate fails. No permission needed.
```

---

## FILE: src/modes/mode5-campaign.js

```javascript
import { callClaude } from '../utils/claude.js';

export async function runMode5(session, userMessage, conversationHistory) {
  const aiResponse = await callClaude({
    systemPrompt: buildCampaignPrompt(session.context_summary),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
  });
  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: 6,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 5,
    serviceHistory: session.service_history || [],
    campaignLog: (session.campaign_analysis_log || '') + aiResponse,
    onboardingComplete: false,
  };
}

// 2025/2026 media buying rules applied before every decision:
// 1. ASC Grace Period Rule — auto-HOLD AI campaigns <3-4 days old
// 2. MER & True CAC Rule — don't trust platform ROAS alone; ask for MER/CAC
// 3. Horizontal Scaling Rule — expand to new audiences/formats/platforms before budget increase
// 4. B2B Pipeline Efficiency Rule — CPL alone invalid; check Cost-per-SQL; flag cold "Book a Demo" as Funnel Mismatch
// 5. Creative Fatigue Detection — CTR declining + frequency >3 + CPM rising
// 6. Audience Saturation Detection — CPM rising >20% WoW without reach growth
//
// Output strict JSON:
// { campaigns: [{ campaign_name, decision(SCALE|HOLD|OPTIMIZE|PAUSE|KILL),
//   impact_score(1-10), reasoning, horizontal_scaling_advice }],
//   summary, immediate_actions[], testing_agenda[],
//   asc_grace_period_flags[], mer_cac_flags[] }
```

---

## FILE: frontend/index.html — Key Sections (1360 lines total)

### Auth Flow
```javascript
// Clerk SDK loaded via CDN script tag with data-clerk-publishable-key
// On load: await window.Clerk?.load()
// If not authenticated: mountSignIn() on #sign-in div
// On auth: hide #auth-container, show #app-container, mountUserButton() on #user-button

async function getToken() {
  try { return await window.Clerk?.session?.getToken() || null; }
  catch { return null; }
}
```

### Send Message (JWT injection on every call)
```javascript
async function send() {
  const token = await getToken();
  const hdrs = { 'Content-Type': 'application/json' };
  if (token) hdrs['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${base}/webhook/chat`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify(payload),
  });
}
```

### Sync to CRM (POST /api/export with Clerk token)
```javascript
async function syncCRM(type, payload) {
  const token = await getToken();
  if (!token) { toast('Sign in required.'); return; }

  const res = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ session_id: S.sid, export_type: type, payload }),
  });
}
```

### Onboarding Wizard (3 steps)
```javascript
// Step 1: 9 industry tile buttons (Ecommerce, B2B & SaaS, Real Estate, Healthcare,
//          Education, Services, F&B, Government, Other)
// Step 2: <select> dropdown with 28 countries + Other
// Step 3: URL input
// On finish: compiles { industry, country, url } into context message → calls send()
```

### Smart JSON Renderer
```javascript
function renderResp(data) {
  const json = tryJSON(data.message);
  if (data.current_mode === 5 && json?.campaigns)  { renderCampaign(json); return; }
  if (data.current_mode === 4 && json?.scorecard)  { renderScorecard(json); return; }
  if (data.current_mode === 3 && json?.calendar)   { renderCalendar(json); return; }
  // Mode 2 long text → insight card grid (emoji mood detection)
  if (data.current_mode === 2 && data.message?.length > 200) { renderInsightText(data); }
  else appendMsg('system', data.message, meta);
}

function tryJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e+1)); } catch {} }
  return null;
}
```

### Lumi Skeleton Loader
```javascript
// Rotating thoughts every 2s from LUMI_THOUGHTS[] array
// Skeleton shimmer lines while waiting for API response
// Lumi ✨ emoji as chat avatar throughout
```

### Image Upload + Compression
```javascript
// Canvas resize to max 800px width, 85% JPEG quality before base64 encoding
// Sends image_base64 + image_media_type in POST payload to /webhook/chat
// Mode 4 passes image to Claude vision API
```

---

## Summary of Key Design Decisions

| Decision | Rationale |
|---|---|
| Airtable as session store | Rapid prototyping; no DB setup required. Tradeoff: 5 req/sec rate limit. |
| Conversation history trimmed to last 20 messages | Claude context window protection; cost control. |
| Webhook secret (not Clerk) for `/webhook/*` | n8n cannot send Clerk JWTs; separate auth per route type. |
| `forceMode` param | Allows frontend config panel to override AI mode detection for testing. |
| Strict JSON output in Modes 3, 4, 5 | Enables visual rendering; fallback to text if JSON parse fails. |
| `tryJSON()` triple-parse strategy | Handles LLM wrapping JSON in markdown fences or prose. |
| ScrapingBee + graceful degradation | Bot-protected sites fail silently; user gets friendly prompt instead of error. |
| `N8N_EXPORT_WEBHOOK` server-side only | Webhook URL never exposed to frontend or user input. |
| Image compressed client-side | Reduces payload size; 800px max avoids hitting Claude's image size limits. |

---

*End of codebase. Please review and share your honest assessment.*
