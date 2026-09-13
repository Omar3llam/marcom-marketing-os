// ============================================================
// SLICE B — the two checks must stay INDEPENDENT
// ------------------------------------------------------------
// Two mechanisms could let authority outlive its revocation, and the fix
// addresses both at the money boundary. The risk in fixing them together is
// that one quietly becomes a condition of the other — a credential check that
// only runs when the role lookup succeeds, a role check skipped for a caller
// whose token verified, a short-circuit that makes the matrix look complete
// while one axis does nothing.
//
// So the matrix is asserted directly, on BOTH canonical mutation paths:
//
//   credential   role        outcome
//   ──────────   ────────    ───────
//   revoked      valid    →  DENY   (401 — the credential, alone)
//   valid        demoted  →  DENY   (403 — the role, alone)
//   revoked      demoted  →  DENY   (either is sufficient)
//   valid        valid    →  ALLOW
//
// The two DENY-by-one-axis rows are the load-bearing ones. If either check
// became dependent on the other, one of them would flip to ALLOW.
//
// The status codes are asserted, not just the refusal: 401 and 403 answer
// different questions, and a boundary that cannot tell "your session is gone"
// from "your seat may not do this" gives the operator the wrong instruction.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// firebaseAuthMiddleware reads the user row FIRST, then the gate reads it again.
// A one-shot mock would be consumed by the middleware and never reach the gate,
// so the stores below are addressed by WHICH read they are serving.
const store = vi.hoisted(() => ({
  revoked: new Set(),
  row: { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' },
  /** reads within the CURRENT request; reset by post(). */
  reads: 0,
  /** applied from the second read onward — i.e. the gate's read, not the middleware's. */
  gateRead: null,
  /** the issuer is unreachable; only the gate asks with checkRevoked. */
  issuerDown: false,
}));

const REVOKED_ERROR = Object.assign(new Error('The Firebase ID token has been revoked.'), {
  code: 'auth/id-token-revoked',
});

vi.mock('../utils/firebaseAdmin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(async (token, checkRevoked = false) => {
        const uid = String(token).replace(/^token-for-/, '');
        // Only the gate passes checkRevoked, so both fault injections below
        // reach the gate and never the global middleware.
        if (checkRevoked && store.issuerDown) throw Object.assign(new Error('ECONNRESET'), { code: 'auth/internal-error' });
        if (checkRevoked && store.revoked.has(uid)) throw REVOKED_ERROR;
        return { uid, email: `${uid}@example.com`, email_verified: true };
      }),
    }),
  },
  getFirebaseAdminReadiness: () => ({ ok: true, error: null }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => {
        store.reads += 1;
        if (store.reads >= 2 && store.gateRead) {
          if (store.gateRead.throws) throw store.gateRead.throws;
          return store.gateRead.row;
        }
        return store.row;
      }),
      update: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { buildAuthorityBoundary, CANONICAL_MUTATION_PATHS } = await import('./authorityBoundary.harness.js');
const { invalidateWorkspaceCache } = await import('../middleware/firebaseAuth.js');

const UID = 'seat-1';
const TOKEN = `token-for-${UID}`;

let app;
let mutations;

beforeEach(async () => {
  store.revoked.clear();
  store.row = { id: 'u-1', workspaceId: 'ws-1', role: 'USER', collabRole: 'STRATEGIST' };
  store.gateRead = null;
  store.issuerDown = false;
  invalidateWorkspaceCache(UID);
  ({ app, mutations } = await buildAuthorityBoundary());
});

const post = (path) => {
  store.reads = 0;
  return request(app).post(path).set('Authorization', `Bearer ${TOKEN}`).send({ action: 'PAUSE_CAMPAIGN' });
};

const setState = ({ credential, role }) => {
  if (credential === 'revoked') store.revoked.add(UID);
  store.row = { ...store.row, collabRole: role === 'demoted' ? 'CLIENT' : 'STRATEGIST' };
};

