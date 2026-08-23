// ============================================================
// Backend Closure SC-4 — the OAuthToken model has no storage left
// ============================================================
// OAuthToken was a destination that never received anything. Production
// measured it directly before this slice ran:
//
//     oauth_tokens   0 rows · 0 inbound FKs · 0 dependent views
//
// TWO CREDENTIAL SYSTEMS, ONLY ONE OF THEM REAL
//   `oauth_tokens`        Prisma-managed, EMPTY, no reader, no writer  — removed
//   `marcom_credentials`  raw SQL, workspace-keyed, AES-256-GCM        — LIVE
//
//   The script comment called oauth_tokens "the new Prisma-managed table" and
//   marcom_credentials "the legacy table". The system went the other way:
//   Phase 12B/12c re-pointed the whole connector layer ONTO marcom_credentials,
//   and the schema note three lines under the old model has said so since the
//   Integration model was dropped for exactly this reason on 2026-06-15.
//
// WHY THE SCRIPT WENT TOO
//   `migrate:credentials` read marcom_credentials — the LIVE store — and copied
//   the ciphertext into oauth_tokens. It was never wired to a build, a boot, a
//   worker, CI or a runbook, but it was runnable: the identity join it depends
//   on (marcom_credentials.user_id == users."clerkId", both the Firebase uid)
//   still matches today. A manual command that duplicates live credentials into
//   a table with no rotation, no revocation on disconnect and no purge path is
//   not a dormant convenience. Manual reachability is not harmlessness, so the
//   script and its npm entry were retired with the model.
//
// WHY T5 PROVES THE SURVIVOR FROM SOURCE, NOT FROM THE DATABASE
//   marcom_credentials is created at BOOT by ensureCredentialSchema(), not by
//   a migration — a migration-built database legitimately does not have it.
//   Asserting its presence against this database would fail for a reason that
//   has nothing to do with credentials, so T5 pins the live path where the live
//   path actually lives: the store, its reader, and its encryption.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');

const DB_OK  = await dbAvailable();
const ROOT   = process.cwd();
const SCHEMA = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');
const MIGRATIONS = resolve(ROOT, 'prisma/migrations');
const SC4 = '20260823110000_sc4_oauthtoken_closure';

const LEGACY_SCRIPT = 'scripts/migrate-credentials-to-oauth.js';
const LEGACY_NPM    = 'migrate:credentials';

