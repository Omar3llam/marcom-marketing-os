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

describe('resolveCredential — corrupt token degrades to null (safeDecrypt)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a row whose tokens fail to decrypt → null tokens, other fields intact, NO throw', async () => {
    sqlMock.mockResolvedValue([
      { access_token_enc: 'corrupt', refresh_token_enc: 'also-corrupt', account_id: 'act_42', expires_at: null },
    ]);

    const cred = await resolveCredential('ws-1', 'META');

    expect(cred).toEqual({
      accessToken: null,   // decrypt threw → safeDecrypt caught → null
      refreshToken: null,
      accountId: 'act_42', // non-token fields pass through untouched
      expiresAt: null,
    });
  });

  it('no matching row → null', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await resolveCredential('ws-1', 'META')).toBeNull();
  });

  it('missing workspaceId or unknown channel → null (no DB hit)', async () => {
    expect(await resolveCredential(null, 'META')).toBeNull();
    expect(await resolveCredential('ws-1', 'NOT_A_CHANNEL')).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