describe.each(CANONICAL_MUTATION_PATHS)('%s', (path) => {
  it('revoked credential + VALID role → denied on the credential alone', async () => {
    setState({ credential: 'revoked', role: 'valid' });
    const res = await post(path);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'CredentialRevoked' });
    expect(mutations.count).toBe(0);
  });

  it('VALID credential + demoted role → denied on the role alone', async () => {
    setState({ credential: 'valid', role: 'demoted' });
    const res = await post(path);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'RoleForbidden', role: 'CLIENT' });
    expect(mutations.count).toBe(0);
  });

  it('revoked credential + demoted role → denied', async () => {
    setState({ credential: 'revoked', role: 'demoted' });
    const res = await post(path);
    expect(res.status).not.toBe(202);
    expect(mutations.count).toBe(0);
  });

  it('valid credential + valid role → allowed', async () => {
    setState({ credential: 'valid', role: 'valid' });
    const res = await post(path);
    expect(res.status).toBe(202);
    expect(mutations.count).toBe(1);
  });
});

// ── An outage is neither a permission nor a denial ──────────────────────────
// R11 (I61) is the precedent: a swallowed identity-store error used to promote
// the caller to the top role. Both sources here are remote, so both can be
// unavailable, and neither may read as an answer about authority.
describe('an unavailable authority source refuses without claiming a verdict', () => {
  it('an unreachable issuer is 503, not 401 and not a pass', async () => {
    store.issuerDown = true;
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'AuthorityUnavailable' });
    expect(mutations.count).toBe(0);
  });

  it('an unreadable role store is 503, not a pass', async () => {
    store.gateRead = { throws: new Error('pool exhausted') };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'AuthorityUnavailable' });
    expect(mutations.count).toBe(0);
  });

  it('a missing user row denies rather than defaulting to a seat', async () => {
    store.gateRead = { row: null };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
    expect(mutations.count).toBe(0);
  });

  // normalizeRole maps anything unrecognised to STRATEGIST so a surface can
  // render. At this boundary an unknown value is a denial — otherwise growing
  // the WorkspaceRole enum would silently grant the highest privilege.
  it('an unrecognised role is denied, never normalised upward', async () => {
    store.gateRead = { row: { collabRole: 'ANALYST' } };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ role: 'ANALYST' });
    expect(mutations.count).toBe(0);
  });

  // A fault injector that cannot reach the gate would make every case above
  // pass for the wrong reason: the middleware would have failed first.
  it('control — the injected faults reach the GATE, not the middleware', async () => {
    store.gateRead = { throws: new Error('pool exhausted') };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(503);          // the gate's code
    expect(res.status).not.toBe(401);      // not requireAuth
    expect(res.status).not.toBe(409);      // not requireWorkspace
  });
});

// ── No per-process state is consulted ───────────────────────────────────────
// Both authorities are SHARED (the issuer, the database), which is what makes
// the property hold on more than one instance. A fix built on invalidating a
// local cache would pass every test above on a single process and fail in
// production the moment a second instance served the request.
describe('the decision rests on shared state, not this process', () => {
  it('a warm local cache does not change the verdict', async () => {
    await post('/api/execute/meta');          // warms whatever is warmable
    store.row = { ...store.row, collabRole: 'CLIENT' };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);             // the row decided, not the cache
  });

  it('a COLD process reaches the same verdict for the same state', async () => {
    store.row = { ...store.row, collabRole: 'CLIENT' };
    invalidateWorkspaceCache(UID);
    ({ app, mutations } = await buildAuthorityBoundary());   // a fresh "instance"
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(403);
    expect(mutations.count).toBe(0);
  });

  it('the role the handler sees is the CURRENT one, not the cached one', async () => {
    await post('/api/execute/meta');
    store.row = { ...store.row, collabRole: 'BUYER' };
    const res = await post('/api/execute/meta');
    expect(res.status).toBe(202);             // BUYER is permitted here
  });
});
