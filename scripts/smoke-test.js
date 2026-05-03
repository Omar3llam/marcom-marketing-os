// ============================================================
// MARCOM / Lumi — Phase 4 Smoke Test (DB-free)
// ------------------------------------------------------------
// Run with:  node scripts/smoke-test.js
//
// Goal:  Prove the end-to-end Phase-4 orchestration works
//        without depending on a live Postgres / Redis stack.
//
// Approach:
//   1. Stub the Prisma client at module-cache level so
//      `contextBuilder` returns a fixed CampaignState +
//      DecisionMemory[3] instead of hitting the DB.
//   2. Run ClaudeAgent  (analysis pass) and
//      ChatGPTAgent    (creative-fix pass) in sequence,
//      simulating an Orchestrator handoff.
//   3. Print the structured JSON result.
//
// Skips gracefully if the relevant API key is missing.
// ============================================================
import dotenv from 'dotenv';
dotenv.config({ override: true });   // override stale shell-exports (e.g. empty ANTHROPIC_API_KEY)

// ── 1. Stub Prisma BEFORE importing anything that uses it ────
// The contextBuilder imports `prisma` from `../lib/prisma.js`.
// We replace that module's exports in the ESM cache by hijacking
// the import. Simplest portable trick: monkey-patch after import.
import { prisma } from '../src/lib/prisma.js';

const FAKE_CAMPAIGN_ID = 'smoke-camp-001';
const FAKE_WORKSPACE   = '00000000-0000-0000-0000-000000000001';

const fakeState = {
  campaignId:   FAKE_CAMPAIGN_ID,
  workspaceId:  FAKE_WORKSPACE,
  stage:        'FATIGUED',
  healthScore:  0.42,
  lastAnalysis: new Date(Date.now() - 30 * 60_000),
};

const fakeMemory = [
  {
    actionType:        'meta.scale_budget',
    decisionRationale: 'Doubled daily budget after 3 days of >3x ROAS',
    resultStatus:      'regression',
    deltaCtr:          -0.0048,
    deltaRoas:         -0.62,
    impactDurationHrs: 24,
    isSustainable:     false,
    recordedAt:        new Date(Date.now() - 26 * 60 * 60_000),
  },
  {
    actionType:        'meta.swap_creative',
    decisionRationale: 'Replaced static carousel with UGC reel',
    resultStatus:      'sustained_lift',
    deltaCtr:          0.0091,
    deltaRoas:         0.34,
    impactDurationHrs: 24,
    isSustainable:     true,
    recordedAt:        new Date(Date.now() - 50 * 60 * 60_000),
  },
  {
    actionType:        'meta.tighten_audience',
    decisionRationale: 'Narrowed lookalike from 5 % to 1 %',
    resultStatus:      'regression',
    deltaCtr:          -0.0021,
    deltaRoas:         -0.18,
    impactDurationHrs: 24,
    isSustainable:     false,
    recordedAt:        new Date(Date.now() - 75 * 60 * 60_000),
  },
];

prisma.campaignState  = { findUnique: async () => fakeState };
prisma.decisionMemory = { findMany:   async () => fakeMemory };

console.log('▶ Prisma stubbed. CampaignState.stage =', fakeState.stage,
            '| memory rows =', fakeMemory.length);

// ── 2. Now import the agents (they'll bind to the stubbed prisma) ─
const { runClaudeAgent }   = await import('../src/agents/ClaudeAgent.js');
const { runChatGPTAgent }  = await import('../src/agents/ChatGPTAgent.js');
const { getRenderedContext } = await import('../src/agents/contextBuilder.js');

// Sanity: confirm the stub is wired
const ctxPreview = await getRenderedContext(FAKE_CAMPAIGN_ID);
console.log('\n── Injected context preview ──\n' + ctxPreview + '\n');

// ── 3. Orchestrator: Claude analyses, ChatGPT proposes the fix ─
const result = { campaignId: FAKE_CAMPAIGN_ID, steps: [] };

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠ ANTHROPIC_API_KEY missing — skipping Claude analysis pass');
  result.steps.push({ agent: 'claude', skipped: true, reason: 'no_api_key' });
} else {
  console.log('▶ Step 1/2 — ClaudeAgent (analysis) ...');
  try {
    const t0 = Date.now();
    const claudeOut = await runClaudeAgent({
      campaignId: FAKE_CAMPAIGN_ID,
      role:       'You are Lumi, a senior performance-marketing analyst.',
      task:       'In ≤120 words, diagnose why this campaign is FATIGUED and ' +
                  'pick the SINGLE highest-leverage corrective action. ' +
                  'Return strict JSON: { "diagnosis": "...", "recommendedAction": "...", "rationale": "..." }',
      maxTokens:  600,
    });
    result.steps.push({
      agent: 'claude',
      ok:    true,
      latencyMs: Date.now() - t0,
      contextInjected: claudeOut.contextInjected,
      output: tryParseJson(claudeOut.text),
    });
    console.log('   ✓ Claude responded in', Date.now() - t0, 'ms');
  } catch (err) {
    result.steps.push({ agent: 'claude', ok: false, error: err.message });
    console.error('   ✗ Claude failed:', err.message);
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠ OPENAI_API_KEY missing — skipping ChatGPT creative pass');
  result.steps.push({ agent: 'chatgpt', skipped: true, reason: 'no_api_key' });
} else {
  console.log('\n▶ Step 2/2 — ChatGPTAgent (creative fix) ...');
  try {
    const t0 = Date.now();
    const handoff = result.steps.find(s => s.agent === 'claude' && s.ok)?.output;
    const chatOut = await runChatGPTAgent({
      campaignId: FAKE_CAMPAIGN_ID,
      role:       'You are Lumi, a creative strategist generating ad-copy variants.',
      task:       'Given the analyst handoff below, write 2 headline + primary-text ' +
                  'variants for the corrective action. Return strict JSON: ' +
                  '{ "variants": [{"headline":"...", "primaryText":"..."}] }\n\n' +
                  'Analyst handoff: ' + JSON.stringify(handoff || {}),
      maxTokens:  500,
    });
    result.steps.push({
      agent: 'chatgpt',
      ok:    true,
      latencyMs: Date.now() - t0,
      contextInjected: chatOut.contextInjected,
      output: tryParseJson(chatOut.text),
    });
    console.log('   ✓ ChatGPT responded in', Date.now() - t0, 'ms');
  } catch (err) {
    result.steps.push({ agent: 'chatgpt', ok: false, error: err.message });
    console.error('   ✗ ChatGPT failed:', err.message);
  }
}

console.log('\n══════════════ FINAL ORCHESTRATOR OUTPUT ══════════════');
console.log(JSON.stringify(result, null, 2));
console.log('═══════════════════════════════════════════════════════');
process.exit(0);

// ── helpers ──────────────────────────────────────────────────
function tryParseJson(s) {
  if (typeof s !== 'string') return s;
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return { _raw: s }; }
}
