import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { selectCanonicalVerdictSnapshots } from './canonicalVerdictEvidence.js';
import { evaluateConnectorVerdicts, getConnectorVerdicts } from './connectorVerdictService.js';

const DB_OK = await dbAvailable();
describe.skipIf(!DB_OK)('SC-17A real PostgreSQL → canonical reader → distribution', () => {
  const ws = randomUUID(), accountId = randomUUID(), campaignId = randomUUID();
  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: ws, name: 'SC-17A isolated test' } });
    await prisma.account.create({ data: { id: accountId, workspaceId: ws, channel: 'META', name: 'Test', externalId: accountId } });
    await prisma.campaign.create({ data: { id: campaignId, workspaceId: ws, accountId, channel: 'META', name: 'Test', externalId: campaignId, objective: 'OUTCOME_SALES' } });
  });
  beforeEach(async () => { await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }); });
  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } });
    await prisma.account.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
  });
  it.each(['PLATFORM_REPORTED', 'LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED'])
  ('stored %s is selected exactly and only real platform origin authorizes publication', async (origin) => {
    const end = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await prisma.metricSnapshot.create({ data: {
      workspaceId: ws, entityId: campaignId, entityLevel: 'CAMPAIGN', source: 'META',
      date: new Date(), granularity: 'DAILY', measurementWindow: 'CUMULATIVE_30D',
      windowStart: new Date(end.getTime() - 29 * 86400000), windowEnd: end,
      currency: 'EGP', currencyProvenance: origin,
      spendMinor: 10000, revenueMinor: 30000, impressions: 10000, clicks: 200, conversions: 10, frequency: 2,
    } });
    const selected = await selectCanonicalVerdictSnapshots(ws, [campaignId]);
    expect(selected).toHaveLength(1);
    expect(selected[0].currencyProvenance).toBe(origin);
    const evaluation = await evaluateConnectorVerdicts(ws);
    expect(evaluation.status).toBe('OK');
    expect(evaluation.campaigns).toHaveLength(1);
    expect(evaluation.campaigns[0].currencyProvenance).toBe(origin === 'PLATFORM_REPORTED' ? origin : 'LEGACY_UNKNOWN');
    const result = await getConnectorVerdicts(ws, { evaluation, memory: { records: [], status: 'NO_VALIDATED_MEMORY' } });
    expect(result.verdicts).toHaveLength(1);
    expect(result.budgetDistribution).toMatchObject(origin === 'PLATFORM_REPORTED'
      ? { status: 'AVAILABLE', currency: 'EGP', totalSpendMinor: 10000 }
      : { status: 'UNAVAILABLE', reason: 'UNKNOWN_CURRENCY', currency: null, totalSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
  });
});
