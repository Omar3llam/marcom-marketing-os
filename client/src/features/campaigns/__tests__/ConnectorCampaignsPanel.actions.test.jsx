// ============================================================
// ConnectorCampaignsPanel — recording the operator's answer
// ------------------------------------------------------------
// The answer belongs to the DECISION, and this suite pins where it now lives.
//
// It used to live under the ad-set evidence: "Explain decision" → "View ad
// sets" → wait for a server ranking → answer. That made an evidence RANKING the
// precondition for recording a claim about a verdict — so an ad set the engine
// declined to rank (a perfectly healthy answer) removed the question entirely,
// from a KILL that was fully answerable. The tests below are the inverse of the
// ones they replace: the buttons must be there WITHOUT any of that.
//
// The other property worth pinning is unchanged: this panel renders MANY rows
// from a single hook instance, so each row must read and write its own entity.
// A scalar state here would have every campaign on screen claiming the answer
// given to one of them.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
vi.mock('@/hooks/useAdsDrillDown.js', () => ({
  useAdsDrillDown: () => ({ byId: {}, loading: {}, errors: {}, load: vi.fn() }),
}));
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock('../decisionSignals.js', () => ({ recordExplain: vi.fn(), recordIntent: vi.fn() }));

const comparisonEnvelope = { status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0 };

const ev = vi.hoisted(() => ({ load: vi.fn(), byId: { current: {} } }));
vi.mock('@/hooks/useEvidence.js', () => ({
  evidenceKey: (id, metric = 'ctr') => `${id}:${metric}`,
  useEvidence: () => ({ load: ev.load, byId: ev.byId.current, loading: {}, errors: {} }),
}));

const action = vi.hoisted(() => ({ execute: vi.fn(), dismiss: vi.fn(), states: { current: {} } }));
vi.mock('@/features/campaigns/useDecisionAction.js', () => ({
  useDecisionAction: () => ({
    execute: action.execute, dismiss: action.dismiss, states: action.states.current,
  }),
}));

import { ConnectorCampaignsPanel } from '../ConnectorCampaignsPanel.jsx';

const bottom = (over = {}) => ({
  entityId: 'as-2', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0032, spendMinor: 325_500, currency: 'USD', _gap: -0.80, ...over,
});

const ranking = (id) => ({
  entity: { entityId: id, ctr: 0.0164 }, objective: 'OUTCOME_SALES',
  evidence: {
    dimension: 'ADSET', metric: 'ctr',
    ranked: [bottom(), bottom({ entityId: 'as-1', ctr: 0.018 })],
    summary: { bottom: bottom(), top: bottom({ entityId: 'as-1' }), outliers: [bottom()] },
    dataConfidence: 0.8,
  },
  comparisonEnvelope, insufficientData: false, reasonKey: null,
});

const campaign = (over = {}) => ({
  entityId: 'c1', channel: 'META', name: 'Ramadan Cold', adSetCount: 3,
  spendMinor: 655_300, roas: null, ctr: 0.0164, frequency: 2.4, currency: 'USD', ...over,
});

const renderPanel = (ui) => render(ui, { wrapper: MemoryRouter });

// The ONLY expansion these tests need. Note what is missing: no "View ad sets".
const explain = (name) =>
  fireEvent.click(screen.getByLabelText(`Toggle details for ${name}`));

const openAdSets = (name) =>
  fireEvent.click(screen.getByLabelText(`Toggle ad sets for ${name}`));

beforeEach(() => {
  vi.clearAllMocks();
  ev.byId.current = {};
  action.states.current = {};
});

describe('P7-04B Campaigns comparison parent', () => {
  it('passes the evidence-response baseline through the real ExecutionContext on demand', () => {
    const entry = ranking('c1');
    ev.byId.current = { 'c1:ctr': { ...entry, entity: { ctr: 0.02 },
      evidence: { ...entry.evidence, summary: { bottom: bottom({ ctr: 0.012, _gap: -0.40 }) } } } };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign({ ctr: 0.01 })]} verdicts={{ c1: 'KILL' }} />);
    expect(ev.load).not.toHaveBeenCalled();
    explain('Ramadan Cold'); openAdSets('Ramadan Cold');
    expect(ev.load).toHaveBeenCalledWith('c1');
    expect(screen.getByText('2.00%')).toBeInTheDocument();
    expect(screen.getByText('-40%')).toBeInTheDocument();
  });
});

