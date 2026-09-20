# PHASE 5.14 — R-14 Authorization Context Contract Correction

**Commit:** `7d0b0c3` · **Branch:** `feat/lumi-authorization-context-contract` · **Base:** `origin/master` `5db01d1`

---

## 1. Baseline Verification

| | |
|---|---|
| Stated | `origin/master` `5db01d1`; Phase 5.13 branch head `ec019df`; #485 squash-merged |
| Verified | `git rev-parse origin/master` → **`5db01d1`** (`fix: enforce Settings audience and permission boundaries (#485)`) |
| Branch | `git checkout -B feat/lumi-authorization-context-contract origin/master` — **not stacked** |
| Worktree at start | clean except untracked `.claude/launch.json` |
| `npm run check-orphans` | ✅ every checked PR's code is present on master |
| Runtime | **Node v24.20.0** (pinned; machine default v24.15.0 not used) |

---

## 2. Phase 5.13 Finding — Reproduced From Source

Every line re-read at `5db01d1`. The discovery report was **not** taken on trust.

| Evidence | Confirmed |
|---|---|
| `src/services/collaboration/roleScope.js:20-22` | `DEFAULT_ROLE = WORKSPACE_ROLE.STRATEGIST`, commented *"Null/unknown collab role falls back to STRATEGIST so existing seats … are never locked out"* |
| `roleScope.js:31-33` | `normalizeRole(role)` returns `DEFAULT_ROLE` for **any** unrecognised value, including `null` |
| `src/middleware/requireCollabRole.js:74-80` | `resolveCollabRoleForDisplay` catches and returns `normalizeRole(null)` → `'STRATEGIST'` |
| `src/routes/lumi/collaboration.js:61-67` | `GET /roles/me` returned **200** `{role:'STRATEGIST', visibleStates:[7]}` |
| `client/src/context/RoleContext.jsx:55-56` | `'STRATEGIST' ∈ KNOWN_ROLES` → `status: READ.PRESENT` |
| `requireCollabRole.js:60` | a row whose `collabRole` is unset → `resolveCollabRole` returns `null` |
| `requireCollabRole.js:63-64` | a DB failure throws `RoleUnavailableError` |
| `requireCollabRole.test.js:93-104` | the old behaviour was **asserted as intended** — `resolves.toBe('STRATEGIST')` for both an outage and a null role |
| Enforcement strict? | ✅ `requireCollabRole.js:94-97` → **503 RoleUnavailable**; `:100-106` → **403 RoleForbidden** |

**Additional evidence gathered before editing** (not in 5.13):

- `canApprove(null) === true` via `normalizeRole`, but **not reachable**: both call sites (`ApprovalService.js:71`, `:111`) sit behind `requireCollabRole` (`collaboration.js:143`, `:166`), which sets a resolved `req.collabRole`. Recorded, not changed.
- `resolveCollabRoleForDisplay` has **three other callers** — `collaboration.js:188` (`/inbox`), `agentic.js:46` (`/home`), `feedSurfacing.js:19`. All shape role-scoped **content**, none publishes a seat. Left unchanged; see §16.
- `User.collabRole` is a Prisma **enum** `WorkspaceRole?` (`schema.prisma:487`, `:302-306`) — only `STRATEGIST | BUYER | CLIENT | null` can be stored.

---

## 3. Existing API Contract (before)

```
GET /api/lumi/roles/me   →  200 { role, visibleStates, userRole }
```

`role` was **always** a valid-looking `WORKSPACE_ROLE`. The response had no way to say "could not establish". Mounted behind `requireAuth` + `requireWorkspace` (`server.js:213-219`), which answer **401**, never 403 — so the client's 403 → `NOT_PERMITTED` mapping had no producer on this path.

Conventions already in the repository, which the new contract reuses rather than invents:

| Situation | Existing answer |
|---|---|
| enforcement, role unresolvable | `503 {error:'RoleUnavailable'}` |
| enforcement, seat unassigned | `403 {error:'RoleForbidden', role:null, message:'…Ask a workspace Strategist to set one.'}` |
| a read that succeeded with nothing to report | `200 {workspace:null, hasWorkspace:false}` (`user.js:32/36/45`) |

---

## 4. Contract Decision

