// ============================================================
// MetaConnector.authenticate — real account currency from Meta
// ============================================================
// The severed ingestion head: before this, authenticate() hardcoded 'USD', so
// every non-USD account stored the right NUMBERS with a wrong label + scale.
// These prove the fix:
//   1. Meta returns 'EGP' → the connector propagates 'EGP' AND corrects the
//      workspace's default-USD currency (one-time, fire-and-forget);
//   2. an INVALID currency falls back to the workspace currency (not USD);
//   3. workspace currency also missing → 'USD';
//   4. the sync NEVER fails when Meta omits the currency (graceful null);
//   5. the write-back is scoped — a workspace already on a real currency is
//      never overwritten, and a failed write never breaks authenticate.
// The pure resolveSyncCurrency precedence is asserted directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { workspace: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('../metaAdsService.js', () => ({
  fetchAccountCurrency: vi.fn(),
  fetchCampaignInsights: vi.fn(),
}));
vi.mock('./credentialStore.js', () => ({ resolveCredential: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { fetchAccountCurrency } from '../metaAdsService.js';
import { resolveCredential } from './credentialStore.js';
import { MetaConnector } from './MetaConnector.js';
import { resolveSyncCurrency } from '../../lib/currencyDetector.js';

const connector = new MetaConnector();
const CRED = { accessToken: 'tok', accountId: 'act_123' };

beforeEach(() => {
  vi.clearAllMocks();
  resolveCredential.mockResolvedValue(CRED);
  prisma.workspace.update.mockResolvedValue({});
});

describe('MetaConnector.authenticate — currency resolution', () => {
  it('Meta returns EGP → propagates EGP and corrects the default-USD workspace', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('EGP');
    expect(fetchAccountCurrency).toHaveBeenCalledWith('tok', 'act_123');
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' }, data: { currency: 'EGP' },
    });
  });

  it('invalid currency from Meta → falls back to the workspace currency (not USD), no write-back', async () => {
    fetchAccountCurrency.mockResolvedValue('XYZ'); // not a supported ISO code
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'SAR' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('SAR');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('no Meta currency AND no workspace currency → USD fallback', async () => {
    fetchAccountCurrency.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue(null);

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('USD');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('Meta omits the currency field → sync still succeeds, falls back gracefully', async () => {
    fetchAccountCurrency.mockResolvedValue(null); // fetch returns null, never throws
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'AED' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('AED');
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('does NOT overwrite a workspace already on a real (non-USD) currency', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });

    const auth = await connector.authenticate('ws-1');

    expect(auth.currency).toBe('EGP');
    expect(prisma.workspace.update).not.toHaveBeenCalled(); // already correct
  });

  it('a failed currency write-back never breaks authenticate (fire-and-forget)', async () => {
    fetchAccountCurrency.mockResolvedValue('EGP');
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    prisma.workspace.update.mockRejectedValue(new Error('db down'));

    const auth = await connector.authenticate('ws-1');

    expect(auth.ok).toBe(true);
    expect(auth.currency).toBe('EGP');
  });

  it('missing credential still short-circuits before any currency work', async () => {
    resolveCredential.mockResolvedValue(null);
    const auth = await connector.authenticate('ws-1');
    expect(auth.ok).toBe(false);
    expect(fetchAccountCurrency).not.toHaveBeenCalled();
  });
});

describe('resolveSyncCurrency — pure precedence', () => {
  it('a valid reported code wins', () => {
    expect(resolveSyncCurrency('EGP', 'USD')).toEqual({ currency: 'EGP', source: 'reported' });
  });
  it('an invalid reported code defers to a valid workspace currency', () => {
    expect(resolveSyncCurrency('???', 'SAR')).toEqual({ currency: 'SAR', source: 'workspace' });
  });
  it('both invalid/missing → USD fallback', () => {
    expect(resolveSyncCurrency(null, null)).toEqual({ currency: 'USD', source: 'fallback' });
  });
  it('normalises case + whitespace', () => {
    expect(resolveSyncCurrency(' egp ', null)).toEqual({ currency: 'EGP', source: 'reported' });
  });
});
