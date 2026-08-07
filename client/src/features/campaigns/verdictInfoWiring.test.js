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
    ['counterfactuals'],
    ['hypotheses'],
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
    ['counterfactuals'],
    ['hypotheses'],
    ['relativeRank'],
  ])('forwards %s', (field) => {
    expect(callSite()).toMatch(new RegExp(`${field}=\\{`));
  });
});

describe('CampaignDetailPanel accepts it', () => {
  // Hop three. A prop passed to a component that does not destructure it is
  // dropped as silently as one omitted from a projection.
  it.each([['counterfactuals'], ['hypotheses'], ['relativeRank']])('destructures %s', (field) => {
    const src = read('CampaignDetailPanel.jsx');
    const sig = src.slice(src.indexOf('export function CampaignDetailPanel'));
    expect(sig.slice(0, sig.indexOf('}'))).toMatch(new RegExp(field));
  });
});
