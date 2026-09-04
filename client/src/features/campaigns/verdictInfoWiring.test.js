// ============================================================
// The verdict → panel projection names every structured field
// ============================================================
// `verdictInfoByEntityId` in CampaignsView is an explicit field list, and a
// field that arrives on every verdict row still has to be NAMED to survive it.
// Its own comment records what that costs: funnel, rootCause and dataConfidence
// "arrived on every verdict row and were dropped here, so the panel could only
// recover the leading clause of the prose — the counterfactual and the
// recommended action were unreachable." That went unnoticed until PR #309.
//
// counterfactuals was dropped by the same list for the same reason, and there
// was no test in the repo touching this projection at all — which is precisely
// how a silent drop survives: nothing fails, the panel just shows less.
//
// A SOURCE ASSERTION, not a render. The failure is a missing KEY, and a
// behavioural test would need CampaignsView's whole mock surface to observe it
// — while still passing if the field were dropped one hop further along. This
// names the property directly, and it also covers fields no UI reads yet.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.resolve(HERE, f), 'utf8');

/** The `verdictInfoByEntityId` useMemo body, brace-matched from its opening. */
function projectionBody() {
  const src = read('CampaignsView.jsx');
  const start = src.indexOf('const verdictInfoByEntityId');
  expect(start, 'verdictInfoByEntityId was renamed — update this test with it').toBeGreaterThan(-1);
  // Up to the closing of the useMemo's dependency array.
  const end = src.indexOf('[connectorVerdicts]', start);
  return src.slice(start, end > -1 ? end : start + 1500);
}

describe('CampaignsView → verdictInfo', () => {
  it.each([
    ['rationale'],
    ['confidence'],
    ['funnel'],
    ['rootCause'],
    ['dataConfidence'],
    // Published on every verdict row since the engine split the two halves, and
    // read by no client file until the confidence breakdown — the same silent
    // drop as counterfactuals, one field later.
    ['signalConfidence'],
    // C-09 - the three factors OF dataConfidence. Same allowlist, same risk:
    // computed on every verdict since the engine existed, and dropped here
    // would leave 'Low confidence' unable to say which of three things is low.
    ['dataConfidenceDimensions'],
    ['counterfactuals'],
    ['hypotheses'],
    // Unlike relativeRank below, this has no second route — the `relativeRanks`
    // map carries only the tag, so the projection is the ONLY way it arrives.
    ['relativeContext'],
    // Decision IDENTITY — what Lumi decided THEN, beside the verdict it thinks
    // NOW. decisionId routes execute/dismiss at one row instead of at a query.
    ['decisionId'],
    ['decisionVerdict'],
    // Past decisions. It arrives on a SEPARATE map on the same response, not on
    // the verdict object — so this projection is the only thing joining the two,
    // and the only place it can be silently dropped.
    ['memory'],
  ])('carries %s through to the panel', (field) => {
    expect(projectionBody()).toMatch(new RegExp(`\\b${field}:`));
  });

  // relativeRank is deliberately NOT in this projection. It is resolved
  // per-row in ConnectorCampaignsPanel from the `relativeRanks` map that feeds
  // the Impact badge, and a second copy here would give the badge and the
  // reasoning block two sources for one fact.
  it('does not duplicate relativeRank, which travels its own route', () => {
    expect(projectionBody()).not.toMatch(/\brelativeRank:/);
  });
});

describe('ConnectorCampaignsPanel → CampaignDetailPanel', () => {
  // Hop two of three. The projection above can be perfect and the field still
  // never arrive, because this call site is a second explicit list.
  const callSite = () => {
    const src = read('ConnectorCampaignsPanel.jsx');
    const start = src.indexOf('<CampaignDetailPanel');
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('/>', start));
  };

  it.each([
    ['funnel'],
    ['rootCause'],
    ['dataConfidence'],
    ['signalConfidence'],
    ['counterfactuals'],
    ['hypotheses'],
    ['relativeRank'],
    ['relativeContext'],
    ['memory'],
    // The decision lifecycle. Not data — the two callbacks and the state that
    // let the operator answer the verdict on the surface that shows it.
    ['onExecute'],
    ['onDismiss'],
    ['executionState'],
  ])('forwards %s', (field) => {
    expect(callSite()).toMatch(new RegExp(`${field}=\\{`));
  });

  // The routing #339 established, unchanged by the surface move: the STORED
  // decision's id names ONE ROW, and null falls back to the by-entity query,
  // which is the correct route for a campaign no sweep has written a Decision
  // for. `?? null` rather than a bare read, so "no decision" cannot arrive as
  // undefined and become indistinguishable from a dropped field.
  it.each([['executeDecision'], ['dismissDecision']])('%s is routed by info.decisionId ?? null', (fn) => {
    expect(callSite()).toMatch(new RegExp(`${fn}\\(c\\.entityId, info\\.decisionId \\?\\? null\\)`));
  });
});

// ── One decision, one place to answer it ────────────────────
// The lifecycle moved UP to the decision surface. If it were restored here too,
// one campaign would have two identical button pairs backed by one state —
// under "Explain decision" and again under "View ad sets" — and answering
// either would silently settle the other. That is worse than the walk it
// replaced, and it would come back as a one-line "restore the props" edit.
describe('the Campaigns-page ExecutionContext no longer asks', () => {
  const mount = () => {
    const src = read('ConnectorCampaignsPanel.jsx');
    const start = src.indexOf('<ExecutionContext');
    expect(start, 'the ExecutionContext mount was renamed or removed').toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('/>', start));
  };

  it.each([['onExecute'], ['onDismiss'], ['executionState']])('passes no %s', (prop) => {
    expect(mount()).not.toMatch(new RegExp(`${prop}=`));
  });

  // The capability is NOT deleted — Overview's DecisionCard is a different
  // surface with no detail panel behind it and still passes all three.
  it('leaves the capability in place for the surface that still needs it', () => {
    const card = read('../overview/components/DecisionCard.jsx');
    expect(card).toMatch(/onExecute=\{/);
    expect(card).toMatch(/executionState=\{/);
  });
});

describe('CampaignDetailPanel accepts it', () => {
  // Hop three. A prop passed to a component that does not destructure it is
  // dropped as silently as one omitted from a projection.
  it.each([
    ['counterfactuals'], ['hypotheses'], ['relativeRank'], ['signalConfidence'], ['relativeContext'],
    ['memory'],
  ])('destructures %s', (field) => {
    const src = read('CampaignDetailPanel.jsx');
    const sig = src.slice(src.indexOf('export function CampaignDetailPanel'));
    expect(sig.slice(0, sig.indexOf('}'))).toMatch(new RegExp(field));
  });
});
