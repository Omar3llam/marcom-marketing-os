# MARCOM Architecture Bible
**Version 4.1 — Engineering Constitution**

> This document governs all AI-assisted and human development on MARCOM.
> Claude Code, Cursor, and all other AI tools MUST follow these laws.
> Violations are caught by CI and rejected at PR review.

---

## 1. Project Identity

**What MARCOM is:**
- A marketing intelligence operating system for MENA media buyers
- A decision engine: CSV in → verdict + action out
- A financial accountability layer over Meta/Google ad platforms

**What MARCOM is NOT:**
- A chatbot (no free-form chat interface)
- A dashboard (no passive data display without decision support)
- A generic analytics tool

---

## 2. Repository Structure

```
marcom-marketing-os/
├── client/                        Frontend (React 18 + Vite + Tailwind)
│   ├── design-system/
│   │   ├── tokens/                JSON source of truth for all tokens
│   │   │   ├── colors.json
│   │   │   ├── motion.json
│   │   │   ├── typography.json
│   │   │   └── spacing.json
│   │   ├── lint/                  ESLint custom rules
│   │   │   └── no-generic-tailwind.js
│   │   └── component-states.md   Visual state matrix
│   └── src/
│       ├── components/
│       │   ├── decision/          FSM-driven decision components ONLY
│       │   ├── layout/            Shell (Sidebar, MainLayout, ContextBar)
│       │   ├── ui/                Primitives (DecisionPill, InlineBar, etc.)
│       │   └── upload/            File ingestion components
│       ├── context/               React Contexts (AuthContext, IntelligenceContext)
│       ├── hooks/                 Data fetching + FSM hooks
│       ├── lib/                   API client, utilities
│       ├── pages/                 Route-level page components
│       └── router/                ProtectedRoute + route definitions
│
└── src/                           Backend (Node 22 + Express + Prisma)
    ├── agents/                    AI agent wrappers
    │   ├── ClaudeAgent.js         Claude API wrapper (CANONICAL)
    │   ├── ChatGPTAgent.js        GPT API wrapper
    │   ├── contextBuilder.js      Context assembly for AI calls
    │   └── orchestrator.js        Dual-agent orchestration (CANONICAL)
    ├── controllers/               Request handlers separated from routing
    ├── middleware/                 Express middleware (auth, rate-limit, etc.)
    ├── models/                    Thin DB query wrappers (chatSession.js)
    ├── queues/                    BullMQ job queues
    ├── routes/                    Express routers (one file per domain)
    ├── services/                  Business logic services
    ├── utils/                     Shared utilities
    ├── workers/                   BullMQ worker processes
    └── server.js                  Express entry point
```

---

## 3. The ONE WAY ONLY Laws

These laws are absolute. No exceptions. No "just this once".

### 3A. Data Fetching — ONE WAY

**CANONICAL:** api client (`client/src/lib/api.js`) via `useEffect` with `AbortController`  
**BANNED:**    direct `fetch()`, raw `axios.create()`, SWR, React Query, `useSWR`

Every API call in the frontend:

```javascript
// ✅ CORRECT:
useEffect(() => {
  let cancelled = false;
  api.get('/api/endpoint', { signal: ctrl.signal })
    .then(res => { if (!cancelled) setState(res.data); })
    .catch(err => { if (axios.isCancel(err)) return; setError(err.message); })
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; ctrl.abort(); };
}, []);

// ❌ BANNED:
fetch('/api/endpoint');              // raw fetch
axios.post('/api/endpoint', data);  // direct axios
const { data } = useSWR('/api');    // SWR
```

### 3B. State Management — ONE WAY

**LOCAL UI STATE:**    `useState` only  
**COMPLEX FLOWS:**     `useReducer` (FSM pattern — see `useDecisionFSM`)  
**SHARED DATA:**       React Context (`IntelligenceContext`, `AuthContext`)  
**SERVER STATE:**      fetched in hooks, stored in context or local state  
**BANNED:**            Redux, Zustand, Jotai, MobX, global variables

### 3C. Styling — ONE WAY

**CANONICAL:** Tailwind utility classes using semantic tokens from `design-system/tokens/`  
**BANNED:**    raw hex in JSX, `bg-gray-*`, `text-gray-*`, inline styles (except `tabular-nums`)  
               CSS modules, styled-components, Emotion

### 3D. Error Handling — ONE WAY

**FRONTEND:** `catch` block + `setError(msg)` + user-visible message  
**BACKEND:**  `try/catch` in every async route handler + `res.status(N).json({error})`  
**BANNED:**   swallowed errors, `console.log` without logger, silent 200s with error payloads

### 3E. AI Orchestration — ONE WAY

