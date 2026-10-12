import { describe, expect, it, vi } from 'vitest';
import { assertWorkspaceLive, withLiveWorkspace } from './workspaceLiveness.js';

describe('workspace refusal error boundaries', () => {
  it('successful admission miss is NoWorkspace', async () => {
    const client = { workspace: { findUnique: vi.fn(async () => null) } };
    await expect(assertWorkspaceLive(client, 'synthetic')).rejects.toMatchObject({ code: 'NoWorkspace' });
  });
  it('admission failure preserves its private cause but sanitizes the public message', async () => {
    const cause = new Error('synthetic sensitive DB detail');
    const client = { workspace: { findUnique: vi.fn(async () => { throw cause; }) } };
    await expect(assertWorkspaceLive(client, 'synthetic')).rejects.toMatchObject({
      code: 'WorkspaceUnavailable', cause, message: 'WorkspaceUnavailable: workspace lookup failed',
    });
  });
  it.each([[], null])('missing or failed lock read never calls the write operation (%s)', async (parent) => {
    const tx = { $queryRaw: vi.fn(async () => { if (parent === null) throw new Error('synthetic outage'); return parent; }) };
    const client = { $transaction: async (operation) => operation(tx) }, write = vi.fn();
    await expect(withLiveWorkspace(client, 'synthetic', write)).rejects.toMatchObject({
      code: parent === null ? 'WorkspaceUnavailable' : 'NoWorkspace',
    });
    expect(write).not.toHaveBeenCalled();
  });
  it('an operation error is propagated by identity, including an unrelated FK', async () => {
    const cause = Object.assign(new Error('synthetic unrelated FK'), { code: 'P2003' });
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'synthetic' }]) };
    const client = { $transaction: async (operation) => operation(tx) };
    await expect(withLiveWorkspace(client, 'synthetic', () => { throw cause; })).rejects.toBe(cause);
  });
  it('transaction acquisition failure is not evidence of a missing parent', async () => {
    const cause = Object.assign(new Error('synthetic connection failure'), { code: 'P1001' });
    const client = { $transaction: async () => { throw cause; } };
    await expect(withLiveWorkspace(client, 'synthetic', vi.fn())).rejects.toBe(cause);
  });
});
