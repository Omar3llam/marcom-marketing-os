// ============================================================
// FE-06 · contract-consumption drift may not disappear again
// ============================================================
// THE PROPERTY
//
//   Every gap between what the API publishes and what the client consumes is
//   either in the baseline below, with a reason, or the build fails.
//
// This slice DETECTS. It arms no validator, deletes no schema and retires no
// route — those are rulings (LOCK 2), and each needs an owner, a contract and
// its own RED proof. What it refuses to allow is the drift going quiet again.
//
// ── WHY A BASELINE AND NOT A COUNT ──────────────────────────────────────────
// `expect(unvalidated).toHaveLength(49)` would pass while one caller is fixed
// and another is added — the number is the same and the graph is different. So
// the baseline names the SET, and the assertions run BOTH ways:
//
//     measured \ baseline  → a NEW gap appeared          → fail
//     baseline \ measured  → a gap was closed, or moved  → fail
//
// The second direction is the one that matters over time. Without it the
// baseline rots into a list of things that used to be true, which is exactly
// the failure this programme keeps finding: a green test protecting a claim
// that stopped being right.
//
// ── THESE NUMBERS ARE EVIDENCE, NOT THE GUARD ───────────────────────────────
// Measured at 7f74ac8: 71 callers, 22 validating, 49 not (25 of them mutating);
// 38 schemas, 17 roots, 27 reached, 11 unreached; 10 lumi endpoints with no
// client caller. They are recorded so a reader can see the shape at a glance.
// The guard is the set membership below.
// ============================================================
import { describe, it, expect } from 'vitest';
import { stripComments, buildGraph, measureEndpoints } from '../../scripts/contractConsumption.js';

const graph = buildGraph();
const unvalidated = graph.callers.filter((c) => !c.validates).map((c) => c.path.replace('client/src/', ''));

// ── BASELINE ────────────────────────────────────────────────────────────────
// Known, classified, deliberately untouched. Adding a line here is a decision:
// it says "this gap is accepted for now", and it should carry a reason.

// Modules that call the API client and do not parse the response against a
// contract. NOT a to-do list to be silently worked off: arming a guard means
// owning the proof it admits the truth (B8-01 — a strict enum killed a whole
// surface, not one field), and the first 25 here MUTATE, where a rejected
// parse would change execution semantics rather than a rendering.
const UNVALIDATED_CALLERS = [
  // ── mutating (25) ─────────────────────────────────────────
  'features/admin/api.js',
  'features/campaigns/decisionSignals.js',
  'features/campaigns/executionSignals.js',
  'features/campaigns/judgmentSignals.js',
  'features/connectors/services.js',
  'features/settings/services.js',
  'hooks/useArtifactApproval/submitApproval.js',
  'hooks/useCampaignAnalysis.js',
  'hooks/useCommitAgenda.js',
  'hooks/useContentGeneration.js',
  'hooks/useCopilot.js',
  'hooks/useOrchestrate/fetchers.js',
  'hooks/usePromotePattern.js',
  'hooks/usePromoteToHoldout.js',
  'hooks/useRecordMetrics.js',
  'hooks/useRecordOutcome.js',
  'hooks/useRecordPublish.js',
  'hooks/useRevenueCsv.js',
  'hooks/useRunSweep.js',
  'hooks/useStartTest.js',
  'hooks/useTeam.js',
  'pages/OnboardingPage/index.jsx',
  'pages/OnboardingPage/steps/SyncStep.jsx',
  'pages/demo/Operations/IncidentPanel.jsx',
  'services/sseClient.ts',
  // ── read-only (24) ────────────────────────────────────────
  'context/RoleContext.jsx',
  'features/shell/services.js',
  'hooks/useAccountHealth.js',
  'hooks/useAdsDrillDown.js',
  'hooks/useApprovedArtifacts.js',
  'hooks/useArtifactApproval.js',
  'hooks/useCampaignReasoning.js',
  'hooks/useConnectorCampaigns.js',
  'hooks/useConnectorVerdicts.js',
  'hooks/useContentHistory.js',
  'hooks/useDecisionLearning.js',
  'hooks/useEntityDrillDown.js',
  'hooks/useEvidence.js',
  'hooks/useExecutionReconciliation/index.js',
  'hooks/useFatigueForecast.js',
  'hooks/usePendingApprovals.js',
  'hooks/useProjectId.js',
  'hooks/useUserRole.js',
  'hooks/useWorkspace.js',
  'pages/Observability.jsx',
  'pages/demo/Operations/ExecutionTimeline.jsx',
  'pages/demo/Operations/LiveMonitor.jsx',
  'pages/demo/Operations/components/RuntimeHealthStrip.jsx',
  'router/ProtectedRoute.jsx',
];

