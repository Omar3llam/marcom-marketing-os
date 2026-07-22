import { describe, it, expect, vi } from 'vitest';
import { contextGuard } from './contextGuard.js';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn((payload) => { res.body = payload; return res; });
  return res;
}

const reqWith = (context) => ({ user: { context }, userId: 'u1' });

describe('contextGuard — workspace identity (PR#264)', () => {
  it('{ name } → passes (calls next, no error response)', () => {
    const req = reqWith({ name: 'Acme' });
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.context).toEqual({ name: 'Acme' });
  });

  it('{ companyName } → passes (backward compat)', () => {
    const req = reqWith({ companyName: 'Acme' });
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('{ name, industry: null, market: null } → passes (industry/market not required)', () => {
    const req = reqWith({ name: 'Acme', industry: null, market: null });
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('empty context {} → 400 (no workspace identity)', () => {
    const req = reqWith({});
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe('INCOMPLETE_CONTEXT');
  });

  it('null context → 400', () => {
    const req = reqWith(null);
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('whitespace-only name → 400 (identity must be non-empty)', () => {
    const req = reqWith({ name: '   ' });
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('unauthenticated (no user) → 401', () => {
    const req = {};
    const res = mockRes();
    const next = vi.fn();
    contextGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
