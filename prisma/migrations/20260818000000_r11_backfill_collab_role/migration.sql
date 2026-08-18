-- ============================================================
-- R11-B (I61) — backfill the implicit collaboration role
-- ============================================================
-- Until now `users.collabRole` was nullable and NULL was interpreted, at the
-- gate, as STRATEGIST: the highest privilege in the product. That default was
-- written so seats predating Phase 8 would not be locked out of their own
-- workspace — a reasonable intent — but it meant the gate could not tell
-- "this person is a strategist" from "we could not work out who this is", and
-- it answered both with full access.
--
-- Every real user is NULL today (collabRole has only ever been set by the
-- seed and by invitations), so this is what they are already treated as. The
-- migration writes down what the system already believes, so that afterwards
-- NULL can mean what it should have meant all along: unknown, therefore deny.
--
-- Additive and non-destructive: it sets a value only where none exists. It
-- never overwrites a seat that was deliberately made BUYER or CLIENT, and it
-- does not alter the column's nullability — NULL must stay reachable so that
-- an anomalous row is detectable rather than silently rewritten by a default.
--
-- Rollback: `UPDATE users SET "collabRole" = NULL WHERE "collabRole" =
-- 'STRATEGIST';` would over-reach — it cannot distinguish the rows this
-- migration wrote from strategists set by hand. Reverting R11-B means
-- reverting the gate, not the data; the data here is correct either way.

UPDATE "users"
SET "collabRole" = 'STRATEGIST'
WHERE "collabRole" IS NULL;
