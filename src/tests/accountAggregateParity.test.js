// ============================================================
// PARITY-01 · the client's vocabulary is the server's vocabulary
// ------------------------------------------------------------
// THE PROPERTY
//
//   Every word `AccountAggregateService` can put on the wire is a word the
//   client contract admits, and the client admits no word the server cannot
//   say.
//
// This is the `published → parsed` link of the close-out gate, made executable
// across the boundary. It exists because of B8-01: the client's zod enums do
// not reject one field, they fail the parse and take the whole surface with
// them. So the day someone adds a fourth UNAVAILABLE reason, or a seventh
// verdict, this test fails in CI — instead of the KPI strip going blank in a
// browser with a console error nobody is watching.
//
// It runs BOTH directions for the same reason FE-06's baselines do: a
// one-directional check lets the client keep a word the server retired, which
// is a contract claiming something that is no longer true.
//
// The server side is imported (it is this repo's own module). The client side is
// READ AS TEXT — the backend suite has no TS transform, and a text read is
// honest as long as the extractor is proved, which is what the controls below
// are for.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UNAVAILABLE,
  CURRENCY_STATUS,
  BOUNDS_STATUS,
  AGGREGATION_LEVEL,
} from '../services/analysis/AccountAggregateService.js';
import { VERDICT } from '../services/verdict-engine/verdictTypes.js';

const SCHEMA_PATH = join(
  process.cwd(),
  'client', 'src', 'contracts', 'schemas', 'accountAggregate.schema.ts',
);
const source = readFileSync(SCHEMA_PATH, 'utf8');

/** Members of `export const <name> = z.enum([...])`, as declared by the client. */
function enumMembers(name) {
  const m = source.match(new RegExp(name + '\\s*=\\s*z\\.enum\\(\\[([^\\]]*)\\]'));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Keys of `export const <name> = z.object({ … })`, to the first closing brace. */
function objectKeys(name) {
  const m = source.match(new RegExp(name + '\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\n\\}\\)'));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]);
}

const same = (a, b) => expect([...a].sort()).toEqual([...b].sort());

describe('PARITY-01 · the account-aggregate vocabulary crosses the boundary intact', () => {
  // ── controls, declared before any finding is read ─────────────────────────
  it('the extractor works, and can fail', () => {
    expect(source.length).toBeGreaterThan(500);           // the file was really read
    expect(enumMembers('CurrencyStatusSchema')).toContain('MIXED');
    expect(enumMembers('ZzzNotASchema')).toBeNull();      // a fiction is not found
    expect(enumMembers('CurrencyStatusSchema')).not.toContain('ZZZ_NOT_A_STATUS');
    expect(objectKeys('VerdictCountsSchema')).toContain('KILL');
    expect(objectKeys('ZzzNotASchema')).toBeNull();
  });

  it('every UNAVAILABLE reason the service can emit is admitted', () => {
    same(enumMembers('AggregateUnavailableSchema'), Object.values(UNAVAILABLE));
  });

  it('every CURRENCY_STATUS is admitted', () => {
    same(enumMembers('CurrencyStatusSchema'), Object.values(CURRENCY_STATUS));
  });

  it('every BOUNDS_STATUS is admitted', () => {
    same(enumMembers('BoundsStatusSchema'), Object.values(BOUNDS_STATUS));
  });

  it('the verdict lanes are the verdict taxonomy, plus the unverdicted lane', () => {
    // `unverdicted` is the service's own extra key — a campaign with no verdict
    // still spent money, and it may not be dropped from a total that claims to
    // reconcile against the rows.
    same(objectKeys('VerdictCountsSchema'), [...Object.values(VERDICT), 'unverdicted']);
  });

  it('the aggregation level is pinned to the one the service fixes', () => {
    // CAMPAIGN, and never two levels summed: an ad-set's spend is a SUBSET of
    // its campaign's. The client pins it as a literal so a change is a parse
    // failure here rather than a double count on a screen.
    expect(source).toContain(`z.literal('${AGGREGATION_LEVEL}')`);
  });

  it('the empty-state reason the route publishes is the one the client branches on', () => {
    const routeSource = readFileSync(join(process.cwd(), 'src', 'routes', 'lumi', 'account.js'), 'utf8');
    expect(routeSource).toContain("reason: 'NO_CANONICAL_MEASUREMENT'");
    const readingSource = readFileSync(
      join(process.cwd(), 'client', 'src', 'lib', 'accountAggregate.js'), 'utf8',
    );
    expect(readingSource).toContain('NO_CANONICAL_MEASUREMENT');
  });
});
