// ============================================================
// R8 — how daily ingestion joins the sync loop
// ============================================================
// The third fetch, and the rules that keep it from costing anything the other
// two depend on:
//
//   • OFF unless a deployment asks for it. Nothing reads the DAILY population
//     yet, and an extra Meta request per sync per account is a real cost.
//   • BEST-EFFORT. A daily failure loses daily rows and nothing else — the
//     operational sync every existing surface reads must be untouchable.
//   • REPORTED SEPARATELY. Three populations, three counts; a caller must be
//     able to tell "off" from "zero days landed".
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: { workspace: { findUnique: vi.fn(async () => ({ id: 'ws-1' })) } } }));

const {
  resolve, isSyncable, landSnapshots, landDailySnapshots, listActiveSyncable, recordSync,
} = vi.hoisted(() => ({
  resolve: vi.fn(), isSyncable: vi.fn(() => true),
  landSnapshots: vi.fn(), landDailySnapshots: vi.fn(),
  listActiveSyncable: vi.fn(), recordSync: vi.fn(),
}));

vi.mock('./connectorRegistry.js', () => ({ resolve, isSyncable }));
vi.mock('./snapshotSink.js', () => ({ landSnapshots }));
vi.mock('./dailySnapshotSink.js', () => ({ landDailySnapshots }));
vi.mock('./credentialStore.js', () => ({ listActiveSyncable, recordSync }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runConnectorSync } from './ConnectorSyncService.js';
import { dailyIngestionDays, isDailyIngestionEnabled, DAILY_INGESTION_MAX_DAYS } from './connectorConfig.js';

const dailyConnector = (over = {}) => ({
  channel: 'META',
  authenticate: vi.fn(async () => ({ ok: true, accountExternalId: 'act_1', currency: 'USD' })),
  fetchRaw: vi.fn(async () => [{ campaign_id: 'c1' }]),
  normalize: vi.fn(() => [{ campaign_id: 'c1' }]),
  fetchDailyRaw: vi.fn(async () => ({ rows: [{ campaign_id: 'c1' }], days: 7, truncated: false })),
  normalizeDaily: vi.fn(() => ({ snapshots: [{ externalId: 'c1' }], rejected: [] })),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  isSyncable.mockReturnValue(true);
  listActiveSyncable.mockResolvedValue([{ workspaceId: 'ws-1', channel: 'META' }]);
  landSnapshots.mockResolvedValue({ entities: 3, snapshots: 2 });
  landDailySnapshots.mockResolvedValue({ created: 7, restated: 0, skippedUnknownEntity: 0 });
  recordSync.mockResolvedValue({});
});

describe('R8 — the switch', () => {
  it('is OFF by default — no daily fetch, no daily rows', async () => {
    // A population with no reader must not spend API budget to exist.
    const connector = dailyConnector();
    resolve.mockReturnValue(connector);

    const res = await runConnectorSync('ws-1');

    expect(connector.fetchDailyRaw).not.toHaveBeenCalled();
    expect(landDailySnapshots).not.toHaveBeenCalled();
    expect(res.results[0].dailyObservations).toBeNull();
    expect(res.synced).toBe(1);
  });

  it('turns on for exactly the string "true", never for a truthy typo', () => {
    expect(isDailyIngestionEnabled({})).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: '' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: 'yes' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: '1' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: 'true' })).toBe(true);
  });

  it('fetches and lands the daily population once enabled', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    const connector = dailyConnector();
    resolve.mockReturnValue(connector);

    const res = await runConnectorSync('ws-1');

    expect(connector.fetchDailyRaw).toHaveBeenCalledTimes(1);
    expect(landDailySnapshots).toHaveBeenCalledWith('ws-1', 'META', [{ externalId: 'c1' }]);
    expect(res.results[0].dailyObservations).toBe(7);
  });

  it('skips a connector that has no daily path at all', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({ fetchDailyRaw: undefined, normalizeDaily: undefined }));

    const res = await runConnectorSync('ws-1');

    expect(landDailySnapshots).not.toHaveBeenCalled();
    // null, not 0: "this connector cannot do daily" is not "it landed no days".
    expect(res.results[0].dailyObservations).toBeNull();
    expect(res.synced).toBe(1);
  });
});

describe('R8 — a daily failure costs only daily rows', () => {
  it('a failing daily fetch leaves the operational sync a success', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({
      fetchDailyRaw: vi.fn(async () => { throw new Error('rate limited'); }),
    }));

    const res = await runConnectorSync('ws-1');

    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.results[0]).toMatchObject({ status: 'success', snapshots: 2, dailyObservations: null });
    expect(recordSync.mock.calls.at(-1)[2]).toMatchObject({ ok: true, records: 2 });
  });

  it('a sink that refuses a bad row does not fail the sync either', async () => {
    // landDailySnapshots throws on a mislabelled population. That is a loud
    // refusal, and it must stay inside the daily block.
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    landDailySnapshots.mockRejectedValue(new Error('refused a ROLLING_WINDOW row'));
    resolve.mockReturnValue(dailyConnector());

    const res = await runConnectorSync('ws-1');

    expect(res.results[0]).toMatchObject({ status: 'success', dailyObservations: null });
  });

  it('lands the operational population BEFORE reaching for daily', async () => {
    // Order is load-bearing: the daily sink decorates existing entities and never
    // mints them, so the operational sync is what puts them there.
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector());
    const order = [];
    landSnapshots.mockImplementation(async () => { order.push('operational'); return { entities: 3, snapshots: 2 }; });
    landDailySnapshots.mockImplementation(async () => { order.push('daily'); return { created: 7, restated: 0, skippedUnknownEntity: 0 }; });

    await runConnectorSync('ws-1');

    expect(order).toEqual(['operational', 'daily']);
  });
});

describe('R8 — the request bound is bounded', () => {
  it('defaults to a week and stays within the ceiling', () => {
    expect(dailyIngestionDays({})).toBe(7);
    expect(dailyIngestionDays({ DAILY_INGESTION_DAYS: '14' })).toBe(14);
  });

  it('cannot be widened into an unbounded historical pull', () => {
    // `time_increment=1` multiplies the response by the day count; an env var
    // must not be able to turn one sync into a years-long re-read.
    expect(dailyIngestionDays({ DAILY_INGESTION_DAYS: '3650' })).toBe(DAILY_INGESTION_MAX_DAYS);
  });

  it('cannot be narrowed to zero days — ingesting nothing while reporting success', () => {
    expect(dailyIngestionDays({ DAILY_INGESTION_DAYS: '0' })).toBe(1);
    expect(dailyIngestionDays({ DAILY_INGESTION_DAYS: '-5' })).toBe(1);
    expect(dailyIngestionDays({ DAILY_INGESTION_DAYS: 'soon' })).toBe(7);
  });
});
