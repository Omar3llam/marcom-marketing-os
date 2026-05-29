# MARCOM Wiring Fix — Phased Prompts
**Based on:** WIRING-AUDIT-2026-05-29.md  
**GitHub verified:** 2026-05-29 (all findings confirmed on master)  
**Live browser audit:** 2026-05-29 — 2 additional critical bugs found in production

Use each prompt below in a new Claude Code session. Phases 1–5 address the original static audit. **Phases 6–7 are new critical bugs found during live browser testing and should be treated as urgent.**

---

## Phase 1 — Fix `getActiveRoute` (Critical, ~5 min)

> **What:** `getActiveRoute` in `client/src/config/routes.ts` is a synchronous function that uses `await import()` on line 62 — this is a syntax error at runtime that crashes any component calling it.

```
Fix the broken `getActiveRoute` function in client/src/config/routes.ts.

The problem: the function is declared as a regular synchronous function (line 57:
`export function getActiveRoute(...): string`) but uses `await import('./features.js')` 
on line 62 inside it. `await` is only valid inside async functions — this throws a 
SyntaxError at runtime.

The fix: replace the dynamic import with a static import at the top of the file.

Specifically:
1. Add a static import at the top of client/src/config/routes.ts:
   import { features } from './features.js';

2. Remove line 62:
   const { features } = await import('./features.js');

3. Change the function signature from:
   export function getActiveRoute(route: keyof typeof routes.v1, forceVersion?: 'v1' | 'v2'): string
   to keep it synchronous (no async needed once the import is static).

4. Update the return type annotation from `: string` — it can stay as `: string` since 
   we're removing the async.

Make only these changes. Do not refactor anything else in the file.
After editing, confirm there are no TypeScript errors by checking if the import 
of features from './features.js' resolves correctly (check what features.ts exports).
```

---

## Phase 2 — Fix SSE Heartbeat (Critical, ~10 min)

> **What:** The server sends SSE heartbeats as comments (`: heartbeat\n\n`) which browsers silently discard — they're never dispatched as `message` events. The client's 30s heartbeat timeout matches the server's 30s interval exactly, causing a constant reconnect loop.

