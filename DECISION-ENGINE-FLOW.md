# Lumi Decision Engine — Visual Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         COMMAND CENTER (Hub)                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ ZONE A: 🔴 ACTIVE RADAR (Proactive)                               │   │
│  ├────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────┐       │   │
│  │  │ 🔴 Burn Rate: $247/day detected                        │       │   │
│  │  │ ───────────────────────────────────────────────────    │       │   │
│  │  │ Campaign: Summer Collection — US East                 │       │   │
│  │  │ Verdict: KILL    Confidence: 92%    Risk: HIGH        │       │   │
│  │  │                                                         │       │   │
│  │  │ Why:                                                    │       │   │
│  │  │  • CTR dropped 68% in last 48h                        │       │   │
│  │  │  • Frequency spike at 9.2x — creative fatigue         │       │   │
│  │  │  • $1,480 wasted on zero conversions                  │       │   │
│  │  │                                                         │       │   │
│  │  │                              [Review Alert →]          │       │   │
│  │  └────────────────────────────────────────────────────────┘       │   │
│  │                                                                      │   │
│  │  (More alerts...)                                                   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ ZONE B: MANUAL OS TOOLS (Reactive)                                 │   │
│  ├────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                         │   │
│  │  │ TOOL 01  │  │ TOOL 02  │  │ TOOL 03  │                         │   │
│  │  │ Campaign │  │ Strategy │  │ Content  │                         │   │
│  │  │ Analysis │  │ 🔒 Locked│  │ 🔒 Locked│                         │   │
│  │  │ [Active] │  │ Phase 2  │  │ Phase 3  │                         │   │
│  │  └──────────┘  └──────────┘  └──────────┘                         │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ 🧠 Decision Memory (Last 5)                                        │   │
│  │ • KILL — Summer Campaign — 2h ago [Replay →]                       │   │
│  │ • SCALE — Holiday Promo — 1d ago [Replay →]                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ User clicks [Review Alert]
                                     │ OR [Analyze Campaign]
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         INPUT_VALIDATION                                    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  From Radar Alert:                                                          │
│  ✓ Pre-filled from radar alert                                             │
│  Campaign: camp_23847dh (auto-selected)                                    │
│  [Auto-submitting in 2s...]                                                │
│                                                                              │
│  From Manual:                                                               │
│  ┌──────────────────────────────────────┐                                  │
│  │  Drag CSV here or click to browse   │                                  │
│  │  [Or select existing campaign ▼]    │                                  │
│  └──────────────────────────────────────┘                                  │
│  [Analyze with Lumi →]                                                     │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ submitInput()
                                     │ + AbortController created
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         THEATER 🔒 (Locked)                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  🧠 Lumi is analyzing your campaign...                                      │
│                                                                              │
│  [████████████████░░░░] 75%                                                │
│                                                                              │
│  • Fetching campaign data from Meta API                                    │
│  • Running decision models (Claude + ChatGPT)                              │
│  • Calculating financial impact                                            │
│                                                                              │
│  🔒 UI LOCKED — No user actions allowed                                    │
│  [Cancel] (aborts AbortController)                                         │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ reportSuccess(data)
                                     │ OR reportError(...)
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         SUCCESS (Verdict Display)                           │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  [KILL]  Summer Collection — US East                              │     │
│  │  Confidence: 92%  Risk: HIGH                                      │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  🔴 Financial Impact:                                                       │
│  Burn Rate: $247/day detected. Stop immediately to prevent further loss.   │
│                                                                              │
│  Why this verdict:                                                          │
│  01. CTR dropped 68% in last 48h (0.42% → 0.13%)                          │
│  02. Frequency spike at 9.2x — creative fatigue confirmed                 │
│  03. $1,480 wasted on zero conversions since May 2                        │
│                                                                              │
│  [Execute KILL Action 🔒]  [New Decision]  [Export PDF]                   │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ User clicks [Execute KILL Action]
                                     │ confirmExecution()
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  CONFIRM_EXECUTION (Modal Overlay)                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    ┌──────────────────────────────────────────────────────────────┐       │
│    │  ⚠️  Confirm Execution                                        │       │
│    │                                                                │       │
│    │  Are you sure you want to execute this KILL action           │       │
│    │  via Meta API?                                                │       │
│    │                                                                │       │
│    │  Action Details:                                              │       │
│    │  Type: pause_campaign                                         │       │
│    │  Target: camp_23847dh                                         │       │
│    │                                                                │       │
│    │  [Cancel]            [Confirm Execute]                        │       │
│    └──────────────────────────────────────────────────────────────┘       │
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ User clicks [Confirm Execute]
                                     │ executeAction()
                                     │ + AbortController created
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  API_EXECUTION 🔒 (Locked, Mock 1.5s)                      │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    ┌──────────────────────────────────────────────────────────────┐       │
│    │  ⏳ Executing KILL Action                                     │       │
│    │                                                                │       │
│    │  Communicating with Meta API...                               │       │
│    │                                                                │       │
│    │  Progress: [████████████░░] 85%                              │       │
│    │                                                                │       │
│    │  🔒 UI locked during execution                                │       │
│    └──────────────────────────────────────────────────────────────┘       │
│                                                                              │
│  (Mock setTimeout 1.5s in production: real Meta API call)                  │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ executionComplete()
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  MEMORY_COMMIT (Toast + Persist)                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✅ Action executed successfully                                            │
│  KILL action applied via Meta API                                           │
│                                                                              │
│  (Persists to Decision Memory — localStorage)                               │
│  (Updates history array, max 20 items)                                      │
│                                                                              │
│  After 500ms → commitToMemory()                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Automatic transition
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    COMMAND CENTER (Back to Hub)                             │
│                                                                              │
│  Decision now appears in Decision Memory:                                   │
│  • KILL — Summer Collection — just now [Replay →]                          │
└────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
ERROR FLOW (If Something Goes Wrong)
═══════════════════════════════════════════════════════════════════════════════

