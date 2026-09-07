// ============================================================
// FE-03 — the client no longer calls GET /api/lumi/feed
// ------------------------------------------------------------
// S1-B deleted the `campaigns` array from that response. What was left in the
// client's only reader (`useIntelligenceData`) was two fields:
//
//   campaigns           deleted server-side       → [] for every workspace
//   fatiguePredictions  threaded through useCampaignFeed and destructured
//                       by NOBODY; the live fatigue panel reads
//                       GET /api/lumi/entities/fatigue instead
//
// So the whole request was a round trip whose output never reached a pixel —
// the identical shape R7 removed the feed's `memory` field for, and that hook's
// own comment says so. Its failure still gated Attention's honesty signal
// (see useOverviewModel.substrates.test.jsx), which is how a fetch nobody
// consumes could still make the page claim it could not read the account.
//
// A CENSUS, not a spot check. A grep aimed at the files I happened to think of
// is the instrument FE-01 measured as inadequate — it found 8 of 60. This globs
// every source file Vite can see and asks the general question.
//
// ⚠️ THE FIRST VERSION OF THIS CENSUS WAS WRONG IN BOTH DIRECTIONS, and each
// error is now a control below:
//   · FALSE POSITIVE — `contracts/errors/ApiError.ts` carries
//     `await api.get('/api/lumi/feed')` inside a DOC COMMENT. A literal-matching
//     regex reported it as a caller.
//   · FALSE NEGATIVE — `CampaignFeedContext.jsx` called `api.get(PRIMARY)`
//     where `const PRIMARY = '/api/lumi/feed'`. A literal-at-the-call-site
//     regex cannot see a call made through a constant, so the census would have
//     reported "zero call sites" while one stood two lines away from the string.
//
// SCOPE, stated rather than implied. `contracts/` still holds the feed's schema,
// adapter and TypeScript types, and `src/tests/mocks/handlers.ts` still mocks
// the endpoint. Those are declarations and fixtures, not calls; their fate is
// FE-06's contract sweep under LOCK 2. This asserts about CALL SITES.
// ============================================================
import { describe, it, expect } from 'vitest';

const ENDPOINT = '/api/lumi/feed';

// Strips // lines and /* */ spans so an endpoint named in prose is not read as
// a call. Same defect class the FE-02 trunk verifier hit from the other side.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const HTTP_CALL = /\b(?:api|axios)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/;
const DIRECT = new RegExp(
  String.raw`\b(?:api|axios)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"\`][^'"\`]*` + ENDPOINT,
);

/**
 * Does this module CALL the endpoint? Two ways it can, and the second is the
 * one a literal regex misses:
 *   1. the path written at the call site
 *   2. the path bound to a name, and the name passed to the call
 * (2) is approximated by "this module names the endpoint in live code AND makes
 * HTTP calls" — which is why a schema or a type file naming it does not count.
 */
export function callsEndpoint(rawSource) {
  const src = stripComments(rawSource);
  if (DIRECT.test(src)) return true;
  return src.includes(ENDPOINT) && HTTP_CALL.test(src);
}

// ── The instrument proves itself before it is believed ──────────────────────
describe('FE-03 · the detector', () => {
  it('finds the path written at the call site', () => {
    expect(callsEndpoint(`const r = await api.get('/api/lumi/feed', { signal });`)).toBe(true);
  });

  it('finds a call made through a CONSTANT — the miss that would have passed', () => {
    expect(callsEndpoint(`const PRIMARY = '/api/lumi/feed';\nconst r = await api.get(PRIMARY);`)).toBe(true);
  });

  it('does NOT count the endpoint named in a doc comment — the false positive', () => {
    expect(callsEndpoint(`/**\n * @example\n *   const r = await api.get('/api/lumi/feed');\n */\nexport class ApiError {}`)).toBe(false);
    expect(callsEndpoint(`// const r = await api.get('/api/lumi/feed');\nexport const x = 1;`)).toBe(false);
  });

  it('does NOT count a schema or type that merely names it', () => {
    expect(callsEndpoint(`export const FeedSchema = z.object({ workspaceId: z.string() }); // ${ENDPOINT}`)).toBe(false);
    expect(callsEndpoint(`export interface FeedResponse { workspaceId: string }\nconst path = '${ENDPOINT}';`)).toBe(false);
  });

  it('is not fooled by a DIFFERENT lumi endpoint', () => {
    expect(callsEndpoint(`await api.get('/api/lumi/entities/campaigns');`)).toBe(false);
  });
});

// eager + ?raw: every module's source text, resolved by Vite itself rather than
// by a path guess from the test file.
const sources = import.meta.glob('/src/**/*.{js,jsx,ts,tsx}', { query: '?raw', import: 'default', eager: true });
const isProductionModule = (p) => !/\.test\.|__tests__\/|^\/src\/tests\//.test(p);

describe('FE-03 · the census itself', () => {
  it('actually loaded the client source tree', () => {
    // A glob that silently resolved nothing makes every finding below vacuous.
    expect(Object.keys(sources).length).toBeGreaterThan(200);
  });

  it('can still find a live endpoint that IS called', () => {
    const found = Object.entries(sources).filter(([, s]) =>
      /\bapi\s*\.\s*get\s*\(\s*['"`][^'"`]*\/api\/lumi\/entities\/campaigns/.test(stripComments(s)));
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('FE-03 · no client module calls the retired feed', () => {
  it('has zero call sites', () => {
    const callers = Object.entries(sources)
      .filter(([p]) => isProductionModule(p))
      .filter(([, s]) => callsEndpoint(s))
      .map(([p]) => p)
      .sort();
    expect(callers).toEqual([]);
  });
});

describe('FE-03 · the retired chain is gone, not merely unused', () => {
  const has = (p) => Object.keys(sources).some((k) => k.endsWith(p));

  it.each([
    ['/src/hooks/useCampaignFeed.js'],
    ['/src/hooks/useIntelligenceData.js'],
    ['/src/context/IntelligenceContext.jsx'],
    ['/src/context/CampaignFeedContext.jsx'],
  ])('%s no longer exists', (path) => {
    expect(has(path)).toBe(false);
  });
});
