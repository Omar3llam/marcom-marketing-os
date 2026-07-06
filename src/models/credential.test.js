// ============================================================
// models/credential — AES-256-GCM encrypt/decrypt at rest
// ------------------------------------------------------------
// The credential encryption core had NO test. These pin the contract every
// connector's token storage depends on: a round-trip is lossless, tampering is
// rejected (GCM auth), and a missing key throws the exact error the credentials
// route turns into a 503 (routes/credentials.js checks err.message includes
// 'CREDENTIAL_ENCRYPTION_KEY').
//
// IMPORTANT: no vi.resetModules() / vi.stubEnv() here — resetModules segfaults
// the vitest forks worker (drops random tests from the run). Instead we lean on
// two facts about the module: the key is read LAZILY and getEncKey only caches a
// VALID key. So the no-key case runs FIRST (nothing cached), then we set the key
// and the happy-path calls cache it. process.env is mutated + restored; no other
// test file reads CREDENTIAL_ENCRYPTION_KEY (credentialStore.test.js mocks the
// crypto), and vitest never interleaves files.
// ============================================================
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Hermetic: encrypt/decrypt are pure crypto, but the module imports db + logger.
vi.mock('../utils/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { encrypt, decrypt } from './credential.js';

const KEY = 'a'.repeat(64); // 64 hex chars → 32-byte AES-256 key
const ORIGINAL = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIGINAL;
});

// Runs FIRST, before any encrypt/decrypt call caches a key (getEncKey caches
// only a VALID key, so the no-key path leaves the module cache untouched).
describe('missing key', () => {
  beforeAll(() => { delete process.env.CREDENTIAL_ENCRYPTION_KEY; });

  it('encrypt AND decrypt throw the 503-triggering error', () => {
    expect(() => encrypt('x')).toThrow(/CREDENTIAL_ENCRYPTION_KEY is not configured/);
    expect(() => decrypt('a:b:c')).toThrow(/CREDENTIAL_ENCRYPTION_KEY is not configured/);
  });
});

describe('with a valid key', () => {
  beforeAll(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = KEY; });

  it('round-trips losslessly and never stores the plaintext', () => {
    const secret = 'ya29.a-very-secret-oauth-token';
    const enc = encrypt(secret);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:tag:ciphertext
    expect(enc).not.toContain(secret);
    expect(decrypt(enc)).toBe(secret);
  });

  it('rejects a tampered ciphertext (GCM auth tag mismatch)', () => {
    const [iv, , ct] = encrypt('secret').split(':');
    const tampered = `${iv}:${'0'.repeat(32)}:${ct}`; // zeroed auth tag
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects a malformed blob with a clear error', () => {
    expect(() => decrypt('not-a-valid-blob')).toThrow(/Invalid stored credential format/);
  });
});
