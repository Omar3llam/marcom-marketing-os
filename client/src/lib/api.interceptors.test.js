// ============================================================
// api client interceptors — the axios 1.16 → 1.19 contract
// ------------------------------------------------------------
// Added alongside the in-range `npm audit fix`. axios moved 1.16.1 → 1.19.0 to
// clear two highs (prototype pollution in auth subfields, DoS via recursion in
// formDataToJSON). One of those advisories is IN the auth-header path this
// client uses on every single request, so the interceptor contract needs a pin
// that fails loudly if a future axios changes how config.headers is carried.
//
// api.planError.test.js already covers the 402 mapping. This covers what that
// one does not: that the REQUEST interceptor still stamps its four headers, and
// that the RESPONSE interceptor's 401 refresh-and-retry still fires once.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getIdToken, currentUserRef } = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  currentUserRef: { value: null },
}));

// Overrides the blanket mock in src/tests/setup.ts (same specifier — a
// file-level vi.mock wins), which pins a fixed 'mock-token' and a
// permanently-signed-in user. Both need to be controllable here.
vi.mock('@/firebase', () => ({
  auth: { get currentUser() { return currentUserRef.value; } },
}));

import { api } from './api.js';

const ok = { status: 200, data: { ok: true } };

beforeEach(() => {
  vi.clearAllMocks();
  getIdToken.mockResolvedValue('tok-123');
  currentUserRef.value = { getIdToken };
});

// The interceptor runs on the real axios instance; the adapter is swapped so
// nothing leaves the process and we can inspect the exact config axios built.
const captureConfig = () => {
  const seen = {};
  api.defaults.adapter = async (config) => {
    Object.assign(seen, config);
    return { ...ok, config, headers: {} };
  };
  return seen;
};

describe('request interceptor', () => {
  it('attaches the Firebase bearer token', async () => {
    const seen = captureConfig();
    await api.get('/api/anything');
    expect(seen.headers.Authorization).toBe('Bearer tok-123');
  });

  it('stamps the contract version and correlation ids', async () => {
    const seen = captureConfig();
    await api.get('/api/anything');
    expect(seen.headers['x-contract-version']).toBeTruthy();
    expect(seen.headers['x-request-id']).toBeTruthy();
    expect(seen.headers['x-session-id']).toBeTruthy();
  });

  it('carries the correlation ids on config.metadata for error mapping', async () => {
    const seen = captureConfig();
    await api.get('/api/anything');
    expect(seen.metadata?.requestId).toBe(seen.headers['x-request-id']);
    expect(seen.metadata?.sessionId).toBe(seen.headers['x-session-id']);
  });

  // A page can render before Firebase resolves; the request must still go out so
  // the backend can answer 401, rather than the client throwing locally.
  it('proceeds without a token when auth is not ready', async () => {
    currentUserRef.value = null;
    const seen = captureConfig();
    await expect(api.get('/api/anything')).resolves.toMatchObject({ status: 200 });
    expect(seen.headers.Authorization).toBeUndefined();
    expect(seen.headers['x-contract-version']).toBeTruthy(); // the rest still stamped
  });

  it('a throwing getIdToken does not block the request', async () => {
    getIdToken.mockRejectedValue(new Error('auth/network-request-failed'));
    const seen = captureConfig();
    await expect(api.get('/api/anything')).resolves.toMatchObject({ status: 200 });
    expect(seen.headers.Authorization).toBeUndefined();
  });

  it('sends a POST body through untouched', async () => {
    const seen = captureConfig();
    await api.post('/api/anything', { verdict: 'KILL', entityId: 'c1' });
    expect(JSON.parse(seen.data)).toEqual({ verdict: 'KILL', entityId: 'c1' });
  });
});

describe('response interceptor — 401 refresh and retry', () => {
  it('force-refreshes the token and retries once', async () => {
    // Faithful stand-in for Firebase: getIdToken(true) invalidates the cache, so
    // every later non-forced read returns the new token. The retry goes back
    // through the REQUEST interceptor, which re-stamps from that cache — the
    // header the response interceptor set is overwritten, and must still be
    // fresh. Asserting a literal 'Bearer fresh' on the retry would have been
    // testing a mechanism the client does not use.
    let cached = 'stale';
    getIdToken.mockImplementation(async (force) => {
      if (force) cached = 'fresh';
      return cached;
    });

    let calls = 0;
    const seenAuth = [];
    api.defaults.adapter = async (config) => {
      calls += 1;
      seenAuth.push(config.headers.Authorization);
      if (calls === 1) {
        const err = new Error('Unauthorized');
        err.response = { status: 401, data: {}, headers: {}, config };
        err.config = config;
        throw err;
      }
      return { ...ok, config, headers: {} };
    };

    await expect(api.get('/api/lumi/home')).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);
    expect(getIdToken).toHaveBeenCalledWith(true);   // the forced refresh happened
    expect(seenAuth[0]).toBe('Bearer stale');
    expect(seenAuth[1]).toBe('Bearer fresh');        // retry carries the refreshed token
  });

  it('retries at most once — a second 401 rejects', async () => {
    let calls = 0;
    api.defaults.adapter = async (config) => {
      calls += 1;
      const err = new Error('Unauthorized');
      err.response = { status: 401, data: {}, headers: {}, config };
      err.config = config;
      throw err;
    };
    await expect(api.get('/api/lumi/home')).rejects.toBeDefined();
    expect(calls).toBe(2); // original + one retry, never a loop
  });

  it('does not retry when there is no signed-in user to refresh', async () => {
    currentUserRef.value = null;
    let calls = 0;
    api.defaults.adapter = async (config) => {
      calls += 1;
      const err = new Error('Unauthorized');
      err.response = { status: 401, data: {}, headers: {}, config };
      err.config = config;
      throw err;
    };
    await expect(api.get('/api/lumi/home')).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('passes a success response through unchanged', async () => {
    api.defaults.adapter = async (config) => ({
      status: 200, data: { learning: null }, config, headers: {},
    });
    const res = await api.get('/api/lumi/decisions/by-entity/c1/learning');
    expect(res.data).toEqual({ learning: null });
  });
});
