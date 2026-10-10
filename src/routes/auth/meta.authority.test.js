import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../middleware/firebaseAuth.js', () => ({ requireAuth: (req, res, next) => req.user?.uid ? next() : res.status(401).json({ error: 'Unauthenticated' }) }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() }, workspace: { findUnique: vi.fn() } } }));
vi.mock('../../models/project.js', () => ({ getProject: vi.fn() }));
vi.mock('../../services/connectors/credentialStore.js', () => ({ completeMetaOAuthCredential: vi.fn(), listConnections: vi.fn(), resolveCredential: vi.fn() }));
vi.mock('../../services/metaAdsService.js', () => ({ exchangeForLongLivedToken: vi.fn(), listAdAccounts: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { prisma } from '../../lib/prisma.js';
import { getProject } from '../../models/project.js';
import { completeMetaOAuthCredential, listConnections, resolveCredential } from '../../services/connectors/credentialStore.js';
import { exchangeForLongLivedToken, listAdAccounts } from '../../services/metaAdsService.js';
import { authMetaRouter, buildState, parseState } from './meta.js';
const KEY = 'fixture-state-secret';
function app(identity = true) {
  return express().use((req, _res, next) => {
    req.user = identity ? { uid: 'uid1' } : null; req.userId = identity ? 'uid1' : null;
    req.collabRole = 'STRATEGIST'; next();
  }).use('/api/auth/meta', authMetaRouter);
}
const begin = (identity) => request(app(identity)).get('/api/auth/meta/connect').query({ projectId: 'p1', returnTo: '/onboarding?step=connect' });
const finish = (state = buildState('uid1', 'p1', '/onboarding', 'ws1')) => request(app()).get('/api/auth/meta/callback').query({ code: 'fixture-code', state });
const error = (res) => new URL(res.headers.location, 'http://localhost').searchParams.get('meta_error');
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('OAUTH_STATE_SECRET', KEY); vi.stubEnv('META_APP_ID', 'fixture-app');
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ access_token: 'fixture-short' }) })));
  prisma.user.findUnique.mockResolvedValue({ collabRole: 'STRATEGIST', workspaceId: 'ws1' });
  prisma.workspace.findUnique.mockResolvedValue({ id: 'ws1' }); getProject.mockResolvedValue({ id: 'p1' });
  exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'fixture-long' });
  listAdAccounts.mockResolvedValue([{ id: 'act1', accountStatus: 1 }]);
  completeMetaOAuthCredential.mockResolvedValue({ stamped: true });
  listConnections.mockResolvedValue([{ platform: 'META', isActive: true, accountId: 'act1' }]);
  resolveCredential.mockResolvedValue({ accessToken: 'fixture-long', accountId: 'act1' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Meta connection authority at actual Express boundaries', () => {
  it.each(['BUYER', 'CLIENT', null, 'UNKNOWN'])('refuses current %s instead of cached STRATEGIST', async (collabRole) => {
    prisma.user.findUnique.mockResolvedValue({ collabRole, workspaceId: 'ws1' });
    const res = await begin(); expect(res.status).toBe(403); expect(res.body.oauthUrl).toBeUndefined();
    expect(completeMetaOAuthCredential).not.toHaveBeenCalled();
  });
  it('refuses missing identity/membership; authenticated authority failure is 503', async () => {
    await begin(false).expect(401); expect(prisma.user.findUnique).not.toHaveBeenCalled();
    prisma.user.findUnique.mockResolvedValue(null); await begin().expect(403);
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'STRATEGIST', workspaceId: null }); await begin().expect(403);
    prisma.user.findUnique.mockRejectedValue(new Error('private DB detail')); const res = await begin().expect(503);
    expect(res.body.error).toBe('AuthorityUnavailable'); expect(JSON.stringify(res.body)).not.toContain('private');
  });
  it.each(['project', 'workspace'])('does not mint state for absent %s', async (missing) => {
    if (missing === 'project') getProject.mockResolvedValue(null);
    else prisma.workspace.findUnique.mockResolvedValue(null);
    const res = await begin().expect(403); expect(res.body.oauthUrl).toBeUndefined();
  });
  it('signs current database workspace and preserves the safe return path', async () => {
    const res = await begin().expect(200);
    const state = new URL(res.body.oauthUrl).searchParams.get('state');
    expect(parseState(state)).toEqual({ userId: 'uid1', projectId: 'p1', workspaceId: 'ws1', returnTo: '/onboarding?step=connect' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: { collabRole: true, workspaceId: true } }));
  });
  it.each(['u:p', 'u:p:L29uYm9hcmRpbmc'])('rejects approved legacy %s before provider or write', async (prefix) => {
    const payload = `${prefix}:${Date.now()}`;
    const mac = createHmac('sha256', KEY).update(payload).digest('hex');
    const res = await finish(Buffer.from(`${payload}:${mac}`).toString('base64url')).expect(302);
    expect(error(res)).toBe('invalid_state'); expect(fetch).not.toHaveBeenCalled();
    expect(completeMetaOAuthCredential).not.toHaveBeenCalled();
  });
  it('distinguishes ownership lookup outage from missing project without any write', async () => {
    getProject.mockRejectedValue(new Error('private SQL detail'));
    expect(error(await finish())).toBe('authority_unavailable');
    expect(fetch).not.toHaveBeenCalled(); expect(completeMetaOAuthCredential).not.toHaveBeenCalled();
  });
  it.each(['role_forbidden', 'authority_unavailable', 'workspace_mismatch'])('preserves distinct callback %s refusal without secrets', async (code) => {
    completeMetaOAuthCredential.mockRejectedValue(Object.assign(new Error('private fixture-token SQL detail'), { code }));
    const res = await finish().expect(302); expect(error(res)).toBe(code);
    expect(res.headers.location).not.toMatch(/private|fixture-token|SQL/);
    expect(listConnections).not.toHaveBeenCalled();
  });
  it('incomplete discovery has zero credential calls', async () => {
    listAdAccounts.mockResolvedValue([]);
    expect(error(await finish())).toBe('incomplete_connection');
    expect(completeMetaOAuthCredential).not.toHaveBeenCalled();
  });
});
