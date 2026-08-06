// ============================================================
// ConnectorCampaignsPanel — recording the operator's answer
// ------------------------------------------------------------
// The second of the two ExecutionContext mounts, and the harder one: this panel
// renders MANY rows from a single hook instance, so the property worth pinning
// is that each row reads and writes its own entity. A scalar action state here
// would have every campaign on screen claiming the answer given to one of them.
//
// Its own file rather than a block in ConnectorCampaignsPanel.test.jsx: these
// need useEvidence and useDecisionAction mocked, and adding module-level mocks
// to that suite would change what its thirty-odd existing tests exercise.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useEntityDrillDown.js', () => ({
  useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }),
}));
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock('../decisionSignals.js', () => ({ recordExplain: vi.fn(), recordIntent: vi.fn() }));

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
  ctr: 0.0032, spendMinor: 325_500, currency: 'USD', ...over,
});

const ranking = (id) => ({
  entity: { entityId: id, ctr: 0.0164 }, objective: 'OUTCOME_SALES',
  evidence: {
    dimension: 'ADSET', metric: 'ctr',
    ranked: [bottom(), bottom({ entityId: 'as-1', ctr: 0.018 })],
    summary: { bottom: bottom(), top: bottom({ entityId: 'as-1' }), outliers: [bottom()] },
    dataConfidence: 0.8,
  },
  insufficientData: false, reasonKey: null,
});

// adSetCount > 0 so the row offers its "View ad sets" toggle — the expansion the
// evidence row hangs off.
const campaign = (over = {}) => ({
  entityId: 'c1', channel: 'META', name: 'Ramadan Cold', adSetCount: 3,
  spendMinor: 655_300, roas: null, ctr: 0.0164, frequency: 2.4, currency: 'USD', ...over,
});

const renderPanel = (ui) => render(ui, { wrapper: MemoryRouter });

const openAdSets = (name) =>
  fireEvent.click(screen.getByLabelText(`Toggle ad sets for ${name}`));

beforeEach(() => {
  vi.clearAllMocks();
  ev.byId.current = {};
  action.states.current = {};
});

describe('the answer is offered under an actionable verdict', () => {
  it('both buttons appear once the server returns a ranking', () => {
    ev.byId.current = { 'c1:ctr': ranking('c1') };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    openAdSets('Ramadan Cold');

    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
  });

  it.each([
    ['I executed this', () => action.execute],
    ['Not applicable',  () => action.dismiss],
  ])('%s records against the row entity', (label, handler) => {
    ev.byId.current = { 'c1:ctr': ranking('c1') };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    openAdSets('Ramadan Cold');

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(handler()).toHaveBeenCalledWith('c1');
  });

  // No ranking, no panel, and therefore nothing to answer. A verdict with no
  // evidence behind it must not collect a claim the Proof Engine would then
  // score against reasoning it never showed.
  it('offers no answer when the engine declined to rank', () => {
    ev.byId.current = {
      'c1:ctr': { entity: {}, objective: null, evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' },
    };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'KILL' }} />);
    openAdSets('Ramadan Cold');

    expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
  });

  it('offers no answer under a verdict that asks for no intervention', () => {
    ev.byId.current = { 'c1:ctr': ranking('c1') };
    renderPanel(<ConnectorCampaignsPanel campaigns={[campaign()]} verdicts={{ c1: 'HOLD' }} />);
    openAdSets('Ramadan Cold');

    expect(screen.queryByRole('button', { name: 'I executed this' })).not.toBeInTheDocument();
  });
});

describe('state is per row', () => {
  const twoRows = () => {
    ev.byId.current = { 'c1:ctr': ranking('c1'), 'c2:ctr': ranking('c2') };
    renderPanel(
      <ConnectorCampaignsPanel
        campaigns={[campaign(), campaign({ entityId: 'c2', name: 'Eid Prospecting' })]}
        verdicts={{ c1: 'KILL', c2: 'KILL' }}
      />,
    );
    openAdSets('Ramadan Cold');
    openAdSets('Eid Prospecting');
  };

  // The failure this prevents: one hook instance serves the whole table, so a
  // scalar state would make an answer given on one campaign appear on every
  // other expanded row — a recorded claim shown against decisions nobody
  // answered.
  it('an answered row does not settle its neighbours', () => {
    action.states.current = { c1: 'executed' };
    twoRows();

    expect(screen.getByText('Recorded as executed')).toBeInTheDocument();
    // The second row still has both of its buttons.
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
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

    const panel = screen.getByText('Where to execute').closest('div');
    expect(within(panel).getAllByText('Lookalike 1%').length).toBeGreaterThan(0);
  });
});
