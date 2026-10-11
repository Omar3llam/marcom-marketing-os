import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: getMock } }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'synthetic', loading: false }) }));
vi.mock('@/features/connectors/startConnect.js', () => ({ startConnect: vi.fn() }));
import { ConnectStep } from './ConnectStep.jsx';

const confirmed = { workspaceId: 'synthetic-workspace', connections: [{
  platform: 'META', connected: true, isActive: true, stale: false,
}] };
let reads;
beforeEach(() => {
  reads = [];
  getMock.mockReset().mockImplementation(() => new Promise((resolve, reject) => reads.push({ resolve, reject })));
  window.history.replaceState({}, '', '/onboarding?step=connect&meta_connected=1');
});

describe('P9-06 — real connection hook ownership with synthetic API responses', () => {
  it('StrictMode callback refresh cancels old reads and advances only once on the latest parsed response', async () => {
    const onConnected = vi.fn();
    render(<StrictMode><ConnectStep onConnected={onConnected} onSkip={vi.fn()} /></StrictMode>);
    expect(reads.length).toBeGreaterThan(1);
    expect(getMock.mock.calls.every(([url]) => url === '/api/lumi/connections')).toBe(true);
    expect(onConnected).not.toHaveBeenCalled();
    await act(async () => reads.slice(0, -1).forEach(read => read.resolve({ data: confirmed })));
    expect(onConnected).not.toHaveBeenCalled();
    await act(async () => reads.at(-1).resolve({ data: confirmed }));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...confirmed, workspaceId: null },
    { ...confirmed, connections: [{ ...confirmed.connections[0], platform: 'GOOGLE' }] },
    { ...confirmed, connections: [] },
    { workspaceId: 'synthetic-workspace', connections: 'malformed' },
  ])('latest parsed non-confirmation cannot advance: %j', async (data) => {
    const onConnected = vi.fn(); render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    await act(async () => reads.at(-1).resolve({ data }));
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('unmount cancels the latest verification result', async () => {
    const onConnected = vi.fn(); const view = render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    view.unmount();
    await act(async () => reads.forEach(read => read.resolve({ data: confirmed })));
    expect(onConnected).not.toHaveBeenCalled();
  });
});