// ── comment-stripped source ─────────────────────────────────────────────────
// This file, the schema note and the migration all explain the retirement by
// naming what they forbid. A scanner that could not tell prose from a call
// would score the explanation as the defect.
const strip = (s) => s
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function jsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { jsFiles(full, out); continue; }
    if (!entry.endsWith('.js') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

// Keyed off ROOT rather than a hardcoded directory name: CI checks the repo out
// into a differently-named folder, and a name-based strip would silently leave
// absolute paths as keys, quietly emptying every lookup below.
const POSIX_ROOT = ROOT.split(/[\\/]/).join('/').replace(/\/+$/, '');
const rel = (f) => f.split(/[\\/]/).join('/').replace(POSIX_ROOT + '/', '');

// src/ is production. scripts/ is included deliberately: after SC-4 the delegate
// does not exist, so a reset script still calling it would crash on use — the
// exact way the three reset scripts referenced the last three dropped models.
const code = new Map(
  [...jsFiles(resolve(ROOT, 'src')), ...jsFiles(resolve(ROOT, 'scripts'))]
    .map((f) => [rel(f), strip(readFileSync(f, 'utf8'))]),
);
const filesMatching = (re) => [...code.entries()]
  .filter(([, c]) => re.test(c)).map(([f]) => f).sort();

const modelBlock = (name) => {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  return m ? m[1] : null;
};

const migrationSql = () => readFileSync(join(MIGRATIONS, SC4, 'migration.sql'), 'utf8');

// ── T1 · T2 · T3 — the schema ───────────────────────────────────────────────
describe('SC-4 · the schema declares no OAuthToken', () => {
  it('T1 · the model is gone', () => {
    expect(SCHEMA).not.toMatch(/^model OAuthToken \{/m);
    expect(SCHEMA).not.toMatch(/@@map\("oauth_tokens"\)/);
  });

  it('T2 · User no longer declares the back-relation', () => {
    // Asserted separately from T1 on purpose: this is a Prisma virtual list
    // relation with NO backing column, so nothing in the database can prove it
    // gone — only the schema can, and a model-only removal must not satisfy it.
    const user = modelBlock('User');
    expect(user, 'model User not found').not.toBeNull();
    expect(user).not.toMatch(/\boauthTokens\b/i);
    expect(user).not.toMatch(/\bOAuthToken\[\]/);
    // …and the live model itself is untouched: its own relations still stand.
    expect(user).toMatch(/workspace\s+Workspace\s+@relation/);
    expect(user).toMatch(/contentGenerations\s+ContentGeneration\[\]/);
  });

  it('T3 · OAuthToken owned no exclusive enum, and the migration invents none', () => {
    // Recorded rather than assumed. Unlike SC-1 (CampaignStage) and SC-2
    // (ActionStatus), this model owned NO enum: `provider` and
    // `encryptionVersion` were plain String/TEXT columns. There is therefore
    // no DROP TYPE to make, and a migration that grew one would be removing
    // something that belonged to another model.
    expect(migrationSql()).not.toMatch(/DROP TYPE/i);
    expect(migrationSql()).not.toMatch(/CREATE TYPE/i);
  });

  it('the generated client exposes no oAuthToken delegate', () => {
    // Schema and client can disagree. A stale `prisma generate` is how a
    // removed model keeps working locally for another week.
    // NOTE the casing: Prisma camel-cases OAuthToken to `oAuthToken`, with a
    // LOWERCASE leading o. A case-sensitive check for `oauthToken` here would
    // pass against a client that still carries the delegate.
    expect(prisma.oAuthToken).toBeUndefined();
    expect(prisma.oauthToken).toBeUndefined();
    // …and the live User delegate it hung off is still there.
    expect(typeof prisma.user?.findMany).toBe('function');
  });
});

// ── T4 — the real database ──────────────────────────────────────────────────
describe.skipIf(!DB_OK)('SC-4 · and the database agrees', () => {
  it('T4 · oauth_tokens does not exist', async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'oauth_tokens'`;
    expect(rows).toEqual([]);
  });

  it('T4b · users kept every one of its columns', async () => {
    // The table oauth_tokens hung off. Its FK lived on the CHILD, so this
    // parent needed no DDL at all — asserted whole, because a DROP COLUMN that
    // "tidied up" the other side of the relation would be invisible in a diff
    // that only checked the dropped table was gone.
    const cols = await prisma.$queryRaw`
      SELECT column_name::text AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
       ORDER BY ordinal_position`;
    // Physical order, not schema-declaration order: `collabRole` was added by a
    // later migration, so it sits LAST in the table however the model reads.
    expect(cols.map((r) => r.c)).toEqual([
      'id', 'workspaceId', 'email', 'clerkId', 'role',
      'context', 'createdAt', 'collabRole',
    ]);
  });

  it('the drop took nothing with it — the live neighbours are all still there', async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS t FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users','workspaces','decisions','audit_logs',
                            'execution_requests','decision_memory_entries')`;
    expect(rows.map((r) => r.t).sort()).toEqual([
      'audit_logs', 'decision_memory_entries', 'decisions',
      'execution_requests', 'users', 'workspaces',
    ]);
  });

  it('and the partial similarity index survived the migration untouched', async () => {
    // The specific casualty of accepting a Prisma-generated migration here.
    // The generated one proposed a PLAIN `CREATE INDEX decisions_similarity_idx`,
    // which would have silently replaced C1's learning-eligibility index with a
    // full-table one. Regenerating from unmodified master proposed it too,
    // which is how it was identified as pre-existing drift rather than SC-4.
    const rows = await prisma.$queryRaw`
      SELECT indexdef::text AS d FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'decisions_similarity_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toMatch(/WHERE/i);
    expect(rows[0].d).toMatch(/resolution IS NOT NULL/i);
  });
});

// ── T5 — the live credential system, which must NOT have gone with it ───────
describe('SC-4 · the live credential system survives', () => {
  it('T5a · credentialStore still resolves credentials from marcom_credentials', async () => {
    const store = await import('./credentialStore.js');
    expect(typeof store.resolveCredential).toBe('function');
    expect(typeof store.upsertWorkspaceCredential).toBe('function');
    expect(typeof store.deleteWorkspaceCredentials).toBe('function');
    // The read seam still reads the live table, not a replacement.
    const src = readFileSync(resolve(ROOT, 'src/services/connectors/credentialStore.js'), 'utf8');
    expect(src).toMatch(/FROM marcom_credentials/);
  });

  it('T5b · credential encryption is still in place', async () => {
    const cred = await import('../../models/credential.js');
    expect(typeof cred.encrypt).toBe('function');
    expect(typeof cred.decrypt).toBe('function');
    expect(typeof cred.ensureCredentialSchema).toBe('function');
    const src = readFileSync(resolve(ROOT, 'src/models/credential.js'), 'utf8');
    expect(src).toMatch(/aes-256-gcm/);
    expect(src).toMatch(/CREDENTIAL_ENCRYPTION_KEY/);
    // The boot-time creator of the live table is still the boot-time creator.
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS marcom_credentials/);
  });

  it('T5c · all three providers still resolve through it', () => {
    // Removing a dead persistence substrate must not have touched
    // authentication behaviour for any live channel.
    for (const f of [
      'src/services/connectors/MetaConnector.js',
      'src/services/connectors/GoogleAdsConnector.js',
      'src/services/connectors/GA4Connector.js',
    ]) {
      expect(code.get(f), `${f} missing from the census`).toBeDefined();
      expect(code.get(f), `${f} no longer resolves a credential`)
        .toMatch(/resolveCredential\(/);
    }
  });
});

// ── T6 — the legacy migration path is retired, not merely unused ────────────
describe('SC-4 · the legacy credential migration path is gone', () => {
  it('T6a · the script file does not exist', () => {
    expect(existsSync(resolve(ROOT, LEGACY_SCRIPT)), `${LEGACY_SCRIPT} is back`)
      .toBe(false);
  });

  it('T6b · package.json declares no command that runs it', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.scripts || {})).not.toContain(LEGACY_NPM);
    // And no differently-named command may point at the same script — renaming
    // the entry would retire the name while leaving the path executable.
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      expect(String(cmd), `npm script "${name}" still runs the retired script`)
        .not.toMatch(/migrate-credentials-to-oauth/);
    }
  });

  it('T6c · nothing in the repository invokes it any more', () => {
    expect(filesMatching(/migrate-credentials-to-oauth|migrate:credentials/)).toEqual([]);
  });
});

// ── T7 — the runtime ────────────────────────────────────────────────────────
describe('SC-4 · no code reads or writes OAuthToken', () => {
  it('T7a · nothing touches the prisma.oAuthToken delegate', () => {
    // Case-INSENSITIVE on purpose, and this is not fussiness: the first census
    // pass of this slice used a case-sensitive pattern, missed `prisma.oAuthToken`
    // entirely, and reported the migration script as comment-only. That is the
    // false "zero readers" conclusion SC-2 was bitten by, reached a second way.
    expect(
      filesMatching(/(?:prisma|tx|db)\.oauthToken\b/i),
      'An OAuthToken delegate access came back. The model no longer exists, so '
      + 'this cannot be a read of real rows — remove it rather than adding a fallback.',
    ).toEqual([]);
  });

  it('T7b · and nothing traverses it as a relation', () => {
    // The shape that hid an Action reader through three slices: a `_count` or
    // include/select on the User side, which never names the delegate at all.
    expect(filesMatching(/\boauthTokens\s*:/i)).toEqual([]);
    expect(filesMatching(/\.\s*oauthTokens\b/i)).toEqual([]);
  });

  it('T7c · no file names the model or its table', () => {
    expect(filesMatching(/\bOAuthToken\b/)).toEqual([]);
    expect(filesMatching(/\boauth_tokens\b/)).toEqual([]);
  });
});

// ── T8 — the migration is exactly one statement ─────────────────────────────
describe('SC-4 · the migration says one thing', () => {
  it('T8a · it exists and drops exactly one table', () => {
    const statements = migrationSql().split(';')
      .map((x) => x.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS "oauth_tokens"$/);
  });

  it('T8b · and it touches nothing else', () => {
    // The generated migration carried FOURTEEN statements. Regenerating from
    // unmodified master produced THIRTEEN of them — including the plain
    // CREATE INDEX for decisions_similarity_idx and even the explicit
    // `ALTER TABLE "oauth_tokens" DROP CONSTRAINT`, which master proposes and
    // then re-adds. That control is what identified all of them as pre-existing
    // history-vs-schema drift: exactly ONE statement was attributable to SC-4.
    // Comment-stripped, for the same reason every other scanner in this
    // codebase is: the migration explains itself by NAMING the statement it
    // deliberately does not make. Prose does not execute — DDL does.
    const sql = migrationSql().replace(/--[^\n]*/g, '');
    for (const forbidden of [
      /"users"/, /"workspaces"/, /"decisions"/, /"audit_logs"/,
      /"execution_requests"/, /"provider_performance_metrics"/,
      /marcom_credentials/,
      /ALTER TABLE/i, /DROP COLUMN/i, /CREATE INDEX/i, /RENAME/i,
      /DROP DEFAULT/i, /ADD CONSTRAINT/i, /DROP CONSTRAINT/i, /CASCADE/i,
    ]) {
      expect(sql, `SC-4 migration matches ${forbidden}`).not.toMatch(forbidden);
    }
  });
});
