# MARCOM Backend ↔ Frontend Wiring Audit
**Date:** 2026-05-29  
**Scope:** `marketing-os-v3` — full stack wiring check  
**Verdict:** Mostly solid architecture with 3 critical issues that need immediate attention

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 3 | Secrets in `.env`, broken `getActiveRoute`, SSE heartbeat logic |
| 🟡 Medium | 4 | Stale `.env.example`, duplicate `.env` content, dead code in SSE token handler, Firebase service account placeholder |
| 🟢 Verified OK | 8 | Auth flow, API client, CORS, proxy, ProtectedRoute, SSE exchange, auto-provisioning, error contracts |

---

## 🔴 CRITICAL

### 1. Real secrets committed in `.env`

**File:** `.env` (root)

The committed `.env` contains live production credentials that must be rotated immediately:

```
ANTHROPIC_API_KEY=sk-ant-api03-NcrfC2BA_...   ← REAL key, 8+ chars visible
OPENAI_API_KEY=sk-proj-S1cu6B8GDq...          ← REAL key
META_APP_SECRET=e53f9ea5c97ec8e8...            ← REAL secret
META_ACCESS_TOKEN=EAAT4X1XSIfsBR...            ← LIVE long-lived token
```

**Action required:**
1. Rotate all four credentials NOW (even if `.gitignore` protects the file, it may be in git history)
2. Run `git log --follow -p .env` to check if it was ever committed
3. If committed historically: `git filter-repo --path .env --invert-paths` to scrub history

---

### 2. `getActiveRoute` in `routes.ts` is broken — sync function with `await`

**File:** `client/src/config/routes.ts`, line 57

```typescript
// BROKEN: regular function using await
export function getActiveRoute(
  route: keyof typeof routes.v1,
  forceVersion?: 'v1' | 'v2'
): string {
  const { features } = await import('./features.js');  // ← SyntaxError at runtime
  ...
}
```

The function is declared `function` (synchronous) but uses `await import(...)` internally. This throws a `SyntaxError: await is only valid in async functions` at runtime. Any component calling `getActiveRoute()` will crash silently or throw.

**Fix:**
```typescript
// Option A — make it async (callers must await)
export async function getActiveRoute(...): Promise<string> {
  const { features } = await import('./features.js');
  ...
}

// Option B — import features statically at the top of the file
import { features } from './features.js';
export function getActiveRoute(...): string {
  // use features directly
}
```

Option B is cleaner since `features.ts` is a static config module.

---

### 3. SSE heartbeat never resets the client timeout

**File:** `client/src/services/sseClient.ts`, lines 257–259

```typescript
private handleMessage(event: MessageEvent): void {
  this.resetHeartbeat(); // Reset heartbeat timeout on any message
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'HEARTBEAT' || event.data === ': heartbeat') {
```

The server sends heartbeats as SSE **comments**: `: heartbeat\n\n`

The `EventSource` API specification explicitly states that SSE comments are **not dispatched** as `message` events — they are silently dropped by the browser. `handleMessage` is therefore never called for heartbeats.

The heartbeat timeout is 30,000ms. The server sends heartbeats every 30,000ms. This means the client will **always** hit the timeout and trigger a reconnect, causing a constant reconnect loop under idle conditions.

**Fix:** Move `resetHeartbeat()` to fire on the `open` event and periodically on any real message. Since SSE comments can't be intercepted via `EventSource`, the correct approach is to either:
- Use a polling keep-alive via a real `data:` heartbeat event (change server to send `data: {"type":"HEARTBEAT"}\n\n`)
- Or extend the timeout to 2× the server interval (e.g., 65,000ms) as a grace buffer

```typescript
// server: events.js — change heartbeat to a real data event
setInterval(() => {
  res.write(`data: ${JSON.stringify({ type: 'HEARTBEAT' })}\n\n`);  // ← parseable
}, 30_000);
```

---

## 🟡 MEDIUM

### 4. `client/.env.example` is completely stale

**File:** `client/.env.example`

The example only documents the old Clerk key:
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

But the client now needs Firebase vars:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

The `firebase.js` has hardcoded dev fallbacks, which masks this misconfiguration in development. A new dev running the app for the first time without any `.env` set will get Firebase working (via hardcoded fallbacks) but those hardcoded values are now **also visible in the production bundle** if `VITE_FIREBASE_*` env vars are not set on Render.