```
GET /api/lumi/roles/me → 200
{
  role:          'STRATEGIST' | 'BUYER' | 'CLIENT' | null,
  roleStatus:    'RESOLVED' | 'UNRESOLVED',
  roleReason:    null | 'ROLE_UNSET' | 'ROLE_LOOKUP_FAILED',
  visibleStates: string[] | null,
  userRole:      'ADMIN' | 'VIEWER'
}
```

### Why still 200, and not 503 or 403

- **A 403 would be false.** This endpoint has no gate — asking about your own seat is never refused — and `readStatusForError` maps 403 to `NOT_PERMITTED`. It would turn an outage into a refusal: the R-14 inversion, pointed the other way.
- **A 503 would couple two orthogonal axes.** `userRole` (ADMIN | VIEWER) is resolved by `firebaseAuth`, is independent of the collaboration role, and `useUserRole` reads it **from this response** to gate `/admin`. Failing the whole response would take a genuine ADMIN's panel away because an unrelated store was unavailable. Asserted: *"an ADMIN keeps their userRole when the COLLAB seat fails"*.
- **The request succeeded.** One *field* of the answer could not be established, and the body says so — the same shape `GET /api/user/workspace` already uses.

### Why two reasons and not one (§4 of the brief)

The backend **can** distinguish them: a lookup failure throws, an unset role returns `null`. They are not semantically identical, because they have **different next steps** — which is C-07's rule that a token cannot replace a reason:

| Reason | Truth | Next step | Client state |
|---|---|---|---|
| `ROLE_UNSET` | the row was read; it carries no role | a Strategist must assign one — a retry changes nothing | `READ.NOTHING_FOUND` |
| `ROLE_LOOKUP_FAILED` | the read itself failed | a retry is honest | `READ.NOT_REACHABLE` |

`ROLE_UNSET` maps to `NOTHING_FOUND` because that is B8-02's *"We looked, and there is nothing. A FINDING — state it as an answer."* It is the same condition the enforcement gate already answers with *"Ask a workspace Strategist to set one."*

**Limitation, stated:** `resolveCollabRole` returns `null` both for "the row exists and its role is unset" and for "no `userId` at all". Both surface as `ROLE_UNSET`. The second cannot occur on this route (`requireAuth` runs first), so the conflation is not observable here — but the contract does not distinguish them, and that is recorded rather than papered over.

**No new state vocabulary.** All four client states are existing B8-02/`READ` tokens.

---

## 5. Backend Implementation

| File | Change |
|---|---|
| `src/services/collaboration/roleScope.js` | **+** `asKnownRole(role)` — the role or `null`, **no default**. `normalizeRole` and `DEFAULT_ROLE` untouched; `DEFAULT_ROLE`'s comment now states it may never be published. |
| `src/middleware/requireCollabRole.js` | **+** `ROLE_UNRESOLVED_REASON`, **+** `resolveCollabRoleContext(req)` returning a discriminated `{status, role, reason}`. `resolveCollabRole` now uses `asKnownRole` on all three inputs. `resolveCollabRoleForDisplay` kept, documented as unusable for publishing a seat. |
| `src/routes/lumi/collaboration.js` | `/roles/me` reads the context resolver; `visibleStates` withheld when unresolved. |
| `src/services/vocabulary/epistemicInventory.js` | `ROLE_UNRESOLVED_REASON` ruled **EXCLUDED** with a written reason. |

### The second leak, found while testing — and its honest reachability

`resolveCollabRole` called `normalizeRole(u.collabRole)` at line 55 (and on `req.collabRole`, fed raw from the store at `firebaseAuth.js:223`). An unrecognised value was therefore promoted to **STRATEGIST inside the ENFORCEMENT path**: `requireCollabRole` would set `req.collabRole = 'STRATEGIST'` and pass a STRATEGIST-gated route.

**NOT REACHABLE today.** `User.collabRole` is a Prisma enum, so only the three valid values or `null` can be stored, and all four already behaved correctly. This is a **forward guard**: the day the enum gains a fourth value, `normalizeRole` would have enforced it as the widest seat. `asKnownRole` denies instead.

No reachable input changes behaviour — stated as an argument, not an assumption: the three enum values pass through both functions identically, and `null` was already `null` at line 60.

### Not changed, deliberately

`normalizeRole`'s default has 10+ consumers including `canApprove`/`canExecute`/`canSeeState`. Changing it globally is the broad refactor §4.7 warns against, and the permissive branch is verified unreachable through every route. Recorded in §16.

---

