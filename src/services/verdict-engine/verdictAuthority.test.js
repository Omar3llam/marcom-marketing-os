// ============================================================
// R8 — the verdict topology, asserted structurally
// ------------------------------------------------------------
// The behavioural tests prove ONE sweep computes ONE verdict. This one proves
// the shape that makes that true and keeps it true: exactly one place runs the
// engine over connector evidence, exactly one place persists the result, and
// nothing anywhere derives a verdict of its own.
//
// A grep is the right instrument for this, and it is the only one. The defects
// R8 removed were all invisible to behavioural tests: four call sites each
// passed their own suite while collectively computing the same decision four
// times, because "did this function return the right verdict?" is a question
// every one of them answered correctly.
//
// SCOPE: the CONNECTOR verdict. Guardrail verdicts are a separate authority over
// a separate population (rule spec, OPERATIONAL) and are deliberately untouched
// — see the boundary test at the bottom.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC    = fileURLToPath(new URL('../..', import.meta.url));          // src/

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
  return /\.(js|jsx)$/.test(e.name) && !e.name.includes('.test.') ? [full] : [];
});

// Comments stripped first — this file's own notes name the calls it constrains,
// as do the explanatory comments left at each R8 seam. A scanner that cannot
// tell prose from a call would force us to delete the explanation to pass.
const codeOf = (f) => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const filesMatching = (root, pattern) => walk(root)
  .filter((f) => pattern.test(codeOf(f)))
  .map((f) => rel(root, f))
  .sort();

// A CALL, not a mention: `name(`. Import lines and re-exports never match.
const callsTo = (name) => new RegExp(`\\b${name}\\s*\\(`);