**CANONICAL:** `src/agents/orchestrator.js` (dual-agent: Claude → GPT)  
**BANNED:**    `src/services/orchestrator.js` (DEPRECATED — do not import)  
               direct Anthropic SDK calls outside of `ClaudeAgent.js`

### 3F. Session/Memory — ONE WAY

**CANONICAL SESSION:** `src/utils/sessionStore.js` (PostgreSQL)  
**CANONICAL MEMORY:**  `src/utils/memoryStore.js` (Anthropic Memory API)  
**CANONICAL HISTORY:** `src/models/chatSession.js` (PostgreSQL)  
**BANNED:**            creating new session storage mechanisms  
                       mixing `sessionStore` and `chatSession` for the same purpose

**NOTE:** These three serve different purposes — see Section 6 for details.

---

## 4. Folder Philosophy

### Frontend — where does new code go?

| What you're building | Where it goes |
|---|---|
| A reusable UI primitive (button, pill, bar) | `client/src/components/ui/` |
| A component that shows AI/decision data | `client/src/components/decision/` |
| A page (route-level) | `client/src/pages/` |
| A hook that fetches data | `client/src/hooks/` |
| A React Context | `client/src/context/` |
| A utility function | `client/src/lib/` |

**Laws:**
- `components/ui/` = stateless primitives only. No API calls. No hooks.
- `components/decision/` = FSM-driven. Props only. No direct API calls.
- `pages/` = orchestrates hooks + components. Maximum 300 lines.
- `hooks/` = data fetching + FSM. No JSX.

### Backend — where does new code go?

| What you're building | Where it goes |
|---|---|
| New API endpoint | `src/routes/[domain].js` |
| Business logic called by a route | `src/services/[name]Service.js` |
| AI agent interaction | `src/agents/` |
| DB query wrapper | `src/models/[model].js` |
| Shared utility | `src/utils/[name].js` |
| Express middleware | `src/middleware/[name].js` |

**Laws:**
- **Routes ONLY:** parse request, call service, return response. No business logic.
- **Services ONLY:** business logic. No Express `req`/`res` objects.
- Max route file size: 400 lines. If over → split by subdomain.

---

## 5. Component Boundaries

### The Decision Stack (frontend)

```
DecisionFeed (page — FSM container)
  └── CommandCenter (view — COMMAND_CENTER state)
  └── InputView (view — INPUT_VALIDATION state)
  └── TheatreView (view — THEATER state)
  └── DecisionFrame (view — SUCCESS/CONFIRM/EXECUTION states)
  └── ErrorView (view — ERROR state)
```

**Laws:**
- Views receive props from `DecisionFeed`. They do NOT fetch data directly.
- `CommandCenter` is the war room. Sub-components are extracted when > 400 lines.
- The FSM lives in `useDecisionFSM.js`. Views only dispatch actions.

### File Size Limits (enforced in CI)

| File type | Max lines | Action if exceeded |
|---|---|---|
| Page component | 300 | Split into sub-components |
| Route handler | 400 | Split by subdomain |
| Hook | 200 | Split into focused hooks |
| UI primitive | 150 | Already simple enough |
| Context | 100 | Too much responsibility |

---

## 6. The Backend Duplicate Map

These files look similar but serve different purposes. **Do NOT consolidate without understanding.**

| File | Purpose | Import from |
|---|---|---|
| `src/agents/orchestrator.js` | Dual-agent (Claude + GPT) for campaign analysis | `src/routes/lumi.js` |
| `src/services/orchestrator.js` | **DEPRECATED** — Claude-only wrapper, pre-dual-agent | Nobody should import this |
| `src/utils/sessionStore.js` | User session persistence (PostgreSQL, `master.js`) | `src/routes/master.js` |
| `src/utils/memoryStore.js` | Anthropic Memory API (long-term AI memory) | `src/routes/lumi.js` |
| `src/models/chatSession.js` | Chat history CRUD (PostgreSQL) | `src/routes/history.js` |
| `src/services/metaMCP.js` | Meta API via MCP protocol (execution) | `src/routes/execution.js` |
| `src/services/metaExecutionService.js` | Direct Meta API HTTP calls | `src/services/metaMCP.js` |
| `src/services/metaAdsService.js` | Meta Ads data fetching (campaigns, insights) | `src/routes/campaigns.js` |

**WARNING:** `src/services/orchestrator.js` is **DEPRECATED**.  
If you find any import of it: replace with `src/agents/orchestrator.js`.

---

## 7. Naming Conventions

### Files
- **PascalCase:**   React components (`CommandCenter.jsx`, `DecisionPill.jsx`)
- **camelCase:**    Hooks, utilities, services (`useCampaignFeed.js`, `sessionStore.js`)
- **kebab-case:**   Config files, docs (`tailwind.config.js`, `component-states.md`)

