// ============================================================
// ConnectorSyncService — a partial fetch is recorded, not swallowed
// ------------------------------------------------------------
// A sync that knowingly read only part of an account still lands real data, so
// it is not a failure — but reporting it as a plain success presents a subset
// as the whole account. That is the "looks complete, isn't" defect this
// codebase keeps correcting (roster-only zeros, page-1 truncation, partial
// token sums), so truncation is folded into connector health as a WARNING and
// surfaces in the admin drill-down beside lastError.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    workspace: { findUnique: vi.fn(async () => ({ id: 'ws-1' })) },
    $queryRaw: vi.fn(async () => [{ id: 'ws-1', health: null }]),
    $executeRaw: vi.fn(async () => 1),
  };
  prisma.$transaction = vi.fn(async (operation) => operation(prisma));
  return { prisma };
});

const { resolve, isSyncable, landSnapshots, listActiveSyncable, recordSync } = vi.hoisted(() => ({
  resolve: vi.fn(), isSyncable: vi.fn(() => true),
  landSnapshots: vi.fn(), listActiveSyncable: vi.fn(), recordSync: vi.fn(),
}));

vi.mock('./connectorRegistry.js', () => ({ resolve, isSyncable }));
vi.mock('./snapshotSink.js', () => ({ landSnapshots }));
vi.mock('./credentialStore.js', async (original) => ({ ...(await original()), listActiveSyncable, recordSync }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runConnectorSync } from './ConnectorSyncService.js';
import { prisma } from '../../lib/prisma.js';
import { nextHealth } from './connectorHealth.js';
import { completenessOf, availabilityOf } from './connectorReadiness.js';

/** A connector whose fetchRaw returns rows carrying (or not) fetchMeta. */
const connectorReturning = (rows, fetchMeta) => {
  if (fetchMeta) Object.defineProperty(rows, 'fetchMeta', { value: fetchMeta, enumerable: false });
  return {
    channel: 'META',
    authenticate: vi.fn(async () => ({ ok: true, accountExternalId: 'act_1', currency: 'USD' })),
    fetchRaw: vi.fn(async () => rows),
    normalize: vi.fn(() => rows),
  };
};

const recorded = () => JSON.parse(prisma.$executeRaw.mock.calls.at(-1)[1]);

beforeEach(() => {
  vi.clearAllMocks();
  isSyncable.mockReturnValue(true);
  listActiveSyncable.mockResolvedValue([{ workspaceId: 'ws-1', channel: 'META' }]);
  landSnapshots.mockResolvedValue({ entities: 3, snapshots: 2 });
  recordSync.mockResolvedValue({});
  prisma.$queryRaw.mockResolvedValue([{ id: 'ws-1', health: null }]);
});

describe('campaign completeness reaches persisted workspace health', () => {
  it.each([
    [{ truncated: true, incomplete: true, truncatedEdges: ['campaignInsights'], failedEdges: [] }, /campaign insights.*pagination limit/i],
    [{ truncated: true, incomplete: true, truncatedEdges: ['campaignRoster'], failedEdges: [] }, /campaign roster.*pagination limit/i],
    [{ truncated: false, incomplete: true, truncatedEdges: [], failedEdges: ['campaignRoster'] }, /campaign roster.*fetch failed/i],
    [{ truncated: true, incomplete: true, truncatedEdges: ['adInsights', 'adSetRoster'], failedEdges: ['campaignRoster'] }, /ad insights.*pagination limit.*campaign roster.*fetch failed/i],
  ])('persists and exposes actual affected edges: %j', async (fetchMeta, warningPattern) => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }], fetchMeta));
    const result = await runConnectorSync('ws-1');
    expect(result).toMatchObject({ synced: 1, failed: 0 });
    expect(recorded().lastWarning).toMatch(warningPattern);
    expect(result.results[0].warning).toBe(recorded().lastWarning);
    expect(completenessOf(recorded())).toBe('INCOMPLETE');
    expect(availabilityOf(recorded())).toBe('OK');
    // Same transaction still scopes the receipt to the requested workspace.
    expect(prisma.$executeRaw.mock.calls.at(-1).slice(2)).toContain('ws-1');
  });

  it('a genuinely complete empty sync clears a previous warning', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'ws-1', health: nextHealth({}, { ok: true, warning: 'previous incomplete read' }) }]);
    resolve.mockReturnValue(connectorReturning([], { truncated: false, incomplete: false, truncatedEdges: [], failedEdges: [] }));
    landSnapshots.mockResolvedValue({ entities: 0, snapshots: 0 });
    const result = await runConnectorSync('ws-1');
    expect(result.synced).toBe(1);
    expect(recorded()).toMatchObject({ lastWarning: null, lastError: null, recordsImported: 0 });
    expect(completenessOf(recorded())).toBe('COMPLETE');
  });

  it('primary failure records failure rather than complete empty', async () => {
    const connector = connectorReturning([]);
    connector.fetchRaw.mockRejectedValue(new Error('primary unavailable'));
    resolve.mockReturnValue(connector);
    const result = await runConnectorSync('ws-1');
    expect(result).toMatchObject({ synced: 0, failed: 1 });
    expect(recordSync).toHaveBeenCalledWith('ws-1', 'META', expect.objectContaining({ ok: false, error: 'primary unavailable' }));
    expect(landSnapshots).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    const failed = nextHealth({}, { ok: false, error: 'primary unavailable' });
    expect(availabilityOf(failed)).toBe('FAILING');
    expect(completenessOf(failed)).toBe('NOT_RECORDED');
  });
});

describe('a complete sync', () => {
  it('records success with no warning', async () => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }], { truncated: false }));

    const res = await runConnectorSync('ws-1');

    expect(res.synced).toBe(1);
    expect(recorded()).toMatchObject({ lastError: null, recordsImported: 2, lastWarning: null });
    expect(res.results[0].warning).toBeUndefined();
  });

  it('a connector with no fetchMeta at all is still a clean success', async () => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }]));

    await runConnectorSync('ws-1');

    expect(recorded()).toMatchObject({ lastError: null, lastWarning: null });
  });
});

describe('a truncated sync', () => {
  beforeEach(() => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }], { truncated: true, adSetsFetched: 10_000 }));
  });

  // Still a success: real data landed. The warning is the difference.
  it('is a SUCCESS, not a failure', async () => {
    const res = await runConnectorSync('ws-1');

    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
    expect(recorded().lastSuccessfulSync).toBeTruthy();
  });

  it('records a warning that names the incompleteness', async () => {
    await runConnectorSync('ws-1');

    expect(recorded().lastWarning).toMatch(/incomplete/i);
    expect(recorded().lastWarning).toMatch(/ad set/i);
  });

  it('surfaces the warning in the sync result too', async () => {
    const res = await runConnectorSync('ws-1');
    expect(res.results[0].warning).toBeTruthy();
  });

  // The rows still land — a partial read is worth keeping, it just must not
  // claim to be the whole account.
  it('still lands the rows it did read', async () => {
    await runConnectorSync('ws-1');
    expect(landSnapshots).toHaveBeenCalledTimes(1);
  });
});
