// ============================================================
// R6 — the SEAM: real evidence rows → the row that gets persisted
// ============================================================
// R5 taught this file's existence. There, the write path was tested against a
// hand-written basis and the projector was tested alone, and the first negative
// control PASSED because nothing covered the join between them. A parity test
// that imports the same implementation it is meant to validate is not a control.
//
// So this file mocks only the two things that are genuinely not under test —
// the database client and the evidence seam — and lets the REAL projector run
// inside the REAL writer. Every expectation below is a literal, typed by hand
// from the fixture rows. Nothing here calls toEvidenceReference, and nothing
// here reads a constant from the code it is checking: if the writer stopped
// persisting provenance, projected a different population, or dated the evidence
// to anything other than the rows, these assertions would have to be edited to
// keep passing.
// ============================================================
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision:        { findFirst: vi.fn(), findMany: vi.fn() },
    outcomeSnapshot: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace:       { findUnique: vi.fn() },
    $transaction:    vi.fn(),
  },
}));
const { selectOperationalSnapshots } = vi.hoisted(() => ({ selectOperationalSnapshots: vi.fn() }));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots }));

import { prisma } from '../../lib/prisma.js';
import { recordOutcome } from './DecisionAccuracyService.js';

const NOW = new Date('2026-06-20T12:00:00.000Z');

const BODY = Object.freeze({
  spendDeltaMinor: -450000, revenueDeltaMinor: 120000, roasDelta: -0.8,
  windowStart: '2026-06-02T00:00:00Z', windowEnd: '2026-06-09T00:00:00Z',
  sustained: true, measuredAt: '2026-06-10T00:00:00Z',
});

// MetricSnapshot rows as the operational seam returns them: `date` is the SYNC
// timestamp, and the last one was synced after the operator's period closed.
const ROWS = [
  { entityId: 'ent-1', date: new Date('2026-06-03T06:00:00Z'), source: 'META', measurementWindow: 'ROLLING_WINDOW' },
  { entityId: 'ent-1', date: new Date('2026-06-06T06:00:00Z'), source: 'META', measurementWindow: 'ROLLING_WINDOW' },
  { entityId: 'ent-1', date: new Date('2026-06-07T06:00:00Z'), source: 'GA4',  measurementWindow: 'ROLLING_WINDOW' },
  { entityId: 'ent-1', date: new Date('2026-06-18T06:00:00Z'), source: 'META', measurementWindow: 'ROLLING_WINDOW' },
];

const persisted = () => prisma.outcomeSnapshot.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue({
    id: 'dec-1', status: 'PROPOSED', entityId: 'ent-1', entityLevel: 'CAMPAIGN',
    executedAt: new Date('2026-06-01T10:00:00.000Z'), dismissedAt: null,
  });
  prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);
  prisma.outcomeSnapshot.create.mockResolvedValue({ id: 'out-new' });
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  selectOperationalSnapshots.mockResolvedValue(ROWS);
});

describe('R6 seam — evidence rows become the persisted reference', () => {
  it('persists exactly the reference those four rows justify', async () => {
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });

    expect(persisted().evidenceReference).toEqual({
      population:        'operational',
      selector:          'selectOperationalSnapshots',
      measurementWindow: 'ROLLING_WINDOW',
      sources:           ['META', 'GA4'],
      observedAt: [
        '2026-06-03T06:00:00.000Z',
        '2026-06-06T06:00:00.000Z',
        '2026-06-07T06:00:00.000Z',
      ],
      reduction: 'series',
      entityIds: ['ent-1'],
      // FOUR consumed, THREE inside the measured period. The row synced on the
      // 18th is counted and not claimed: the outcome does not rest on evidence
      // observed after the window it reports.
      rowCount: 4,
      refs: [],
    });
  });

  it('reads the operational population for THIS decision\'s entity and level', async () => {
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });
    const [workspaceId, opts] = selectOperationalSnapshots.mock.calls[0];
    expect(workspaceId).toBe('ws-1');
    expect(opts.entityIds).toEqual(['ent-1']);       // inherited from the decision
    expect(opts.entityLevel).toBe('CAMPAIGN');       // inherited from the decision
    expect(opts.since).toEqual(new Date('2026-06-02T00:00:00Z'));
  });

  it('dates the evidence to the ROWS, never to the recording', async () => {
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });
    const row = persisted();
    expect(row.evidenceReference.observedAt[0]).toBe('2026-06-03T06:00:00.000Z');
    // Not the measurement instant, not the window bounds, not the server clock —
    // all four are on or beside this row and none of them is an observation.
    expect(row.evidenceReference.observedAt).not.toContain(row.measuredAt.toISOString());
    expect(row.evidenceReference.observedAt).not.toContain(row.windowStart.toISOString());
    expect(row.evidenceReference.observedAt).not.toContain(row.windowEnd.toISOString());
    expect(row.evidenceReference.observedAt).not.toContain(NOW.toISOString());
  });

  it('records an empty read as empty, and still writes the outcome', async () => {
    // A window Lumi synced nothing across. The operator saw the result in the ads
    // manager and is allowed to say so; the reference says, truthfully, that the
    // database held nothing for that period.
    selectOperationalSnapshots.mockResolvedValue([]);
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });

    expect(persisted().evidenceReference).toEqual({
      population: 'operational', selector: 'selectOperationalSnapshots', measurementWindow: null,
      sources: [], observedAt: [], reduction: 'series', entityIds: [], rowCount: 0, refs: [],
    });
  });

  it('reports "not captured" as null when the rows carried no source', async () => {
    // The R5 distinction, end to end: null is a column nobody projected, [] is a
    // read with no contributing rows. Collapsing them would make an unrecorded
    // fact look like an observed absence.
    selectOperationalSnapshots.mockResolvedValue([
      { entityId: 'ent-1', date: new Date('2026-06-03T06:00:00Z'), source: null, measurementWindow: null },
    ]);
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });

    const ref = persisted().evidenceReference;
    expect(ref.sources).toBeNull();
    expect(ref.measurementWindow).toBeNull();
    expect(ref.rowCount).toBe(1);
    expect(ref.observedAt).toEqual(['2026-06-03T06:00:00.000Z']);
  });

  it('carries the reference into the SUPERSEDING row, leaving the retired one untouched', async () => {
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-old' });
    await recordOutcome('ws-1', 'dec-1', BODY, { now: NOW });

    expect(persisted().evidenceReference.rowCount).toBe(4);
    expect(Object.keys(prisma.outcomeSnapshot.update.mock.calls[0][0].data).sort())
      .toEqual(['supersededAt', 'supersededById']);
  });
});

// ── The rows that were already there ──────────────────────────────
// Every outcome recorded before R6 is a legacy human-entered result with no
// provenance and no measurementinstant. That is a FACT ABOUT THOSE ROWS, and the
// only honest way to keep it is to leave them alone.
describe('R6 — legacy rows are left as they are', () => {
  const MIGRATION = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../prisma/migrations/20260816000000_add_outcome_provenance/migration.sql',
    ),
    'utf8',
  );

  it('the migration adds columns and writes to no row', () => {
    // A backfill would make every historical outcome assert a population, a
    // source and an observation time nobody recorded — the exact fabrication
    // this PR exists to make impossible for new rows.
    const sql = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "measuredAt"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "evidenceReference"/);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);   // a default would backfill on read
    expect(sql).not.toMatch(/\bNOT NULL\b/i);  // a NOT NULL would refuse them entirely
  });
});