// Client contract schemas that nothing a surface parses can ever contain.
//
// `api → campaign → alert → metrics` is ONE dead component, not four orphans:
// api.schema is the GET /lumi/feed contract (LumiFeedResponseSchema), built
// around the `campaigns` array S1-B deleted server-side and FE-03 removed the
// last reader of. The other three are reachable only through it.
//
// `approval` is a NAMING COLLISION, not a dead feature: approvals are live, and
// useApprovals.js parses ApprovalRequestSchema out of plan.schema, which
// duplicates four of this file's eight exports. Consolidating them is a slice
// that must first prove the duplicated exports mean the same thing.
const UNREACHED_SCHEMAS = [
  'alert', 'api', 'campaign', 'metrics',        // the retired feed contract
  'approval',                                    // naming collision with plan.schema
  'attribution', 'reconciliation',               // built, typed, unconsumed verticals
  'execution', 'fatiguePrediction', 'metricSnapshot', 'testAgenda',
];

// Published lumi endpoints with no client caller. `/_health` is a diagnostic
// and is meant to have none; the rest need an owner and a rationale before
// anyone retires or adopts them (LOCK 2).
//
// ── PARITY-01 · one line left this list, by ruling ──────────────────────────
// `GET /account/aggregate` was here. This guard's baseline-rot direction is
// what caught its adoption — the test failed with
// `expected [ 'GET /account/aggregate' ] to deeply equal []` on the first run
// after the client started calling it, which is the entire reason that
// direction exists.
//
// It is removed rather than annotated because it genuinely has a caller now:
// Parity discovery measured Attention and Campaigns each recomputing this
// account aggregate in the browser, disagreeing by a factor of ten on a
// 3-exponent currency, and the endpoint had been publishing the correct answer
// with nobody reading it. Adopting it was a ruling, not a cleanup.
//
// Nothing is weakened by the removal: if the caller ever goes away, the line
// reappears in `uncalled` and the OTHER direction fails it as a new gap.
const UNCALLED_ENDPOINTS = [
  'GET /_health',
  'GET /attribution',
  'GET /feed',
  'GET /loop',
  'GET /network',
  'GET /reconciliation',
  'POST /',            // quickaction
  'POST /:actionId',   // rollback
  'POST /handoff',     // collaboration
];

const only = (a, b) => a.filter((x) => !b.includes(x));

