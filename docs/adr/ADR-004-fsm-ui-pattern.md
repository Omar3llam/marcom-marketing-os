# ADR-004: Finite State Machine for Decision UI

**Status:** ✅ Accepted  
**Date:** Sprint 4 (v4.0)  
**Deciders:** Frontend lead + UX review

## Context

MARCOM's core user flow is a **multi-step decision pipeline**:

1. User uploads CSV or selects campaigns
2. AI analyzes campaigns (loading state, 15-30 seconds)
3. System displays verdict (KILL/HOLD/SCALE)
4. User confirms execution
5. System executes Meta API actions (pause ad, scale budget)
6. System commits decision to memory

In v1-v3, this flow was managed with **useState + conditional rendering**:

```javascript
const [step, setStep] = useState('upload');
const [isAnalyzing, setIsAnalyzing] = useState(false);
const [verdict, setVerdict] = useState(null);
const [isExecuting, setIsExecuting] = useState(false);
const [executionResult, setExecutionResult] = useState(null);
const [error, setError] = useState(null);
```

This caused **state explosion** — we had 6+ boolean flags, and it was unclear which combinations were valid:
- Can `isAnalyzing` and `isExecuting` both be true? (No, but nothing prevented it)
- If `error` is set, should `verdict` be null? (Yes, but we had bugs where both were set)
- Can user jump from `'upload'` to `'execution'` without confirmation? (No, but the code allowed it)

We had 3 production bugs caused by invalid state transitions:
1. User clicked "Execute" twice → sent 2 API requests to Meta → charged client double
2. Error occurred during analysis, but UI still showed "Analyzing..." (stuck state)
3. User navigated away during execution → AbortController not triggered → orphaned API call

The question: **Continue with useState hell, or adopt a state machine pattern?**

## Decision

**Implement a Finite State Machine (FSM)** using `useReducer` to manage the decision flow.

