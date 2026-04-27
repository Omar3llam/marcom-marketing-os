// ============================================================
// MARCOM — Mode 4: Content Interrogation Engine
// Supports text + vision (image) analysis
// Strict JSON output → visual scorecard / analysis dashboard
// ============================================================
import { callClaude, stripJsonFences } from '../utils/claude.js';
import { extractDialectContext, MODE_PLATFORM_HINTS } from '../utils/dialectContext.js';

// Keywords that signal the user wants a full 10-step SCORECARD
const SCORE_SIGNALS = [
  'score', 'scorecard', 'rate ', 'rating', 'grade', 'evaluate', 'evaluation',
];

// Keywords that signal the user wants a deep strategic ANALYSIS
const ANALYSE_SIGNALS = [
  'interrogate', 'interrogation', 'analyse', 'analyze', 'analysis',
  'deep dive', 'deep-dive', 'strategic review', 'review this', 'breakdown',
  'audit', 'critique',
];

function detectIntent(message = '') {
  const m = message.toLowerCase();
  // If message has no substantial content to analyse yet, flag it
  const wordCount = m.trim().split(/\s+/).length;
  const isRequest = wordCount <= 12; // short prompt — probably asking, not pasting content

  if (ANALYSE_SIGNALS.some(k => m.includes(k))) return { type: 'analyse', isRequest };
  if (SCORE_SIGNALS.some(k => m.includes(k)))   return { type: 'score',   isRequest };
  return { type: 'score', isRequest }; // default to scorecard
}

export async function runMode4(session, userMessage, conversationHistory, imageBase64 = null, imageMediaType = 'image/jpeg') {
  const dialectContext = extractDialectContext(session, MODE_PLATFORM_HINTS.mode4);
  const { type, isRequest } = detectIntent(userMessage);

  // If the user has sent a short trigger phrase without actual content yet,
  // and we have no prior turns with content in this session, ask for the
  // content directly — never fall back to Mode 1 onboarding.
  const hasPriorContent = conversationHistory.some(
    m => m.role === 'user' && m.content && m.content.trim().split(/\s+/).length > 12
  );

  if (isRequest && !hasPriorContent && !imageBase64) {
    const modeLabel = type === 'analyse' ? 'interrogate' : 'score';
    const aiResponse = `Your business context is locked and ready. 🔍\n\nTo ${modeLabel} your content, paste the copy, caption, post, or ad you'd like me to evaluate — then let me know:\n1. **Platform** (LinkedIn / Instagram / TikTok / X / Facebook / Email)\n2. **Funnel stage** (TOFU / MOFU / BOFU / Retention)\n3. **Format** (Carousel / Reel / Static / Story / Long-form / Ad)\n4. **Intended audience**\n\nDrop everything in one message and I'll run the full analysis.`;

    return {
      aiResponse,
      currentSection: session.current_section,
      currentService: session.current_service,
      contextLocked:  session.context_locked,
      contextSummary: session.context_summary,
      nextMode:       4,
      serviceHistory: session.service_history || [],
      onboardingComplete: false,
    };
  }

  const raw = await callClaude({
    systemPrompt: buildContentPrompt(session.context_summary, !!imageBase64, type),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
    imageBase64,
    imageMediaType,
    dialectContext,
  });
  const aiResponse = stripJsonFences(raw);

  const existingLog = session.content_interrogation_log || '';
  const contentLog = existingLog
    + `\n${'─'.repeat(60)}\n`
    + `INTERROGATION [${type.toUpperCase()}]: ${new Date().toISOString()}\n`
    + aiResponse;

  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: session.current_service,
    contextLocked:  session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 4,
    serviceHistory: session.service_history || [],
    contentLog,
    onboardingComplete: false,
  };
}

function buildContentPrompt(contextSummary, hasImage, mode = 'score') {
  const visionNote = hasImage ? `
VISION ANALYSIS ACTIVE: An image has been submitted alongside the content.
In addition to text analysis, evaluate:
- visual_impact_score (1–10): Does the visual stop the scroll? Is it thumb-stopping on the target platform?
- text_design_harmony (1–10): Does the text overlay (if any) work with the visual? Are font, contrast, and spacing platform-appropriate?
Include both metrics in the scorecard JSON.
` : '';

  const contextBlock = contextSummary
    ? `LOCKED BUSINESS CONTEXT (use this throughout the analysis — brand voice, audience, goals, differentiators all apply):
${contextSummary}`
    : `No business context available — proceed based on what the user shares.`;

  const modeInstruction = mode === 'analyse'
    ? buildAnalysisPrompt(contextBlock, visionNote)
    : buildScorecardPrompt(contextBlock, visionNote);

  return modeInstruction;
}

