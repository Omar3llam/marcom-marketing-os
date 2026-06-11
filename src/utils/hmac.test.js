import { afterEach, describe, expect, it } from 'vitest';
import { signQuickAction, verifyQuickAction } from './hmac.js';

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('quick-action HMAC helpers', () => {
  it('signs and verifies with QUICK_ACTION_HMAC_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.QUICK_ACTION_HMAC_SECRET = 'quick-secret';
    delete process.env.JWT_SECRET;

    const signed = signQuickAction({ actionId: 'action-1' });
    expect(verifyQuickAction(signed)).toMatchObject({
      ok: true,
      actionId: 'action-1',
      scope: 'execute',
    });
  });

  it('does not fall back to JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.QUICK_ACTION_HMAC_SECRET;
    process.env.JWT_SECRET = 'jwt-secret';

    expect(() => signQuickAction({ actionId: 'action-1' }))
      .toThrow('QUICK_ACTION_HMAC_SECRET is required in production');
  });

  it('allows JWT_SECRET fallback outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.QUICK_ACTION_HMAC_SECRET;
    process.env.JWT_SECRET = 'jwt-secret';

    const signed = signQuickAction({ actionId: 'action-2' });
    expect(verifyQuickAction(signed)).toMatchObject({
      ok: true,
      actionId: 'action-2',
    });
  });
});
