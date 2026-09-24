import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { dbAvailable } from '../../tests/dbProbe.js';
import { persistAllocation } from './AllocationService.js';
import { readAllocationEfficiency } from './allocationPlanMetric.js';

const DB_OK = await dbAvailable();
const WS = randomUUID();
const migration = readFileSync(new URL('../../../prisma/migrations/20260924090000_allocationplan_blended_efficiency_storage/migration.sql', import.meta.url), 'utf8');

describe.skipIf(!DB_OK)('AllocationPlan additive storage migration', () => {
  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: WS, name: 'AllocationPlan storage barrier test' } });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('adds nullable, default-free columns without changing a legacy row or breaking an old writer', async () => {
    await prisma.$transaction(async (tx) => {
      // Shadow only this transaction's public table with the pre-hotfix shape.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE allocation_plans (id int, "merBefore" DOUBLE PRECISION, "merAfter" DOUBLE PRECISION) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO allocation_plans (id, "merBefore", "merAfter") VALUES (1, 2, 2.5)');
      await tx.$executeRawUnsafe(migration);
      const columns = await tx.$queryRawUnsafe(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'allocation_plans' AND table_schema LIKE 'pg_temp%'
          AND column_name IN ('blendedRevenueEfficiencyBefore', 'blendedRevenueEfficiencyAfter') ORDER BY column_name`);
      expect(columns).toHaveLength(2);
      expect(columns.every((column) => column.is_nullable === 'YES' && column.column_default == null)).toBe(true);
      await tx.$executeRawUnsafe('INSERT INTO allocation_plans (id, "merBefore", "merAfter") VALUES (2, 3, 3.5)');
      const rows = await tx.$queryRawUnsafe('SELECT * FROM allocation_plans ORDER BY id');
      expect(rows).toMatchObject([
        { id: 1, merBefore: 2, merAfter: 2.5, blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
        { id: 2, merBefore: 3, merAfter: 3.5, blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
      ]);
    });
  });

  it('persists a new valid plan only in semantic columns and leaves old reader fields null', async () => {
    const plan = {
      goal: { type: 'GROWTH_CEILING', value: null }, totalBudgetMinor: 100_000,
      currency: 'USD', monetaryStatus: 'MONETARY_VALID', efficiencyStatus: 'VALID',
      spendPeriod: { status: 'MEASURABLE', currency: 'USD' },
      projected: { blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.4, projectedCpaMinor: null },
      allocations: [], reasoningTrail: ['Measured allocation'],
    };
    const { allocationPlanId } = await persistAllocation(prisma, WS, plan);
    const row = await prisma.allocationPlan.findUniqueOrThrow({ where: { id: allocationPlanId } });
    expect(row).toMatchObject({ blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.4,
      merBefore: null, merAfter: null });
    expect(readAllocationEfficiency(row)).toMatchObject({ efficiencyStatus: 'BLENDED_REVENUE_EFFICIENCY',
      blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.4 });
    const oldReader = ({ merBefore, merAfter }) => ({ merBefore, merAfter });
    expect(oldReader(row)).toEqual({ merBefore: null, merAfter: null });
  });
});
