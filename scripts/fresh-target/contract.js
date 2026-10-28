import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  if (!(plain(approval, ['version', 'operation', 'expiresAt', 'artifactSha256', 'target'])
    || plain(approval, ['version', 'operation', 'expiresAt', 'artifactSha256', 'target', 'exclusiveTarget']))
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

// These seals are independently supplied by the approving lab controller. They
// are an explicit trust boundary, not an in-band attestation of network policy.
// Hosted endpoints remain contained, including endpoints carrying these seals.
export function validateExclusiveTarget(approval, url, caPem, contract) {
  const refuse = () => { throw Error('MIGRATION_TARGET_BINDING_UNQUALIFIED'); };
  const t = approval.target, binding = approval.exclusiveTarget;
  if (t.host !== '127.0.0.1'
    || !plain(binding, ['version', 'scope', 'qualificationFile', 'qualificationSha256'])
    || binding.version !== 1 || binding.scope !== 'OWNED_SYNTHETIC_PG17_ONLY'
    || typeof binding.qualificationFile !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(binding.qualificationFile)
    || !/^[a-f0-9]{64}$/.test(binding.qualificationSha256)) refuse();
  const stat = lstatSync(binding.qualificationFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) refuse();
  const bytes = readFileSync(binding.qualificationFile);
  if (digest(bytes) !== binding.qualificationSha256) refuse();
  const q = JSON.parse(bytes);
  if (!plain(q, ['version', 'scope', 'target', 'artifactSha256', 'caSha256', 'credentialSha256', 'cliSha256', 'engineSha256', 'engineRevision', 'networkPolicySha256', 'evidenceSha256'])
    || q.version !== 1 || q.scope !== binding.scope || JSON.stringify(q.target) !== JSON.stringify(t)
    || q.artifactSha256 !== contract.artifactSha256
    || q.engineRevision !== '605197351a3c8bdd595af2d2a9bc3025bca48ea2'
    || !['caSha256', 'credentialSha256', 'cliSha256', 'engineSha256', 'networkPolicySha256', 'evidenceSha256']
      .every(k => typeof q[k] === 'string' && /^[a-f0-9]{64}$/.test(q[k]) && q[k] !== '0'.repeat(64))) refuse();
  const password = decodeURIComponent(new URL(url).password);
  if (!/^[a-f0-9]{64}$/.test(password) || digest(password) !== q.credentialSha256) refuse();
  if (typeof caPem !== 'string' || digest(caPem) !== q.caSha256) throw Error('VERIFIED_TLS_REQUIRED');
  const ca = new X509Certificate(caPem);
  if (!ca.ca || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) <= Date.now()) throw Error('VERIFIED_TLS_REQUIRED');
  const cli = fileURLToPath(new URL('node_modules/prisma/build/index.js', contract.root));
  const engines = new URL('node_modules/@prisma/engines/', contract.root);
  const candidates = readdirSync(engines).filter(n => /^schema-engine-[a-z0-9.-]+$/.test(n)
    && (process.platform === 'win32' ? n === 'schema-engine-windows.exe' : !n.endsWith('.exe')));
  if (candidates.length !== 1) throw Error('DEPENDENCY_UNQUALIFIED');
  const engine = fileURLToPath(new URL(candidates[0], engines));
  for (const [file, expected] of [[cli, q.cliSha256], [engine, q.engineSha256]]) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || digest(readFileSync(file)) !== expected) throw Error('DEPENDENCY_UNQUALIFIED');
  }
  if (JSON.parse(readFileSync(new URL('node_modules/@prisma/engines/package.json', contract.root))).version !== '5.22.0') throw Error('DEPENDENCY_UNQUALIFIED');
  return { cli, engine, caPem, engineRevision: q.engineRevision };
}