## 6. Frontend Implementation

| File | Change |
|---|---|
| `client/src/context/RoleContext.jsx` | branches on `roleStatus`/`roleReason`; `KNOWN_ROLES` kept as the belt |
| `client/src/components/auth/RoleUnavailable.jsx` | one sentence per state, declared as a `COPY` map; axis named; no retry control |
| `client/src/components/auth/PlanGate.jsx` | `ENTITLEMENT_COPY` map; `NOTHING_FOUND` corrected; axis named |

Both components import the vocabulary from its **home** (`design-system/states/readStatus.js`) rather than through `usePlan.js` / `RoleContext.jsx`. The copy maps are built at module scope, and three suites whole-module-mock `usePlan.js`; keying a static map off a mockable hook turned an incomplete mock into an import-time crash rather than a readable assertion. `READ`, `WORKSPACE_READ` and `ROLE_READ` are the same frozen object.

**Unchanged:** `RoleGate`, `RequireUserRole`, `useUserRole`, `MainLayout`, `Sidebar`, `SettingsView`, `TeamTab`, `RevenueCsvTab`, direct-route protection. No gate logic was touched — only what the states mean and how they read.

---

## 7. State Mapping

| Server | Client state | Gate behaviour |
|---|---|---|
| in flight | `LOADING` | protected children withheld; shell shows a labelled wait |
| `RESOLVED` + known role | `PRESENT` | evaluate access normally |
| `UNRESOLVED` + `ROLE_UNSET` | `NOTHING_FOUND` | fail closed; named state |
| `UNRESOLVED` + `ROLE_LOOKUP_FAILED` | `NOT_REACHABLE` | fail closed; named state |
| transport rejection, 403 | `NOT_PERMITTED` | fail closed (see §8 — no producer found) |
| transport rejection, other | `NOT_REACHABLE` | fail closed |
| no `roleStatus` (old server) + valid role | `PRESENT` | unchanged — degrades safely |
| no `roleStatus` + no valid role | `NOT_REACHABLE` | fail closed |

**The success condition holds:**

```
Unresolved role  ≠ STRATEGIST   ✅ role is null, asserted BE + FE
                 ≠ PRESENT      ✅ NOTHING_FOUND or NOT_REACHABLE
                 ≠ NOT_PERMITTED ✅ 403 is never produced for an unresolved seat

Known refusal    ≠ role-read failure       ✅ distinct copy, asserted
                 ≠ workspace-read failure  ✅ distinct axis, asserted
```

---

## 8. Copy Mapping

### Role axis — `RoleUnavailable`

| State | Title | Description |
|---|---|---|
| `NOTHING_FOUND` | *No access level is set for your account.* | *Ask a Strategist in your workspace to assign one. Nothing is wrong with your account.* |
| `NOT_REACHABLE` | *Lumi couldn't check your access just now.* | *This is a problem on our side. Nothing about your account has changed.* |
| `NOT_PERMITTED` | *Lumi isn't allowed to check your access.* | — (no "our side" claim) |

### Workspace axis — `EntitlementUnavailable`

| State | Title | Description |
|---|---|---|
| `NOTHING_FOUND` | *Lumi couldn't find a workspace for this account.* | *Your account is signed in, but no workspace is attached to it yet.* |
| `NOT_REACHABLE` | *Lumi couldn't read your workspace just now.* | *This is a problem on our side, not a verdict about your campaigns.* |
| `NOT_PERMITTED` | *Lumi isn't allowed to read this workspace.* | — |

**Rules carried, and asserted:**

- **Subject discipline.** A failure's subject is LUMI; a refusal's subject is the rule. No surface says *"You don't have permission"* for a state that was not established — asserted per state.
- **The axis is named.** Every role title matches `/access/i` and **not** `/workspace/i`; every workspace title the reverse. That is 5.13's M-4 closed, and the old shared sentence is asserted **gone from both**.
- **No two states read alike** — asserted by rendering all three and comparing full text.
- **Nothing claims a plan, a tier or money** on either axis.
- **`NOTHING_FOUND` (workspace) corrected.** It was rendered as *"couldn't read … a problem on our side"*. The server replied `hasWorkspace:false` — the read **succeeded**. Both clauses were false about Lumi's own position. The new sentence states the measured fact and **offers no next step**, because what a person should do about having no workspace is an open ruling (R-14.b) and inventing one would be inventing product.
- **No internal detail** — no status codes, resolver names, API paths, middleware terms.

