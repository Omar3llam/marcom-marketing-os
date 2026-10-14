import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCampaignInsights, fetchAllCampaigns } from './metaAdsService.js';

// The service loads the CJS SDK with createRequire. Spy on that SAME module,
// not an ESM mock the service cannot see. The configured network guard stays on.
const { AdAccount, FacebookAdsApi } = createRequire(import.meta.url)('facebook-nodejs-business-sdk');
afterEach(() => vi.restoreAllMocks());

function cursorFor(pages) {
  let index = 0;
  const cursor = [];
  const load = () => cursor.splice(0, cursor.length, ...pages[index].map((row) => ({ _data: row })));
  load();
  cursor.hasNext = () => index < pages.length - 1;
  cursor.next = vi.fn(async () => { index += 1; load(); return cursor; });
  return cursor;
}

describe.each([
  ['campaign insights', fetchCampaignInsights, 'getInsights'],
  ['campaign roster', fetchAllCampaigns, 'getCampaigns'],
])('%s completeness retains the legacy array contract', (_label, fetchRows, method) => {
  function stub(cursor) {
    vi.spyOn(FacebookAdsApi, 'init').mockReturnValue({ setDebug: vi.fn() });
    return vi.spyOn(AdAccount.prototype, method).mockResolvedValue(cursor);
  }

  it('reports MAX_PAGES truncation while retaining every collected row', async () => {
    const pages = Array.from({ length: 51 }, (_, i) => [{ id: String(i), spend: '2.30' }]);
    const cursor = cursorFor(pages);
    const provider = stub(cursor);
    const rows = await fetchRows('synthetic-token', 'act_fixture');
    expect(rows).toEqual(pages.slice(0, 50).flat());
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.fetchMeta).toEqual({ pages: 50, truncated: true });
    expect(cursor.next).toHaveBeenCalledTimes(49);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(Object.keys(rows)).not.toContain('fetchMeta');
    expect(JSON.parse(JSON.stringify(rows))).toEqual([...rows]);
    expect(Object.isFrozen(rows.fetchMeta)).toBe(true);
  });

  it.each([1, 3, 50])('exhausting %i pages reports no truncation, even at the cap', async (count) => {
    const pages = Array.from({ length: count }, (_, i) => [{ id: String(i) }]);
    stub(cursorFor(pages));
    const rows = await fetchRows('synthetic-token', 'act_fixture');
    expect(rows).toEqual(pages.flat());
    expect(rows.fetchMeta).toEqual({ pages: count, truncated: false });
  });

  it('complete empty is an observed empty array, not a failure', async () => {
    stub(cursorFor([[]]));
    const rows = await fetchRows('synthetic-token', 'act_fixture');
    expect(rows).toEqual([]);
    expect(rows.fetchMeta).toEqual({ pages: 1, truncated: false });
  });

  it('provider and next-page failures still throw, never become complete empty', async () => {
    const provider = stub(cursorFor([[]]));
    provider.mockRejectedValueOnce(new Error('primary unavailable'));
    await expect(fetchRows('synthetic-token', 'act_fixture')).rejects.toThrow('primary unavailable');
    const cursor = cursorFor([[{ id: '1' }], [{ id: '2' }]]);
    cursor.next.mockRejectedValue(new Error('page unavailable'));
    provider.mockResolvedValueOnce(cursor);
    await expect(fetchRows('synthetic-token', 'act_fixture')).rejects.toThrow('page unavailable');
  });
});
