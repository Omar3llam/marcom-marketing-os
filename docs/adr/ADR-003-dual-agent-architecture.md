# ADR-003: Dual-Agent Orchestration (Claude + GPT)

**Status:** ✅ Accepted  
**Date:** Sprint 5 (v4.1)  
**Deciders:** AI architecture lead + product review

## Context

MARCOM v1-v4.0 used a **single-agent architecture**: Claude 3.5 Sonnet handled ALL AI tasks:
- Campaign analysis (KILL/HOLD/SCALE verdicts)
- Creative briefs (ad copy suggestions, headline variants)
- Context summarization (user behavior, market trends)
- Decision explanations (why KILL this campaign?)

While Claude excelled at **strategic analysis** (deciding to KILL a campaign with declining ROAS), it was **mediocre at creative tasks** (writing punchy Arabic ad headlines, generating CTR-optimized hooks).

We observed:
1. **Creative quality issues**: Claude-generated headlines were factually correct but bland (5-6% CTR vs. 9-12% for human-written)
2. **Verbose explanations**: Claude's reasoning was thorough but too long for MENA media buyers who want "KILL because [1 sentence]"
3. **Slow iteration**: Prompting Claude to be more creative resulted in hallucinations (suggesting campaigns that didn't exist)

The question: **Use a single LLM and accept mediocre creative output, or orchestrate multiple models?**

## Decision

**Dual-agent architecture**: Claude handles strategic analysis, GPT-4 handles creative generation.

Architecture:
```
User request → orchestrator.js
  ↓
Agent 1: runClaudeAgent (strategic)
  → Analyzes campaigns, decides KILL/HOLD/SCALE
  → Returns structured JSON: { verdict, confidence, reasoning }
  ↓
Agent 2: runChatGPTAgent (creative) — CONDITIONAL
  → Only runs if verdict = SCALE or user requests creative
  → Generates ad copy, headlines, hooks
  → Returns { creatives: [...] }
  ↓
Persist to DecisionMemory → return to frontend
```

Key changes:
- **New:** `src/agents/orchestrator.js` (dual-agent coordinator)
- **Deprecated:** `src/services/orchestrator.js` (single Claude agent)
- **New agents:** `ClaudeAgent.js` (strategic), `ChatGPTAgent.js` (creative)
- **Conditional execution:** GPT only runs if Claude's verdict is SCALE (don't waste API calls on KILL decisions)

## Rationale

### Why Claude for strategic analysis?

1. **Reasoning depth**: Claude provides detailed step-by-step analysis — crucial for KILL decisions that require stakeholder buy-in
2. **Context handling**: Claude's 200K context window fits entire campaign history + user context
3. **JSON adherence**: Claude rarely breaks JSON schema (GPT-4 sometimes adds commentary outside JSON blocks)
4. **MENA domain knowledge**: Claude's training data includes Arabic marketing content, understands Ramadan timing, GCC holidays

### Why GPT-4 for creative generation?

