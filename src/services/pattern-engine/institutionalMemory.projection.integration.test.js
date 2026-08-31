// ============================================================
// B5-01V — validated memory must survive the REAL Prisma projection
// ============================================================
// institutionalMemory.test.js is a good unit suite and it could not have caught
// this. It mocks `prisma.accountPattern.findMany` and hands back a hand-built
// object that already carries `status: 'ESTABLISHED'` — so the `select` is never
// applied, and every assertion is made about a row shape the production query
// could not actually produce.
//
// The defect that shipped behind that gap: MEMORY_SELECT projected 17 columns
// and `status` was not one of them, while isValidatedMemory's first test is
// `p.status === PATTERN_STATUS.ESTABLISHED`. The WHERE clause already filtered
// on status, which is precisely why nobody looked twice — the query was correct
// and then withheld from the caller the one column it needed to believe the
// answer. Every row came back with `status: undefined`, every row was discarded,
// and getInstitutionalMemory reported NO_VALIDATED_MEMORY for every workspace,
// permanently: "we looked, this account has learned nothing", published in the
// verdict payload as a fact about the account.
//
// So this file tests a boundary a mock cannot reach:
//
//     Prisma schema → actual select → returned object shape → validation
//
// It is additive. The unit suite still owns the arithmetic and the purity
// controls; this one owns the projection, and the two do not overlap.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js).
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import {
  getInstitutionalMemory, selectRelevantMemory, memoryConfidenceFactor,
  applyMemoryToConfidence, MEMORY_STATUS,
} from './institutionalMemory.js';
import { getConnectorVerdicts } from '../verdict-engine/connectorVerdictService.js';
import { CANONICAL_VERDICT_WINDOW_DAYS } from '../verdict-engine/metricWindow.js';

const DB_OK = await dbAvailable();
const DAY = 86_400_000;

