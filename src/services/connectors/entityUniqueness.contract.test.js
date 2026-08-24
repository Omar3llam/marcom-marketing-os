// ============================================================
// R9 — the entity uniqueness contract, as declared
// ------------------------------------------------------------
// The runtime behaviour of `UNIQUE (workspaceId, channel, externalId)` cannot be
// asserted here: it lives in PostgreSQL, and this suite has no database. It WAS
// verified for real against a scratch database built from the full migration
// history — duplicate rejected (P2002), other workspace allowed, other channel
// allowed, two NULLs coexisting, a derived-id re-sync still upserting in place.
// See the R9 migration PR for that run.
//
// What this file can do, and what CI needs it to do, is guard the DECLARATION:
// the constraint exists on all five entity models, it is spelled with exactly
// the intended columns, the migration that creates it contains nothing else, and
// the frozen MetricSnapshot key was not altered while the schema was open.
//
// A constraint that quietly loses a column, or gains `level`, or is dropped in a
// later schema edit, still leaves every other test in this repo passing — the
// application derives ids through detId either way. That is exactly the failure
// this file exists to make loud.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../../..');
const schema = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');

/** The body of one `model X { … }` block. */
function modelBlock(name) {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, `model ${name} not found in schema.prisma`).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n}', start));
}

const ENTITY_MODELS = ['Account', 'Campaign', 'AdSet', 'Ad', 'Creative'];
const CONSTRAINT = '@@unique([workspaceId, channel, externalId])';

describe('R9 · every entity model declares DB-level canonical identity', () => {
  it.each(ENTITY_MODELS)('%s carries the uniqueness constraint', (model) => {
    expect(modelBlock(model)).toContain(CONSTRAINT);
  });

  it('declares it on exactly those five models — no more, no fewer', () => {
    const occurrences = schema.split(CONSTRAINT).length - 1;
    expect(occurrences).toBe(ENTITY_MODELS.length);
  });

  // `level` is deliberately absent: each model IS one level, so the model
  // supplies that dimension. Adding it would make the constraint vacuous —
  // every row in `campaign_entities` has the same level, so a tuple including
  // it can never collide differently, but it WOULD silently widen the key.
  it('does not include a level column', () => {
    for (const model of ENTITY_MODELS) {
      const block = modelBlock(model);
      expect(block).not.toContain('@@unique([workspaceId, channel, level, externalId])');
      expect(block).not.toContain('@@unique([workspaceId, channel, entityLevel, externalId])');
    }
  });

  // The identity tuple must not narrow. Dropping workspaceId would make one
  // platform id globally unique across tenants; dropping channel would collide
  // a Meta and a Google campaign that happen to share an id.
  it.each(ENTITY_MODELS)('%s constraint is not narrowed to a partial tuple', (model) => {
    const block = modelBlock(model);
    expect(block).not.toContain('@@unique([externalId])');
    expect(block).not.toContain('@@unique([workspaceId, externalId])');
    expect(block).not.toContain('@@unique([channel, externalId])');
  });
});

describe('R9 · the migration creates the constraint and nothing else', () => {
  const dir = readdirSync(resolve(ROOT, 'prisma/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith('_add_entity_canonical_uniqueness'))
    .map((d) => d.name);

  it('the R9 migration exists exactly once', () => {
    expect(dir).toHaveLength(1);
  });

  it('contains five CREATE UNIQUE INDEX statements over the five entity tables', () => {
    const sql = readFileSync(resolve(ROOT, 'prisma/migrations', dir[0], 'migration.sql'), 'utf8');
    const creates = sql.match(/CREATE UNIQUE INDEX/g) ?? [];
    expect(creates).toHaveLength(5);

    const tables = [...sql.matchAll(/ON "([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(['accounts', 'ad_sets', 'ads', 'campaign_entities', 'creatives']);
  });

  it('alters no table, drops nothing, and never overrides NULL semantics', () => {
    const sql = readFileSync(resolve(ROOT, 'prisma/migrations', dir[0], 'migration.sql'), 'utf8');
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/DROP/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ADD COLUMN/i);
    // NULLS NOT DISTINCT would make every legacy row with a null externalId
    // collide with every other one — the migration would fail on real data, and
    // it would also contradict I41's separation of "absent" from "fabricated".
    expect(sql).not.toMatch(/NULLS NOT DISTINCT/i);
  });
});

describe('R9 · frozen keys were not touched while the schema was open', () => {
  // R9 §13 defers MetricSnapshot uniqueness explicitly. The temptation while
  // editing this file is to "also fix" the missing workspaceId — which would
  // change the identity of every canonical observation and the DAILY race with
  // it. Deferred means deferred, and this pins it.
  it('MetricSnapshot keeps its six-column natural key, without workspaceId', () => {
    // The columns, their order, and the absence of workspaceId are what this
    // control is about, and all three are still asserted exactly.
    //
    // B4-E5 moved WHERE they are declared. The deployed identity is now a PARTIAL
    // index (WHERE "measurementWindow" <> 'DAILY') so that DAILY observations
    // stop colliding on a shared sync timestamp, and Prisma cannot express an
    // index predicate — so the `@@unique` is gone from the model and the key
    // lives in 20260824000000_b4e5_non_daily_partial_identity. The temptation
    // this control was written against is unchanged: adding workspaceId would
    // change the identity of every canonical observation.
    const sql = readFileSync(resolve(
      ROOT, 'prisma/migrations/20260824000000_b4e5_non_daily_partial_identity/migration.sql',
    ), 'utf8');
    expect(sql).toContain('ON "metric_snapshots" ("entityId", "entityLevel", "date", "granularity", "source", "measurementWindow")');
    expect(sql).not.toContain('"workspaceId", "entityId", "entityLevel", "date", "granularity", "source", "measurementWindow"');
    // A DECLARATION, not the word — the block's comments explain why it is gone.
    expect(modelBlock('MetricSnapshot')).not.toMatch(/^\s*@@unique\(/m);
  });

  it('SC-1 · CampaignState was never unified with the entity graph — it was removed', () => {
    // This used to assert that the legacy model kept its own
    // @@unique([campaignId, workspaceId]), pinning the fact that R9 did not
    // quietly fold a health-snapshot table into the connector entity graph.
    //
    // SC-1 dropped the model after production measured 0 rows, so the original
    // form has no block to read. The guarantee it defended is not that the key
    // exists — it is that the entity graph did not ABSORB the legacy shape on
    // the way out, which is the failure mode a removal invites: a
    // stage/healthScore pair reappearing on Campaign so "nothing is lost".
    expect(schema).not.toMatch(/^model CampaignState \{/m);
    const campaign = modelBlock('Campaign');
    expect(campaign).not.toMatch(/\bstage\b/);
    expect(campaign).not.toMatch(/\bhealthScore\b/);
    expect(campaign).not.toMatch(/\blastAnalysis\b/);
  });
});
