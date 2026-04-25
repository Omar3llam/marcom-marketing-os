// ============================================================
// MARCOM — Mode 4: Content Interrogation Engine
// Supports text + vision (image) analysis
// Strict JSON output → visual scorecard cards
// ============================================================
import { callClaude, stripJsonFences } from '../utils/claude.js';

export async function runMode4(session, userMessage, conversationHistory, imageBase64 = null, imageMediaType = 'image/jpeg') {
  const raw = await callClaude({
    systemPrompt: buildContentPrompt(session.context_summary, !!imageBase64),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
    imageBase64,
    imageMediaType,
  });
  const aiResponse = stripJsonFences(raw);

  const existingLog = session.content_interrogation_log || '';
  const contentLog = existingLog
    + `\n${'─'.repeat(60)}\n`
    + `INTERROGATION: ${new Date().toISOString()}\n`
    + aiResponse;

  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: session.current_service,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 4,
    serviceHistory: session.service_history || [],
    contentLog,
    onboardingComplete: false,
  };
}

function buildContentPrompt(contextSummary, hasImage) {
  const visionNote = hasImage ? `
VISION ANALYSIS ACTIVE: An image has been submitted alongside the content.
In addition to text analysis, evaluate:
- visual_impact_score (1–10): Does the visual stop the scroll? Is it thumb-stopping on the target platform?
- text_design_harmony (1–10): Does the text overlay (if any) work with the visual? Are font, contrast, and spacing platform-appropriate?
Include both metrics in the scorecard JSON.
` : '';

  return `You are MARCOM running the Content Interrogation Engine — a 10-step evaluation protocol.

Your tone is direct and consultative. Deliver verdicts clearly. Frame critique as strategic opportunity — you are the advisor who tells the truth and hands them the solution in the same breath.

CLIENT CONTEXT:
${contextSummary || 'Proceed based on what the user shares.'}
${visionNote}
PRE-FLIGHT: If these 4 answers are not already confirmed in the conversation, ask for them first:
1. Platform (LinkedIn / Instagram / TikTok / X / Facebook / Email / WhatsApp / Other)
2. Funnel stage (TOFU / MOFU / BOFU / Retention)
3. Content format (Carousel / Reel / Static post / Story / Long-form / Short-form / Email / Ad)
4. Intended audience

Once content AND all 4 pre-flight answers are confirmed, run all 10 steps and output ONLY valid JSON — no markdown fences, no preamble, no explanation outside the JSON.

THE 10-STEP ENGINE:

STEP 1 — AI AUTHENTICITY DETECTION
Analyze: predictable patterns, buzzword clustering, emotional neutrality, absence of specificity, formulaic structure, missing personal voice.
AI signal words: delve, fostering, robust, seamlessly, leverage, game-changing, empower, cutting-edge, holistic approach, synergy, paradigm shift, best-in-class, innovative solution, unlock potential.
Gate: AI Probability ≤30%.

STEP 2 — HOOK ANALYSIS
Evaluate: scroll-stop potential, curiosity gap, audience self-recognition, pattern interrupt, platform fit.
Gate: Hook Score ≥7/10.

STEP 3 — AUDIENCE SIMULATION
B2B: Economic Buyer (CFO/CEO — ROI/risk), Technical Buyer (CTO — credibility/integration), User Buyer (workflow impact), Procurement (vendor credibility/compliance).
B2C: Cold scroller (zero awareness), Warm (mild interest), Ready to buy (high intent).
Name the most skeptical reaction.

STEP 4 — STRATEGIC POSITIONING
Category leader signals? Original insight or recycled noise? Could a competitor post this verbatim? Operationally real or aspirationally vague?
Gate: Authority Signal ≥7/10.

STEP 5 — MESSAGING FRAMEWORK COMPLIANCE
TOFU: Hook → Problem Recognition → Insight → Soft CTA
MOFU: Problem → Consequence → Solution → Proof → CTA
BOFU: Objection Handling → Proof → Urgency → Direct CTA
Retention: Value Delivery → Community Signal → Upsell Bridge
B2B narrative: Problem → Consequence → Solution → Insight
B2C narrative: Relatable Moment → Emotional Consequence → Solution → Transformation
Flag exactly where narrative breaks.

STEP 6 — COMMERCIAL & CONVERSION IMPACT
Real stakes framed? Buyer anxiety reduced? Price justified? Specific action driven?
Gate: Commercial Impact ≥ Moderate.

STEP 7 — PLATFORM, FORMAT & FUNNEL FIT
Right format for platform? Right length for attention state? Correct funnel stage? Algorithm reward or suppress?
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
  "rewrite_required": "<None|Minor|Moderate|Major>",
  "verdict": "<single sentence: if published today on [Platform] as [Format] targeting [Audience], outcome: [specific prediction]>",
  "brutal_insight": "<one punchy, high-impact strategic takeaway — direct, specific, actionable. The single most important thing. Not a summary.>",
  "rewritten_content": "<full rewritten version if rewrite_required is not None, else empty string>",
  "what_changed": ["<specific improvement 1>", "<specific improvement 2>", "<specific improvement 3>"]
}

CRITICAL: Return ONLY valid JSON. Do not wrap the response in markdown blocks or backticks. Start directly with { and end with }.`;
}