// ── SCORECARD MODE (10-step full evaluation) ──────────────────
function buildScorecardPrompt(contextBlock, visionNote) {
  return `You are running the Content Interrogation Engine — a 10-step evaluation protocol.
You are now in INTERROGATION MODE. Your analysis is grounded in the locked business context below.

${contextBlock}
${visionNote}
BRAND VOICE RULE: When rewriting or suggesting revised copy, always use "we/our/us" — never "I/my/me". You are writing on behalf of the brand.

PRE-FLIGHT: If these 4 answers are not already confirmed in the conversation, ask for them first (as plain text, NOT JSON):
1. Platform (LinkedIn / Instagram / TikTok / X / Facebook / Email / WhatsApp / Other)
2. Funnel stage (TOFU / MOFU / BOFU / Retention)
3. Content format (Carousel / Reel / Static post / Story / Long-form / Short-form / Email / Ad)
4. Intended audience

Once content AND all 4 pre-flight answers are confirmed, run all 10 steps and output ONLY valid JSON.

THE 10-STEP ENGINE:

STEP 1 — AI AUTHENTICITY DETECTION
Analyze: predictable patterns, buzzword clustering, emotional neutrality, absence of specificity, formulaic structure, missing personal voice.
AI signal words: delve, fostering, robust, seamlessly, leverage, game-changing, empower, cutting-edge, holistic approach, synergy, paradigm shift, best-in-class, innovative solution, unlock potential.
Gate: AI Probability ≤30%.

STEP 2 — HOOK ANALYSIS
Evaluate: scroll-stop potential, curiosity gap, audience self-recognition, pattern interrupt, platform fit.
Gate: Hook Score ≥7/10.

STEP 3 — AUDIENCE SIMULATION
Dynamically derive 3 target personas from the locked business context + content provided.
For each: name their role/archetype, gut reaction, and single biggest credibility gap.

STEP 4 — STRATEGIC POSITIONING
Category leader signals? Original insight or recycled noise? Could a competitor post this verbatim?
Gate: Authority Signal ≥7/10.

STEP 5 — MESSAGING FRAMEWORK COMPLIANCE
TOFU: Hook → Problem → Insight → Soft CTA
MOFU: Problem → Consequence → Solution → Proof → CTA
BOFU: Objection → Proof → Urgency → Direct CTA
Retention: Value Delivery → Community → Upsell
Flag exactly where the narrative breaks.

STEP 6 — COMMERCIAL & CONVERSION IMPACT
Real stakes framed? Buyer anxiety reduced? Specific action driven?
Gate: Commercial Impact ≥ Moderate.

STEP 7 — PLATFORM, FORMAT & FUNNEL FIT
Right format? Right length? Correct funnel stage? Algorithm reward or suppress?
Gate: Platform ✓, Funnel ✓, Format ✓.

STEP 8 — CLOSING LINE EVALUATION
Quotable? Earns a save or share? Closes the loop the hook opened?
Gate: Closing Line ≥7/10.

STEP 9 — ENGAGEMENT & VIRALITY PREDICTION
Score each /10: Scroll Stop, Save Likelihood, Share/Forward, Comment Trigger.

STEP 10 — SCORECARD & AUTO-REWRITE
If Rewrite Required is Minor, Moderate, or Major — produce the full rewritten version automatically. Do not ask permission.

OUTPUT FORMAT — Return ONLY this JSON. No other text whatsoever:

{
  "mode": "scorecard",
  "overallScore": <Integer 0–100. Weighted composite of all 10 criteria.>,
  "summary": "<2–3 sentence executive verdict — what works, what breaks, single highest-leverage fix.>",
  "criteria": [
    { "name": "AI Authenticity",     "score": <1-10>, "feedback": "<1 sentence. Specific, actionable.>" },
    { "name": "Hook Strength",       "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Audience Fit",        "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Authority Signal",    "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Differentiation",     "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Cultural Resonance",  "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Closing Line",        "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Commercial Impact",   "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Platform Fit",        "score": <1-10>, "feedback": "<1 sentence.>" },
    { "name": "Engagement Potential","score": <1-10>, "feedback": "<1 sentence.>" }
  ],
  "recommendations": [
    "<Concrete action 1 — specific, not vague.>",
    "<Concrete action 2.>",
    "<Concrete action 3.>"
  ],
  "scorecard": {
    "ai_probability": <0-100>,
    "hook_score": <1-10>,
    "audience_conviction": <1-10>,
    "authority_signal": <1-10>,
    "differentiation": <1-10>,
    "cultural_resonance": <1-10>,
    "closing_line": <1-10>,
    "commercial_impact": "<Low|Moderate|High>",
    "visual_impact_score": <1-10 or null if no image>,
    "text_design_harmony": <1-10 or null if no image>,
    "overall": <1-10>
  },
  "audience_simulation": [
    { "persona_name": "<dynamically derived persona>", "reaction": "<gut reaction>", "credibility_gap": "<single biggest gap>" },
    { "persona_name": "<second persona>",              "reaction": "<reaction>",     "credibility_gap": "<gap>" },
    { "persona_name": "<third persona>",               "reaction": "<reaction>",     "credibility_gap": "<gap>" }
  ],
  "rewrite_required": "<None|Minor|Moderate|Major>",
  "verdict": "<single sentence: if published today on [Platform] as [Format] targeting [Audience], outcome: [specific prediction]>",
  "brutal_insight": "<one punchy, high-impact strategic takeaway — direct, specific, actionable.>",
  "rewritten_content": "<full rewritten version if rewrite_required is not None, else empty string>",
  "what_changed": ["<specific improvement 1>", "<specific improvement 2>", "<specific improvement 3>"]
}

ABSOLUTE OUTPUT RULE: Return ONLY a valid JSON object. No markdown, no intro text, no backticks, no code fences.
Start with { and end with }. Any character outside the JSON will break the parser.`;
}

