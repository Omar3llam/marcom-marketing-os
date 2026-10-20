# Backend 03B-3C | Source-only removal of automatic credential backfill

2026-10-20. Bounded implementation candidate following [Issue #601](https://github.com/Omar3llam/marcom-marketing-os/issues/601) and its independently accepted STOP / Production NO-GO design review.

**STATUS: DRAFT / NOT_RELEASE_QUALIFIED / NOT_DEPLOYED / NOT_WIRED_FOR_ADMISSION.** This source-only branch is NOT an approved production cutover, a recovery proof, or product policy for connecting, deactivating or selecting ad accounts. Backend Gates B/C remain BLOCKED.

## Exact behavioral delta

- `src/models/credential.js` no longer calls `backfillWorkspaceIds` from `ensureCredentialSchema`. The obsolete private boot helper and its census, `workspace_id` stamping, timestamp updates and automatic duplicate deactivation are removed from this proposed source version.
- **All eight native credential schema DDL statements remain byte-for-byte unchanged.** Ordinary API startup in `src/server.js` STILL invokes four asynchronous schema ensures after opening the HTTP listener, warns and continues on schema errors. **Do not treat this as a safe API readiness gate.**
- API/Worker startup imports, queue creation, eager Prisma connect and worker schedules are unchanged. This code-only removal is **not** the full API/Worker admission fix.
- Existing explicit Meta/Google OAuth and `saveCredential` / `attachOnTransaction` / account picker / connector sync / workspace-user deletion and encrypted-token lifecycle are **not edited**. These are business operations with different authorization semantics, NOT replacements for startup backfill.
- A legacy NULL-workspace credential may remain unlinked; that is not proof of `NOT_CONNECTED`. Duplicate active records remain possible and `resolveCredential` currently uses timestamp ordering with `LIMIT 1`. No customer account is auto-linked, deactivated or newly selected by this PR, and it does not prove prior linkage is correct. Source-only classification in merged PR #600 remains `SYNTHETIC_ONLY / NOT_WIRED / NO_ACCOUNT_SELECTION_AUTHORITY`.

## Contract and source authority

Frozen historical `scripts/legacy-schema/manifest.v1.json` remains unchanged. Active proposed `manifest.v2.json` is a separate sealed version that changes only `version`, `sourceCommit`, provenance narrative and the **credential source digest**. It retains the complete v1 `catalog`, all 21 metadata categories and ALL 76 shipped migration names/checksums unchanged.

- Historical v1 normalized digest: `246785a402ea206fdb82c3c0d71899c9819084189fe9583a72dec330b10b65e5`.
- Active v2 normalized digest: `dc4687bf45b8965de94acd93975218504c3294b9b3694ba0bd1c8a9a1faf3da4`.
- V2 source origin (model-only commit): `6ee98edda008fd8370e6d871b23e03922006577d`.
- Credential native DDL census: **8/8 identical**, legacy fixture: **26** total expected unchanged.
- Loader still fixes its manifest path and digest internally, rejects operator `root`/`manifestPath` overrides, verifies source inventory + migrations, and must fail closed on mismatched source/target/history/ACL. No regen-by-production or silently permissive fallback.
- `scripts/legacy-schema/tests/fixture.js` only changes extraction end anchor from deleted backfill helper to the existing `PUBLIC API` marker; no generated SQL or data changed. The synthetic fixture version/source pin follow v2. Existing forgery tests must target the active v2 path.

## Verification scope

**Structural verification performed during branch authoring:** direct content comparison showed all eight literal DDL SQL templates unchanged; frozen v1 SHA-256 independently recalculated and matched the approved pin; v2 inherited the identical native catalog and all migration checksums. Source strings were fetched through the connected GitHub integration. No authenticated production DB or Render mutation was used.

**NOT_TESTED:** This branch has not run Node24/Vitest, a full backend test suite, PG17 fixture/negative tests, hosted GitHub CI, API or Worker runtime tests, real OAuth/account deletion and mixed-version compatibility. Structural checks are **not** a substitute. A reviewable Draft PR must not be merged until targeted tests execute, failures are examined, source pins independently verified and separate code-only merge approval is documented; #593's temporary zero-step hosted CI exception is not a PASS.

Expected pre-merge testing in a credential-free isolated Node24/PG17 environment: `src/tests/startupAdmission.contract.test.js`, `src/tests/legacySchemaValidator.test.js`, the isolated `scripts/legacy-schema/tests/validator.test.js` using its explicit loopback PG17 fixture, credential lifecycle/OAuth/account-deletion negative suites, `npm run check`, `npm run boot-check`, `npm run arch-check:backend`, `npm run security-check:backend`, `npm run lint`, `npm run build:backend`, and the full fast suite. No production DB, app/worker process or live provider credentials are allowed for these tests.

## Production gate and rollback

Old Render Web and Worker binaries (last independently observed `9b48f32826e03f7e11b7a15054df05d67001f834`) still execute historical startup behavior. **DO NOT DEPLOY THIS BRANCH.** Even a future source merge will not change deployed binaries, prove no-write startup, or close B/C.

Before any release: separately qualify H-1 backup and independently isolated restore; preserve true Migration #76 receipts and verify native catalog/roles; approve explicit operator-owned credential linkage/duplicate-account policy and tenant-complete census; establish side-effect-free import ordering and real fail-closed API+Worker admission; verify all four old/new mixed-version combinations, live build config, security and rollback using a no-boot-write fallback binary. A historical binary that still runs backfill is not a safe fallback.

Code-only rollback *before production adoption* is reverting this branch/change and its v2 source attestation. No migration-history rewriting, inverse SQL, live credential repair or production restore is authorized by this PR.
