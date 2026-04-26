// ============================================================
// MARCOM — Mode 1: Agentic Context Engine
// URL → ScrapingBee → AI auto-populate with Confidence Levels
// Graceful degradation on fetch failure
// ============================================================
import { callClaude } from '../utils/claude.js';
import { fetchUrlContent } from '../utils/scraper.js';
import { logger } from '../utils/logger.js';

export async function runMode1(session, userMessage, conversationHistory) {
  let currentSection = parseInt(session.current_section) || 0;
  // How many prior turns exist (not counting the message we just pushed)?
  const priorTurns = conversationHistory.length - 1;

  // ── AGENTIC HOOK: detect URL in message ──────────────────
  const urlMatch = userMessage.match(/https?:\/\/[^\s]+/);
  let scrapedContext = '';
  let isAgenticTrigger = false;
  let fetchFailed = false;

  if (urlMatch && currentSection === 0) {
    isAgenticTrigger = true;
    try {
      const content = await fetchUrlContent(urlMatch[0]);
      // Validate we got meaningful content (not empty or error strings)
      if (!content || content.length < 100) throw new Error('Insufficient content extracted');
      scrapedContext = content;
    } catch (err) {
      logger.warn({ err: err.message, url: urlMatch[0] }, '[Mode1] URL scrape failed — graceful degradation');
      fetchFailed = true;
      // Graceful degradation — do NOT expose raw error to user
    }
  }

  const aiResponse = await callClaude({
    systemPrompt: buildContextPrompt(currentSection, scrapedContext, isAgenticTrigger, fetchFailed, priorTurns),
    conversationHistory,
    userMessage,
    maxTokens: 2000,
  });

  // Section advancement logic
  const isSubstantive = userMessage.trim().length > 15;
  if (isSubstantive && currentSection < 9) currentSection += 1;
  // Successful agentic URL trigger → jump to confirmation stage
  if (isAgenticTrigger && !fetchFailed) currentSection = 9;
  // Failed fetch → stay at 0 (wait for user description)
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

function buildContextPrompt(currentSection, scrapedContext, isAgenticTrigger, fetchFailed, priorTurns = 0) {

  // ── GRACEFUL DEGRADATION: URL fetch failed ───────────────
  if (isAgenticTrigger && fetchFailed) {
    return `The user provided a URL but the system could not retrieve the page content (likely bot-protection on the target site).

Respond warmly and without mentioning technical errors. Say something like:
"That site's got some protection in place — couldn't pull it automatically. No problem. Drop a 2–3 sentence description of your company — what you do, who you serve, and what makes you different — and I'll generate your full context instantly."

Keep it brief and forward-moving. Do not apologize excessively.`;
  }

  // ── AGENTIC: successful scrape ────────────────────────────
  if (isAgenticTrigger && scrapedContext) {
    return `WEBSITE CONTENT SCRAPED:
${scrapedContext.slice(0, 6000)}

TASK: Analyze this website and auto-populate all 9 COMPANY CONTEXT sections. For each section, assign a Confidence Level:
- HIGH — Data explicitly stated on the website
- MEDIUM / INFERRED — Reasonably inferred from signals; state your reasoning
- MISSING — Cannot be determined; flag clearly and ask the user to fill it in

Use this exact output structure:

---
CONTEXT ANALYSIS — PRELIMINARY ⚡

**Company Foundation** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Business Model & Commercial Reality** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Target Customer Profile** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Competitor & Market Intelligence** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Marketing History & Channel Reality** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Brand Voice & Content Identity** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Local Market & Cultural Context** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Trends & Market Awareness** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

**Commercial Goals & Budget** [HIGH / MEDIUM-INFERRED / MISSING]
[Data extracted]

---
**Confident about:** [list HIGH items]
**Inferred:** [list MEDIUM items with reasoning]
**Missing:** [list what you need from the user]

End with: "Does this look right? Correct anything that's off, fill in the gaps, and I'll lock the context."

RULES:
- Be specific. Never write vague placeholders.
- If something is genuinely missing, say so and ask for it.
- Do not fabricate data.`;
  }

  // ── MANUAL MODE: stage-by-stage context gathering ────────
  // If this is the very first message in a fresh session, introduce Lumi.
  // If the conversation is already underway, do NOT re-introduce — just
  // continue gathering context from where we left off.
  const welcomeInstruction = priorTurns === 0
    ? `This is the first message in the session. Welcome the user warmly as Lumi, the AI marketing co-pilot built by MARCOM AI.
CRITICAL: You are Lumi by MARCOM AI. Never refer to any other company, product, or brand name (e.g. never say "Zync AI", "Anthropic", or any other name). You are exclusively "Lumi" from "MARCOM AI".
Explain that before unlocking the full tool suite you need to build their business context — it takes 2 minutes and powers every output.
Give them three options:
1. Drop their website URL — Lumi will auto-analyse it in seconds
2. Describe their company in 2–3 sentences
3. Answer a quick set of questions step by step
Ask which they prefer. Keep it short and energetic — no walls of text.`
    : `The conversation is already in progress. Do NOT re-introduce yourself or repeat the welcome.
Continue gathering context naturally based on what has already been shared.
Move to the next unanswered stage question. Acknowledge any answer they just gave before asking the next batch.`;

  return `You are gathering business context in order to lock the client's profile and unlock the full MARCOM tool suite.

CURRENT CONTEXT STAGE: ${currentSection} of 9

${welcomeInstruction}

STAGE GUIDE (use as a reference for what to ask at each stage — do not dump all stages at once):

STAGE 0 — Orientation (handled by the welcome instruction above)

STAGE 1 — Company Foundation
Ask: company name and tagline, what they do in one sentence, industry, how long operating, markets and geographies served, content languages, key credentials, biggest differentiator.

STAGE 2 — Business Model & Commercial Reality
Ask: B2B/B2C/both, revenue model, average deal size in local currency, sales cycle length, business stage, annual marketing goal (with numbers), monthly budget range.

STAGE 3 — Target Customer Profile
B2B: decision maker title, influencer roles, company size, client industries, top 3 problems before finding them, trigger events, most common objection, cost of not working with them.
B2C: customer profile, functional problem, emotional need, online/offline habits, purchase emotion, pre-buy objection, competitive alternatives, life transformation after purchase.

STAGE 4 — Competitor & Market Intelligence
Top 3 competitors, what each does well in marketing, each competitor's gap, a brand they admire and why, customer frustrations with existing solutions, what target customer searches before finding them.

STAGE 5 — Marketing History & Channel Reality
Primary channel now, channels trying to grow, what worked historically and why, what failed and lessons, content production capacity, tools used, paid media details.

STAGE 6 — Brand Voice & Content Identity
Brand voice in 3 words, guidelines status, formats produced, languages published, visual identity status, UGC/testimonials/case studies available.

STAGE 7 — Local Market & Cultural Context
Specific countries targeted, local cultural/religious/national occasions, local platform preferences, regulatory constraints, pricing differences by market, localization approach.

STAGE 8 — Trends & Market Awareness
Biggest industry trend, AI impact, regulatory/seasonal factors, what customer cares about now vs 2 years ago, emerging competitor or behavior shift.

STAGE 9 — Context Lock
Generate the full COMPANY CONTEXT summary and ask the user to confirm before locking.

CONTEXT SUMMARY FORMAT:
COMPANY CONTEXT — LOCKED ✓

Company: [Name] | Tagline: [Tagline]
Industry: [Industry] | Business Model: [B2B / B2C / Both]
Geography: [Markets] | Languages: [Languages]
Stage: [Stage]
Primary Decision Maker: [Role]
Top Customer Problem: [Problem]
Key Differentiator: [What sets them apart]
Key Credentials: [Awards / Certifications / Partnerships]
Marketing Goal: [Goal + Number]
Monthly Budget: [Range]
Primary Channel: [Channel] | Growing Channel: [Channel]
Current Paid Media: [Yes/No + Platforms]
Brand Voice: [3 words]
Local Cultural Moments: [Key dates per market]
Local Platform Specifics: [Non-global platforms]
Local Regulations: [Constraints]
Top 3 Competitors: [Names + gaps]
Biggest Marketing Challenge: [Challenge]
Industry Trend: [Trend]
Admired Brand: [Brand + reason]

RULES:
- One stage per response in manual mode.
- Never fabricate data. Flag what's missing.
- Do not re-introduce yourself if the conversation is already in progress.
- Do not output a scripted welcome if the user is asking a specific question — answer it first, then gently steer back to context gathering.`;
}
