// ============================================================
// decisionSignals — telemetry that can never break the click
// ------------------------------------------------------------
// These record that a human engaged with a verdict. They are worth having and
// worth losing: a 404 (no live decision) and a 403 (a read-only CLIENT seat)
// are both normal, and neither may surface to the user or block the action they
// actually took.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/api/client', () => ({ api: { patch } }));

import { recordExplain, recordIntent } from './decisionSignals.js';

const ENTITY = 'c1c1c1c1-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockResolvedValue({ data: { ok: true, recorded: true } });
});

describe('the two signals hit their own endpoints', () => {
  it('explain', async () => {
    await recordExplain(ENTITY);
    expect(patch).toHaveBeenCalledWith(`/api/lumi/decisions/by-entity/${ENTITY}/explain`);
  });

  it('intent', async () => {
    await recordIntent(ENTITY);
    expect(patch).toHaveBeenCalledWith(`/api/lumi/decisions/by-entity/${ENTITY}/intent`);
  });

  it('returns the server payload on success', async () => {
    await expect(recordExplain(ENTITY)).resolves.toMatchObject({ ok: true, recorded: true });
  });

  // The id lands in a URL path; a stray character must not change which route
  // is hit.
  it('encodes the entity id', async () => {
    await recordIntent('a/b?c');
    expect(patch).toHaveBeenCalledWith('/api/lumi/decisions/by-entity/a%2Fb%3Fc/explain'.replace('explain', 'intent'));
  });
});

describe('best-effort by construction', () => {
  it.each([
    ['a 404 — no live decision', { response: { status: 404 } }],
    ['a 403 — a read-only CLIENT seat', { response: { status: 403 } }],
    ['a network failure', new Error('offline')],
    ['a 500', { response: { status: 500 } }],
  ])('%s resolves null instead of rejecting', async (_label, err) => {
    patch.mockRejectedValue(err);
    await expect(recordIntent(ENTITY)).resolves.toBeNull();
  });

  it.each([[null], [undefined], ['']])('a missing entity id (%s) sends nothing', async (id) => {
    await expect(recordExplain(id)).resolves.toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  // A rejected promise is only half the exposure. If the client is unavailable
  // the call throws BEFORE any promise exists, and a bare .catch cannot see it —
  // that threw straight through handleCopy and stuck the Copy button.
  it('a synchronous throw is contained too, not just a rejection', async () => {
    patch.mockImplementation(() => { throw new TypeError('api.patch is not a function'); });
    await expect(recordIntent(ENTITY)).resolves.toBeNull();
  });
});