---

## 9. Recovery Behaviour

Audited after the contract change, per §8 of the brief.

| | |
|---|---|
| Is retry possible on the role axis? | **No.** `RoleContext` fetches once with `[]` deps and exposes no refetch. |
| Is retry possible on the workspace axis? | **Mechanically yes** — `useWorkspace` exports `refetch` (`:127`) — but it still has **zero callers**. |
| Does a reload recover? | Yes, both axes (full remount). |
| Does navigation recover? | **No.** `RoleContext` is mounted at `MainLayout` and holds its resolved state across in-shell navigation. `useWorkspace` re-reads only on `currentUser` change. |
| Does the user get actionable information? | Only for `NOTHING_FOUND` on the role axis, where a real action exists ("ask a Strategist"). |
| Does any copy promise an action that does not exist? | **No** — asserted: no button renders, and no sentence contains *try again*, *retry* or *refresh*. |

**No retry control was added.** Wiring `refetch` changes *when* a dependency is re-read, which is a behaviour change rather than copy, and §8 says to document rather than fabricate. Follow-up in §16.

---

## 10. Security and Authorization Impact

| | |
|---|---|
| Enforcement | **Unchanged and still fails closed.** `requireCollabRole` → 503 `RoleUnavailable` on an unresolvable role, 403 `RoleForbidden` on an unassigned one. Both asserted, untouched. |
| Net direction | **Strictly tighter.** An unrecognised role now denies instead of being enforced as STRATEGIST. |
| Privilege granted anywhere? | **No.** No path gained access it did not have. |
| Protected content leaked while unresolved? | **No.** `RoleGate`, `PlanGate`, `RequireUserRole`, `LockFromClient`, `MainLayout` are untouched and still return nothing or a named state. The #485 mount-level test is unchanged and passing. |
| Behaviour change users will see | A seat that previously rendered the **full operator surface** during a role-store outage now sees a named unavailable state. That is the ruling: it removes an exposure, and it removes access that was never genuinely granted. |
| Backend ownership of truth | preserved — the client claims nothing the server did not state. |
| Migration required | **None.** No schema change, no data change. The client degrades safely against an un-deployed server, and the server's added fields are ignored by an old client that still reads `role`. |

---

## 11. Tests Added or Changed

**Added**

- `src/routes/lumi/rolesMe.test.js` — **new**, 16 cases. 5.13 recorded this route as NOT COVERED at route level. Runs the real `requireCollabRole`; only prisma and the logger are mocked.
- `client/src/components/auth/RoleUnavailable.test.jsx` — **new**, 19 cases. 5.13 recorded this component as NOT COVERED; its copy was only ever asserted through a regex that **also matched** `EntitlementUnavailable`.

**Changed — corrected, never weakened or deleted**

- `src/middleware/requireCollabRole.test.js` — the two cases asserting `resolveCollabRoleForDisplay → 'STRATEGIST'` are **kept** (that function still has three legitimate callers) and **retitled `SHAPING:`**, because the old names read as a blanket endorsement of the default and `/roles/me` relied on exactly that reading. **+9** cases for `resolveCollabRoleContext`.
- `client/src/components/auth/roleRead.test.jsx` — **+7** cases for the new contract, including a server that sends no `roleStatus` at all.
- `client/src/components/auth/PlanGate.test.jsx` — copy assertions updated to the per-state sentences; **+4** cases including the `NOTHING_FOUND` correction and *"no two absence states read alike"*.
- `client/src/components/auth/roleBoundary.test.jsx` — copy assertions updated to the ACCESS axis; **+1** case for an unassigned seat.
- `client/src/components/layout/__tests__/roleShellBoundary.test.jsx` — one copy assertion updated.
- `client/src/features/settings/settingsAudience.test.jsx` — `READ_FAILED` regex retargeted from the shared sentence to the role axis.

---

## 12. Tests Run

Node **v24.20.0** throughout.

