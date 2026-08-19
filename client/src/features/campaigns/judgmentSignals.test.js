// ============================================================
// judgmentSignals — the exact bytes that reach the server
// ------------------------------------------------------------
// This is the assertion NC8 protects. A test that only checked "a PATCH
// happened" would pass against a body with a mistyped key, a label instead of
// an enum code, or an empty-string note — all of which the server rejects with
// a 400 the operator cannot act on. So every case pins the URL AND the whole
// body object, by equality, not by containment.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const patch = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: { ok: true } })));
vi.mock('@/lib/api.js', () => ({ api: { patch } }));

const { recordJudgment } = await import('./judgmentSignals.js');

const ID = 'dec_0f4c';
const URL_FOR = (id = ID) => `/api/lumi/decisions/${id}/judgment`;

beforeEach(() => patch.mockClear());

describe('exact payloads', () => {
  it('CONFIRM sends the response and NOTHING else', async () => {
    await recordJudgment(ID, { response: 'CONFIRM' });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(URL_FOR(), { response: 'CONFIRM' });
  });

  it('OVERRIDE sends the response and the canonical reason CODE', async () => {
    await recordJudgment(ID, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' });
    // The stored value, never the label. 'Top-of-funnel role' is not a member of
    // the enum and would be refused.
    expect(patch).toHaveBeenCalledWith(URL_FOR(), { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' });
  });

  it('ADJUST sends the response and the reason code', async () => {
    await recordJudgment(ID, { response: 'ADJUST', reasonCode: 'SEASONALITY' });
    expect(patch).toHaveBeenCalledWith(URL_FOR(), { response: 'ADJUST', reasonCode: 'SEASONALITY' });
  });

  it('carries a real note verbatim, trimmed', async () => {
    await recordJudgment(ID, { response: 'OVERRIDE', reasonCode: 'BRAND_ROLE', reasonNote: '  brand push  ' });
    expect(patch).toHaveBeenCalledWith(URL_FOR(), {
      response: 'OVERRIDE', reasonCode: 'BRAND_ROLE', reasonNote: 'brand push',
    });
  });
});

describe('what is deliberately NOT sent', () => {
  it('omits a blank note rather than sending an empty string', async () => {
    await recordJudgment(ID, { response: 'OVERRIDE', reasonCode: 'OTHER', reasonNote: '   ' });
    expect(patch).toHaveBeenCalledWith(URL_FOR(), { response: 'OVERRIDE', reasonCode: 'OTHER' });
  });

  it('omits an absent reason rather than sending null', async () => {
    await recordJudgment(ID, { response: 'CONFIRM', reasonCode: null, reasonNote: null });
    expect(patch).toHaveBeenCalledWith(URL_FOR(), { response: 'CONFIRM' });
  });

  it('never sends verdict, status, executedAt or dismissedAt', async () => {
    await recordJudgment(ID, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE', reasonNote: 'x' });
    const body = patch.mock.calls[0][1];
    // The judgement axis writes four columns and touches nothing else. A body
    // that carried a verdict would let a UI rewrite what Lumi said.
    expect(Object.keys(body).sort()).toEqual(['reasonCode', 'reasonNote', 'response']);
  });
});

describe('routing', () => {
  it('addresses ONE decision by id — there is no by-entity fallback', async () => {
    await recordJudgment('dec/with space', { response: 'CONFIRM' });
    expect(patch.mock.calls[0][0]).toBe('/api/lumi/decisions/dec%2Fwith%20space/judgment');
  });

  it('rejects without a decisionId instead of requesting /undefined/judgment', async () => {
    await expect(recordJudgment(null, { response: 'CONFIRM' })).rejects.toThrow(/decisionId/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('propagates a server rejection — it never swallows', async () => {
    patch.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(recordJudgment(ID, { response: 'CONFIRM' })).rejects.toBeTruthy();
  });
});