**Fix:** Update `client/.env.example` to document all Firebase vars. Remove the hardcoded fallback values from `firebase.js` (or at minimum gate them strictly to `DEV` mode so they can't slip into production).

---

### 5. Root `.env.example` has Clerk/JWT relics that no longer apply

**File:** `.env.example` (root), lines 59–76

```
CLERK_PUBLISHABLE_KEY=pk_live_...   ← Clerk is gone (ADR-001)
CLERK_SECRET_KEY=sk_live_...        ← Clerk is gone
JWT_SECRET=replace-me-with-64-byte-hex  ← JWT auth removed
JWT_ISSUER=lumi-api
JWT_AUDIENCE=lumi-clients
CLERK_JWKS_URL=https://...clerk...  ← Clerk JWKS, not used
```

The auth migration to Firebase is complete. These variables are dead and confuse anyone setting up the project.

**Fix:** Remove Clerk/JWT entries from `.env.example`. Keep `FIREBASE_SERVICE_ACCOUNT_JSON`.

---

### 6. `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env` is a stub placeholder

**File:** `.env` (root), line 148

```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"...}
```

This is a fake template value, not a real service account. If the **deployed** server is running with this value, `admin.auth().verifyIdToken()` will fail on every request and every user will get 401s.

**Verify:** Check Render env vars to confirm the real service account JSON is set there, not inherited from this file.

---

### 7. Dead `req.user?.workspaceId` reference in SSE token handler

**File:** `src/routes/events.js`, line 59

```javascript
const workspaceId = req.user?.workspaceId || req.workspaceId;
```

`req.user` is the Firebase decoded token (from `admin.auth().verifyIdToken()`). Firebase tokens do not contain a `workspaceId` claim — that field is only set on `req.workspaceId` by `firebaseAuthMiddleware` after a Prisma lookup. So `req.user?.workspaceId` is always `undefined` and the fallback `req.workspaceId` does the real work.

This works correctly but the dead reference is misleading. **Fix:** Simplify to `const workspaceId = req.workspaceId;`.

---

### 8. `.env` file has duplicated content

**File:** `.env` (root)

The file contains the same env block twice (lines 1–61 are the real config, lines 62–149 paste most of the `.env.example` template on top of it). This is likely a copy-paste accident. The second block mostly has placeholder values, so the first block's real values take precedence (Node reads the first occurrence), but it's fragile and confusing.

**Fix:** Remove lines 62–149 (the duplicated template block). Keep only the first, real block.

---

## 🟢 VERIFIED OK

### Auth flow: Firebase → Bearer → requireAuth

The pipeline is clean end to end:
- `firebase.js` initializes with `getAuth()` using explicit `browserLocalPersistence`
- `api.js` interceptor calls `auth.currentUser?.getIdToken()` on every request
- 401 triggers a `getIdToken(true)` force-refresh + single retry before giving up
- Backend `firebaseAuthMiddleware` verifies via `admin.auth().verifyIdToken(token)`
- `requireAuth` route guard rejects if `!req.user.uid`
- Auto-provisioning creates Workspace + User atomically with race-condition retry ✅

### API client (axios)

- Single axios instance (`api`) used everywhere — no rogue `fetch()` calls
- `baseURL: '/'` + Vite proxy `/api → localhost:3000` is correct for dev
- `withCredentials: true` enables Meta OAuth session cookies
- Error mapping (transport → domain) covers 401, 403, 429, 400/422, 5xx, ECONNABORTED ✅

### CORS

- `credentials: true`, `maxAge: 600` (preflight cache), `PUT` included in allowed methods
- `ALLOWED_ORIGINS` is configurable; dev mode allows all origins ✅

### ProtectedRoute / OnboardingRoute

- Always calls `/api/campaigns/me/context` — never trusts module-level cache across user switches (the race condition from User A → User B was explicitly fixed)
- `isOnboarded()` checks `context.name || context.companyName` for backwards compatibility
- `clearContextCache()` is called before `signOut()` — no stale state leaks ✅

### SSE two-step exchange

- POST `/api/events/token` — Firebase JWT in header → short-lived UUID stream token (60s TTL)
- GET `/api/events/stream?token=<uuid>` — no JWT in URL (no PII in access logs)
- Token is single-use, consumed on first connect
- Server scopes events to `workspaceId` via `addSubscriber(workspaceId, res)` ✅

### Route structure

- Public routes (`/`, `/login`, `/signup`) are unauthenticated
- `/onboarding` uses `OnboardingRoute` (blocks re-entry if already onboarded)
- `/app/*` uses `ProtectedRoute` (redirects to `/login` or `/onboarding`)
- v2 migration uses Strangler Pattern (`/app/v2/decision`) with feature flag routing
- `App.jsx` blocks all route rendering until `authLoading === false` ✅

### Contract version header

Frontend sends `x-contract-version: 2.1.0` on every request. The backend contracts doc is frozen at v1.0 (2026-05-18). Consider wiring server-side validation that logs or warns on contract version mismatch.

### Error contracts

All domain errors (`AuthError`, `NetworkError`, `RateLimitError`, `PlatformError`, `ValidationError`, `StreamDisconnectError`) are defined in `client/src/contracts/errors/` and imported correctly throughout the codebase ✅

---

## Recommended Action Order

1. **Rotate all leaked credentials** (Anthropic, OpenAI, Meta app secret, Meta access token) — do this NOW
2. **Fix `getActiveRoute`** (async or static import) — causes runtime crash in any component using it
3. **Fix SSE heartbeat** (change server to emit `data:` events instead of comments)
4. **Clean up `.env`** (remove duplicated template block)
5. **Update `client/.env.example`** with Firebase vars
6. **Remove Clerk/JWT relics** from root `.env.example`
7. **Verify Render env vars** — confirm `FIREBASE_SERVICE_ACCOUNT_JSON` has the real service account, not the placeholder
8. **Simplify** `req.user?.workspaceId` dead reference in `events.js`
