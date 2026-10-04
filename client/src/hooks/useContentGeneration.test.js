import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.js';
import { useContentGeneration } from './useContentGeneration.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const params = {
  campaignContext: { name: 'Campaign', product: 'Product' },
  options: { copy: true }, tone: 'Warm', brandVoice: 'Brand',
  targetAudience: 'Audience', industry: 'Retail', objective: 'Sales',
  format: 'Square', dimensions: '1080×1080',
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
beforeEach(() => vi.clearAllMocks());

describe('useContentGeneration — request lifecycle without invented progress', () => {
  it('stays pending until the response and forwards unchanged request inputs', async () => {
    const request = deferred();
    api.post.mockReturnValue(request.promise);
    const { result } = renderHook(() => useContentGeneration());
    expect(result.current).toMatchObject({ content: null, loading: false, error: null });
    let pending;
    act(() => { pending = result.current.generate(params); });
    expect(result.current).toMatchObject({ content: null, loading: true, error: null });
    expect(result.current).not.toHaveProperty('progress');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/tools/content-generate', params);
    const content = { copy: [{ tag: 'STORY', text: 'Actual generated output' }], visual: null };
    await act(async () => { request.resolve({ data: { status: 'ok', content } }); await pending; });
    expect(result.current).toMatchObject({ content, loading: false, error: null });
    expect(result.current).not.toHaveProperty('progress');
  });

  it('preserves actual API failure, reset and explicit retry', async () => {
    const request = deferred();
    api.post.mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useContentGeneration());
    let pending;
    act(() => { pending = result.current.generate(params); });
    await act(async () => {
      request.reject({ response: { data: { message: 'Provider request refused' } } });
      await pending;
    });
    expect(result.current).toMatchObject({ loading: false, content: null, error: 'Provider request refused' });
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ loading: false, content: null, error: null });
    expect(api.post).toHaveBeenCalledTimes(1);
    api.post.mockResolvedValueOnce({ data: { status: 'ok', content: { headlines: ['Retry output'] } } });
    await act(async () => { await result.current.generate(params); });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(result.current.content.headlines).toEqual(['Retry output']);
  });

  it.each([
    { status: 'ok', content: null },
    { status: 'error', content: { copy: [] } },
  ])('does not publish success from an invalid response: %j', async (data) => {
    api.post.mockResolvedValueOnce({ data });
    const { result } = renderHook(() => useContentGeneration());
    await act(async () => { await result.current.generate(params); });
    expect(result.current).toMatchObject({
      content: null, loading: false, error: 'Invalid response format from server',
    });
  });
});
