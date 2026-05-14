# MARCOM v4 — Claude Code Project Guide

## Stack
- Node.js 18+ (ES Modules), Express.js, Anthropic Claude, Airtable, Clerk Auth, ScrapingBee, Gmail

## Architecture
```
src/server.js                   — Entry point. /webhook (secret), /api (Clerk JWT)
src/routes/master.js            — Mode router (1-5) + image payload
src/routes/export.js            — POST /api/export → N8N_EXPORT_WEBHOOK
src/modes/mode1-onboarding.js   — Agentic URL + graceful degradation
src/modes/mode2-service.js      — 18 tools dispatcher
src/modes/mode3-social.js       — 4-week calendar JSON
src/modes/mode4-content.js      — 10-step scorecard + vision
src/modes/mode5-campaign.js     — 2025/2026 media buying (ASC, MER, Horizontal)
src/utils/claude.js             — Anthropic SDK (text + vision)
src/utils/airtable.js           — MARCOM_Sessions CRUD
src/utils/scraper.js            — ScrapingBee URL fetcher
src/utils/email.js              — Nodemailer notifications
src/middleware/clerkAuth.js     — ClerkExpressRequireAuth → { error: "Unauthenticated" }
src/middleware/validateWebhook.js
src/middleware/errorHandler.js
frontend/index.html             — Marshmallow Light UI, Clerk JS, Lumi mascot, wizard
```

## Auth Model
- `/webhook/*` — protected by WEBHOOK_SECRET header (for n8n)
- `/api/*` — protected by Clerk JWT (Bearer token from frontend)
- Frontend awaits `window.Clerk.session.getToken()` before every `/api/*` fetch

## UI Design (Marshmallow)
- Light mode: creamy off-white (#FAFAF7), yellow (#FFD300), mint, coral
- Font: Poppins (Google Fonts)
- High border-radius on all cards/buttons, soft box-shadows
- Lumi (✨) as mascot avatar throughout

## Color Discipline Rule

Every view may use at most **3 brand colors** simultaneously:
- 1 structural (surface-border, surface-card)
- 1 accent (lumi-gold for CTAs only)
- 1 semantic (signal-kill OR signal-scale OR signal-hold — not all three)

**Never use more than one signal color in the same visual zone.**

Restraint = premium. More colors = cheaper feel.

## Key Variables
- `current_service` — internal DB/routing only; user sees "Tool 01–18"
- `MARCOM_Sessions` — Airtable table name
- `N8N_EXPORT_WEBHOOK` — server-side only; frontend never provides it

## Commands
```bash
npm install && npm run setup    # install + verify Airtable
npm run dev                     # start with --watch
npm test                        # integration tests (server must be running)
```

## Add a New Tool
1. Add guide to `serviceGuides` in mode2-service.js
2. Add keywords to `detectService()`
3. If hybrid (URL scrape): add to `HYBRID_SERVICES` array

## AUDIT MISMATCH GOVERNANCE RULE

When executing any prompt that assumes a specific codebase state:

1. **Run pre-flight greps first.** Every patch has a PROOF step. Run it.

2. **If assumption matches codebase** → proceed with the described patch.

3. **If assumption does NOT match** → STOP and print:
   ```
   AUDIT MISMATCH DETECTED
   Expected:  [what the prompt assumed]
   Actual:    [what grep found]
   Impact:    [what would break if we applied the patch blindly]
   Safe path: [minimal change that is still safe given actual state]
   Decision:  [proceed with safe path / BLOCKED — needs human input]
   ```

Never silently reinterpret scope. If the intended UX change
requires a component that doesn't exist yet, say so explicitly.
Do not invent a different solution without flagging the substitution.
Never combine audit mismatch adaptation with scope expansion.
Fix the mismatch first. New scope = new prompt.

### Examples

**Correct behavior:**
```
Pre-flight confirmed: TrustStrip component does not exist.
AUDIT MISMATCH: prompt assumed fake metrics in TrustStrip.
Safe adaptation: wire summary prop infrastructure only.
Blocking visual metric replacement until TrustStrip exists.
```

**Incorrect behavior (what to avoid):**
```
[silently creates TrustStrip with different design than intended,
or wires infrastructure and calls it "done" without flagging the gap]
```