describe('the answer is offered on the decision itself', () => {
  it('both buttons appear on opening the decision — no ad sets, no evidence', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');

    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
    // The evidence request is the ad-set expansion's, and it never happened.
    expect(ev.load).not.toHaveBeenCalled();
  });

  it('says what the answer is for', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');
    expect(screen.getByText(/Either answer is recorded/)).toBeInTheDocument();
  });

  // The regression this PR exists to prevent. A ranking refusal is a healthy
  // answer about the AD SETS; it says nothing about whether the campaign-level
  // KILL can be answered, and it used to remove the question entirely.
  it('survives an evidence refusal — the ranking is not the gate', () => {
    ev.byId.current = {
      'c1:ctr': { entity: {}, objective: null, evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' },
    };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');
    openAdSets('Ramadan Cold');

    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
  });

  // REALLOCATE reached this surface through the ad-set panel before the move
  // (ACTIONABLE_VERDICTS carries it) and then lost it, because the decision
  // surface gates on nextActionFor and that had no entry for it. The verdict is
  // emitted by verdictEngine's INEFFICIENT_SCALING and AUDIENCE_MISMATCH
  // branches and by AllocationService, so this was a live hole.
  it('is offered for REALLOCATE, which lost it in the move', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REALLOCATE' }} />);
    explain('Ramadan Cold');
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
    // Same invariant as KILL's: no ad sets opened, no evidence requested.
    expect(ev.load).not.toHaveBeenCalled();
  });

  it('is offered for SCALE, which the ad-set surface never asked about', () => {
    // ACTIONABLE_VERDICTS (the ExecutionContext gate) is KILL/REALLOCATE, so a
    // SCALE could not be recorded from the Campaigns page at all. The decision
    // surface gates on nextActionFor, which SCALE satisfies.
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'SCALE' }} />);
    explain('Ramadan Cold');
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
  });

  // Same reasoning as SCALE above, and the gap this closed: REFRESH is gated out
  // of ACTIONABLE_VERDICTS (an ad-set evidence question) but satisfies
  // nextActionFor — so it can now be recorded from the Campaigns page. Until it
  // could, `intentAt` was unreachable for every REFRESH ever issued.
  it('is offered for REFRESH, whose creative change is a real intervention', () => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REFRESH' }} />);
    explain('Ramadan Cold');
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
  });

  it.each([['HOLD'], ['WATCH']])(
    'is not offered under %s, which asks for no intervention', (verdict) => {
      renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: verdict }} />);
      explain('Ramadan Cold');
      expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
    },
  );
});

describe('where the write is routed', () => {
  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s falls back to the entity when no sweep wrote a Decision', (label, handler) => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');

    fireEvent.click(screen.getByRole('button', { name: label }));
    // null, never undefined: a campaign with no Decision routes by entity, which
    // is the CORRECT route for it rather than a degraded one, and the two cases
    // must not become indistinguishable downstream.
    expect(handler()).toHaveBeenCalledWith('c1', null);
    expect(handler()).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s targets the stored decision row when the feed carried one', (label, handler) => {
    renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign()]}
        verdicts={{ c1: 'KILL' }}
        verdictInfo={{ c1: { decisionId: 'dec-7', decisionVerdict: 'KILL' } }}
      />,
    );
    explain('Ramadan Cold');

    fireEvent.click(screen.getByRole('button', { name: label }));
    // The id names ONE ROW; the by-entity path names a query the server
    // re-resolves at write time. A sweep landing between render and click moves
    // that target, which is the whole reason the id wins when there is one.
    expect(handler()).toHaveBeenCalledWith('c1', 'dec-7');
  });
});

// The routing is the verdict's business in no way at all — but a verdict that
// only just regained its surface is exactly the one worth proving it on, rather
// than assuming it inherited the wiring.
describe('REALLOCATE routes like every other actionable verdict', () => {
  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s targets the stored decision row', (label, handler) => {
    renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign()]}
        verdicts={{ c1: 'REALLOCATE' }}
        verdictInfo={{ c1: { decisionId: 'dec-7', decisionVerdict: 'REALLOCATE' } }}
      />,
    );
    explain('Ramadan Cold');

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(handler()).toHaveBeenCalledTimes(1);
    expect(handler()).toHaveBeenCalledWith('c1', 'dec-7');
  });

  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s falls back to the entity when no sweep wrote a Decision', (label, handler) => {
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REALLOCATE' }} />);
    explain('Ramadan Cold');

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(handler()).toHaveBeenCalledTimes(1);
    expect(handler()).toHaveBeenCalledWith('c1', null);
    // null, not undefined: the by-entity route is the CORRECT one for a
    // campaign with no Decision, and the two cases must stay distinguishable.
    expect(handler().mock.calls[0][1]).not.toBeUndefined();
  });

  it('reports the same six answers', () => {
    action.states.current = { c1: 'executed' };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'REALLOCATE' }} />);
    explain('Ramadan Cold');
    expect(screen.getByText('Recorded as executed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
  });
});

