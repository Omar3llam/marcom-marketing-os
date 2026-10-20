# Backend 03B-4 | Prisma import-time connection boundary

**2026-10-20. Source-only candidate. NOT_DEPLOYED / NOT_ADMISSION / NOT_RELEASE_QUALIFIED.**

Baseline master: `96037b5bd339f1fac8d8a89d116a782598f6940b`, latest merged PR #603. Stage 1 Backend Stabilization, H-1 #598 NO-GO, Backend Gates B/C BLOCKED.

## Exact delta

- `src/lib/prisma.js` retains the existing singleton construction and non-production cache, but no longer calls `prisma.$connect()` at module import. Real Prisma clients establish a connection lazily on first query. Explicit diagnostic scripts that call their own `$connect()` remain unchanged.
- Add `src/tests/prismaImportNoConnect.test.js`: a fresh-module mocked-client import must construct once, make **zero** `$connect` calls and **zero** queries; a second module load reuses the singleton, and request-time access remains possible. This test fails on the old module's automatic `$connect`.
- Two existing AI gateway comments are updated to stop claiming eager DB connection behavior; no provider routing, billing, plan lookup or test logic changes.

## Limitations / verification

This removes one *actual* early connection side effect. Prisma construction, existing static imports, lazy Redis connections, the four legacy DDL ensures after `app.listen`, Worker startup/scheduling and real admission remain **unmodified and unqualified**. Do not treat this change as whole-process fail-closed admission. An import-free boot cannot be claimed from this slice.

Review requirements: exact changed files, isolated import-time negative tests, existing DB integration and full `REQUIRE_DB=1` tests on ephemeral PostgreSQL, frontend parity, lint, architecture/security and backend-without-client checks. Distinguish PostgreSQL 15 CI from the separately required PG17 qualification. No Neon, Render, production SQL, schema/migration, account-selection or frontend modification is in scope. GitHub PR checks are not proof of current-master or production verification.

A source merge may be approved separately after code/CI review but **does not authorize deployment**. Historical Render Web/Worker binaries remain unchanged until separately qualified cutover and rollback approval.
