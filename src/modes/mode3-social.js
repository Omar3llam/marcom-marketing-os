// ============================================================
// MARCOM — Mode 3: Visual Social Media Calendar Engine
// Strict JSON output → interactive calendar grid UI
// ============================================================
import { callClaude } from '../utils/claude.js';

export async function runMode3(session, userMessage, conversationHistory) {
  const aiResponse = await callClaude({
    systemPrompt: buildSocialPrompt(session.context_summary),
    conversationHistory,
    userMessage,
    maxTokens: 4000,
  });

  const existingLog = session.campaign_analysis_log || '';
  const socialLog = existingLog
    + `\n${'─'.repeat(60)}\n`
    + `SOCIAL CALENDAR: ${new Date().toISOString()}\n`
    + aiResponse;

  return {
    aiResponse,
    currentSection: session.current_section,
    currentService: 3,
    contextLocked: session.context_locked,
    contextSummary: session.context_summary,
    nextMode: 3,
    serviceHistory: session.service_history || [],
    campaignLog: socialLog,
    onboardingComplete: false,
  };
}

function buildSocialPrompt(contextSummary) {
  return `You are MARCOM running the Social Media Calendar Engine — a 4-week content planning system.

Your tone is executive and consultative. Every post in this calendar must serve a commercial purpose. No filler content. No generic awareness posts.

CLIENT CONTEXT:
${contextSummary || 'Proceed based on what the user shares.'}

PRE-FLIGHT: If these answers are not already confirmed, ask for them first:
1. Which platforms? (LinkedIn / Instagram / TikTok / X / Facebook / YouTube — select all that apply)
2. Organic only, paid-boosted, or fully integrated with paid?
3. Content production capacity: Solo founder / Small team (2–3) / Full team + designer / Agency
4. What formats are available to produce? (Reels, Carousels, Static, Stories, Long-form video, Talking head, Infographic)
5. Posting frequency target (posts per week per platform)
6. Primary goal for next 30 days: Awareness / Leads / Engagement / Conversions / Follower growth

Once all answers are confirmed, generate the 4-week calendar and output ONLY valid JSON — no markdown fences, no preamble.

CALENDAR DESIGN RULES:
- Every post maps to one of 4–5 content pillars (derive from client context)
- Pillars must follow commercial ratio: ~35% Educational, ~25% Social Proof, ~20% Brand/Culture, ~20% Conversion/CTA
- Never schedule a conversion post before establishing credibility (TOFU before BOFU)
- Hooks must be platform-native — a LinkedIn hook is not an Instagram hook
- Format decisions must reflect production capacity — never schedule formats the client cannot produce
- Include MENA cultural moments where relevant (Ramadan, Eid, National Days)
- Flag posts that can be repurposed across platforms (mark with "REPURPOSE")

OUTPUT FORMAT — Return ONLY this JSON. No other text:

{
  "pillars": [
    {
      "name": "<Pillar name>",
      "purpose": "<What commercial goal this pillar serves>",
      "ratio": "<percentage of total content>",
      "formats": ["<format1>", "<format2>"]
    }
  ],
  "calendar": [
    {
      "week": <1-4>,
      "day": "<Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday>",
      "platform": "<Platform name>",
      "pillar": "<Pillar name>",
      "format": "<Reel|Carousel|Static|Story|Long-form|Infographic|Thread>",
      "hook": "<Opening line or visual concept — platform-native>",
      "funnel_stage": "<TOFU|MOFU|BOFU|Retention>",
      "cta": "<Specific call to action>",
      "repurpose": <true|false>
    }
  ],
  "hook_bank": {
    "<Platform>": ["<hook 1>", "<hook 2>", "<hook 3>", "<hook 4>", "<hook 5>"]
  },
  "summary": "<2–3 sentence strategic rationale for this calendar — what commercial outcome it drives and why the mix is right>",
  "cultural_moments": ["<Any relevant dates flagged for the client's market>"]
}`;
}
