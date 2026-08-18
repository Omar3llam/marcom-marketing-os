-- ============================================================
-- R11-C (I65) — workspace-qualify the execution idempotency key
-- ============================================================
-- `execution_requests.idempotencyKey` was GLOBALLY unique and fully
-- client-supplied, and the route that read it looked the key up with no
-- workspace predicate. Two consequences, both reachable from the public API:
--
--   * presenting another workspace's key returned that workspace's
--     executionId, status, and stored Meta API response;
--   * pre-claiming a key another workspace was about to use made their genuine
--     request answer `idempotentReplay: true` — telling them an ad-platform
--     action had succeeded that was never queued.
--
-- The guarantee idempotency actually needs is "this workspace must not execute
-- this twice", not a global namespace shared by every tenant. Uniqueness now
-- spans (workspaceId, idempotencyKey).
--
-- WIDENING, not narrowing: every row that satisfied the old global constraint
-- satisfies the new compound one, so this cannot fail on existing data and no
-- row is rewritten or removed. It also does the opposite of a destructive
-- migration — pairs that previously collided across tenants become legal.
--
-- Generated with `prisma migrate diff --from-schema-datamodel ...
-- --to-schema-datamodel ... --script` against the pre-R11 schema; the SQL below
-- is that output verbatim, with the commentary above added.
--
-- Rollback: recreate the single-column unique index and drop the compound one.
-- That reintroduces the vulnerability, and can now FAIL if two workspaces have
-- since used the same key — which is exactly the situation the old constraint
-- was silently preventing by leaking instead.

-- DropIndex
DROP INDEX "execution_requests_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "execution_requests_workspaceId_idempotencyKey_key" ON "execution_requests"("workspaceId", "idempotencyKey");