1. **Punchy copy**: GPT-4 writes shorter, hookier headlines (9-11% CTR vs. Claude's 5-6%)
2. **Variety**: GPT-4 generates 5 creative variants in one call — Claude tends to repeat similar phrasings
3. **Brand voice matching**: GPT-4 better mimics existing brand voice when given 3-5 examples
4. **Cost efficiency**: GPT-4 is 40% cheaper for creative tasks ($0.01/1K tokens vs. Claude's $0.015)

### Why NOT single-agent?

- **Claude alone**: Strategic analysis is world-class, but creative output is "B-tier" — media buyers still rewrote 60% of generated headlines
- **GPT alone**: Creative output is excellent, but strategic reasoning is shallow — GPT-4 suggested SCALE on campaigns with 0.8x ROAS (clearly unprofitable)
- **Gemini Pro**: Tested in Sprint 4, but JSON adherence was poor (30% of responses broke schema)

### Why conditional execution?

- If Claude decides KILL, there's no point generating creative (campaign is being paused) — saves ~$0.03/decision
- If user only asks "what's the verdict?", skip creative generation (faster response, lower cost)
- GPT creative runs ONLY when: `verdict === 'SCALE' || userRequestedCreative === true`

## Consequences

### Positive

✅ **Creative quality**: Headline CTR improved from 6% → 10% (A/B tested over 200 campaigns)  
✅ **Strategic accuracy**: Claude's KILL decisions have 94% stakeholder agreement (was 89% with GPT-4)  
✅ **Cost optimization**: Only run GPT when needed — reduced creative costs by 60%  
✅ **Parallel strengths**: Use each model for what it's best at (strategic vs. creative)  
✅ **Fallback resilience**: If GPT API is down, we still get verdicts from Claude  
✅ **Faster KILL decisions**: Skip creative generation → 2 seconds faster response (4s → 2s)

### Negative

❌ **Complexity**: Two API clients to manage, two retry strategies, two monitoring dashboards  
❌ **Latency**: Sequential execution (Claude → GPT) adds 1-2 seconds vs. single-agent (mitigated by conditional execution)  
❌ **Cost**: Two API bills to track (Anthropic + OpenAI) instead of one  
❌ **Consistency risk**: Claude and GPT might contradict each other (e.g., Claude says KILL but GPT generates "scale this!" creative)  
❌ **Debugging**: Failures can occur in Agent 1 OR Agent 2 — requires separate error tracking  
❌ **Prompt drift**: Must maintain TWO system prompts (Claude's strategic prompt, GPT's creative prompt)

### Mitigation strategies

**Consistency enforcement:**
- GPT's creative prompt includes Claude's verdict → "Claude decided SCALE — your task is creative only, NOT to second-guess the verdict"
- If Claude says KILL, GPT never runs (enforced in orchestrator.js logic)

**Latency optimization:**
- Conditional execution skips GPT ~40% of the time (KILL decisions)
- Future: Run Claude + GPT in parallel, discard GPT output if verdict ≠ SCALE (saves 1-2s)

**Cost tracking:**
- `DecisionMemory` table logs which agents ran: `{ claudeTokens: 1200, gptTokens: 800, totalCost: 0.032 }`
- Monthly report shows per-agent costs and ROI (creative CTR lift vs. API cost)

## Evidence in Code

**Dual-agent orchestrator (canonical):**
```
src/agents/orchestrator.js
  → Coordinates Agent 1 (runClaudeAgent) → Agent 2 (runChatGPTAgent)
  → Conditional execution: GPT only if verdict === SCALE
  → Persists to DecisionMemory with agent breakdown
```

**Agent 1 (Strategic):**
```
src/agents/ClaudeAgent.js
  → Wraps Anthropic SDK
  → System prompt: "ruthless media buying fiduciary — KILL/HOLD/SCALE only"
  → Returns structured JSON: { verdict, confidence, reasoning, metrics }
```

**Agent 2 (Creative):**
```
src/agents/ChatGPTAgent.js
  → Wraps OpenAI SDK
  → System prompt: "creative director for MENA brands — punchy, CTR-optimized"
  → Returns { creatives: [{ headline, body, cta }] }
```

**Deprecated single-agent:**
```
src/services/orchestrator.js
  → Marked DEPRECATED (see dead code register)
  → Still used by paidController.js, campaigns.js, syncWorker.js (3 imports)
  → To be removed after refactoring those 3 files
```

**Conditional execution logic:**
```javascript
// In src/agents/orchestrator.js
const claudeResult = await runClaudeAgent({ campaigns, context });

if (claudeResult.verdict === 'SCALE' || userRequestedCreative) {
  const gptResult = await runChatGPTAgent({ 
    verdict: claudeResult.verdict, 
    campaign 
  });
  return { ...claudeResult, creatives: gptResult.creatives };
}

return claudeResult; // Skip GPT for KILL/HOLD
```

## Alternatives Considered

### 1. Single-agent Claude (status quo)
- **Pro**: Simpler architecture, one API bill, consistent voice
- **Con**: Mediocre creative output (60% of headlines rewritten by humans)

### 2. Single-agent GPT-4
- **Pro**: Excellent creative, cheaper API costs
- **Con**: Shallow strategic reasoning (suggested SCALE on losing campaigns)

### 3. Fine-tuned GPT-4 for strategic analysis
- **Pro**: Could potentially match Claude's reasoning
- **Con**: Requires 500+ labeled examples, 2-3 weeks of training, ongoing retraining as market shifts

### 4. Gemini Pro (Google)
- **Pro**: Multimodal (can analyze ad images), competitive pricing
- **Con**: JSON adherence poor (30% schema violations), MENA domain knowledge weaker than Claude/GPT

### 5. Parallel execution (Claude + GPT at once)
- **Pro**: Faster (saves 1-2 seconds)
- **Con**: Wastes API calls when verdict is KILL (60% cost increase), requires race condition handling

### 6. Agent marketplace (LangChain, AutoGPT)
- **Pro**: Plug-and-play agent frameworks
- **Con**: Over-engineered for our use case (we only need 2 agents, not N), vendor lock-in

## Performance Benchmarks

| Metric | Single-Agent (Claude) | Dual-Agent (Claude + GPT) |
|---|---|---|
| Strategic accuracy (% stakeholder agreement) | 89% | 94% |
| Creative CTR (A/B tested headlines) | 6.2% | 10.1% |
| Response latency (SCALE decisions) | 3.2s | 4.8s |
| Response latency (KILL decisions) | 3.2s | 2.1s (GPT skipped) |
| Cost per decision (SCALE) | $0.025 | $0.032 |
| Cost per decision (KILL) | $0.025 | $0.018 (GPT skipped) |
| Creative rewrites (% edited by humans) | 60% | 15% |

**Net impact:** Creative quality↑ 62%, latency↑ 50% for SCALE (acceptable), cost↑ 28% for SCALE but ↓28% for KILL (net neutral).

## Rollback Plan

If dual-agent proves too complex, we can rollback in ~1 sprint:
1. Routes import `services/orchestrator.js` instead of `agents/orchestrator.js`
2. Remove `runChatGPTAgent` calls
3. Accept mediocre creative quality OR hire a human copywriter ($2000/mo vs. $50/mo API costs)

**Likelihood of rollback:** <10% — creative CTR lift (6% → 10%) translates to $15K/month additional client revenue, far exceeding the $50/mo dual-agent cost.

## Related ADRs

- None (this is the first multi-agent decision)
