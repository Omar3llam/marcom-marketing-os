// ============================================================
// useRecordPublish Hook Tests — manual Meta publish recording
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecordPublish } from './useRecordPublish.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: { post: vi.fn() },
}));

/** Build a mapped-domain-error shape (what the api client rejects with). */
function domainError({ httpStatus, message, details }) {
  return Object.assign(new Error(message || 'err'), {
    httpStatus,
    context: details ? { details } : undefined,
  });
}

describe('useRecordPublish', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts the entered IDs and exposes the created PublishedCreative', async () => {
    const created = { id: 'pub-1', metaAdId: 'ad-1' };
    api.post.mockResolvedValueOnce({ data: { publishedCreative: created } });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useRecordPublish({ onSuccess }));

    let returned;
    await act(async () => {
      returned = await result.current.recordPublish('artifact-1', {
        metaAdId: ' ad-1 ',
        metaCampaignId: 'camp-1',
        metaAdsetId: '',
        adName: '',
      });
    });

    // Trimmed required fields; empty optionals omitted (schema allows null).
    expect(api.post).toHaveBeenCalledWith('/api/attribution/publish', {
      artifactId: 'artifact-1',
      metaAdId: 'ad-1',
      metaCampaignId: 'camp-1',
      metaAdsetId: undefined,
      adName: undefined,
    });
    expect(returned).toEqual(created);
    expect(result.current.published).toEqual(created);
    expect(result.current.error).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith(created);
  });

  it('maps a 409 to a specific "already linked" message', async () => {
    api.post.mockRejectedValueOnce(domainError({ httpStatus: 409 }));
    const { result } = renderHook(() => useRecordPublish());

    await act(async () => {
      await expect(
        result.current.recordPublish('a', { metaAdId: 'ad-1', metaCampaignId: 'camp-1' })
      ).rejects.toBeTruthy();
    });

    expect(result.current.error).toMatch(/already linked/i);
    expect(result.current.published).toBeNull();
  });

  it('maps a 403 to a permission message', async () => {
    api.post.mockRejectedValueOnce(domainError({ httpStatus: 403 }));
    const { result } = renderHook(() => useRecordPublish());

    await act(async () => {
      await expect(
        result.current.recordPublish('a', { metaAdId: 'ad-1', metaCampaignId: 'camp-1' })
      ).rejects.toBeTruthy();
    });

    expect(result.current.error).toMatch(/permission|Buyer or Strategist/i);
  });

  it('surfaces the server validation text on a 400', async () => {
    api.post.mockRejectedValueOnce(
      domainError({ httpStatus: 400, details: { error: 'Missing required fields: artifactId, metaAdId, metaCampaignId' } })
    );
    const { result } = renderHook(() => useRecordPublish());

    await act(async () => {
      await expect(
        result.current.recordPublish('a', { metaAdId: '', metaCampaignId: '' })
      ).rejects.toBeTruthy();
    });

    expect(result.current.error).toMatch(/Missing required fields/i);
  });

  it('reset() clears error and published', async () => {
    api.post.mockRejectedValueOnce(domainError({ httpStatus: 409 }));
    const { result } = renderHook(() => useRecordPublish());

    await act(async () => {
      await result.current.recordPublish('a', { metaAdId: 'ad-1', metaCampaignId: 'camp-1' }).catch(() => {});
    });
    expect(result.current.error).toBeTruthy();

    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.published).toBeNull();
  });
});
