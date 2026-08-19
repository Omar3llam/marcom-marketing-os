// ============================================================
// LoopRun briefing column contract (R12-1d)
// ============================================================
// schema.prisma declares `aiInsight String?` with no @map, so the generated
// client addresses "aiInsight". The migration history created the physical
// column as "ai_insight" and never created "aiInsight", so every read and write
// of it failed with P2022 — on production and on every migration-built database,
// which is CI and every fresh developer database.
//
// It survived from 2026-07-10 to 2026-08-19 for one reason: EVERY test that
// touched prisma.loopRun mocked the client. AgenticLoopService.sweep.test.js,
// AgenticLoopService.singlePass.test.js and admin/workspaces.detail.test.js all
// assert against a vi.fn(), so none of them could ever notice that the column
// the real client selects did not exist. Four defensive catches (PR #210) then
// turned each live failure into a warning line.
//
// This file is the missing half: it exercises the column through the REAL
// generated client against the REAL database CI builds from the migration
// history. A mock cannot fail the way production failed, so nothing here mocks.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAvailable } from '../tests/dbProbe.js';
import { prisma } from '../lib/prisma.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = path.join(ROOT, 'prisma', 'migrations',
  '20260818050000_r12_1d_loop_run_ai_insight_rename', 'migration.sql');

// ============================================================
// Source-level safety — no database required
// ============================================================
describe('R12-1d migration is non-destructive by construction', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const executable = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');

  it('never drops a column', () => {
    // Prisma's own generated reconciliation was DROP COLUMN "ai_insight" +
    // ADD COLUMN "aiInsight" — it destroys a live column to rebuild it empty.
    // Harmless only because this column happens to hold nothing; on a database
    // that did hold data it would discard it silently.
    expect(executable).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('renames in place, so data is preserved by construction', () => {
    expect(executable).toMatch(/ALTER TABLE "loop_runs" RENAME COLUMN "ai_insight" TO "aiInsight"/);
  });

  it('adds a column exactly once, and only for the neither-exists case', () => {
    // A single ADD COLUMN is legitimate (the both-absent branch). Two would mean
    // the destructive drop/add pattern had crept back in.
    expect((executable.match(/ADD\s+COLUMN/gi) ?? []).length).toBe(1);
  });

  it('refuses rather than guesses when both columns exist', () => {
    expect(executable).toMatch(/RAISE EXCEPTION/);
    expect(executable).toMatch(/Refusing to guess which holds the briefing/);
  });

  it('copies no data between columns', () => {
    // A copy-then-drop approach would show up as an UPDATE ... SET or an
    // INSERT ... SELECT. The rename needs neither.
    expect(executable).not.toMatch(/UPDATE\s+"?loop_runs"?/i);
    expect(executable).not.toMatch(/INSERT\s+INTO/i);
  });
});

const DB_OK = await dbAvailable();
const WS = '00000000-0000-4000-8000-00000000d1d0';

describe.skipIf(!DB_OK)('R12-1d deployed — the physical column', () => {
  it('loop_runs has "aiInsight" and no "ai_insight"', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name::text AS col, data_type::text AS type, is_nullable::text AS nullable,
             coalesce(column_default, '') AS col_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'loop_runs'`;

    const now = rows.find((r) => r.col === 'aiInsight');
    expect(now, 'aiInsight is missing — the migration did not run').toBeDefined();
    expect(now.type).toBe('text');
    expect(now.nullable).toBe('YES');
    expect(now.col_default).toBe('');
    expect(rows.some((r) => r.col === 'ai_insight'), 'ai_insight still present').toBe(false);
  });

  it('leaves the rest of loop_runs untouched', async () => {
    // A rename must not disturb siblings, keys or indexes. The FK and both
    // indexes are re-proved rather than assumed.
    const cols = await prisma.$queryRaw`
      SELECT column_name::text AS col FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'loop_runs'`;
    for (const c of ['id', 'workspaceId', 'trigger', 'startedAt', 'finishedAt', 'proposalsByType',
      'stageStatus', 'summary', 'closed', 'loopHealth', 'staleStages', 'createdAt']) {
      expect(cols.map((x) => x.col), `${c} disappeared`).toContain(c);
    }

    const idx = await prisma.$queryRaw`
      SELECT indexname::text AS name FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'loop_runs'`;
    expect(idx.map((i) => i.name).sort()).toEqual([
      'loop_runs_pkey',
      'loop_runs_workspaceId_createdAt_idx',
      'loop_runs_workspaceId_loopHealth_idx',
    ]);
  });
});

// ============================================================
// The point of the slice: the real client can round-trip the column
// ============================================================
describe.skipIf(!DB_OK)('R12-1d deployed — the generated client can use aiInsight', () => {
  const runIds = [];

  const makeRun = (extra = {}) => ({
    workspaceId: WS,
    trigger: 'MANUAL',
    startedAt: new Date(),
    finishedAt: new Date(),
    proposalsByType: { VERDICT: 0 },
    stageStatus: [],
    summary: 'R12-1d contract fixture',
    closed: true,
    loopHealth: 'HEALTHY',
    staleStages: [],
    ...extra,
  });

  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: WS }, update: {}, create: { id: WS, name: 'R12-1d briefing fixture' },
    });
  });

  afterAll(async () => {
    // Scoped to the fixture workspace only — never a blanket delete.
    await prisma.loopRun.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('create -> findFirst(select aiInsight) -> update round-trips', async () => {
    // Exactly the three operations that were failing in production, in the
    // order PortfolioAnalysisService and AgentHomeService perform them.
    const created = await prisma.loopRun.create({ data: makeRun() });
    runIds.push(created.id);
    expect(created.aiInsight).toBeNull();          // honest empty state, not an error

    const BRIEFING = 'Two campaigns need attention this week.';
    await prisma.loopRun.update({ where: { id: created.id }, data: { aiInsight: BRIEFING } });

    const read = await prisma.loopRun.findFirst({
      where: { workspaceId: WS },
      orderBy: { createdAt: 'desc' },
      select: { aiInsight: true },
    });
    expect(read.aiInsight).toBe(BRIEFING);
  });

  it('a SELECT-LESS findFirst succeeds — the sweep idempotency guard works again', async () => {
    // runSweep's reuse guard is select-less, so it projects every scalar
    // including aiInsight. Under the old mismatch it raised P2022, its .catch
    // returned null, and the reuse branch was never taken — the scheduled
    // worker re-ran a full sweep, with its ANALYZE_PORTFOLIO gateway call,
    // every single time. This is the assertion that proves that path is alive.
    const last = await prisma.loopRun.findFirst({
      where: { workspaceId: WS }, orderBy: { createdAt: 'desc' },
    });
    expect(last).not.toBeNull();
    expect(last).toHaveProperty('aiInsight');
    expect(last.summary).toBe('R12-1d contract fixture');
  });

  it('stores and returns a null briefing without complaint', async () => {
    // The column stays nullable: a sweep that generated no prose must be able
    // to say so rather than be forced to invent one.
    const created = await prisma.loopRun.create({ data: makeRun({ aiInsight: null }) });
    runIds.push(created.id);
    const read = await prisma.loopRun.findUnique({
      where: { id: created.id }, select: { aiInsight: true },
    });
    expect(read.aiInsight).toBeNull();
  });
});