describe.skipIf(!DB_OK)('B5-01V · institutional memory through the real projection', () => {
  const ws = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();

  /** A pattern row that satisfies EVERY production validation requirement:
   *  ESTABLISHED, a measured accuracy above the promotion floor, and support
   *  thick enough that the memory layer's own MIN_EFFECTIVE_SUPPORT is met. */
  const persistPattern = (over = {}) => prisma.accountPattern.create({
    data: {
      workspaceId: ws,
      patternKey: `FATIGUE|CAMPAIGN|null|KILL|${randomUUID().slice(0, 8)}`,
      kind: 'FATIGUE_CEILING',
      statement: 'On campaigns, KILL once frequency passes ~3.5',
      basis: 'weighted-median frequency at KILL across 4 decisions',
      metric: 'frequency', scopeLevel: 'CAMPAIGN', emitVerdict: 'KILL',
      threshold: 3.5, unit: 'RATIO',
      status: 'ESTABLISHED', accuracy: 0.95, confidence: 0.9,
      support: 6, effectiveSupport: 5,
      firstObservedAt: new Date(Date.now() - 120 * DAY),
      lastObservedAt: new Date(Date.now() - 5 * DAY),
      ...over,
    },
  });

  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: ws, name: `b5-01v-${ws.slice(0, 8)}` } });
    await prisma.account.create({
      data: {
        id: accountId, workspaceId: ws, channel: 'META',
        name: 'B5V acct', externalId: `act-${accountId.slice(0, 8)}`,
      },
    });
    await prisma.campaign.create({
      data: {
        id: campaignId, workspaceId: ws, accountId, channel: 'META',
        name: 'B5V campaign', externalId: `c-${campaignId.slice(0, 8)}`,
        objective: 'OUTCOME_SALES',
        // Long-running, so the campaign clears the engine's learning gate.
        platformCreatedTime: new Date(Date.now() - 240 * DAY),
      },
    });
    // Canonical evidence, one day old — inside the freshness gate by
    // construction, and spanning exactly the canonical window.
    const windowEnd = new Date(`${new Date(Date.now() - DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
    await prisma.metricSnapshot.create({
      data: {
        workspaceId: ws, entityId: campaignId, entityLevel: 'CAMPAIGN',
        source: 'META', date: new Date(windowEnd.getTime() + 9 * 3_600_000),
        measurementWindow: 'CUMULATIVE_30D',
        windowStart: new Date(windowEnd.getTime() - (CANONICAL_VERDICT_WINDOW_DAYS - 1) * DAY),
        windowEnd,
        spendMinor: 500_000, revenueMinor: 250_000, impressions: 200_000, clicks: 4_000,
        conversions: 20, roas: 0.5, ctr: 0.02, frequency: 4.2, reach: 95_000,
        currency: 'USD',
      },
    });
  });

  beforeEach(async () => {
    await prisma.accountPattern.deleteMany({ where: { workspaceId: ws } });
  });

  afterAll(async () => {
    await prisma.accountPattern.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.account.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
    await prisma.workspace.deleteMany({ where: { id: ws } }).catch(() => {});
  });

  // ── T2 — the load-bearing regression ──────────────────────────────────────
  describe('T2 · a real ESTABLISHED row survives the production select', () => {
    it('is returned as validated memory, not swallowed by the projection', async () => {
      await persistPattern();

      const out = await getInstitutionalMemory(ws);

      // The exact assertion the old projection could not satisfy. Remove
      // `status: true` from MEMORY_SELECT and this line is where it dies.
      expect(out.status).toBe(MEMORY_STATUS.OK);
      expect(out.records).toHaveLength(1);
      expect(out.records[0]).toMatchObject({
        verdict: 'KILL', scopeLevel: 'CAMPAIGN', accuracy: 0.95, effectiveSupport: 5,
      });
    });

    it('the row it came from really did carry ESTABLISHED in the database', async () => {
      await persistPattern();
      // Asserted against the stored row, so "validated" means the database said
      // so — not that the test handed the predicate a convenient object.
      const stored = await prisma.accountPattern.findMany({
        where: { workspaceId: ws }, select: { status: true },
      });
      expect(stored.map((r) => r.status)).toEqual(['ESTABLISHED']);
      expect((await getInstitutionalMemory(ws)).records).toHaveLength(1);
    });

    it('NO_VALIDATED_MEMORY is still reachable — an account with no patterns', async () => {
      // The honest empty must survive the repair, or the fix would merely have
      // inverted the lie.
      const out = await getInstitutionalMemory(ws);
      expect(out.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
      expect(out.records).toEqual([]);
    });
  });

  // ── T3/T4 — through the REAL decision path ────────────────────────────────
  describe('T3/T4 · the same decision, with and without this account history', () => {
    /** The A/B: the identical campaign evaluated by the real production path,
     *  first with no history, then with a track record about EXACTLY this call.
     *  The verdict is READ from the first run rather than assumed, so the
     *  pattern is relevant by construction instead of by a fixture that guessed
     *  right. */
    const evaluateBeforeAndAfter = async () => {
      const before = await getConnectorVerdicts(ws);
      expect(before.status).toBe('OK');
      expect(before.verdicts).toHaveLength(1);
      const base = before.verdicts[0];
      expect(base.institutionalMemory.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
      expect(base.institutionalMemory.applied).toBe(false);

      await persistPattern({ emitVerdict: base.verdict, scopeLevel: 'CAMPAIGN' });

      const after = await getConnectorVerdicts(ws);
      return { base, withMemory: after.verdicts[0] };
    };

    // T3 and T4 are deliberately SEPARATE tests rather than one A/B with two
    // assertions. They guard opposite failures — memory that does nothing, and
    // memory that does too much — and a single test cannot distinguish them:
    // neutralising the factor and letting memory rewrite the verdict would both
    // show up as the same red line.
    it('T3 · memory changes the published confidence', async () => {
      const { base, withMemory } = await evaluateBeforeAndAfter();

      // Derived from the live rule, never hard-coded to a number.
      const memory = await getInstitutionalMemory(ws);
      const relevant = selectRelevantMemory(memory.records, {
        verdict: base.verdict, entityLevel: 'CAMPAIGN',
      });
      const factor = memoryConfidenceFactor(relevant);
      expect(relevant).toHaveLength(1);
      expect(factor).toBeGreaterThan(1);

      expect(withMemory.institutionalMemory.status).toBe(MEMORY_STATUS.OK);
      expect(withMemory.institutionalMemory.applied).toBe(true);
      expect(withMemory.institutionalMemory.factor).toBeCloseTo(factor, 10);
      expect(withMemory.confidence).toBe(applyMemoryToConfidence(base.baseConfidence, factor));
      // …and it is a DIFFERENT number from the one memory-less evidence gave.
      expect(withMemory.confidence).not.toBe(base.confidence);
    });

    it('T4 · and the verdict itself is untouched by it', async () => {
      const { base, withMemory } = await evaluateBeforeAndAfter();

      // The boundary I51 exists to hold: identical evidence, so the CALL cannot
      // move, however strong the track record behind it. Only how sure we are
      // may change.
      expect(withMemory.verdict).toBe(base.verdict);
      expect(withMemory.baseConfidence).toBe(base.baseConfidence);
      expect(withMemory.institutionalMemory.applied).toBe(true);
    });

    it('a pattern about another verdict does not speak to this one', async () => {
      const before = await getConnectorVerdicts(ws);
      const other = before.verdicts[0].verdict === 'KILL' ? 'SCALE' : 'KILL';
      await persistPattern({ emitVerdict: other, scopeLevel: 'CAMPAIGN' });

      const after = await getConnectorVerdicts(ws);
      // Retrieved (status OK — the account HAS validated memory) but not
      // relevant, which is the distinction that makes the selector meaningful.
      expect(after.verdicts[0].institutionalMemory.status).toBe(MEMORY_STATUS.OK);
      expect(after.verdicts[0].institutionalMemory.applied).toBe(false);
      expect(after.verdicts[0].institutionalMemory.factor).toBe(1);
      expect(after.verdicts[0].confidence).toBe(before.verdicts[0].confidence);
    });
  });

  // ── T5 — the repair must not have widened what "validated" means ──────────
  describe('T5 · unvalidated rows stay out', () => {
    const cases = [
      ['EMERGING is not established',      { status: 'EMERGING' }],
      ['SUPERSEDED never speaks',          { status: 'SUPERSEDED' }],
      ['CONFLICTED never speaks',          { status: 'CONFLICTED' }],
      ['an unmeasured pattern is not knowledge', { accuracy: null, confidence: null }],
      ['accuracy below the promotion floor',     { accuracy: 0.4 }],
      ['thin support, however good it reads',    { effectiveSupport: 1, accuracy: 1 }],
    ];

    it.each(cases)('%s', async (_label, over) => {
      await persistPattern(over);
      const out = await getInstitutionalMemory(ws);
      expect(out.records).toEqual([]);
      expect(out.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
      expect(memoryConfidenceFactor(selectRelevantMemory(out.records, {
        verdict: 'KILL', entityLevel: 'CAMPAIGN',
      }))).toBe(1);
    });
  });

  // ── T6 — the honest failure state, which the false-empty used to mask ─────
  describe('T6 · a failed read is still OUR failure, not the account\'s', () => {
    it('reports MEMORY_UNAVAILABLE and leaves confidence untouched', async () => {
      await persistPattern();
      const real = prisma.accountPattern.findMany;
      prisma.accountPattern.findMany = async () => { throw new Error('connection terminated'); };
      let out;
      try { out = await getInstitutionalMemory(ws); } finally {
        prisma.accountPattern.findMany = real;
      }

      expect(out.status).toBe(MEMORY_STATUS.MEMORY_UNAVAILABLE);
      expect(out.status).not.toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
      expect(out.records).toEqual([]);
      // Neutral, exactly — an outage of ours must not penalise the account.
      expect(memoryConfidenceFactor(selectRelevantMemory(out.records, {
        verdict: 'KILL', entityLevel: 'CAMPAIGN',
      }))).toBe(1);
      expect(applyMemoryToConfidence(0.7, 1)).toBe(0.7);

      // And the memory really was there — so this is the failure path, not an
      // empty account wearing its name.
      expect((await getInstitutionalMemory(ws)).status).toBe(MEMORY_STATUS.OK);
    });
  });
});