// ── ANALYSIS MODE (strategic deep-dive) ──────────────────────
function buildAnalysisPrompt(contextBlock, visionNote) {
  return `You are the Content Interrogation Engine running in DEEP ANALYSIS MODE.
You are grounded in the locked business context. Every insight must reference the brand's actual goals, voice, and audience.

${contextBlock}
${visionNote}
BRAND VOICE RULE: When suggesting copy, always use "we/our/us" — never "I/my/me".

TASK: Perform a strategic deep-dive on the content provided.
- Assess alignment with the locked business context (brand voice, sector goals, audience profile)
- Identify what the content gets right (strengths), what it gets wrong (weaknesses), and the strategic gaps
- Assign an alignment score (0–100) reflecting how well the content serves the locked business goals
- Produce a concrete action plan

If the user hasn't confirmed platform / funnel stage / format / audience, infer them from context and state your assumption in the analysis.

OUTPUT FORMAT — Return ONLY this JSON. No other text whatsoever:

{
  "mode": "analysis",
  "alignmentScore": <Integer 0–100. How well the content aligns with the locked business goals and brand context.>,
  "summary": "<2–3 sentence executive summary: what the content is trying to do, how well it succeeds, single biggest strategic miss.>",
  "analysis": "<Paragraph-level deep dive (4–6 sentences). Cover tone, messaging, commercial intent, audience relevance, and brand alignment. Be specific — reference actual words or phrases from the content.>",
  "strengths": [
    "<Specific strength 1 — what works and why.>",
    "<Specific strength 2.>",
    "<Specific strength 3.>"
  ],
  "weaknesses": [
    "<Specific weakness 1 — what fails and the consequence.>",
    "<Specific weakness 2.>",
    "<Specific weakness 3.>"
  ],
  "strategicGaps": "<How this content fails to serve the locked business goals — missed opportunity, misaligned tone, wrong audience signal, or commercial gap. Be direct.>",
  "recommendations": [
    "<High-priority fix 1 — specific, actionable.>",
    "<High-priority fix 2.>",
    "<High-priority fix 3.>"
  ],
  "brutal_insight": "<One punchy, high-impact strategic takeaway — direct, specific, actionable.>",
  "rewrite_required": "<None|Minor|Moderate|Major>",
  "rewritten_content": "<Full rewritten version if rewrite_required is not None, else empty string>"
}

ABSOLUTE OUTPUT RULE: Return ONLY a valid JSON object. No markdown, no intro text, no backticks, no code fences.
Start with { and end with }. Any character outside the JSON will break the parser.`;
}
