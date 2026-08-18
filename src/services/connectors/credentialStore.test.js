// ============================================================
// credentialStore.resolveCredential — safeDecrypt swallows corruption
// ------------------------------------------------------------
// safeDecrypt wraps decrypt in try/catch so a single corrupt/undecryptable
// token can't throw the whole connector auth path — it degrades to null. This
// pins that contract via resolveCredential (safeDecrypt is module-private):
// a stored row whose token fails to decrypt yields null tokens, never a throw.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('../../utils/db.js', () => ({ getDb: () => sqlMock }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./connectorHealth.js', () => ({ nextHealth: vi.fn() }));
// decrypt throws → exactly what a corrupt/tampered ciphertext does at runtime.
vi.mock('../../models/credential.js', () => ({
  encrypt: vi.fn((x) => `enc(${x})`),
  decrypt: vi.fn(() => { throw new Error('unsupported state or unable to authenticate data'); }),
}));

import { resolveCredential } from './credentialStore.js';

describe('resolveCredential — a decrypt failure is NOT "not connected" (R11 · E3)', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── NC-G4 · the control ────────────────────────────────────
  it('THROWS a distinct DECRYPT_FAILED rather than degrading to null tokens', async () => {
    // The old behaviour returned `{ accessToken: null, … }`, and
    // resolveCredential also returns null for "no row" — so a wrong or missing
    // CREDENTIAL_ENCRYPTION_KEY presented to the customer as "you have not
    // connected your ad account". They would reconnect, OAuth would succeed,
    // and nothing would change, because the fault was never in the connection.
    sqlMock.mockResolvedValue([
      { access_token_enc: 'corrupt', refresh_token_enc: 'also-corrupt', account_id: 'act_42', expires_at: null },
    ]);

    await expect(resolveCredential('ws-1', 'META')).rejects.toMatchObject({
      name: 'CredentialDecryptError',
      code: 'DECRYPT_FAILED',
    });
  });

  it('never puts ciphertext or key material in the error message', async () => {
    sqlMock.mockResolvedValue([
      { access_token_enc: 'super-secret-ciphertext', refresh_token_enc: null, account_id: 'act_42', expires_at: null },
    ]);

    const err = await resolveCredential('ws-1', 'META').catch((e) => e);
    expect(err.message).not.toContain('super-secret-ciphertext');
    expect(err.message).toMatch(/CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('no matching row → null — genuinely not connected stays distinguishable', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await resolveCredential('ws-1', 'META')).toBeNull();
  });

  it('missing workspaceId or unknown channel → null (no DB hit)', async () => {
    expect(await resolveCredential(null, 'META')).toBeNull();
    expect(await resolveCredential('ws-1', 'NOT_A_CHANNEL')).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
