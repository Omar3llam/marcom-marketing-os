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

const { resolve, isSyncable, landSnapshots, listActiveSyncable, recordSync } = vi.hoisted(() => ({
  resolve: vi.fn(), isSyncable: vi.fn(() => true),
  landSnapshots: vi.fn(), listActiveSyncable: vi.fn(), recordSync: vi.fn(),
}));

vi.mock('./connectorRegistry.js', () => ({ resolve, isSyncable }));
vi.mock('./snapshotSink.js', () => ({ landSnapshots }));
vi.mock('./credentialStore.js', () => ({ listActiveSyncable, recordSync }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runConnectorSync } from './ConnectorSyncService.js';

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

const recorded = () => recordSync.mock.calls.at(-1)[2];

beforeEach(() => {
  vi.clearAllMocks();
  isSyncable.mockReturnValue(true);
  listActiveSyncable.mockResolvedValue([{ workspaceId: 'ws-1', channel: 'META' }]);
  landSnapshots.mockResolvedValue({ entities: 3, snapshots: 2 });
  recordSync.mockResolvedValue({});
});

describe('a complete sync', () => {
  it('records success with no warning', async () => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }], { truncated: false }));

    const res = await runConnectorSync('ws-1');

    expect(res.synced).toBe(1);
    expect(recorded()).toMatchObject({ ok: true, records: 2, warning: null });
    expect(res.results[0].warning).toBeUndefined();
  });

  it('a connector with no fetchMeta at all is still a clean success', async () => {
    resolve.mockReturnValue(connectorReturning([{ campaign_id: 'c1' }]));

    await runConnectorSync('ws-1');

    expect(recorded()).toMatchObject({ ok: true, warning: null });
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
    expect(recorded().ok).toBe(true);
  });

  it('records a warning that names the incompleteness', async () => {
    await runConnectorSync('ws-1');

    expect(recorded().warning).toMatch(/incomplete/i);
    expect(recorded().warning).toMatch(/ad set/i);
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
