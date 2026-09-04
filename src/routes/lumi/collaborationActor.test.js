// ============================================================
// C-18 · the collaboration lifecycle writes a person, not a Firebase uid
// ------------------------------------------------------------
// `req.userId` is `decodedToken.uid` — a Firebase identifier. Four columns on
// this path are `@db.Uuid`, and `ApprovalRequest.requestedById` is NOT NULL.
// Writing the one into the other does not produce a wrong name. It produces a
// failed insert:
//
//   POST /api/lumi/approvals
//     → requestApproval() opens a $transaction
//     → plan.update{ requiresApproval: true }        ← rolls back
//     → approvalRequest.create{ requestedById: uid } ← 22P02, invalid uuid
//     → 500
//
// So `Plan.requiresApproval` can never become true through the product, and
// `isPromotionApprovalBlocked` — five unit tests, correct in every one — has
// nothing to block. C-18's gate cannot be armed until this is repaired, which
// is why Ruling C moved these four sites inside the slice.
//
// C-05 already solved this in lumi/memory.js and named the defect in its own
// comment. The repair is that function, reused — not a new resolver.
// ============================================================
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/collaboration/ApprovalService.js', () => ({
  requestApproval: vi.fn(), decideApproval: vi.fn(), handoff: vi.fn(), listApprovals: vi.fn(),
  APPROVAL_STATE: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
}));
vi.mock('../../services/narrative-engine/NarrativeService.js', () => ({
  generateNarrative: vi.fn(), listNarratives: vi.fn(), getNarrative: vi.fn(),
}));
vi.mock('../../services/collaboration/InboxService.js', () => ({ inboxFor: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { collaborationRouter } from './collaboration.js';
import { prisma } from '../../lib/prisma.js';
import { requestApproval, decideApproval, handoff } from '../../services/collaboration/ApprovalService.js';
import { generateNarrative } from '../../services/narrative-engine/NarrativeService.js';

const FIREBASE_UID = 'aZ9kQ2mV7pLx3Rt8Nw1Ye5Bc0Df4';   // 28 chars, not a uuid
const USER_ID      = '11111111-1111-1111-1111-111111111111';
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `/approvals` sits behind requirePlan('GROWTH'). This suite is about WHO the
// route writes, not about the paywall — lift the tier so a gate failure cannot
// masquerade as an actor failure.
let priorPlanOverride;
beforeAll(() => { priorPlanOverride = process.env.PLAN_OVERRIDE; process.env.PLAN_OVERRIDE = 'PRO'; });
afterAll(() => {
  if (priorPlanOverride === undefined) delete process.env.PLAN_OVERRIDE;
  else process.env.PLAN_OVERRIDE = priorPlanOverride;
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = FIREBASE_UID;
    req.workspaceId = 'workspace-1';
    req.collabRole = 'STRATEGIST';
    req.plan = 'ENTERPRISE';
    next();
  });
  app.use('/', collaborationRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: USER_ID });
  requestApproval.mockResolvedValue({ id: 'req-1', state: 'PENDING' });
  decideApproval.mockResolvedValue({ id: 'req-1', state: 'APPROVED' });
  handoff.mockResolvedValue({ id: 'evt-1' });
  generateNarrative.mockResolvedValue({ id: 'nar-1' });
});

describe('the four sites resolve the actor to a User row', () => {
  it('POST /approvals files the request under a uuid, never the Firebase uid', async () => {
    await request(makeApp()).post('/approvals').send({ planId: 'plan-1' }).expect(201);

    const [, args] = requestApproval.mock.calls[0];
    expect(args.requestedById).toBe(USER_ID);
    expect(args.requestedById).not.toBe(FIREBASE_UID);
    expect(args.requestedById).toMatch(UUID_RE);
  });

  it('POST /approvals/:id/decide records the approver as a uuid', async () => {
    await request(makeApp()).post('/approvals/req-1/decide').send({ decision: 'APPROVED' }).expect(201);

    const [, args] = decideApproval.mock.calls[0];
    expect(args.approverId).toBe(USER_ID);
    expect(args.approverId).toMatch(UUID_RE);
  });

  it('POST /handoff records the actor as a uuid', async () => {
    await request(makeApp()).post('/handoff').send({ subjectId: 'dec-1', toRole: 'BUYER' }).expect(201);

    const [, args] = handoff.mock.calls[0];
    expect(args.actorId).toBe(USER_ID);
    expect(args.actorId).toMatch(UUID_RE);
  });

  it('POST /narratives/generate records the author as a uuid', async () => {
    await request(makeApp()).post('/narratives/generate').send({}).expect(201);

    const [, args] = generateNarrative.mock.calls[0];
    expect(args.actorId).toBe(USER_ID);
    expect(args.actorId).toMatch(UUID_RE);
  });
});

describe('an unresolvable actor refuses — it never writes a null into an audit column', () => {
  // R-13, as C-05 settled it and lumi/memory.js already implements it: "an
  // authorization nobody can be named for is not an authorization". A null actor
  // would keep the row but lose the person, which is the same trail defect one
  // step quieter than a crash.
  beforeEach(() => { prisma.user.findUnique.mockResolvedValue(null); });

  it('refuses to open an approval gate', async () => {
    const res = await request(makeApp()).post('/approvals').send({ planId: 'plan-1' }).expect(409);
    expect(res.body.error).toBe('ActorUnresolved');
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('refuses to decide one', async () => {
    await request(makeApp()).post('/approvals/req-1/decide').send({ decision: 'APPROVED' }).expect(409);
    expect(decideApproval).not.toHaveBeenCalled();
  });

  it('refuses to hand off', async () => {
    await request(makeApp()).post('/handoff').send({ subjectId: 'dec-1', toRole: 'BUYER' }).expect(409);
    expect(handoff).not.toHaveBeenCalled();
  });

  it('refuses to author a narrative', async () => {
    await request(makeApp()).post('/narratives/generate').send({}).expect(409);
    expect(generateNarrative).not.toHaveBeenCalled();
  });
});

describe('one resolver, not three copies', () => {
  it('collaboration.js, memory.js and planning.js import the same function', async () => {
    // Ruling C: "Reuse resolveActorId exactly" — and three identical private
    // copies is not reuse. It is the same drift risk the six C-06 name
    // collisions already record, seeded deliberately.
    const shared = await import('./actorId.js');
    expect(typeof shared.resolveActorId).toBe('function');

    for (const file of ['collaboration.js', 'memory.js', 'planning.js']) {
      const src = await import('node:fs').then((fs) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
      expect(src).toMatch(/from '\.\/actorId\.js'/);
      expect(src).not.toMatch(/^async function resolveActorId/m);
    }
  });
});