// ── the instrument must work before its findings mean anything ──────────────
describe('FE-06 · the census can be trusted', () => {
  it('a comment is not a call site', () => {
    const src = "/**\n * await api.get('/api/lumi/feed');\n */\nconst x = 1;";
    expect(stripComments(src)).not.toMatch(/lumi\/feed/);
    expect(stripComments(src)).toMatch(/const x = 1/);
  });

  it('a path glob inside a line comment does not swallow the code below it', () => {
    // The exact shape that made an FE-04 verifier report a present line as
    // MISSING: `/app/*` contains `/*`, and a stripper that scans for block
    // comments first opens one there and runs to the next `*/`.
    const src = 'const a = 1; // see /app/* for the glob\nconst b = 2;';
    expect(stripComments(src)).toMatch(/const b = 2/);
  });

  it('a URL and a glob inside a STRING survive', () => {
    expect(stripComments("const u = 'https://x.example/a';")).toMatch(/x\.example\/a/);
    expect(stripComments("const p = '/app/*';\nconst q = 2;")).toMatch(/const q = 2/);
  });

  it('finds a caller that does validate, and one that does not', () => {
    const paths = graph.callers.map((c) => c.path);
    expect(paths).toContain('client/src/hooks/useConnections.js');
    expect(graph.callers.find((c) => c.path.endsWith('useConnections.js')).validates).toBe(true);
    expect(graph.callers.find((c) => c.path.endsWith('useTeam.js')).validates).toBe(false);
  });

  it('reads a real, populated tree', () => {
    expect(graph.sources.size).toBeGreaterThan(300);
    expect(graph.callers.length).toBeGreaterThan(50);
    expect(graph.schemas.all.length).toBeGreaterThan(30);
    expect(graph.endpoints.total).toBeGreaterThan(100);
  });

  it('attributes a schema by IMPORT SOURCE, not by name', () => {
    // `useApprovals.js` imports ApprovalRequestSchema from plan.schema, where
    // it is duplicated. A name-match called approval.schema consumed; it is not.
    expect(graph.schemas.importers.get('plan.schema.ts')).toContain('client/src/hooks/useApprovals.js');
    expect([...graph.schemas.importers.get('approval.schema.ts')]).toEqual([]);
  });

  it('walks reachability, and does not mistake a reference for it', () => {
    // entity.schema is imported by 8 schemas and reached through them.
    expect(graph.schemas.reached).toContain('entity');
    // campaign.schema IS referenced — by api.schema, which nothing imports.
    expect(graph.schemas.unreached).toContain('campaign');
  });

  it('an endpoint is called only by an EXACT match, never by its child', () => {
    const { calledBy } = measureEndpoints(graph.sources);
    expect(calledBy('/connections')).toBe('/api/lumi/connections');
    expect(calledBy('/zzz-not-an-endpoint')).toBeNull();
  });
});

// ── the guard ───────────────────────────────────────────────────────────────
describe('FE-06 · no NEW contract-consumption gap', () => {
  it('every module calling the API without parsing is a known one', () => {
    expect(only(unvalidated, UNVALIDATED_CALLERS)).toEqual([]);
  });

  it('every unreached client schema is a known one', () => {
    expect(only(graph.schemas.unreached, UNREACHED_SCHEMAS)).toEqual([]);
  });

  it('every published endpoint with no client caller is a known one', () => {
    expect(only(graph.endpoints.uncalled, UNCALLED_ENDPOINTS)).toEqual([]);
  });
});

describe('FE-06 · the baseline may not rot', () => {
  it('no baselined caller has quietly started validating (or moved)', () => {
    expect(only(UNVALIDATED_CALLERS, unvalidated)).toEqual([]);
  });

  it('no baselined schema has quietly become reachable (or been deleted)', () => {
    expect(only(UNREACHED_SCHEMAS, graph.schemas.unreached)).toEqual([]);
  });

  it('no baselined endpoint has quietly gained a caller (or been retired)', () => {
    expect(only(UNCALLED_ENDPOINTS, graph.endpoints.uncalled)).toEqual([]);
  });
});

// ── the findings, pinned as facts rather than prose ─────────────────────────
describe('FE-06 · what the census found, kept honest', () => {
  it('the retired /lumi/feed contract is a connected dead component', () => {
    // api.schema IS the feed contract (LumiFeedResponseSchema). S1-B deleted
    // the `campaigns` field it is built around; FE-03 removed the last reader.
    // These four are kept alive only by each other.
    for (const s of ['api', 'campaign', 'alert', 'metrics']) {
      expect(graph.schemas.unreached).toContain(s);
    }
    expect(graph.endpoints.uncalled).toContain('GET /feed');
  });

  it('a mutation without a parsed response is the larger half of the gap', () => {
    const mutating = graph.callers.filter((c) => !c.validates && c.mutates);
    expect(mutating.length).toBeGreaterThan(20);
  });
});
