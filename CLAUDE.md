# MARCOM v4.1 — Claude Code Project Guide
**Last updated: post-Firebase migration, post-dual-agent, post-Prisma**

> Full architecture: see MARCOM-ARCHITECTURE.md  
> Design system: see MARCOM-DESIGN-BIBLE.md  
> This file: quick reference for Claude Code sessions

---

## Current Stack

### Frontend
- React 18 + Vite + Tailwind CSS + shadcn/ui (select components)
- Firebase Auth (NOT Clerk — Clerk was removed)
- Axios via `client/src/lib/api.js` (the ONLY API client)
- FSM state machine: `client/src/hooks/useDecisionFSM.js`

### Backend
- Node.js 22 + Express + ES Modules
- Prisma + PostgreSQL (NOT MongoDB, NOT Airtable)
- BullMQ + Redis (async job queue)
- Firebase Admin SDK (token verification)
- Anthropic Claude + OpenAI GPT (dual-agent)

---

## Entry Points

```
client/src/main.jsx        → React app root
client/src/App.jsx         → Router + route definitions
src/server.js              → Express app + all route mounting
prisma/schema.prisma       → Database schema (source of truth for models)
```

---

## Auth Model (Firebase, NOT Clerk)

**Frontend:**  Firebase SDK → `auth.currentUser.getIdToken()`  
               Axios interceptor in `api.js` attaches token automatically  
**Backend:**   `src/middleware/firebaseAuth.js` → `req.user` + `req.workspaceId`  
**Protected:** `requireAuth` on all `/api/*` (see `server.js` for exceptions)

**NEVER use `clerkAuth.js` — it is a dead file from v1.**

---

## The ONE WAY ONLY Rules (summary — full laws in ARCHITECTURE.md)

**API calls:**     `api.get`/`post` via `client/src/lib/api.js` ONLY  
**State:**         `useState` / `useReducer` / Context ONLY (no Redux/Zustand)  
**Styling:**       Semantic tokens from `design-system/tokens/` ONLY (no `bg-gray-*`)  
**AI calls:**      `src/agents/orchestrator.js` ONLY (not `services/orchestrator.js`)  
**Sessions:**      `src/utils/sessionStore.js` (active sessions, `master.js`)  
**Memory:**        `src/utils/memoryStore.js` (Anthropic Memory API, `lumi.js`)  
**History:**       `src/models/chatSession.js` (chat history, `history.js`)

---

## Critical Files

### Frontend

```
client/src/lib/api.js              — Axios client with Firebase token interceptor
client/src/hooks/useDecisionFSM.js — 8-state FSM (the brain of the UI)
client/src/hooks/useCampaignFeed.js — Campaign data fetching hook
client/src/pages/DecisionFeed.jsx  — Main FSM container page
client/src/context/AuthContext.jsx — Firebase auth state
```

### Backend

```
src/server.js                      — All routes mounted here
src/routes/lumi.js                 — Campaign feed, orchestration, rollback
src/routes/campaigns.js            — CSV upload, Meta fetch, context
src/routes/execution.js            — Meta action execution (4-layer guards)
src/agents/orchestrator.js         — CANONICAL dual-agent (Claude + GPT)
src/utils/csvParser.js             — CSV parsing with BOM removal, EGP handling
prisma/schema.prisma               — DB schema
```

---

## Deprecated / Dead Files (DO NOT IMPORT)

```
src/services/orchestrator.js  → DEPRECATED. Use src/agents/orchestrator.js
src/middleware/clerkAuth.js   → DEAD. Firebase replaced Clerk.
src/models/userContext.js     → DEAD. Replaced by campaigns/me/context route.
src/utils/airtable.js         → DEAD. Airtable replaced by PostgreSQL.
src/utils/scraper.js          → Check if still used before touching.
```

---

## Commands

```bash
# Development
npm run dev                         # start server (src/server.js)
cd client && npm run dev            # start frontend (Vite)

# Frontend only
cd client && npm run lint           # ESLint with design system rules
cd client && npm run build          # production build (bundle < 700KB target)

# Database
npx prisma studio                   # visual DB browser
npx prisma migrate dev              # run new migrations
npx prisma generate                 # regenerate client after schema change

# Testing
node src/tests/dialect.test.js      # dialect resolution tests
```

---

## Prisma Models (source of truth)

```
User              → workspace membership, Firebase UID
Workspace         → the company/account unit
CampaignState     → campaign health snapshot from CSV
Action            → executed Meta API actions (audit log)
DecisionMemory    → AI decision history with ROAS delta
```

Full schema: `prisma/schema.prisma`

---

## Forbidden Patterns (enforced by lint + CI)

```javascript
// ❌ Direct fetch — always use api client
fetch('/api/anything')

// ❌ Raw axios — always use api client
await axios.post('/api/execute/meta', payload)

// ❌ Import deprecated orchestrator
import from '../services/orchestrator.js'

// ❌ Prisma in loops (N+1)
for (const x of items) { await prisma.model.create(...) }

// ❌ useEffect without cleanup
useEffect(() => { api.get('/x').then(setState); }, [])

// ❌ Raw hex or gray-* in JSX (use design tokens)
className="bg-gray-900 text-white #F6C945"
```

---

## File Size Budget

```
Page component:    max 300 lines
Route file:        max 400 lines
Hook:              max 200 lines
UI primitive:      max 150 lines
Context:           max 100 lines
```

---

## AI Prompt Requirements

Every prompt must include:

- **MAX_FILES_TO_MODIFY**
- **PROOF_BEFORE_PATCH**
- **NO_SCOPE_CREEP**
- **NO_SILENT_SUCCESS**
- **ATOMIC**
- **AUDIT_MISMATCH_RULE**