### Variables
- **SCREAMING_SNAKE:** Constants, config values (`MAX_ROWS`, `API_TIMEOUT`)
- **camelCase:**       Functions, variables, hook return values
- **PascalCase:**      React components, classes, types

### API Routes
- `/api/[domain]/[action]`    → `/api/campaigns/upload-csv`
- `/api/[domain]/me/[field]`  → `/api/campaigns/me/context`
- `/api/v1/[domain]/[action]` → `/api/v1/paid/radar` (versioned paid features)

---

## 8. Data Flow

```
User action
  ↓
Page component (DecisionFeed, CampaignAnalysis)
  ↓
Hook (useDecisionFSM, useCampaignFeed, useOrchestrate)
  ↓
api client (src/lib/api.js) — attaches Firebase JWT
  ↓
Express route (src/routes/*.js)
  ↓
Middleware (requireAuth → apiLimiter)
  ↓
Service / Agent (business logic)
  ↓
Prisma / External API
  ↓
Response → Hook → Context → Component → UI
```

**Law:** Data flows DOWN only. Components never call APIs directly.

---

## 9. Auth Model

**Frontend:**  Firebase Auth SDK → `getIdToken()` → Bearer token  
**Interceptor:** `client/src/lib/api.js` Axios interceptor attaches token automatically  
**Backend:**   `firebaseAuthMiddleware` populates `req.user` + `req.workspaceId`  
**Protected:** `requireAuth` middleware on all `/api/*` routes except:
  - `/api/health` (health check)
  - `/api/lumi/demo-feed` (stakeholder demo)
  - `/webhook` (WEBHOOK_SECRET header instead)
  - `/api/auth/meta/callback` (OAuth callback, can't have JWT)

---

## 10. Forbidden Patterns

These patterns are detected by CI and block PRs:

```javascript
// ❌ Direct fetch (bypass api client)
fetch('/api/anything')

// ❌ Raw hex in JSX
className="text-[#F6C945]"

// ❌ Generic Tailwind color (use semantic token)
className="bg-gray-900 text-white"

// ❌ Importing deprecated orchestrator
import orchestrator from '../services/orchestrator.js'

// ❌ Raw axios call (bypass api client)
await axios.post('/api/execute/meta', payload)

// ❌ useEffect without cleanup
useEffect(() => {
  api.get('/endpoint').then(setData);
}, []); // ← memory leak if component unmounts during fetch

// ❌ Prisma calls inside loops (N+1)
for (const item of items) {
  await prisma.model.create({ data: item }); // do createMany instead
}

// ❌ Wildcard CORS (breaks with credentials: true + leaks to all origins)
app.use(cors({ origin: '*' }))

// ❌ Missing credentials on CORS (breaks OAuth cookies)
app.use(cors({ origin: allowlist }))  // without credentials: true

// ❌ PUT requests without 'PUT' in CORS methods
methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']  // missing PUT

// ✅ CORRECT — full CORS policy
app.use(cors({
  origin: allowlistFn,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', ...],
  maxAge: 600,
}))
```

---

## 11. Sprint Governance

Every 2-week sprint includes:

**Week 1:** Feature development  
**Week 2 (Friday):** Architecture cleanup
- Remove dead components (run: `npx unimported`)
- Check file size limits
- Verify lint passes with 0 violations
- Review `component-states.md` — any missing states?

**Before every PR:**
- ✅ `npm run lint` → 0 violations
- ✅ `npm run build` → no errors, bundle < 700KB
- ✅ No new file exceeds its size limit
- ✅ No forbidden patterns introduced
- ✅ CLAUDE.md + ARCHITECTURE.md updated if architecture changed

---

## 12. AI Prompt Laws (for Claude Code / Cursor)

Every AI prompt touching this codebase MUST include:

- **MAX_FILES_TO_MODIFY:** N (explicit count)
- **PROOF_BEFORE_PATCH:** print current block before editing
- **NO_SILENT_SUCCESS:** every validation prints PASS or FAIL
- **NO_SCOPE_CREEP:** touch only described lines
- **ATOMIC:** one logical change per commit
- **AUDIT_MISMATCH_RULE:** if codebase doesn't match assumed state → STOP, report mismatch

**Claude is a constrained architect, NOT an autonomous CTO.**

It reads, audits, patches surgically, and validates.  
It does NOT redesign, does NOT rename existing stable APIs,  
does NOT refactor outside the described scope.

---

## 13. Component Registry

**Source of truth:** `client/design-system/ui-registry.md`

Before creating ANY new UI component, consult the registry.  
If a similar component exists → extend it. Don't create a duplicate.

### Current Component Inventory (19 components)

**UI Primitives (7):**
- DecisionPill variants: VerdictPill, PriorityPill, StagePill
- InlineBar, LumiLoader, Skeleton, ErrorBoundary

**Decision Components (8):**
- CommandCenter, InputView, TheatreView, SuccessView
- DecisionFrame, ErrorView, DecisionBreadcrumb, MemoryPanel

**Layout (3):** MainLayout, Sidebar, ContextBar  
**Upload (1):** CsvUploader

### Anti-Pattern Prevention

The registry explicitly blocks these forbidden duplicates:

| Forbidden | Reason | Use Instead |
|---|---|---|
| InlineBar2, ProgressBar, MetricBar, ConfidenceLine | Duplicates InlineBar | Extend InlineBar with props |
| AlertBadge, StatusTag, VerdictChip, SignalPill | Duplicates DecisionPill | Use VerdictPill/PriorityPill/StagePill |
| AISpinner, ThinkingLoader, IntelLoader | Duplicates LumiLoader | Use LumiLoader |
| NavBar, TopBar, Header | Conflicts with Sidebar | Extend Sidebar or use ContextBar |

### Adding a New Component — Law

1. Check `ui-registry.md` first
2. If similar exists → extend it, don't duplicate
3. Choose directory: `ui/` (primitives), `decision/` (FSM), `layout/`, `upload/`
4. Keep primitives stateless (no API calls, no hooks)
5. Add to registry in the same PR
6. Document states in `component-states.md`
7. File size: primitives ≤ 150 lines, decision ≤ 300 lines

**Violation:** Creating a component without checking the registry  
**Result:** PR rejected, component deleted, registry consulted, work re-done

---

## 14. Architecture Decision Records

Major architectural decisions are documented in `/docs/adr/`.

**Consult before questioning why something is "weird":**

| Decision | Short reason |
|---|---|
| [ADR-001](docs/adr/ADR-001-firebase-over-clerk.md) | Firebase cheaper + better for MENA; `clerkId` column name kept intentionally |
| [ADR-002](docs/adr/ADR-002-postgres-over-airtable.md) | PostgreSQL handles joins/transactions; Airtable hit rate limits |
| [ADR-003](docs/adr/ADR-003-dual-agent-architecture.md) | Claude for analysis, GPT for creative; two agents = better output |
| [ADR-004](docs/adr/ADR-004-fsm-ui-pattern.md) | FSM prevents impossible states in 8-step decision flow |
| [ADR-005](docs/adr/ADR-005-bullmq-execution-layer.md) | Async Meta execution with idempotency + SSE status |

**When to write a new ADR:**  
Decision is hard to reverse AND affects multiple systems AND will confuse future engineers without context.

**When NOT to write an ADR:**  
Adding a component, endpoint, or refactoring within an existing pattern.

**Format:** Context → Problem → Decision → Tradeoffs → Consequences → Evidence in code

---

## 15. Security Architecture Layer

### Endpoint Security Checklist (required for every new route)

| Layer | Question | Failure = |
|---|---|---|
| **Auth** | Is `requireAuth` on this route? | 401 Unauthorized |
| **Ownership** | Is userId in the SQL WHERE clause? | IDOR / tenant isolation |
| **Validation** | Is request body validated (Zod/manual)? | injection / crashes |
| **Rate limit** | Is `apiLimiter` applied? | abuse / DoS |
| **Output** | Does response expose internal IDs? | enumeration |
| **Error** | Does 404 replace 403 on ownership fail? | resource enumeration |
| **Observability** | Is failure logged with context? | silent bugs |
| **Cache** | Does response set Vary: Authorization? | cross-user leakage |

### Ownership Rule (anti-IDOR)

```javascript
// ❌ WRONG — fetches then checks (vulnerable to IDOR + race condition)
const project = await getProjectById(projectId);
if (project.user_id !== req.userId) return res.status(403).json(...)

// ✅ CORRECT — ownership inside the query
const project = await getProjectById(projectId, req.userId);
if (!project) return res.status(404).json({ error: 'Project not found' });
// 404 not 403 — never confirm resource existence to wrong user
```

### XSS Rule (AI-generated content)

```javascript
// ❌ WRONG — AI output injected as HTML
element.innerHTML = aiResponse.content;

// ✅ CORRECT option 1 — React JSX (auto-escaped)
<p>{aiResponse.content}</p>

// ✅ CORRECT option 2 — DOMPurify if HTML is needed
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(aiResponse.html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'li'],
    ALLOWED_ATTR: [],
  })
}} />
```

### Security Check CI

```bash
npm run security-check  # runs scripts/security-check.js
```

Runs on every PR via `.github/workflows/architecture-check.yml`.
Blocks merge on: IDOR calls, SQL injection patterns, 403 leakage.