| Gate | Result |
|---|---|
| `src/routes/lumi/rolesMe.test.js` + `requireCollabRole.test.js` | **35 passed** |
| Backend `npm test` (fast) | **380 files passed / 19 skipped; 5677 passed / 471 skipped, 0 failed** |
| Client `src/components/auth` + `src/context` | **88 passed** |
| Client full `vitest run` | **245 files / 3462 tests passed, 0 failed** |
| `npm run lint:ci --workspace client` | clean (`--max-warnings 0`) |
| `npm run tokens:check --workspace client` | ✅ |
| `npm run build --workspace client` | ✓ built in 7.43s |
| `npm run check:tokens --workspace client` | ✅ 1052 selectors resolve |
| `npm run lint` (root, backend-only) | **0 errors**, 28 pre-existing warnings |
| `npm run arch-check` | ✅ **PASSED** — 0 failures, **5 warnings (the pre-existing count)** |
| `npm run check-orphans` | ✅ |

**Two governance mechanisms fired during this phase and were obeyed, not bypassed:**

1. **C-06 ratchet** — `epistemicInventory.test.js` failed with *"A status vocabulary exists that C-06 has not ruled on"* for `ROLE_UNRESOLVED_REASON`. Ruled **EXCLUDED** with a written reason, on the same ground as the four `*_REASON` vocabularies already excluded: a reason refines a status that is already classified, and declaring both would let one seat carry two knowledge tokens.
2. **arch-check** — `client/src/context/**` has a 100-line budget and my comment block pushed `RoleContext.jsx` to 111. The comment was **tightened to 99 lines**; the budget was not moved. (Warnings returned to the pre-existing 5.)

### Planted-regression battery — 11/11 caught

Both halves green before and after every revert. A plant that failed to apply would have been reported as NOT CAUGHT; none did.

| # | Side | Plant | Verdict |
|---|---|---|---|
| 1 | BE | **the defect** — `/roles/me` publishes the display default again | CAUGHT (6) |
| 2 | BE | `asKnownRole` gains a default | CAUGHT (6) |
| 3 | BE | an UNSET role reported as RESOLVED | CAUGHT (6) |
| 4 | BE | `visibleStates` published for an unknown seat | CAUGHT (1) |
| 5 | BE | enforcement promotes an unrecognised stored role | CAUGHT (2) |
| 6 | FE | client ignores `roleStatus`, trusts the role string | CAUGHT (1) |
| 7 | FE | the two reasons collapse to one state | CAUGHT (2) |
| 8 | FE | an ABSENT workspace spoken as a failed read | CAUGHT (1) |
| 9 | FE | **M-4 returns** — all three role states share one title | CAUGHT (17) |
| 10 | FE | a refusal blames our side again | CAUGHT (2) |
| 11 | FE | a "Try again" control that performs no retry | CAUGHT (7) |

---

## 13. Tests Unavailable or Skipped

```
npm run test:full
▶ FULL verification — REQUIRE_DB=1. DB-backed suites must execute; an unusable database fails the run.
IsolationSetupError: TEST_DATABASE_URL is not set. Full verification provisions throwaway databases and must never…
Serialized Error: { code: 'DB_ISOLATION_UNAVAILABLE' }
```

`TEST_DATABASE_URL` is not set in this worktree and there is no `.env`. **The guard was not bypassed and the run was not degraded to fast mode. No claim is made about database semantics.** The backend fast run (19 suites skipped) makes no database claim either.

This matters more than usual here: the resolution path reads `prisma.user.findUnique`, and every test of it **mocks prisma**. The failure mode itself (a real database outage producing `RoleUnavailableError`) has **not** been exercised against a real database.

---

## 14. Build and Lint Results

Build ✓ 7.43s. Lint clean on both workspaces (0 errors).

| | `5db01d1` | `7d0b0c3` | delta |
|---|---|---|---|
| total gzip, `dist/assets` | 1,899,508 B | 1,899,975 B | **+467 B** |

---

## 15. Remaining NOT VERIFIED

- **Infrastructure 403 on `/roles/me` or `/api/user/workspace`.** No repository code produces one (both mount behind `requireAuth`, which 401s). Whether Render, a CDN or a WAF can is **NOT VERIFIED** — not determinable from the repository. `NOT_PERMITTED` is therefore retained on both axes, with copy, and **not** deleted: 5.13's rule was not to remove a state merely because current routes do not produce it.
- **Real Firebase was NOT used.** `AuthContext` and `@/firebase.js` are mocked in every client test.
- **A real database was NOT exercised.** Prisma is mocked in the backend tests; `test:full` refused (§13).
- **No production build was driven in a browser.**
- **`req.collabRole` provenance beyond `firebaseAuth`.** Verified set at `firebaseAuth.js:194/223/355/375` from the enum column, and by `requireCollabRole` itself. No other writer was found by `grep`; that is a search result, not a proof of absence.

