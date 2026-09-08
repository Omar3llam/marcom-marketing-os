// ============================================================
// ACROSS · Tier 1 — the network vocabulary crosses the boundary intact
// ------------------------------------------------------------
// RULING (Omar): "الـclient contract لازم يكون قادر يستقبل vocabulary المنشورة
// من الـserver، مش يعرّف vocabulary بديلة من عنده."
//
// The client had defined its own. Measured on trunk before this slice:
//
//     server publishes (response level)   OK · NOT_CONSENTED · UNAVAILABLE
//     client admitted                     OK · NOT_CONSENTED · INSUFFICIENT_DATA
//
// Wrong in BOTH directions — it accepted a value the service never sends at
// response level, and rejected one it sends on two paths. UNAVAILABLE is not an
// edge case: `NetworkService.js` returns it for a CONSENTED workspace whose
// cohort cannot be established, and the briefing route returns it when the
// network read fails. Either way `BriefingSchema` failed, and the hook's
// salvage turned that into a silent, error-less fabrication.
//
// ── WHY THIS IS MEASURED AND NOT LISTED ─────────────────────────────────────
// The response-level set is EXTRACTED from the two files that publish it rather
// than typed out here. A hand-written list is a second declaration of the same
// vocabulary, which is the defect this test exists to catch.
//
// The insight level is a DIFFERENT vocabulary with a different publisher
// (`networkEngine.js`), and conflating the two is how INSUFFICIENT_DATA came to
// sit in a response-level enum. They are extracted separately, from their own
// publishers, and asserted to differ.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NETWORK_STATUS, NETWORK_KNOWLEDGE } from '../services/network-engine/networkTypes.js';

const read = (...p) => readFileSync(join(process.cwd(), ...p), 'utf8');

const SERVICE = read('src', 'services', 'network-engine', 'NetworkService.js');
const ROUTE = read('src', 'routes', 'lumi', 'memory.js');
const ENGINE = read('src', 'services', 'network-engine', 'networkEngine.js');
const SCHEMA = read('client', 'src', 'contracts', 'schemas', 'networkInsight.schema.ts');

/** Every `NETWORK_STATUS.X` a source actually names. */
function published(source) {
  return [...source.matchAll(/status:\s*NETWORK_STATUS\.(\w+)/g)].map((m) => m[1]);
}

/** Members of `export const <name> = z.enum([...])`, as the client declares them. */
function enumMembers(name) {
  const m = SCHEMA.match(new RegExp(name + '\\s*=\\s*z\\.enum\\(\\[([^\\]]*)\\]'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
}

const uniq = (a) => [...new Set(a)].sort();

// The response level has two publishers: the service, and the route's own catch.
const SERVER_RESPONSE = uniq([...published(SERVICE), ...published(ROUTE)]);
const SERVER_INSIGHT = uniq(published(ENGINE));

describe('ACROSS · the extractors work, and can fail', () => {
  it('reads real sources and finds real tokens', () => {
    expect(SERVICE.length).toBeGreaterThan(500);
    expect(SCHEMA.length).toBeGreaterThan(200);
    expect(SERVER_RESPONSE).toContain('UNAVAILABLE');
    expect(SERVER_INSIGHT).toContain('INSUFFICIENT_DATA');
  });

  it('and does not find fiction', () => {
    expect(published('status: NETWORK_STATUS.')).toEqual([]);
    expect(SERVER_RESPONSE).not.toContain('ZZZ_NOT_A_STATUS');
    expect(enumMembers('ZzzNotASchema')).toBeNull();
  });

  it('the two levels are genuinely different vocabularies', () => {
    // If these ever coincide the split below proves nothing, and the test
    // would pass for the wrong reason.
    expect(SERVER_RESPONSE).not.toEqual(SERVER_INSIGHT);
    expect(SERVER_RESPONSE).toContain('NOT_CONSENTED');
    expect(SERVER_INSIGHT).not.toContain('NOT_CONSENTED');
  });
});

describe('ACROSS · the client admits what the server publishes, and no more', () => {
  it('the response status enum equals the set the server can send', () => {
    expect([...enumMembers('NetworkResponseStatusSchema')].sort()).toEqual(SERVER_RESPONSE);
  });

  it('the insight status enum equals the set the engine can emit', () => {
    expect([...enumMembers('NetworkInsightStatusSchema')].sort()).toEqual(SERVER_INSIGHT);
  });

  it('INSUFFICIENT_DATA is not a response-level status', () => {
    // It is a finding about a COHORT, published per insight. Accepting it at
    // response level is what made the client believe its vocabulary was
    // complete while UNAVAILABLE was missing.
    expect(SERVER_RESPONSE).not.toContain('INSUFFICIENT_DATA');
    expect(enumMembers('NetworkResponseStatusSchema')).not.toContain('INSUFFICIENT_DATA');
  });

  it('every status the server can publish carries a C-06 knowledge token', () => {
    for (const s of [...SERVER_RESPONSE, ...SERVER_INSIGHT]) {
      expect(NETWORK_KNOWLEDGE.knowledgeOf(NETWORK_STATUS[s])).toBeTruthy();
    }
  });

  it('and the client declares `knowledge`, so the token is not stripped away', () => {
    // C-13's F-6: a published field removed by the client schema. The route
    // sends this token EXPLICITLY so a client that has never heard of
    // NETWORK_STATUS can still tell the three apart; zod drops unknown keys,
    // so an undeclared field is a deleted one.
    expect(ROUTE).toMatch(/knowledge:\s*networkKnowledge/);
    expect(SCHEMA).toMatch(/knowledge:/);
  });
});