describe('the six answers', () => {
  const withState = (state) => {
    action.states.current = { c1: state };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');
  };

  it.each([
    ['executing',  'Recording…'],
    ['dismissing', 'Recording…'],
    ['executed',   'Recorded as executed'],
    ['dismissed',  'Recorded as not applicable'],
    ['stale',      'This verdict was replaced — refresh to see the current one'],
    ['error',      "Couldn't record — refresh and try again"],
  ])('%s reads "%s"', (state, sentence) => {
    withState(state);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  // ONE-WAY. A terminal state REPLACES the buttons rather than disabling them —
  // a control that looks clickable after being answered invites a second click,
  // and a second click on a recorded claim is not a second claim.
  it.each([['executing'], ['executed'], ['dismissed'], ['stale'], ['error']])(
    '%s leaves no button to click again', (state) => {
      withState(state);
      expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Not applicable' })).not.toBeInTheDocument();
    },
  );
});

describe('one decision, one place to answer it', () => {
  // The failure Fix 4 prevents: the lifecycle rendered on BOTH surfaces would
  // put two identical button pairs on screen for one campaign, backed by one
  // state — answering either would silently settle the other.
  it('expanding the ad sets under an answerable KILL adds no second pair', () => {
    ev.byId.current = { 'c1:ctr': ranking('c1') };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    explain('Ramadan Cold');
    openAdSets('Ramadan Cold');

    expect(screen.getAllByRole('button', { name: 'I executed this' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Not applicable' })).toHaveLength(1);
  });

  it('the ad-set surface still renders — it just stopped asking', () => {
    ev.byId.current = { 'c1:ctr': ranking('c1') };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    openAdSets('Ramadan Cold');

    expect(screen.getByText('Where to execute')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Either answer is recorded/)).not.toBeInTheDocument();
  });
});

describe('state is per row', () => {
  const twoRows = () => {
    renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign(), campaign({ entityId: 'c2', name: 'Eid Prospecting' })]}
        verdicts={{ c1: 'KILL', c2: 'KILL' }}
      />,
    );
    explain('Ramadan Cold');
    explain('Eid Prospecting');
  };

  // One hook instance serves the whole table, so a scalar state would make an
  // answer given on one campaign appear on every other expanded row — a
  // recorded claim shown against decisions nobody answered.
  it('an answered row does not settle its neighbours', () => {
    action.states.current = { c1: 'executed' };
    twoRows();

    expect(screen.getByText('Recorded as executed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'I executed this' })).toHaveLength(1);
  });

  // Order-independent on purpose: the panel groups rows into bands, so DOM
  // position is not the caller's to assume. What matters is that two buttons
  // send two DIFFERENT ids — a shared closure would send the same one twice.
  it('each row sends its own entity id', () => {
    twoRows();
    const buttons = screen.getAllByRole('button', { name: 'I executed this' });
    expect(buttons).toHaveLength(2);

    buttons.forEach((b) => fireEvent.click(b));
    const sent = action.execute.mock.calls.map(([id]) => id).sort();
    expect(sent).toEqual(['c1', 'c2']);
  });

  it('each row sends its OWN decision id, not its neighbour’s', () => {
    renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign(), campaign({ entityId: 'c2', name: 'Eid Prospecting' })]}
        verdicts={{ c1: 'KILL', c2: 'KILL' }}
        verdictInfo={{ c1: { decisionId: 'dec-1' }, c2: { decisionId: 'dec-2' } }}
      />,
    );
    explain('Ramadan Cold');
    explain('Eid Prospecting');

    screen.getAllByRole('button', { name: 'I executed this' }).forEach((b) => fireEvent.click(b));
    const pairs = action.execute.mock.calls.map(([id, dec]) => `${id}:${dec}`).sort();
    expect(pairs).toEqual(['c1:dec-1', 'c2:dec-2']);
  });
});

describe('the ranking comes from the server, not from a second ranker here', () => {
  it('names summary.bottom even when the row it points at is not the lowest visible CTR', () => {
    const inverted = ranking('c1');
    inverted.evidence.summary = {
      bottom: bottom({ entityId: 'as-1', name: 'Lookalike 1%', ctr: 0.018 }),
      top: bottom(),
      outliers: [],
    };
    ev.byId.current = { 'c1:ctr': inverted };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    openAdSets('Ramadan Cold');

    expect(screen.getAllByText('Lookalike 1%').length).toBeGreaterThan(0);
  });
});
