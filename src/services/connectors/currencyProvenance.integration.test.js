import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { prisma } from '../../lib/prisma.js';
import { dbAvailable } from '../../tests/dbProbe.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { landSnapshots } from './snapshotSink.js';
import { landDailySnapshots } from './dailySnapshotSink.js';
import { metaDailyNormalize } from './normalize/metaDailyNormalize.js';
import { landActuals } from './actualsSink.js';
import { processRevenueCsv } from '../revenue/RevenueCsvService.js';
import { isAuthoritativeCurrency, resolveSyncCurrencyWithProvenance } from '../../lib/currencyProvenance.js';

const DB_OK = await dbAvailable();
const WS = '00000000-0000-4000-8000-0000c6000011';
const date = new Date('2026-09-22T09:00:00Z');
const migration = readFileSync(new URL('../../../prisma/migrations/20260922000000_currency_provenance/migration.sql', import.meta.url), 'utf8');
const raw = { campaign_id: 'provenance-c1', campaign_name: 'Provenance campaign', spend: '12.50', impressions: '100', clicks: '5' };
const rows = () => prisma.metricSnapshot.findMany({ where: { workspaceId: WS } });

describe.skipIf(!DB_OK)('currency provenance persistence and legacy upgrade', () => {
  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: WS, name: 'Currency provenance test' } });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('runs the shipped migration on legacy rows without rewriting any old field', async () => {
    // Session-local table shadows public only inside this transaction. The real
    // migration runs against the old shape, with no production-table alteration.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE metric_snapshots (id int, currency text NOT NULL, "spendMinor" int, "revenueMinor" int, "cpaMinor" int, "dailyBudgetMinor" int, "actionMetrics" jsonb) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO metric_snapshots VALUES
        (1, 'EGP', 123, 456, 41, 900, '{"purchaseValue":456}'),
        (2, 'USD', 999, 222, NULL, NULL, NULL),
        (3, '???', 5, 6, NULL, NULL, NULL)`);
      const before = await tx.$queryRawUnsafe('SELECT id, currency, "spendMinor", "revenueMinor", "cpaMinor", "dailyBudgetMinor", "actionMetrics" FROM metric_snapshots ORDER BY id');
      await tx.$executeRawUnsafe(migration);
      const after = await tx.$queryRawUnsafe('SELECT * FROM metric_snapshots ORDER BY id');
      expect(after.map(({ currencyProvenance: _origin, ...original }) => original)).toEqual(before);
      expect(after.every((r) => r.currencyProvenance === 'LEGACY_UNKNOWN')).toBe(true);
      expect(after.every((r) => !isAuthoritativeCurrency(r))).toBe(true);
      await tx.$executeRawUnsafe("INSERT INTO metric_snapshots (id, currency) VALUES (4, 'SAR')");
      const [oldWriter] = await tx.$queryRawUnsafe('SELECT * FROM metric_snapshots WHERE id = 4');
      expect(oldWriter.currencyProvenance).toBe('LEGACY_UNKNOWN');
    });
  });

  it.each(['EGP', 'USD', 'SAR'])('persists reported %s through normalizer, sink and raw SQL upsert', async (currency) => {
    const denomination = resolveSyncCurrencyWithProvenance(currency, 'AED');
    await landSnapshots(WS, 'META', metaNormalize({
      accountExternalId: 'provenance-account', ...denomination, date, rows: [raw],
    }));
    const stored = await rows();
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row).toMatchObject({ currency, currencyProvenance: 'PLATFORM_REPORTED', spendMinor: 1250 });
      expect(isAuthoritativeCurrency(row)).toBe(true);
    }
  });

  it('a new failed currency lookup downgrades the restated observation instead of retaining old authority', async () => {
    for (const [reported, workspace, currencyProvenance] of [
      [null, 'EGP', 'WORKSPACE_INFERRED'], [null, null, 'FALLBACK_DEFAULT'],
    ]) {
      await landSnapshots(WS, 'META', metaNormalize({
        accountExternalId: 'provenance-account', ...resolveSyncCurrencyWithProvenance(reported, workspace), date, rows: [raw],
      }));
      for (const row of await rows()) {
        expect(row.currencyProvenance).toBe(currencyProvenance);
        expect(row.spendMinor).toBe(1250);
        expect(isAuthoritativeCurrency(row)).toBe(false);
      }
    }
  });

  it('daily creation and restatement write the provenance from the new observation', async () => {
    for (const currencyProvenance of ['PLATFORM_REPORTED', 'WORKSPACE_INFERRED']) {
      const { snapshots } = metaDailyNormalize({
        accountExternalId: 'provenance-account', currency: 'EGP', currencyProvenance, date,
        rows: [{ ...raw, date_start: '2026-09-21', date_stop: '2026-09-21' }],
      });
      await landDailySnapshots(WS, 'META', snapshots);
      const daily = (await rows()).filter((r) => r.measurementWindow === 'DAILY');
      expect(daily).toHaveLength(1);
      expect(daily[0]).toMatchObject({ currency: 'EGP', currencyProvenance, spendMinor: 1250 });
    }
  });

  it('actuals and manual uploads preserve their distinct origins without borrowing authority', async () => {
    await landActuals(WS, [{
      channel: 'META', campaignName: raw.campaign_name, source: 'GA4', date,
      currency: 'USD', currencyProvenance: 'FALLBACK_DEFAULT', revenueMinor: 3000,
    }]);
    const ga4 = (await rows()).find((r) => r.source === 'GA4');
    expect(ga4).toMatchObject({ currency: 'USD', currencyProvenance: 'FALLBACK_DEFAULT', revenueMinor: 3000 });
    await processRevenueCsv(WS, [{ campaignIdentifier: raw.campaign_name, revenueAmount: 12, currency: 'SAR', currencyProvenance: 'PLATFORM_REPORTED' }]);
    let manual = (await rows()).find((r) => r.source === 'MANUAL');
    expect(manual).toMatchObject({ currency: 'SAR', currencyProvenance: 'USER_SUPPLIED', revenueMinor: 1200 });
    expect(isAuthoritativeCurrency(manual)).toBe(false);
    await processRevenueCsv(WS, [{ campaignIdentifier: raw.campaign_name, revenueAmount: 12 }]);
    manual = (await rows()).find((r) => r.source === 'MANUAL');
    expect(manual.currencyProvenance).toBe('SNAPSHOT_INFERRED');
    expect(isAuthoritativeCurrency(manual)).toBe(false);
  });
});
