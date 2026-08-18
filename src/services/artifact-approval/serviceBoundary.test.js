// ============================================================
// R11 — service-level boundaries  (I64 / I69 / I70)
// ------------------------------------------------------------
// R9 established that a tenant-owned resolver takes workspaceId as an ARGUMENT
// rather than trusting its callers. Six mutating services were left outside
// that rule and were safe only because every current caller happened to
// pre-scope its input. "The caller checks it" is not a property of a service.
//
// Every case here fails if the service goes back to trusting its caller.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WS_MINE    = '00000000-0000-0000-0000-0000000000aa';
const WS_FOREIGN = '00000000-0000-0000-0000-0000000000bb';

const rows = new Map();

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    artifactApproval: {
      updateMany: vi.fn(async ({ where = {}, data }) => {
        const matched = [...rows.values()].filter((r) =>
          (!where.id          || r.id          === where.id) &&
          (!where.workspaceId || r.workspaceId === where.workspaceId) &&
          (!where.status      || r.status      === where.status));
        for (const r of matched) Object.assign(r, data);
        return { count: matched.length };
      }),
      findFirst: vi.fn(async ({ where = {} }) =>
        [...rows.values()].find((r) =>
          (!where.id          || r.id          === where.id) &&
          (!where.workspaceId || r.workspaceId === where.workspaceId)) ?? null),
      create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  approveArtifact,
  rejectArtifact,
  requestRevision,
  ApprovalNotActionableError,
  APPROVAL_STATUS,
} from './index.js';

function seed(id, workspaceId, status = APPROVAL_STATUS.PENDING) {
  rows.set(id, { id, workspaceId, artifactId: `art_${id}`, status, reviewerId: null, feedback: null });
  return rows.get(id);
}

beforeEach(() => { rows.clear(); vi.clearAllMocks(); });

describe('approval decisions are workspace-scoped inside the service (I64)', () => {
  it('approves a row the caller owns', async () => {
    seed('ap1', WS_MINE);
    const out = await approveArtifact('ap1', WS_MINE, 'reviewer-1', 'looks good');
    expect(out.status).toBe(APPROVAL_STATUS.APPROVED);
    expect(rows.get('ap1').reviewerId).toBe('reviewer-1');
  });

  // ── NC-B9 · the control ────────────────────────────────────
  it('REFUSES a foreign approvalId unaided — no route check involved', async () => {
    seed('ap2', WS_FOREIGN);
    await expect(approveArtifact('ap2', WS_MINE, 'attacker', null))
      .rejects.toBeInstanceOf(ApprovalNotActionableError);
    expect(rows.get('ap2').status).toBe(APPROVAL_STATUS.PENDING);
    expect(rows.get('ap2').reviewerId).toBeNull();
  });

  it('REFUSES when no workspace is supplied at all — never falls back to unscoped', async () => {
    seed('ap3', WS_MINE);
    await expect(approveArtifact('ap3', undefined, 'x', null)).rejects.toThrow(/workspaceId required/);
    await expect(rejectArtifact('ap3', null, 'x', 'why')).rejects.toThrow(/workspaceId required/);
    await expect(requestRevision('ap3', '', 'x', 'notes')).rejects.toThrow(/workspaceId required/);
  });
});

describe('approval decisions are state-gated inside the service (I69)', () => {
  // ── NC-B11 · the control ───────────────────────────────────
  it('REFUSES to overturn a REJECTED approval', async () => {
    // The concrete defect: reject, then approve, and the rejection was gone —
    // reviewerId and timestamps overwritten, repeatably. The other approval
    // door (executeDecision) enforced PENDING; these three did not, so one
    // invariant had two answers depending on which route you came through.
    seed('ap4', WS_MINE);
    await rejectArtifact('ap4', WS_MINE, 'reviewer-1', 'off-brand');
    expect(rows.get('ap4').status).toBe(APPROVAL_STATUS.REJECTED);

    await expect(approveArtifact('ap4', WS_MINE, 'reviewer-2', 'actually fine'))
      .rejects.toBeInstanceOf(ApprovalNotActionableError);

    expect(rows.get('ap4').status).toBe(APPROVAL_STATUS.REJECTED);
    expect(rows.get('ap4').reviewerId).toBe('reviewer-1');
  });

  it('REFUSES a second decision of the same kind — the write is once-only', async () => {
    seed('ap5', WS_MINE);
    await approveArtifact('ap5', WS_MINE, 'reviewer-1', null);
    await expect(approveArtifact('ap5', WS_MINE, 'reviewer-2', null))
      .rejects.toBeInstanceOf(ApprovalNotActionableError);
    expect(rows.get('ap5').reviewerId).toBe('reviewer-1');
  });

  it('answers absent, foreign, and already-decided identically — no existence oracle', async () => {
    seed('ap6', WS_FOREIGN);
    seed('ap7', WS_MINE, APPROVAL_STATUS.APPROVED);

    const outcomes = await Promise.all([
      approveArtifact('does-not-exist', WS_MINE, 'x', null).catch((e) => e.name),
      approveArtifact('ap6',            WS_MINE, 'x', null).catch((e) => e.name),
      approveArtifact('ap7',            WS_MINE, 'x', null).catch((e) => e.name),
    ]);

    expect(new Set(outcomes)).toEqual(new Set(['ApprovalNotActionableError']));
  });
});