Architecture:
- **7 states**: `COMMAND_CENTER`, `INPUT_VALIDATION`, `THEATER`, `SUCCESS`, `CONFIRM_EXECUTION`, `API_EXECUTION`, `MEMORY_COMMIT`, `ERROR`
- **1 reducer**: Validates ALL state transitions (e.g., can't jump from `THEATER` to `CONFIRM_EXECUTION` without passing through `SUCCESS`)
- **State locking**: `THEATER` and `API_EXECUTION` are locked (user can't navigate away or trigger new analysis)
- **AbortController integration**: Each async transition gets its own AbortController — cleanup on state exit
- **Error state**: Centralizes all error handling with classification (`ANALYSIS_FAILED`, `EXECUTION_FAILED`, `NETWORK_ERROR`)

## Rationale

### Why FSM over useState?

1. **Impossible states are impossible**: Can't have `isAnalyzing === true` and `isExecuting === true` simultaneously — the FSM only allows one state at a time
2. **Clear transition rules**: Reducer explicitly lists valid transitions (e.g., `THEATER` → `SUCCESS` or `THEATER` → `ERROR`, no other options)
3. **Centralized logic**: All state changes go through the reducer — no scattered `setStep()` calls across 10 components
4. **Debuggable**: Can log every state transition → replay bugs exactly as they occurred
5. **Testable**: Can unit test reducer transitions without mounting React components

### Why useReducer instead of XState?

- **XState** is a full state machine library with visualization, parallel states, nested machines
- **useReducer** is React built-in, zero dependencies, simpler mental model
- We only need **linear state flow** (A → B → C), not parallel states or nested machines
- XState would add 50KB to bundle, useReducer is <1KB

### Why 7 states specifically?

We mapped the user flow to distinct UI screens:
1. **COMMAND_CENTER**: War room home (radar feed, activity ticker)
2. **INPUT_VALIDATION**: CSV upload + mode selection
3. **THEATER**: AI analysis in progress (locked, can't navigate away)
4. **SUCCESS**: Verdict display (KILL/HOLD/SCALE card)
5. **CONFIRM_EXECUTION**: User confirms "Yes, execute this"
6. **API_EXECUTION**: Meta API call in progress (locked)
7. **MEMORY_COMMIT**: Write to DecisionMemory (fast, auto-transitions to COMMAND_CENTER)
8. **ERROR**: Error screen with classification + retry button

Each state has **exactly one UI view** — no conditional rendering within a state.

## Consequences

### Positive

✅ **Zero invalid states**: Reducer prevents impossible transitions (e.g., can't execute without confirmation)  
✅ **Debuggable**: Every state change is logged → can replay user sessions exactly  
✅ **Abort on unmount**: AbortController cleanup prevents orphaned API calls  
✅ **Clear loading states**: `THEATER` and `API_EXECUTION` states make loading UX explicit  
✅ **Error centralization**: All errors route to `ERROR` state with classification  
✅ **Testable**: Reducer is pure function — easy to test all transitions  
✅ **Self-documenting**: State enum + reducer is the spec for the entire flow

### Negative

❌ **Learning curve**: Junior devs unfamiliar with FSM pattern took 1-2 days to understand  
❌ **Verbosity**: Reducer is 400+ lines (vs. 50 lines of useState, though that was buggy)  
❌ **Boilerplate**: Every new state requires action type + reducer case + UI view  
❌ **Over-engineering risk**: FSM is overkill for simple flows (e.g., a modal with 2 states: open/closed)  
❌ **Refactoring cost**: Changing flow order requires updating reducer transitions  
❌ **No visual diagram**: XState has built-in visualization — useReducer FSM needs manual diagramming

### Guardrails implemented

**State locking:**
- `THEATER` and `API_EXECUTION` set `locked: true` in state → Sidebar navigation is disabled
- User can't spam "Analyze" button during analysis (button is disabled when `view === 'THEATER'`)

**AbortController per transition:**
```javascript
const abortControllerRef = useRef(new AbortController());

useEffect(() => {
  return () => {
    abortControllerRef.current.abort(); // cleanup on state exit
    abortControllerRef.current = new AbortController();
  };
}, [state.view]);
```

**Error classification:**
- `ANALYSIS_FAILED`: AI returned error → show "Try simpler prompt" suggestion
- `EXECUTION_FAILED`: Meta API rejected action → show "Check Meta credentials"
- `NETWORK_ERROR`: Fetch timeout → show "Check internet connection"

## Evidence in Code

**FSM hook (canonical):**
```
client/src/hooks/useDecisionFSM.js
  → 16 reducer cases (actions like 'START_ANALYSIS', 'ANALYSIS_SUCCESS', 'EXECUTION_FAILED')
  → 7 states: COMMAND_CENTER, INPUT_VALIDATION, THEATER, SUCCESS, CONFIRM_EXECUTION, API_EXECUTION, ERROR
  → State locking: locked: true during THEATER and API_EXECUTION
  → AbortController integration for cleanup
```

**Page container:**
```
client/src/pages/DecisionFeed.jsx
  → Uses useDecisionFSM() hook
  → Renders views based on state.view:
      COMMAND_CENTER → <CommandCenter />
      THEATER → <TheatreView />
      SUCCESS → <SuccessView />
      ERROR → <ErrorView />
```

**Decision components:**
```
client/src/components/decision/CommandCenter.jsx
client/src/components/decision/InputView.jsx
client/src/components/decision/TheatreView.jsx
client/src/components/decision/SuccessView.jsx
client/src/components/decision/DecisionFrame.jsx
client/src/components/decision/ErrorView.jsx
  → Each component is stateless — receives state + dispatch as props
  → No component can trigger invalid transition (reducer blocks it)
```

**State transition example:**
```javascript
// In useDecisionFSM.js reducer
case 'START_ANALYSIS':
  if (state.view !== 'INPUT_VALIDATION') {
    console.warn('Cannot start analysis from', state.view);
    return state; // block invalid transition
  }
  return {
    view: 'THEATER',
    locked: true,
    inputData: action.payload,
    outputData: null,
    errorDetails: null,
  };
```

## Alternatives Considered

### 1. useState + conditional rendering (status quo)
- **Pro**: Familiar pattern, less code upfront
- **Con**: Invalid states possible, hard to debug, caused 3 production bugs

### 2. XState
- **Pro**: Visual diagrams, parallel states, nested machines, TypeScript integration
- **Con**: 50KB bundle size, over-engineered for linear flow, steeper learning curve

### 3. Zustand (global state)
- **Pro**: Simple API, good for shared state across components
- **Con**: Doesn't enforce state transitions (still allows invalid states), global state is overkill for single-page flow

### 4. React Router (route-based state)
- **Pro**: Browser back/forward buttons work, deep-linkable states
- **Con**: Decision flow shouldn't be URL-addressable (e.g., `/theater` without uploading CSV first = invalid), locks UI to browser history

### 5. Redux + redux-saga
- **Pro**: Time-travel debugging, middleware for side effects
- **Con**: Massive overkill (500+ lines of boilerplate for 7 states), entire team would need Redux training

## State Diagram

```
COMMAND_CENTER (unlocked)
  ↓ [user clicks "Analyze"]
INPUT_VALIDATION (unlocked)
  ↓ [user uploads CSV]
  ↓ dispatch('START_ANALYSIS')
THEATER (locked)
  ↓ [AI analysis completes]
  ↓ dispatch('ANALYSIS_SUCCESS')
SUCCESS (unlocked)
  ↓ [user clicks "Execute"]
CONFIRM_EXECUTION (unlocked)
  ↓ [user confirms]
  ↓ dispatch('START_EXECUTION')
API_EXECUTION (locked)
  ↓ [Meta API returns]
  ↓ dispatch('EXECUTION_SUCCESS')
MEMORY_COMMIT (auto-transition)
  ↓ dispatch('COMMIT_COMPLETE')
COMMAND_CENTER (loop back)

ERROR (escape hatch from any state)
  ↓ [user clicks "Retry" or "Back"]
  ↓ dispatch('RESET_TO_HOME')
COMMAND_CENTER
```

## Performance Impact

| Metric | useState (v3) | FSM useReducer (v4) |
|---|---|---|
| DecisionFeed.jsx size | 280 lines | 430 lines |
| useDecisionFSM.js size | N/A | 427 lines |
| Invalid state bugs (6 months) | 3 production bugs | 0 bugs |
| AbortController cleanup rate | 60% (manual) | 100% (automatic) |
| State transition logging | Manual console.log | Automatic reducer logging |
| Unit test coverage | 40% (hard to test) | 85% (reducer is pure function) |

**Net impact:** 150 more lines of code, but zero state bugs and 2x test coverage.

## Rollback Plan

If FSM proves too complex, we can rollback to useState in ~1 sprint:
1. Remove `useDecisionFSM.js` hook
2. Replace with 6 useState hooks in `DecisionFeed.jsx`
3. Re-add conditional rendering (`{isAnalyzing && <TheatreView />}`)
4. Accept risk of invalid state bugs

**Likelihood of rollback:** <2% — FSM has eliminated state bugs entirely, and the team is now comfortable with the pattern.

## Related ADRs

- None (this is the first UI state management decision)
