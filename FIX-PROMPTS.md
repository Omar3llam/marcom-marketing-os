# MARCOM Wiring Fix — Phased Prompts
**Based on:** WIRING-AUDIT-2026-05-29.md  
**GitHub verified:** 2026-05-29 (all findings confirmed on master)

Use each prompt below in a new Claude Code session. Run them in order — Phase 1 and 2 are independent of each other but should both be done before Phase 3.

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

## Summary

| Phase | What it fixes | Files touched | Time |
|-------|--------------|---------------|------|
| 1 | `getActiveRoute` sync+await crash | `client/src/config/routes.ts` | ~5 min |
| 2 | SSE heartbeat reconnect loop | `src/routes/events.js`, `client/src/services/sseClient.ts` | ~10 min |
| 3 | Stale/duplicate env config | `client/.env.example`, `.env.example`, `.env` | ~15 min |
| 4 | Dead code + silent prod misconfiguration | `src/routes/events.js`, `client/src/firebase.js` | ~10 min |
| 5 | Verify all fixes | (read-only checks) | ~5 min |
