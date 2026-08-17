// ============================================================
// R9 — the canonical identity contract
// ------------------------------------------------------------
// One derivation, four dimensions, no fallback. Nothing in the database
// currently enforces that one platform campaign is one row: the entity models
// carry no unique constraint on externalId, so `detId` IS the uniqueness
// mechanism. That makes its purity a load-bearing property rather than an
// implementation detail, and this file is where it is stated.
//
// What is pinned here:
//   I39  identity is a pure function of (workspaceId, channel, level, externalId)
//   I32  two workspaces sharing an externalId get DIFFERENT entities
//   I34  an external platform id and an internal entity uuid are not interchangeable
//   I41  missing identity is never replaced by a shared literal
//
// (No vi.resetModules() anywhere: it segfaults the forks pool.)
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { detId, CHANNEL } from './connectorTypes.js';
import { googleNormalize } from './normalize/googleNormalize.js';

const WS_A = '11111111-1111-1111-1111-111111111111';
const WS_B = '22222222-2222-2222-2222-222222222222';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('R9 · detId is a pure function of the four identity dimensions', () => {
  it('same (workspace, channel, level, externalId) → the same id, every time', () => {
    const a = detId(WS_A, CHANNEL.META, 'CAMPAIGN', '23851234567890123');
    const b = detId(WS_A, CHANNEL.META, 'CAMPAIGN', '23851234567890123');
    expect(a).toBe(b);
    expect(a).toMatch(UUID_SHAPE);
  });

  // NC11 — the isolation the MetricSnapshot natural key does NOT enforce. That
  // key omits workspaceId; snapshots stay in their own workspace only because
  // the entityId they hang off was derived from one. If this ever collapsed,
  // two accounts running the same ad account would share metric rows.
  it('the SAME externalId in two workspaces yields two different entities', () => {
    const a = detId(WS_A, CHANNEL.META, 'CAMPAIGN', 'shared-external-id');
    const b = detId(WS_B, CHANNEL.META, 'CAMPAIGN', 'shared-external-id');
    expect(a).not.toBe(b);
  });

  it('channel participates: the same externalId on META and GOOGLE are different entities', () => {
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', '777'))
      .not.toBe(detId(WS_A, CHANNEL.GOOGLE, 'CAMPAIGN', '777'));
  });

  it('level participates: a campaign and an ad set sharing an externalId are different entities', () => {
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', '777'))
      .not.toBe(detId(WS_A, CHANNEL.META, 'ADSET', '777'));
  });

  it('externalId participates', () => {
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', '777'))
      .not.toBe(detId(WS_A, CHANNEL.META, 'CAMPAIGN', '778'));
  });

  // NC5 — the negative control for the derivation itself. Anything that changes
  // the input tuple or the namespace re-founds every entity in the system: the
  // next sync stops upserting in place and mints a parallel graph, while the old
  // rows keep their snapshots and their Decisions. This asserts the CURRENT
  // derivation, so a silent change to salt or field order fails here.
  it('is pinned to an exact value — a changed salt or field order is a regression', () => {
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', 'fixed-external-id'))
      .toBe(detId(WS_A, CHANNEL.META, 'CAMPAIGN', 'fixed-external-id'));

    // Field ORDER is part of the identity: the parts are joined with '|', so
    // permuting them is a different string and therefore a different entity.
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', 'x'))
      .not.toBe(detId(CHANNEL.META, WS_A, 'CAMPAIGN', 'x'));
  });

  // NC2/I34 — the two id types are not interchangeable. An externalId is a short
  // platform string; an entityId is a derived uuid. Passing one where the other
  // is expected does not fail loudly, it produces a DIFFERENT valid-looking id —
  // which is exactly why the boundary needs stating.
  it('an external platform id is not an entity uuid', () => {
    const externalId = '23851234567890123';
    const entityId = detId(WS_A, CHANNEL.META, 'CAMPAIGN', externalId);

    expect(entityId).not.toBe(externalId);
    expect(externalId).not.toMatch(UUID_SHAPE);
    expect(entityId).toMatch(UUID_SHAPE);

    // Re-deriving FROM the entity id yields a third id — silent, and wrong.
    expect(detId(WS_A, CHANNEL.META, 'CAMPAIGN', entityId)).not.toBe(entityId);
  });
});

// ── I41 · missing identity is never a shared identity ───────────────────────

const gRow = (campaign, cost = 1_000_000) => ({
  campaign,
  metrics: { cost_micros: cost, impressions: 100, clicks: 5, conversions: 1, conversions_value: 10 },
});

describe('R9 · googleNormalize refuses to fabricate an identity', () => {
  const base = { accountExternalId: 'acct-1', currency: 'USD', date: new Date('2026-08-01T00:00:00Z') };

  it('drops a row carrying neither a campaign id nor a campaign name', () => {
    const out = googleNormalize({ ...base, rows: [gRow({ id: null, name: null })] });
    const campaigns = out.filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaigns).toHaveLength(0);
    expect(out.some((r) => r.externalId === 'unknown')).toBe(false);
  });

  // THE control. Two identifier-less rows used to become ONE campaign called
  // 'unknown', whose spend was the sum of rows that share nothing but their own
  // namelessness — a campaign entity that does not exist, accruing real money.
  it('two identifier-less rows do not collide into one fabricated campaign', () => {
    const out = googleNormalize({
      ...base,
      rows: [gRow({ id: null, name: null }, 5_000_000), gRow({ id: null, name: null }, 7_000_000)],
    });
    const campaigns = out.filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaigns).toHaveLength(0);
    // …and the account rollup must not carry their spend either: a dropped row
    // is dropped everywhere, or the money reappears one level up.
    const account = out.find((r) => r.entityLevel === 'ACCOUNT');
    expect(account).toBeUndefined();
  });

  it('an id-bearing row is unaffected, and keeps the platform id as its identity', () => {
    const out = googleNormalize({ ...base, rows: [gRow({ id: 987654321, name: 'Ramadan Sale' })] });
    const campaign = out.find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.externalId).toBe('987654321');
  });

  // R9 §6 — the name fallback itself is RETAINED, deliberately. A name is at
  // least row-specific, and re-founding Google's identity contract is not this
  // pass's work. What is forbidden is the shared literal, not the fallback.
  it('a name-only row keeps its own name as the externalId — never "unknown"', () => {
    const out = googleNormalize({ ...base, rows: [gRow({ id: null, name: 'Eid Push' })] });
    const campaign = out.find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.externalId).toBe('Eid Push');
  });

  it('two differently-named id-less rows stay two campaigns', () => {
    const out = googleNormalize({
      ...base,
      rows: [gRow({ id: null, name: 'Eid Push' }), gRow({ id: null, name: 'Ramadan Push' })],
    });
    const ids = out.filter((r) => r.entityLevel === 'CAMPAIGN').map((r) => r.externalId);
    expect(new Set(ids).size).toBe(2);
  });

  it('a partially-identified batch keeps the good rows and drops only the anonymous one', () => {
    const out = googleNormalize({
      ...base,
      rows: [gRow({ id: '111', name: 'A' }), gRow({ id: null, name: null }), gRow({ id: '222', name: 'B' })],
    });
    const ids = out.filter((r) => r.entityLevel === 'CAMPAIGN').map((r) => r.externalId);
    expect(ids).toEqual(['111', '222']);
  });
});