---

## 16. Follow-up Work

1. **The three remaining `resolveCollabRoleForDisplay` callers** — `/inbox` (`collaboration.js:188`), `/home` (`agentic.js:46`), `feedSurfacing.js:19`. Each still shapes role-scoped **content** from the STRATEGIST default when the seat is unresolved. They publish data, not an access claim, and narrowing them changes what those surfaces return — a product decision, not this ruling. **Same class as the defect just fixed; recorded rather than silently changed.**
2. **`normalizeRole`'s default** — still permissive for `canApprove` / `canExecute` / `canSeeState`. Verified unreachable through every route today (all callers sit behind `requireCollabRole`). Worth closing at the root eventually.
3. **Recovery.** `useWorkspace.refetch` exists with zero callers; `RoleContext` cannot refetch at all. Wiring either is a semantics change and needs its own slice.
4. **`ROLE_UNSET` vs "no userId"** conflate in `resolveCollabRole` (§4). Not observable on this route.
5. **A real-database test** of the `RoleUnavailableError` path, once `TEST_DATABASE_URL` is available.

---

## 17. Open Product Owner Rulings

| # | Ruling | Status |
|---|---|---|
| **R-14.b** | What should a user with **no workspace** (`hasWorkspace:false`) see or do? The copy now states the fact and deliberately offers no next step. | **Open — blocks nothing** |
| **R-14.c** | Should gate-level failures carry a retry? Changes re-read semantics. | Open |
| **Follow-up 1** | Should `/inbox`, `/home` and `feedSurfacing` also stop defaulting? | Open |
| R-15 | `workspace` Settings section audience | Carried |
| — | unreachable `billing` branch in `SettingsView` | Carried |
| R-4 · R-10 · R-11 · R-12 · R-13/R-1 | show-locked nav · ContextBar · pricing/landing · currency default · NOW-vs-THEN | Carried, untouched |

---

## 18. Final Phase Verdict

> ### ✅ COMPLETE — the P1 that blocked Phase 5.13 is closed

The success condition holds, asserted on both sides of the wire:

```
Unresolved role  ≠ STRATEGIST · ≠ PRESENT · ≠ NOT_PERMITTED
Known refusal    ≠ role-read failure · ≠ workspace-read failure
```

The contract was corrected **first**, then the client's state mapping, then the copy — no UI-only workaround. Enforcement is unchanged and still fails closed; the net direction of every change is tighter, not looser. Two governance mechanisms (C-06's ratchet, arch-check's context budget) fired and were obeyed rather than worked around.

Two things were found while implementing that 5.13 had not: an enforcement-path promotion of unrecognised roles (**not reachable** — enum-constrained — fixed as a forward guard), and `visibleStates` leaking the STRATEGIST list one field over (**reachable**, fixed).

What this does **not** prove: the real failure mode. Every test of the resolution path mocks prisma, and `test:full` refused for want of `TEST_DATABASE_URL`. The logic is pinned; the live outage is not.

**No auto-merge.** Review boundary in §13 of the brief is satisfied above: the exact contract change (§4), old vs new behaviour (§2 vs §7), enforcement unchanged (§10), no leak (§10), the copy distinction (§8), honest test results (§12–13), and what remains NOT VERIFIED (§15).

---

### Changed files (15) · `7d0b0c3` · +863 −71

**Backend** — `src/services/collaboration/roleScope.js` · `src/middleware/requireCollabRole.js` · `src/middleware/requireCollabRole.test.js` · `src/routes/lumi/collaboration.js` · `src/routes/lumi/rolesMe.test.js` **(new)** · `src/services/vocabulary/epistemicInventory.js`

**Frontend** — `client/src/context/RoleContext.jsx` · `client/src/components/auth/RoleUnavailable.jsx` · `client/src/components/auth/RoleUnavailable.test.jsx` **(new)** · `client/src/components/auth/PlanGate.jsx` · `client/src/components/auth/PlanGate.test.jsx` · `client/src/components/auth/roleBoundary.test.jsx` · `client/src/components/auth/roleRead.test.jsx` · `client/src/components/layout/__tests__/roleShellBoundary.test.jsx` · `client/src/features/settings/settingsAudience.test.jsx`

**Migration requirements:** none.