```
Fix the SSE heartbeat mismatch between server and client in the marcom-marketing-os project.

ROOT CAUSE:
- Server (src/routes/events.js, line 140) sends: res.write(': heartbeat\n\n')
  This is an SSE *comment*. The browser EventSource API silently drops SSE comments —
  they are never dispatched as `message` events.
- Client (client/src/services/sseClient.ts, line 251) calls resetHeartbeat() inside
  handleMessage(), which is never triggered by comments.
- Client heartbeat timeout = 30,000ms, server interval = 30,000ms.
  Result: the client always times out and reconnects on idle connections.

REQUIRED CHANGES:

1. In src/routes/events.js — change heartbeat from a comment to a real data event:
   BEFORE: res.write(': heartbeat\n\n');
   AFTER:  res.write(`data: ${JSON.stringify({ type: 'HEARTBEAT', timestamp: new Date().toISOString() })}\n\n`);

2. In client/src/services/sseClient.ts — the handleMessage method already checks for
   HEARTBEAT type (line 257: `if (data.type === 'HEARTBEAT'...`) and calls resetHeartbeat()
   at the top of handleMessage. This logic is ALREADY CORRECT once the server emits real 
   data events. No change needed in sseClient.ts other than removing the dead check for 
   the string `': heartbeat'` since that can never appear in event.data:
   BEFORE: if (data.type === 'HEARTBEAT' || event.data === ': heartbeat')
   AFTER:  if (data.type === 'HEARTBEAT')

3. Also increase the client heartbeat timeout from 30,000ms to 65,000ms to give a
   comfortable buffer (> 2x server interval) in case of network jitter:
   In client/src/services/sseClient.ts, find: heartbeatTimeout: 30_000
   Change to: heartbeatTimeout: 65_000
   (Both the default in createSSEClient() at the bottom and the SSEClientOptions default.)

Make only these three targeted changes. Do not alter SSE reconnect logic, backoff 
timings, or anything else in sseClient.ts.
```

---

## Phase 3 — Clean Up Environment Config (Medium, ~15 min)

> **What:** Three env config issues: (1) `client/.env.example` only documents a stale Clerk key — Firebase vars are missing, (2) root `.env.example` still has Clerk/JWT relics from the old auth system, (3) root `.env` has duplicated template content pasted into it.

```
Clean up environment configuration files in the marcom-marketing-os project.
Make all three changes below. Do not touch .env (the actual secrets file).

─── CHANGE 1: Update client/.env.example ───────────────────────────────────

client/.env.example currently only has VITE_CLERK_PUBLISHABLE_KEY which is stale 
(Clerk was replaced by Firebase — see ADR-001). Replace the entire file contents with:

# ============================================================
# MARCOM / Lumi — React client env (Vite)
# ------------------------------------------------------------
# Copy to client/.env.local for local dev.
# In production, set these in Render's web-service env vars
# BEFORE the build step runs (see render.yaml).
# ============================================================

# ── Firebase (required) ──────────────────────────────────────
# Get from: Firebase Console → Project Settings → General → Your apps
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=

─── CHANGE 2: Remove Clerk/JWT relics from root .env.example ────────────────

In .env.example, delete the following sections entirely (they reference auth systems
that have been fully replaced by Firebase — ADR-001):

  # ── CLERK ─── section (lines with CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, 
    and their comments)
  
  # ── JWT AUTH section (lines with JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE, 
    JWT_EXPIRES_IN, CLERK_JWKS_URL, and their comments)

Keep everything else in .env.example exactly as-is.

─── CHANGE 3: Fix the duplicated content in root .env ───────────────────────

Open .env (root). The file currently has its real config in lines 1–61, then 
lines 62 onwards is a near-duplicate paste of the .env.example template. This 
duplicate block starts at the line:
  # ============================================================
  # MARCOM v4 — Environment Configuration
  # Copy to .env — NEVER commit .env to version control
  (second occurrence of this header)

Delete everything from that second header to the end of file. Keep only lines 1–61
(the real config block with actual values).

After making all three changes, verify:
- client/.env.example has 7 VITE_FIREBASE_* keys and no VITE_CLERK_* key
- .env.example has no CLERK_* or JWT_* lines
- .env has no duplicated header block
```

---

## Phase 4 — Fix Dead Code & Minor Issues (Low, ~10 min)

> **What:** Two minor cleanup items: (1) dead `req.user?.workspaceId` reference in events.js, (2) hardcoded Firebase fallback values in firebase.js that could silently slip into production if VITE vars aren't set on Render.

```
Two minor cleanup fixes in marcom-marketing-os. Make both changes.

─── CHANGE 1: Remove dead req.user?.workspaceId in src/routes/events.js ─────

In src/routes/events.js, find this line in the POST /token handler:
  const workspaceId = req.user?.workspaceId || req.workspaceId;

Replace with:
  const workspaceId = req.workspaceId;

Explanation: req.user is the decoded Firebase token object from 
admin.auth().verifyIdToken(). Firebase tokens don't have a workspaceId claim — 
that field is only on req.workspaceId (set by firebaseAuthMiddleware via Prisma).
So req.user?.workspaceId is always undefined. The || fallback does all the work.
This is dead code that misleads anyone reading it.

─── CHANGE 2: Guard hardcoded Firebase fallback values in firebase.js ───────

In client/src/firebase.js, the fallback() helper function is used to set 
hardcoded dev default values (apiKey, authDomain, projectId, etc.) for convenience.
These values are also the real production Firebase config, which means if Render's
build doesn't have VITE_FIREBASE_* set, the prod bundle silently uses these 
hardcoded values without error.

The hardcoded defaults are fine for development but should NOT silently apply
in production. Add a console.warn when a fallback fires in production:

In the fallback function, change:
  const fallback = (envKey, devDefault) =>
    import.meta.env[envKey] || (isDev ? devDefault : '');

To:
  const fallback = (envKey, devDefault) => {
    if (import.meta.env[envKey]) return import.meta.env[envKey];
    if (isDev) return devDefault;
    console.error(`[Firebase] Missing required env var in production: ${envKey}`);
    return '';
  };

This makes misconfigured production deployments immediately visible in the 
browser console instead of silently falling back to what might be wrong values.

Make only these two targeted changes.
```

---

## Phase 5 — Verify All Fixes (Validation)

> **What:** Run this after all previous phases to confirm nothing is broken.

```
Validate the four phases of fixes applied to marcom-marketing-os.

Run the following checks and report pass/fail for each:

1. TypeScript check on routes.ts:
   cd client && npx tsc --noEmit --project tsconfig.json 2>&1 | grep routes.ts
   Expected: no errors on routes.ts

2. Confirm getActiveRoute is no longer async:
   grep -n "async\|await" client/src/config/routes.ts
   Expected: no matches (no async/await in routes.ts)

3. Confirm SSE heartbeat is now a data event:
   grep -n "heartbeat" src/routes/events.js
   Expected: line should contain `data:` and `JSON.stringify` and `HEARTBEAT`
   NOT a bare `: heartbeat` comment

4. Confirm client heartbeat timeout is 65000:
   grep -n "heartbeatTimeout\|heartbeat_timeout\|65" client/src/services/sseClient.ts
   Expected: 65_000 or 65000 appears

5. Confirm client/.env.example has Firebase vars:
   grep "VITE_FIREBASE" client/.env.example
   Expected: 7 lines with VITE_FIREBASE_*
   grep "VITE_CLERK" client/.env.example
   Expected: no matches

6. Confirm .env.example has no Clerk/JWT:
   grep -i "clerk\|jwt_secret\|jwt_issuer" .env.example
   Expected: no matches

7. Confirm .env has no duplicate header:
   grep -c "MARCOM v4 — Environment Configuration" .env
   Expected: 1 (only one occurrence)

8. Confirm dead workspaceId reference is gone:
   grep "req.user?.workspaceId" src/routes/events.js
   Expected: no matches

Report each check as ✅ PASS or ❌ FAIL with the actual output.
If any fail, show the diff needed to fix it.
```

---

## Phase 6 — Fix SSE Retry Storm (Critical — Found in Live Audit, ~20 min)

> **What:** `useSSE` lists `options.onMessage` in its `useEffect` dependency array. Since callers (like `DecisionFeed`) pass inline arrow functions, the reference changes every render, re-running the effect, recreating the SSEClient from scratch (resetting `reconnectAttempts` to 0), and restarting the connection loop. This produced **1,000+ network requests and 6,669 console messages** on the `/app/feed` page in production within minutes. Additionally, the SSEClient doesn't treat 429 responses specially — it retries them with backoff just like any other error, making a rate-limit situation dramatically worse.

```
Fix two related SSE problems in marcom-marketing-os that were found during live browser testing.

─── PROBLEM 1: useSSE re-creates SSEClient on every render ─────────────────

File: client/src/services/useSSE.ts

The useEffect that creates the SSEClient (lines 86–117) lists options.onMessage,
options.onError, options.autoConnect, options.maxRetries, options.baseDelay, and
options.maxDelay in its dependency array. When callers pass inline functions (which
get a new reference on every render), this effect re-runs constantly — disconnecting
the old client and creating a new one with reconnectAttempts = 0, bypassing the
maxRetries guard completely.

FIX — Store callbacks in refs so the SSEClient is created ONCE:

Replace the entire useSSE function with this implementation:

export function useSSE(options: UseSSEOptions): UseSSEResult {
  const [state, setState] = useState<SSEState>('IDLE');
  const [metrics, setMetrics] = useState<SSEMetrics>({
    state: 'IDLE',
    reconnectAttempts: 0,
    lastConnected: null,
    lastDisconnected: null,
    downtime: 0,
    totalMessages: 0,
    totalErrors: 0,
  });

  const clientRef = useRef<SSEClient | null>(null);

  // Store callbacks in refs so SSEClient is not recreated when they change
  const onMessageRef = useRef(options.onMessage);
  const onErrorRef = useRef(options.onError);
  useEffect(() => { onMessageRef.current = options.onMessage; }, [options.onMessage]);
  useEffect(() => { onErrorRef.current = options.onError; }, [options.onError]);

  // Create SSEClient ONCE on mount — never recreate it
  useEffect(() => {
    const client = new SSEClient({
      onMessage: (event) => onMessageRef.current(event),
      onError: (error) => onErrorRef.current?.(error),
      onStateChange: (newState) => {
        setState(newState);
        setMetrics(client.getMetrics());
      },
      maxRetries: options.maxRetries,
      baseDelay: options.baseDelay,
      maxDelay: options.maxDelay,
    });

    clientRef.current = client;

    if (options.autoConnect) {
      client.connect();
    }

    return () => {
      client.disconnect();
    };
  }, []); // ← EMPTY dependency array: create once, never recreate

  // Update metrics periodically while connected
  useEffect(() => {
    if (state === 'CONNECTED' || state === 'RECONNECTING') {
      const interval = setInterval(() => {
        if (clientRef.current) {
          setMetrics(clientRef.current.getMetrics());
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [state]);

  const connect = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  }, []);

  return {
    state,
    metrics,
    connect,
    disconnect,
    isConnected: state === 'CONNECTED',
    isConnecting: state === 'CONNECTING',
    isReconnecting: state === 'RECONNECTING',
    isFailed: state === 'FAILED',
  };
}

─── PROBLEM 2: SSEClient retries on 429 instead of backing off ─────────────

File: client/src/services/sseClient.ts

In the connect() method, when api.post('/api/events/token') fails with a 429
(RateLimitError), handleConnectionError() calls scheduleReconnect() with normal
exponential backoff. But each retry hits the same rate limit, making it worse
and driving the retry count to FAILED — after which a re-mount (from Problem 1)
starts the whole cycle over.

FIX — In the connect() method's catch block, check for 429 and use the
Retry-After header if available, or a 60s minimum:

In sseClient.ts, change the catch block of connect() from:
  } catch (error: any) {
    this.handleConnectionError(error);
  }

To:
  } catch (error: any) {
    // Special handling for rate limit — back off much longer
    const isRateLimit = error?.httpStatus === 429 || error?.code === 'RATE_LIMIT_EXCEEDED';
    if (isRateLimit) {
      const retryAfterSec = parseInt(error?.context?.retryAfter || '60', 10);
      const retryMs = Math.max(retryAfterSec * 1000, 60_000);
      console.warn(`[SSEClient] Rate limited on token request — waiting ${retryMs}ms before retry`);
      this.transitionTo('RECONNECTING');
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectAttempts = 0; // reset so retry budget is fresh after the long wait
        this.connect();
      }, retryMs);
      return;
    }
    this.handleConnectionError(error);
  }

Make only these two targeted changes to useSSE.ts and sseClient.ts.
After editing, confirm no TypeScript errors with: cd client && npx tsc --noEmit 2>&1 | grep -E "useSSE|sseClient"
```

---

## Phase 7 — Fix ProtectedRoute False-Logout on Transient Errors (Critical — Found in Live Audit, ~15 min)

> **What:** `ProtectedRoute`'s context API error handler treats **any** failure — including 429 rate limits, 5xx errors, network timeouts — as "user is not onboarded". It wipes localStorage and publishes `hasContext: false`, bouncing the authenticated user to `/onboarding`. This was triggered in production simply by navigating between pages quickly. The fix is to distinguish transient errors (fall back to cached state) from real "not onboarded" signals (only when API explicitly returns `{context: null}`).

```
Fix the ProtectedRoute false-logout bug in client/src/router/ProtectedRoute.jsx.

PROBLEM:
In the useUserContext hook, the .catch() block (around line 153) does this on ANY error:
  setStoredOnboardingState(false);
  publish({ loading: false, hasContext: false });

This includes 429 (rate limit), 503, network errors, and timeouts — all of which are
transient and have nothing to do with whether the user is onboarded. The result: a
user who navigates between pages quickly triggers the rate limiter, gets their 
localStorage wiped, and gets bounced to /onboarding even though they're fully onboarded.

FIX:
Replace the .catch() block with error-type-aware handling:

BEFORE:
  .catch((err) => {
    if (cancelled) return;
    console.error('[ProtectedRoute] Context API failed:', err);
    // API failed — wipe stale localStorage so user goes to onboarding
    setStoredOnboardingState(false);
    publish({ loading: false, hasContext: false });
  });

AFTER:
  .catch((err) => {
    if (cancelled) return;
    console.error('[ProtectedRoute] Context API failed:', err);

    // Classify the error
    const isTransient =
      err?.httpStatus === 429 ||  // rate limit
      err?.httpStatus >= 500 ||   // server error
      err?.code === 'RATE_LIMIT_EXCEEDED' ||
      err?.code === 'NETWORK_ERROR' ||
      err?.code === 'NETWORK_TIMEOUT' ||
      !err?.httpStatus;           // no response at all (offline)

    if (isTransient) {
      // Transient error — do NOT wipe cache. Fall back to whatever localStorage says.
      // If localStorage says onboarded, keep them in the app.
      // If localStorage is empty/false, redirect to onboarding as before.
      const cached = getStoredOnboardingState();
      console.warn('[ProtectedRoute] Transient error — using cached onboarding state:', cached);
      publish({ loading: false, hasContext: cached === true });
    } else {
      // Auth errors (401, 403) or explicit null context from the API
      // → treat as not onboarded, wipe cache
      setStoredOnboardingState(false);
      publish({ loading: false, hasContext: false });
    }
  });

Make only this targeted change. The function getStoredOnboardingState() is already
defined in the same file (it reads the 'marcom:onboarded' localStorage key).
After editing, verify the logic by reading the function to ensure it compiles and
the getStoredOnboardingState import/usage is correct within the same file scope.
```

---

## Phase 8 — Fix CSV Upload 502 Timeout (Critical — Found in Upload Test, ~25 min)

> **What:** `POST /api/campaigns/upload-csv?mode=analyze` fires **one Claude API call per campaign row in parallel** via `Promise.allSettled`. With a 14-row CSV this launches 14 simultaneous Anthropic requests. On Render's Starter plan (30s request timeout) this consistently returns 502 Bad Gateway. Confirmed live: every upload attempt fails with 502.

```
Fix the CSV upload timeout in src/routes/campaigns/upload.js.

PROBLEM (lines 123–137):
The analyze mode fires one Claude API call per campaign in parallel:

  const results = await Promise.allSettled(
    parsed.map(async (c) => {
      const decision = await analyzeCampaignData(dataForClaude, 'csv');
      ...
    }),
  );

With 14 campaigns, this launches 14 concurrent Anthropic API calls.
Each takes ~3–5s. Render's 30s request timeout fires before all complete → 502.

FIX — Replace N parallel calls with ONE batched call:

Step 1: Check if analyzeCampaignData supports a batch mode. Search for it in
src/agents/orchestrator.js. If it accepts an array of campaigns, use that.

Step 2: If no batch mode exists, add a batch function to the orchestrator:

In src/agents/orchestrator.js, add an export:

export async function analyzeCampaignsBatch(campaigns) {
  // Build a single prompt with all campaigns
  const prompt = `Analyze these ${campaigns.length} Meta Ads campaigns and return a JSON array
of decisions. For each campaign return:
{ campaignId, verdict (SCALE|HOLD|KILL|OPTIMIZE|PAUSE_AND_RELAUNCH),
  rootCause, confidence (HIGH|MEDIUM|LOW),
  actionPlan: { primaryAction, reasoning, steps[] },
  signals: [{ metric, value, threshold, status }] }

Campaigns:
${JSON.stringify(campaigns.map(c => ({
  campaignId: c.campaignId,
  campaignName: c.campaignName,
  adsetName: c.adsetName,
  metrics: c.metrics,
  deliveryStatus: c.deliveryStatus,
})), null, 2)}

Return ONLY valid JSON: { decisions: [...] }`;

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in batch analysis response');
  return JSON.parse(jsonMatch[0]);
}

Step 3: In src/routes/campaigns/upload.js, replace the Promise.allSettled block
(lines ~123–137) with a single batch call:

  // ── Step 1: Run AI analysis (BATCHED — single Claude call for all campaigns)
  const campaignsForAnalysis = parsed.map(c => ({
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    adsetName: c.adsetName,
    metrics: { spend: c.spend, impressions: c.impressions, results: c.results,
               ctr: c.ctr, cpc: c.cpc, roas: c.roas, frequency: c.frequency,
               reach: c.reach, costPerResult: c.costPerResult },
    deliveryStatus: c.deliveryStatus,
  }));

  let batchResult;
  try {
    batchResult = await analyzeCampaignsBatch(campaignsForAnalysis);
  } catch (err) {
    logger.error({ err: err.message }, '[campaigns/upload] Batch analysis failed');
    return res.status(500).json({ success: false, error: 'AI analysis failed: ' + err.message });
  }

  // Map batch decisions back to campaigns
  const decisionMap = new Map(batchResult.decisions.map(d => [d.campaignId, d]));
  const results = parsed.map(c => ({
    status: 'fulfilled',
    value: {
      decision: decisionMap.get(c.campaignId) || { verdict: 'HOLD', rootCause: 'No analysis', confidence: 'LOW' },
      campaign: c,
    },
  }));

Also import analyzeCampaignsBatch at the top of upload.js:
  import { analyzeCampaignData, analyzeCampaignsBatch } from '../../agents/orchestrator.js';

After making these changes, verify by checking the code reads correctly and no
import errors exist.
```

---

## Phase 9 — Fix CSV Upload 500: Duplicate campaignId for Unicode Campaign Names (Critical, ~10 min)

> **What:** The slug generator in `metaAdsParser.js` strips all Unicode characters to `_`, then collapses runs of `_`. Multiple campaigns with Unicode-heavy names (e.g., all three "Instagram post: 𝑺𝒘𝒊𝒑𝒆…", "Instagram post: 𝗟𝗲𝗮𝘃𝗶𝗻𝗴…", "Instagram post: 𝒀𝒐𝒖𝒓…") all produce the identical `campaignId`: `meta__instagram_post_instagram_post`. When `createMany` tries to insert multiple `Action` rows with the same `idempotencyKey` (`meta:csv:<session>:meta__instagram_post_instagram_post`), Prisma throws a unique constraint violation. The `$transaction` has no outer try-catch, so this propagates as an unhandled 500. Confirmed live — **every upload of a real Meta CSV with multiple Instagram posts fails 100% of the time.**

```
Fix duplicate campaignId generation in src/services/metaAdsParser.js.

ROOT CAUSE (lines ~182–188):
  const slug = `${campaignName}__${adsetName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')   // ← strips ALL Unicode to '_'
    .replace(/_+/g, '_')            // ← collapses duplicates
    .slice(0, 100);
  const campaignId = `meta__${slug}`;

Campaign names with Unicode math/bold/italic characters (very common in Meta exports
from MENA markets) all collapse to the same slug. Multiple campaigns like:
  "Instagram post: 𝑺𝒘𝒊𝒑𝒆 𝒕𝒉𝒓𝒐𝒖𝒈𝒉..." + "Instagram Post"
  "Instagram post: 𝗟𝗲𝗮𝘃𝗶𝗻𝗴 𝗳𝗼𝗿 𝘃𝗮𝗰𝗮𝘁𝗶𝗼𝗻..." + "Instagram Post"
  "Instagram post: 𝒀𝒐𝒖𝒓 𝒇𝒂𝒎𝒊𝒍𝒚..." + "Instagram Post"
all produce: meta__instagram_post_instagram_post
This causes a unique constraint violation in createMany → transaction rollback → 500.

FIX — Append a short deterministic hash of the ORIGINAL (pre-slug) names to guarantee uniqueness:

In src/services/metaAdsParser.js, find the campaignId construction block
(around lines 182–188) and replace it:

BEFORE:
  const slug = `${campaignName}__${adsetName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);

  const campaignId = `meta__${slug}`;

AFTER:
  import { createHash } from 'crypto';  // add to top of file if not already imported

  const slug = `${campaignName}__${adsetName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);  // shorten to leave room for hash suffix

  // Append 8-char hash of ORIGINAL names to disambiguate Unicode-heavy duplicates.
  // Same campaign name always produces same hash (deterministic/idempotent).
  const nameHash = createHash('sha256')
    .update(`${campaignName}|${adsetName}`)
    .digest('hex')
    .slice(0, 8);

  const campaignId = `meta__${slug}_${nameHash}`;

This ensures:
- Same campaign on re-upload = same campaignId (hash is deterministic)
- Different campaigns with identical Unicode slugs = different campaignId (different hash)
- No collisions in idempotencyKey → no unique constraint violations

Check if `createHash` is already imported at the top of metaAdsParser.js.
If not, add: import { createHash } from 'crypto';

Make only this change. No other modifications.
After editing, verify: node -e "
  import { createHash } from 'crypto';
  const names = [
    ['Instagram post: UNICODE1', 'Instagram Post'],
    ['Instagram post: UNICODE2', 'Instagram Post'],
  ];
  names.forEach(([c, a]) => {
    const slug = (c+'__'+a).toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').slice(0,80);
    const hash = createHash('sha256').update(c+'|'+a).digest('hex').slice(0,8);
    console.log('meta__'+slug+'_'+hash);
  });
" — they should produce DIFFERENT IDs.
```

---

## Summary

| Phase | What it fixes | Files touched | Time |
|-------|--------------|---------------|------|
| 1 | `getActiveRoute` sync+await crash | `client/src/config/routes.ts` | ~5 min |
| 2 | SSE heartbeat reconnect loop | `src/routes/events.js`, `client/src/services/sseClient.ts` | ~10 min |
| 3 | Stale/duplicate env config | `client/.env.example`, `.env.example`, `.env` | ~15 min |
| 4 | Dead code + silent prod misconfiguration | `src/routes/events.js`, `client/src/firebase.js` | ~10 min |
| 5 | Verify phases 1–4 | (read-only checks) | ~5 min |
| 6 | SSE retry storm (1000+ req/min in prod) | `client/src/services/useSSE.ts`, `client/src/services/sseClient.ts` | ~20 min |
| 7 | ProtectedRoute false-logout on 429/503 | `client/src/router/ProtectedRoute.jsx` | ~15 min |
| 8 | CSV upload 502 (N parallel Claude calls) — already fixed in code | `src/routes/campaigns/upload.js`, `src/agents/orchestrator.js` | N/A |
| 9 | CSV upload 500 (duplicate campaignId for Unicode names) | `src/services/metaAdsParser.js` | ~10 min |
