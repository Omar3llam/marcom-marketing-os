// ============================================================
// Phase 4-F — the network consent gate (the cross-tenant boundary)
// ------------------------------------------------------------
// Consenting to contribute this workspace's learned patterns into the
// shared cross-account pool is the ONE write in the network layer that
// crosses a tenant boundary (the k-anonymity-gated read is safe by
// construction). It must be STRATEGIST-only — a CLIENT or BUYER seat
// cannot opt the account in. The REAL requireCollabRole runs here; only
// the services + DB are mocked. Mirrors the rollback router's gate test.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryRouter } from './memory.js';
import { setConsent } from '../../services/network-engine/NetworkService.js';

vi.mock('../../services/network-engine/NetworkService.js', () => ({
  setConsent: vi.fn(),
  getNetworkInsights: vi.fn(),
}));
vi.mock('../../services/pattern-engine/PatternService.js', () => ({ getBriefing: vi.fn() }));
vi.mock('../../services/pattern-engine/PlaybookService.js', () => ({ promotePattern: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// `collabRole` is what firebaseAuth stamps on req; the real gate reads it.
function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'workspace-1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', memoryRouter);
  return app;
}

// Deliberately still carries the field R11 (F12) removed: the role gate is
// middleware and must refuse before the body is ever inspected, so these two
// cases prove ORDER as well as the gate.
const body = { optIn: true, cohortTag: 'EG-apparel' };

describe('POST /network/consent — STRATEGIST-gated cross-tenant consent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forbids a CLIENT from opting the workspace into the network', async () => {
    await request(makeApp({ collabRole: 'CLIENT' }))
      .post('/network/consent').send(body)
      .expect(403);
    expect(setConsent).not.toHaveBeenCalled(); // the write never fires
  });

  it('forbids a BUYER too — only the account owner may consent', async () => {
    await request(makeApp({ collabRole: 'BUYER' }))
      .post('/network/consent').send(body)
      .expect(403);
    expect(setConsent).not.toHaveBeenCalled();
  });

  it('lets a STRATEGIST opt in — optIn only; the cohort comes back server-assigned', async () => {
    setConsent.mockResolvedValue({ id: 'workspace-1', networkConsent: true, cohortTag: 'CUR-EGP', consentedAt: new Date().toISOString() });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' }))
      .post('/network/consent').send({ optIn: true })
      .expect(200);
    expect(setConsent).toHaveBeenCalledWith('workspace-1', { optIn: true });
    expect(res.body).toMatchObject({ workspaceId: 'workspace-1', networkConsent: true, cohortTag: 'CUR-EGP' });
  });

  // ── NC-F12a · the control (R11 · F12 / RU-5) ─────────────
  it('REFUSES a caller-supplied cohortTag — 400, and the write never fires', async () => {
    // Cohort membership decides both who you contribute to and whose aggregate
    // you may read. Accepting the tag from the request body made that a claim,
    // and the claim was trusted: type a cohort's name and you were inside it.
    // Refusing rather than ignoring matters — an ignored parameter is
    // indistinguishable from an accepted one to whoever sent it.
    const res = await request(makeApp({ collabRole: 'STRATEGIST' }))
      .post('/network/consent').send({ optIn: true, cohortTag: 'EG-apparel' })
      .expect(400);
    expect(res.body.error).toBe('CohortNotSettable');
    expect(setConsent).not.toHaveBeenCalled();
  });

  it('refuses even an empty-string cohortTag — presence is what is rejected', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' }))
      .post('/network/consent').send({ optIn: true, cohortTag: '' })
      .expect(400);
    expect(setConsent).not.toHaveBeenCalled();
  });

  it('no assignable cohort → 409, not a silent opt-in', async () => {
    const err = new Error('No cohort can be established for this workspace');
    err.code = 'COHORT_UNAVAILABLE';
    setConsent.mockRejectedValue(err);
    const res = await request(makeApp({ collabRole: 'STRATEGIST' }))
      .post('/network/consent').send({ optIn: true })
      .expect(409);
    expect(res.body.error).toBe('CohortUnavailable');
  });

  it('REFUSES a null collab role — R11 (I61) removed the fail-open default', async () => {
    // This gate protects a cross-tenant consent decision. Before R11 an
    // unresolvable role was answered with STRATEGIST, so the one seat that can
    // opt a workspace into the network was the one every seat defaulted to.
    setConsent.mockResolvedValue({ id: 'workspace-1', networkConsent: false, cohortTag: null, consentedAt: null });
    await request(makeApp({ collabRole: null }))
      .post('/network/consent').send({ optIn: false })
      .expect(403);
    expect(setConsent).not.toHaveBeenCalled();
  });
});