describe('R8 · one authority computes the connector verdict', () => {
  it('the canonical EVIDENCE read has exactly one VERDICT consumer', () => {
    // getCanonicalVerdictCampaigns is the door every connector verdict comes
    // through. One caller ⇒ one computation site, and no consumer can widen or
    // re-scope the population behind the engine's back (Controls 5–8).
    //
    // R13-C adds a SECOND reader that is not a verdict consumer: /entities/health
    // scores account health over the same canonical rows. It was reading the
    // OPERATIONAL population — an aggregate covering whatever the last sync
    // requested — while weighting it by canonical 30-day verdicts, so its
    // `wastedSpend` was a lifetime figure attached to a 30-day judgement.
    //
    // Why that does not breach this control: the route does not judge. It takes
    // verdicts verbatim from getConnectorVerdicts (pinned in
    // entities.health.test.js: "derives every health figure from that one verdict
    // set — it re-judges nothing"), and the two assertions below still forbid it
    // from running the engine on the rows it reads. Reading the population is
    // permitted; being a second authority over it is not.
    //
    // Adding a name here is therefore a deliberate act, not a formality: a new
    // entry must be a reader that provably does not judge.
    expect(filesMatching(SRC, callsTo('getCanonicalVerdictCampaigns'))).toEqual([
      'routes/lumi/entities.js',                           // R13-C — health scoring, judges nothing
      'services/entity-graph/EntityGraphService.js',       // the definition
      'services/verdict-engine/connectorVerdictService.js', // evaluateConnectorVerdicts
    ]);
  });

  it('the ENGINE is run in exactly two places, both inside the engine directory', () => {
    // connectorVerdictService — evaluateConnectorVerdicts, the connector path.
    // VerdictService      — persistLevelVerdicts, the raw-tree entry a
    //                       non-connector caller uses. It does NOT serve the
    //                       connector write path any more; persistConnectorVerdicts
    //                       stores what it was handed.
    expect(filesMatching(SRC, callsTo('rollupVerdicts'))).toEqual([
      'services/verdict-engine/VerdictService.js',
      'services/verdict-engine/connectorVerdictService.js',
      'services/verdict-engine/verdictEngine.js',      // the definition (recursive)
    ]);
    // evaluateVerdict — the per-node judgement — is called by nothing but the
    // rollup. A consumer reaching past rollupVerdicts to judge a single node
    // would be a second authority with none of the cohort context.
    expect(filesMatching(SRC, callsTo('evaluateVerdict'))).toEqual([
      'services/verdict-engine/verdictEngine.js',
    ]);
  });

  // CONTROL 12 — the agentic loop must never become a verdict engine.
  it('no consumer outside the engine directory runs the engine', () => {
    const engineCalls = /\b(rollupVerdicts|evaluateVerdict|applyRelativeRanking|buildConnectorVerdictTree)\s*\(/;
    const outsiders = filesMatching(SRC, engineCalls)
      .filter((f) => !f.startsWith('services/verdict-engine/'));
    expect(outsiders).toEqual([]);
  });

  // CONTROL 2/4 — no consumer re-derives a verdict from raw metrics (I27).
  it('nothing on the backend turns a number into a verdict', () => {
    // The precise shape of a second authority: a numeric comparison whose
    // branches are verdict literals. AccountHealthService's verdict→score maps
    // run the other way (verdict in, number out) and are consumers, not authors.
    const derivation = /[<>]=?\s*[\d.]+\s*\?\s*['"`](KILL|SCALE|HOLD|WATCH|REFRESH|REALLOCATE|OPTIMIZE)/;
    expect(filesMatching(SRC, derivation)).toEqual([]);
  });

  it('OPTIMIZE is not a verdict this system can emit', () => {
    // It appears in one dead client mapper and in no engine. Asserted so a
    // "missing" verdict is never quietly added to a consumer instead of the one
    // place verdict vocabulary is defined.
    const types = readFileSync(path.join(SRC, 'services/verdict-engine/verdictTypes.js'), 'utf8');
    expect(types).not.toMatch(/OPTIMIZE/);
  });
});

describe('R8 · persistence is a sink, not a second computation', () => {
  it('persistConnectorVerdicts neither reads evidence nor runs the engine', () => {
    const src = codeOf(path.join(SRC, 'services/verdict-engine/VerdictService.js'));
    // The body between the signature and the end of the function. Scoped to the
    // function because persistLevelVerdicts, further up the same file, legitimately
    // annotates a raw tree for a non-connector caller.
    const body = src.slice(src.indexOf('export async function persistConnectorVerdicts'));
    expect(body).not.toMatch(callsTo('getCanonicalVerdictCampaigns'));
    expect(body).not.toMatch(callsTo('rollupVerdicts'));
    expect(body).not.toMatch(callsTo('applyRelativeRanking'));
    expect(body).not.toMatch(callsTo('buildConnectorVerdictTree'));
    // What it DOES do: check the result is usable, then store it.
    expect(body).toMatch(callsTo('assertUsableEvaluation'));
    expect(body).toMatch(callsTo('persistAnnotatedVerdicts'));
  });

  it('the synthetic ACCOUNT root is skipped EXPLICITLY, not by accident', () => {
    // It used to be skipped because the write path built a rootless literal and
    // persistNode ignores an id-less node. Both twins now share ONE tree, whose
    // root carries `id: workspaceId` — so the old accident would have started
    // writing an ACCOUNT Decision per sweep with a workspace id in entityId.
    const src = codeOf(path.join(SRC, 'services/verdict-engine/VerdictService.js'));
    const body = src.slice(src.indexOf('export async function persistConnectorVerdicts'));
    expect(body).toMatch(/skipRoot:\s*true/);
  });
});

describe('R8 · failure is explicit, never an empty verdict set (I29)', () => {
  it('no verdict read is caught into an empty verdicts array', () => {
    // The exact fallback R8 removed from copilot.js and PortfolioAnalysisService.
    // "The verdict engine failed" and "this account has no verdicts" are opposite
    // facts that render identically, and the model narrated the second one.
    const collapse = /catch\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*\{\s*verdicts:\s*\[\s*\]/;
    expect(filesMatching(SRC, collapse)).toEqual([]);
  });

  it('no verdict read is caught into a fabricated verdict', () => {
    const invented = /getConnectorVerdicts\([^)]*\)\s*\.catch\([^)]*(KILL|SCALE|HOLD|WATCH)/;
    expect(filesMatching(SRC, invented)).toEqual([]);
  });
});

// CONTROL 11 — a cached verdict must never become the current one.
describe('R8 · CampaignReasoning stays a cache', () => {
  it('only its writer and its labelled reader touch the table', () => {
    expect(filesMatching(SRC, /prisma\.campaignReasoning\b/)).toEqual([
      'routes/lumi/entities.js',                        // labelled reader (publishes `stale`)
      'services/analysis/CampaignReasoningService.js',  // the writer
    ]);
  });

  it('the reader publishes staleness beside the cached verdict', () => {
    // The row carries a `verdict` column. Publishing it without saying how old it
    // is would let a client treat a cached verdict as the current one — which is
    // precisely what I30 forbids. The live verdict lives on /entities/verdicts.
    const src = codeOf(path.join(SRC, 'routes/lumi/entities.js'));
    const route = src.slice(src.indexOf("'/entities/:id/reasoning'"));
    expect(route).toMatch(/stale/);
    // …and it never feeds a Decision or an account-health computation.
    expect(route).not.toMatch(callsTo('computeAccountHealth'));
    expect(route).not.toMatch(/prisma\.decision\.create/);
  });
});

// The boundary R8 must NOT cross (§16).
describe('R8 · Guardrail and Connector remain separate authorities', () => {
  it('the guardrail sweep does not run the connector verdict path', () => {
    const src = codeOf(path.join(SRC, 'services/guardrail-engine/GuardrailSweepService.js'));
    expect(src).not.toMatch(callsTo('evaluateConnectorVerdicts'));
    expect(src).not.toMatch(callsTo('getConnectorVerdicts'));
    expect(src).not.toMatch(callsTo('getCanonicalVerdictCampaigns'));
  });
});
