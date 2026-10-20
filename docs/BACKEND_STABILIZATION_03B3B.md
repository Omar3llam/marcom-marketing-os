# Backend 03B-3B — credential reconciliation risk candidate

2026-10-20. [Issue599](https://github.com/Omar3llam/marcom-marketing-os/issues/599),
implemented under Omar's subsequent explicit three-file, code-only instruction.
**SYNTHETIC_ONLY / NOT_WIRED / NO_DATA_WRITES / NO_ACCOUNT_SELECTION_AUTHORITY.**
Author evidence for independent review; Backend Gates B/C remain **BLOCKED**.

## Authority and unchanged behavior

Fresh master was `2362a4e5a47b1d3cb4c30a8078404257607307b0`, with no open PR.
Read Issue599, [accepted581 discovery](https://github.com/Omar3llam/marcom-marketing-os/issues/581#issuecomment-6234272436),
CLAUDE.md, Product Truth Rulings/governance, the legacy provisioning contract and
synthetic startup-admission contract. Work is isolated on
`codex/issue599-credential-risk-candidate`. The unrelated primary checkout and its
four pre-existing untracked artifacts are preserved.

This candidate does not remove or replace existing backfill, change account
selection, import an application module or implement a production policy. R-8,
the approved five canonical-completeness principles, vault/decrypt-failure
semantics, authorization and lifecycle transactions remain unchanged. H-1 and
Migration76 recovery remain separate blocked work; no provider metadata or DB
operation was needed for this slice.

### Source trace, without SQL execution

| Existing path | Current association / effect, preserved |
|---|---|
| `src/server.js` listener callback | Calls four asynchronous schema ensures after opening listener, including ensureCredentialSchema; it is not an admission gate. |
| `src/models/credential.js` ensure/backfill | Joins `marcom_credentials.user_id = users.clerkId`, then users.workspaceId. Stamps NULL workspace_id and updated_at=NOW(); a separate UPDATE ranks active rows by updated_at/created_at and deactivates losers. An early toMatch=0 return bypasses duplicate work. 581 proved synthetic winner reversal/partial commit, not a production account switch. |
| Prisma User / legacy schema contract | User.id is the primary UUID, clerkId is nullable/unique and carries the auth UID; workspaceId refers to workspaces. Raw marcom_credentials has no workspace FK/CASCADE. Do not confuse User.id and clerkId. |
| Legacy credential routes / campaigns/feed | Read by user/project/platform through getCredential; project identity is not an alternative workspace join for this candidate. |
| credentialStore resolveCredential | Reads active workspace/platform rows, ordered by updated_at with LIMIT1. Meta/Google/GA4 authentication and metaExecutionService use this seam. No account ordering/picker behavior is changed. |
| credentialStore listConnections / listActiveSyncable | Display and sync consumers of stored links/activity; ConnectorSyncService and its worker/manual callers remain untouched. |
| OAuth/lifecycle writers | completeMetaOAuthCredential, attachWorkspaceToCredential, upsert/save paths and account picker retain their current writes and workspace→user→project authority locking. This candidate cannot replace those checks. |
| Workspace/user deletion | deleteWorkspaceCredentials / deleteLegacyOwnerCredentials resolve raw credential ownership and purge before Prisma destruction. Admin workspaces and user routes retain these calls. |
| startupAdmission | Inventories no_automatic_reconciliation as a synthetic requirement. No requirement or issuer is wired to this candidate. |

`docs/LEGACY_SCHEMA_PROVISIONING_CONTRACT.md` explicitly excludes credential DML.
Removing automatic startup work still needs an approved reconciliation policy,
runtime/admission rollout and operator/recovery proof. No product ruling is needed
to report synthetic structural risk; any actual link, deactivation or winning
account decision needs separate authority. Stop rather than invent that policy.

## Pure input contract

Only `evaluateCredentialReconciliation(compactJson)` is exported. It accepts a
primitive string exactly equal to `JSON.stringify(JSON.parse(compactJson))`;
objects, proxies, getters, callbacks, duplicate JSON keys, surrounding whitespace
and noncanonical numeric representations are refused. Parsing passive text avoids
executing caller getters/coercions or accidentally accepting a last-key winner.
This is a deliberately narrow synthetic DTO, not a production/operator entrypoint.

```js
JSON.stringify({
  scope: 'SYNTHETIC_ONLY',
  completeness: { credentials: 'COMPLETE', users: 'COMPLETE', workspaces: 'COMPLETE' },
  credentials: [{ id: 'fixture-credential', userId: 'fixture-auth', workspaceId: null,
    platform: 'meta_ads', isActive: true, createdAt: 1000, updatedAt: 2000 }],
  users: [{ id: 'fixture-user', clerkId: 'fixture-auth', workspaceId: 'fixture-workspace' }],
  workspaces: [{ id: 'fixture-workspace' }]
})
```

All listed keys are required and unknown keys are rejected, including tokens,
account IDs, errors, source roots or authority flags. IDs/platforms are opaque,
case-sensitive, untrimmed 1–256-character ASCII fixture identifiers with the
syntax in source. Explicit null identity values mean missing evidence; a null
credential workspace is the legitimate unlinked condition. No fuzzy/UUID case
normalization or inferred project/workspace equivalence is introduced.

Timestamps are nonnegative safe-integer fixture epoch milliseconds or null;
isActive is boolean or null. Missing/invalid fields reject the DTO; null timestamps
or activity make evidence UNKNOWN. No clock, freshness claim, date conversion,
timestamp ordering, timestamp mutation or active-account ranking occurs.

Completeness is COMPLETE, INCOMPLETE or UNKNOWN for each corpus. It describes
the supplied synthetic fixture only, not an independently attested database
census. A complete empty fixture is distinguishable from omitted/incomplete
evidence. Runtime data acquisition, freshness, source sealing and scoped database
coverage are undefined and cannot be inferred from these declarations.

Technical resource limits: at most 1,048,576 UTF-16 code units in the input and
10,000 records per corpus. Overflow rejects the entire DTO; no truncation or
successful partial scan. These are fixture parser limits, not approved runtime
capacity or population policy. Input indexes and grouping are local per call;
outputs share no mutable module state.

## Output and refusal semantics

Every output contains:

```text
contract = CREDENTIAL_RECONCILIATION_CANDIDATE_V1
scope = SYNTHETIC_ONLY
runtimeAdmission = NOT_WIRED
dataWrites = NO_DATA_WRITES
authority = NO_ACCOUNT_SELECTION_AUTHORITY
```

Only `status`, `inspected` counts and sorted `findings:[{reason,count}]` accompany
those markers. No input IDs, platform values, workspace/account identifiers,
tokens, raw errors, SQL, per-row instructions or chosen winner are returned.

| Status | Meaning within this fixture only |
|---|---|
| UNKNOWN | Malformed/over-limit input, incomplete declared corpora, missing identity/time/activity evidence, ambiguous identity keys or unresolved active-unmapped cohort. Malformed input has inspected=null, never invented zero counts. |
| REVIEW_REQUIRED | Supplied metadata exposes an unmatched link, conflict, duplicate active group or uniquely joinable but unlinked row. This grants no mutation authority. |
| NO_LINK_CHANGE_INDICATED | Complete declared fixture has no finding except ALREADY_LINKED, or is genuinely empty. Not proof of account correctness, authorization, decryptability, source completeness or operational safety. |

Known risks remain listed when aggregate status is UNKNOWN. Counts are supplied
record counts, not customer/product metrics. A duplicate-group count is not a
count of deactivations or repair operations. Reasons are intentionally overlapping;
do not sum them into a distinct credential total.

### Findings / acceptance matrix

| Evidence / scenario | Fixed reason(s) / behavior |
|---|---|
| Bad syntax/types/keys/text boundary/resource limit | MALFORMED_INPUT; UNKNOWN; inspected=null; fixed redacted result |
| Any corpus not COMPLETE | EVIDENCE_INCOMPLETE; UNKNOWN while retaining observable risks |
| Null credential id/user/platform | CREDENTIAL_IDENTITY_MISSING, CREDENTIAL_USER_IDENTITY_MISSING, PLATFORM_IDENTITY_MISSING; UNKNOWN |
| Null activity / either timestamp | ACTIVE_STATE_UNKNOWN / TIMESTAMP_EVIDENCE_MISSING; UNKNOWN; never infer false or refresh time |
| Null user primary/auth identity or workspace record identity | USER_RECORD_IDENTITY_MISSING, USER_JOIN_IDENTITY_MISSING, WORKSPACE_RECORD_IDENTITY_MISSING; UNKNOWN |
| Repeated credential/user/workspace IDs or auth joins | DUPLICATE_CREDENTIAL_IDENTITY, DUPLICATE_USER_IDENTITY, DUPLICATE_WORKSPACE_IDENTITY, AMBIGUOUS_USER_JOIN; counts of repeated-key groups; UNKNOWN |
| No auth-UID match / multiple or unusable user matches | USER_UNMATCHED / USER_MAPPING_AMBIGUOUS; never use primary User.id as auth identity or select first match |
| User has no workspace / absent or ambiguous workspace target | USER_WORKSPACE_IDENTITY_MISSING / WORKSPACE_UNMATCHED / WORKSPACE_MAPPING_AMBIGUOUS |
| Stored credential workspace absent/ambiguous in corpus | LINKED_WORKSPACE_UNMATCHED / LINKED_WORKSPACE_AMBIGUOUS; do not bless dangling links |
| Unique user→existing workspace, current link agrees | ALREADY_LINKED; only for a uniquely identified credential; not an active-account endorsement |
| Same unique join, current link is NULL | NEEDS_LINK_POLICY; review only, never safe-to-stamp/actionable mapping |
| Stored workspace differs from unique join | WORKSPACE_CONFLICT; no overwrite instruction |
| Active unlinked row with unresolved target | ACTIVE_COHORT_UNRESOLVED; UNKNOWN; no invented zero duplicate count for the actual population |
| Multiple known active records currently sharing workspace/platform | DUPLICATE_ACTIVE_LINKED_GROUP, even when auth joins are unmatched |
| Multiple known active records sharing current or uniquely joined candidate workspace/platform | DUPLICATE_ACTIVE_CANDIDATE_GROUP. Includes mapped/unmapped and distinct-user collisions. Conflicting current and joined edges are both retained as potential collision evidence, not applied. |
| Multiple active NULL-workspace records sharing auth UID/platform | DUPLICATE_ACTIVE_UNMAPPED_IDENTITY_GROUP, including unmatched historical rows. This alone does not prove a workspace assignment. |
| Known inactive rows / distinct exact platform or workspace keys | Do not form an active duplicate group. Null activity remains UNKNOWN. |

Duplicate identity records can themselves create overlapping group observations;
the global UNKNOWN explicitly refuses treating them as distinct real DB records.
Ambiguous user joins are not expanded into guessed workspace edges. Possible
collisions that cannot be resolved from the fixture stay unknown. Timestamps and
array order never break ties. Aggregate findings are lexically sorted, so input
permutation changes no output. The evaluator cannot issue READY/admission tokens.

## Verification and immutable evidence

Evidence is outside the application tree at
`C:/Users/user/.codex/visualizations/2026/10/20/lumi-issue599-credential-risk/`.
Node24.20.0/npm11.19.0, Vitest4.1.7, Windows. Copied the existing offline dependency
tree into this isolated worktree (not a fresh install claim); verified42 normalized
dependency-source files including package/lockfile, Prisma schema and packages.
The copied generated client is local to this worktree. No .env exists. The runner
constructs a new environment rather than inheriting credentials/DB/Redis URLs,
uses an empty private npm profile, disables telemetry and retains the unchanged
Vitest config/setup/network guard. An external inherited guard additionally blocks
remote sockets, the default PG listener and DB executables/Prisma migration verbs.
Loopback HTTP fixture traffic is permitted, not a production/network certification.

RED scaffold is retained separately: the two selected positive/duplicate tests
failed (0 passed,2 failed,60 filtered/skipped), exit1. This demonstrates missing
candidate behavior, not a new production reproduction of backfill. It did not run
the old writer. Initial implementation focused run:62 passed,0 failed,0 skipped.
An additional negative test then exposed an unused user row with a missing
workspace being overlooked:1 failed,63 filtered/skipped, exit1. The minimal
correction checks that missing evidence across all supplied user records, even
without a referencing credential. This additional RED is retained.
The expanded focused suite subsequently passed64/64 (zero failures/skips).
No assertion, timeout, network guard or existing test was weakened.

### Actual final commands and results

Commands use the pinned Node/npm under the external clean-environment runner;
Vitest JSON reporter/output-file arguments only capture evidence. Existing file
discovery, pool width, assertions,5s budgets and guards are unchanged.

| Command / run | Actual outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run src/tests/credentialReconciliationCandidate.test.js` | Final64 passed,0 failed,0 skipped; repeated after the final test assertions. |
| `npm run check` | PASS/exit0;873 JS syntax/alias checks. |
| `npm run boot-check` | PASS/exit0;871 backend parses and server static graph link. Not application readiness or real boot. |
| `npm run arch-check:backend` | PASS/exit0;0 failures,5 warnings in existing routes/tests. Frontend rules remain a separate scope. |
| `npm run security-check:backend` | PASS/exit0;0 failures,0 warnings. |
| `npm run lint` | PASS/exit0;0 errors,32 warnings in unchanged files; none in either new JS file. |
| `npm run build:backend` | PASS/exit0; Prisma5.22.0 generation, check and boot-check;117.959s. No migration or DB configured. |
| `npm run test:fast` initial | **FAIL/exit1**;6,845 passed,1 failed,639 skipped;48.377s.461 reported files, one failed file. |
| `npm run test:fast -- src/workers/legacyActionRetirement.test.js` | PASS/exit0;37 passed,0 failed,0 skipped; unchanged file,0.908s test duration. |
| `npm run test:fast` confirmation | PASS/exit0;6,846 passed,0 failed,639 skipped;49.858s. Same complete discovery/pool/timeouts; no filter. |
| `git diff --check` / allowlist and source audit | PASS; only the three additions, no existing tracked implementation/config/schema/test edits. |
| Full DB tests / full legacy-client contracts / frontend suites / real API+Worker boot | NOT_TESTED; outside this synthetic-only scope. |
| Fresh dependency installation | NOT_TESTED; copied offline dependencies with42-file source parity, not npm-ci evidence. |
| Hosted CI | NOT_TESTED locally; actual PR status is reported separately. A zero-step hosted job is NOT_TESTED regardless of its badge. No new waiver requested. |

The initial fast failure is `legacyActionRetirement.test.js:175`, the existing
async test `enqueueAction no longer exists` importing queues/index.js. Its JSON
records5,011.9542ms and STACK_TRACE_ERROR at the unchanged5s boundary. It did not
report a differing account/classifier assertion. The focused unchanged file and
one unchanged full confirmation passed. **Timing/contention is a hypothesis, not
a proven root cause or waived failure.** No test/queue/worker/timeout change was
made; raw first-run JSON/logs are retained alongside the successful runs. Runtime
source does not import this candidate. Further flake diagnosis is a separate scope.

All639 skipped cases are listed by file in the external JSON census (50 files),
including22 credential lifecycle and11 production-migration safety cases.
Do not count these as executed/green. The first census helper incorrectly looked
for JSON `pending` rather than `skipped`; its empty output is retained separately,
and the corrected per-file sum is639. Aggregate reporter totals were always639.
The final external network journals have zero FORBIDDEN events; permitted fixture
loopback traffic and refused local Redis connections remain visible in raw logs.
No live provider, production customer credential, DB semantics, runtime/worker,
production recovery or hosted claim follows from the synthetic/fast results.

## Review / rollback / remaining decisions

Review exact user.clerkId join, current/candidate duplicate unions, unresolved
unmapped groups, refusal of malformed/ambiguous/incomplete inputs, no timestamp
winner, fixed redaction, live-object rejection, permutation invariance and import/
I/O isolation. Only the three additive allowlisted files belong to this slice.
There is no runtime consumer, persistent state or external operation to undo;
rollback is reverting these additions after separately approved merge, not DML,
DDL, migration history repair or restoring an old migration-bearing build.

Before replacing startup backfill: separately approve source/target qualification,
complete sealed acquisition, actual project/workspace authority, null/duplicate/
conflict remediation policy, auditability and transactional lifecycle/concurrency
requirements. Account selection/deactivation cannot be justified by fixture
timestamps or source order. H-1, Migration76 history/native/role verification,
vault/auth/tenant/worker/rolling compatibility, live Render drift and trusted
runtime admission remain separate gates. No new CI exception is requested.

**Stop at one Draft PR for independent ChatGPT review. No merge, deployment,
startup backfill removal or activation; separate Omar merge approval is required.
Backend Gates B/C remain BLOCKED.**