┌────────────────────────────────────────────────────────────────────────────┐
│                         ERROR (Intelligent Fallback)                        │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ⚠️  Analysis failed                                                        │
│                                                                              │
│  Network request timeout                                                    │
│  Code: NETWORK_ERROR | network                                              │
│                                                                              │
│  Check your connection and try again.                                       │
│                                                                              │
│  💡 Fallback: Try uploading CSV instead                                    │
│                                                                              │
│  [Retry Analysis]  [Back to Command Center]                                │
└────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
ABORT FLOW (User Cancels During Processing)
═══════════════════════════════════════════════════════════════════════════════

  THEATER 🔒          User clicks [Cancel]          COMMAND CENTER
  (isLocked=true)  ──────────────────────────────▶  (Fresh state)
                     • AbortController.abort()
                     • reset()
                     • Clean transition


═══════════════════════════════════════════════════════════════════════════════
KEY ARCHITECTURAL PRINCIPLES
═══════════════════════════════════════════════════════════════════════════════

1. NO DIRECT EXECUTION
   SUCCESS → CONFIRM_EXECUTION → API_EXECUTION
   ↑ Always through confirmation modal

2. STATE LOCKING
   THEATER: isLocked = true (async AI analysis)
   API_EXECUTION: isLocked = true (async Meta API call)
   ↑ User cannot take actions during these states

3. ABORT PROTECTION
   AbortController created on:
   - submitInput() → THEATER
   - executeAction() → API_EXECUTION
   Aborted on:
   - Component unmount
   - New operation start
   - User cancel

4. INTELLIGENT ERRORS
   classification: 'network' | 'auth' | 'parsing'
   fallbackAction: "Try uploading CSV instead"
   retryable: true | false

5. PERSISTENCE
   localStorage:
   - lumi:decisionHistory (max 20)
   - lumi:radarAlerts

6. PROACTIVE + REACTIVE
   Proactive: Radar alerts → Review Alert → Auto-submit
   Reactive: Manual tools → Upload/Select → Submit
   ↑ Both converge on same verdict pipeline


═══════════════════════════════════════════════════════════════════════════════
DESIGN TOKENS
═══════════════════════════════════════════════════════════════════════════════

Verdict Colors:
• KILL:     #EF4444 (Red)     → Destructive, stop immediately
• HOLD:     #F59E0B (Amber)   → Caution, monitor closely
• SCALE:    #10B981 (Green)   → Success, amplify spend
• OPTIMIZE: #6366F1 (Indigo)  → Refine, test variations

Risk Levels:
• HIGH:     Red tint, border-red-500/20, bg-red-500/5
• MEDIUM:   Yellow tint, border-yellow-500/20, bg-yellow-500/5
• LOW:      Blue tint, border-blue-500/20, bg-blue-500/5

Animations:
• fade-in:   150ms ease-out
• scale-in:  200ms cubic-bezier (modals)
• Progressive reveal: 0ms → 400ms → 800ms → 1200ms → 1600ms


═══════════════════════════════════════════════════════════════════════════════
MOCK vs PRODUCTION
═══════════════════════════════════════════════════════════════════════════════

Phase 1.1 (Current — MOCK):
✓ Mock radar alerts (MOCK_ALERTS array)
✓ Mock API execution (setTimeout 1.5s)
✓ localStorage persistence

Phase 2.0 (Production):
→ Real radar alerts from /api/radar
→ Real Meta API execution via backend
→ Webhook handlers for campaign status
→ Database persistence (replace localStorage)
```
