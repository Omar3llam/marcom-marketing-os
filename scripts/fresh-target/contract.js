import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { types } from 'node:util';

export const ROLES = Object.freeze({ owner: 'lumi_backend_owner', migrator: 'lumi_backend_migrator',
  runtime: 'lumi_backend_runtime', auditor: 'lumi_backend_auditor', canonicalOwner: 'lumi_canonical_owner',
  canonicalApp: 'lumi_canonical_app', retention: 'lumi_canonical_retention' });
const PROFILE_SHA256 = 'db95bf13da5150242e21509271ae4a8cc96f62e0322bcc1cbafba2db4d03b8d5';
const LEGACY_SHA256 = 'dc4687bf45b8965de94acd93975218504c3294b9b3694ba0bd1c8a9a1faf3da4';
export const digest = text => createHash('sha256').update(text).digest('hex');
export function plain(value, keys) {
  return value && typeof value === 'object' && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).sort().join('|') === [...keys].sort().join('|')
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value'));
}
export function loadFreshContract() {
  // Fixed repository roots and manifests. No operator root/manifest overrides.
  const root = new URL('../../', import.meta.url);
  const legacyText = readFileSync(new URL('../legacy-schema/manifest.v2.json', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  if (digest(legacyText) !== LEGACY_SHA256) throw Error('SOURCE_UNQUALIFIED');
  const source = JSON.parse(legacyText).source;
  for (const [path, expected] of Object.entries(source.sources)) {
    if (digest(readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n')) !== expected) throw Error('SOURCE_UNQUALIFIED');
  }
  const names = readdirSync(new URL('prisma/migrations/', root), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  if (names.length !== 76 || JSON.stringify(names) !== JSON.stringify(source.migrations.map(m => m.name))) throw Error('SOURCE_UNQUALIFIED');
  const migrations = source.migrations.map(m => {
    const bytes = readFileSync(new URL(`prisma/migrations/${m.name}/migration.sql`, root));
    // Receipts must describe EXACT shipped Git bytes. CRLF checkout is refused.
    if (digest(bytes) !== m.checksum) throw Error('MIGRATION_BYTES_UNQUALIFIED');
    return { ...m, bytes };
  });
  const legacy = [];
  for (const [file, from, to] of [
    ['scripts/migrate.js', 'async function migrate()', 'migrate().catch'],
    ['src/models/chatSession.js', 'export async function ensureChatSessionSchema()', '// ── Helpers'],
    ['src/models/userContext.js', 'export async function ensureUserContextSchema()', '// ── Save'],
    ['src/models/project.js', 'export async function ensureProjectSchema()', '// ── CRUD'],
    ['src/models/credential.js', 'export async function ensureCredentialSchema()', '// ── PUBLIC API'],
  ]) {
    const text = readFileSync(new URL(file, root), 'utf8');
    const start = text.indexOf(from), end = text.indexOf(to, start);
    if (start < 0 || end < 0) throw Error('SOURCE_UNQUALIFIED');
    for (const match of text.slice(start, end).matchAll(/await sql`([\s\S]*?)`/g)) {
      if (match[1].includes('${') || !/^\s*(CREATE|ALTER|DROP TRIGGER|DO\b)/.test(match[1])) throw Error('SOURCE_UNQUALIFIED');
      legacy.push({ file, query: match[1] });
    }
  }
  if (legacy.length !== 26) throw Error('SOURCE_UNQUALIFIED');
  const profileText = readFileSync(new URL('./profile.v1.json', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  if (digest(profileText) !== PROFILE_SHA256) throw Error('PROFILE_UNQUALIFIED');
  const profile = JSON.parse(profileText);
  if (profile.version !== 'lumi-fresh-native-v1' || !profile.catalog || Object.keys(profile.catalog).length < 10) throw Error('PROFILE_UNQUALIFIED');
  const implementation = Object.fromEntries(['contract.js', 'catalog.js', 'provision.js', 'cli.js'].map(file =>
    [file, digest(readFileSync(new URL('./' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n'))]));
  const artifactSha256 = digest(JSON.stringify({ profile: PROFILE_SHA256, source, implementation, ddl: legacy.map(d => digest(d.query.replaceAll('\r\n', '\n'))) }));
  return { migrations, legacy, profile, artifactSha256, root };
}

export function validateApproval(approval, expectedHash, url, artifactSha256, now = Date.now()) {
  if (!plain(approval, ['version', 'operation', 'expiresAt', 'artifactSha256', 'target'])
    || approval.version !== 1 || approval.operation !== 'PROVISION_EMPTY_PG17'
    || typeof expectedHash !== 'string' || typeof url !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)
    || approval.artifactSha256 !== artifactSha256 || !Number.isSafeInteger(approval.expiresAt)
    || approval.expiresAt <= now || approval.expiresAt > now + 86400000) throw Error('APPROVAL_UNQUALIFIED');
  const t = approval.target;
  if (!plain(t, ['host', 'port', 'database', 'login', 'serverAddress', 'serverPort', 'systemIdentifier', 'databaseOid', 'platformOwner'])
    || typeof t.host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(t.host) || t.login !== ROLES.migrator
    || !Number.isInteger(t.port) || t.port < 1024 || t.port > 65535
    || !Number.isInteger(t.serverPort) || t.serverPort < 1024 || t.serverPort > 65535
    || typeof t.database !== 'string' || !/^lumi_fresh_[a-z0-9_]{1,40}$/.test(t.database)
    || typeof t.serverAddress !== 'string' || !/^[a-fA-F0-9:.]+$/.test(t.serverAddress)
    || typeof t.systemIdentifier !== 'string' || !/^[1-9][0-9]{18,19}$/.test(t.systemIdentifier)
    || BigInt(t.systemIdentifier) > 18446744073709551615n || !Number.isInteger(t.databaseOid) || t.databaseOid <= 0
    || typeof t.platformOwner !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(t.platformOwner) || Object.values(ROLES).includes(t.platformOwner)) throw Error('TARGET_UNQUALIFIED');
  if (digest(JSON.stringify(approval)) !== expectedHash) throw Error('APPROVAL_UNQUALIFIED');
  const u = new URL(url);
  if (u.protocol !== 'postgresql:' || u.hostname !== t.host || Number(u.port || 5432) !== t.port
    || decodeURIComponent(u.username) !== t.login || u.pathname !== '/' + t.database || u.search || u.hash) throw Error('TARGET_UNQUALIFIED');
  return t;
}
