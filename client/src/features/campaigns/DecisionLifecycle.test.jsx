// ============================================================
// DecisionLifecycle — six answers, one definition
// ============================================================
// It has two mount points (ActionBar on the decision surface, ExecutionContext
// for Overview's DecisionCard), which is the reason it exists as a file: six
// states rendered from two copies would drift, and the drift would land on the
// one write in the product whose purpose is to be believed.
//
// Two rules are worth more than the rendering: a surface that cannot record an
// answer must not ask for one, and every terminal state must REPLACE the
// buttons rather than disable them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DecisionLifecycle } from './DecisionLifecycle.jsx';

/**
 * The module's CODE, comments stripped. Its header explains at length that it
 * owns no hook and knows nothing about decisionId — prose that would trip the
 * very grep meant to catch that coupling arriving.
 */
const codeOf = () => readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'DecisionLifecycle.jsx'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const onExecute = vi.fn();
const onDismiss = vi.fn();
const renderIt = (props = {}) => render(
  <DecisionLifecycle onExecute={onExecute} onDismiss={onDismiss} {...props} />,
);

beforeEach(() => { onExecute.mockClear(); onDismiss.mockClear(); });

describe('at rest', () => {
  it('asks the question and names both answers', () => {
    renderIt();
    expect(screen.getByText('Did you act on this?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
  });

  // Without it the pair reads as a satisfaction survey, and "Not applicable"
  // looks like a way to hide the row rather than a recorded judgement.
  it('says what the answer is FOR', () => {
    renderIt();
    expect(screen.getByText('Either answer is recorded — it is how Lumi learns whether its calls were right.'))
      .toBeInTheDocument();
  });

  it.each([
    ['I executed this', () => onExecute, () => onDismiss],
    ['Not applicable',  () => onDismiss, () => onExecute],
  ])('%s calls its own handler, once, and not the other', (label, called, other) => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(called()).toHaveBeenCalledTimes(1);
    expect(other()).not.toHaveBeenCalled();
  });

  // It knows nothing about decisionId, entityId or which route the write takes.
  it('passes no arguments of its own — the host owns the routing', () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'I executed this' }));
    expect(onExecute).toHaveBeenCalledWith(expect.anything()); // the click event only
    expect(onExecute.mock.calls[0]).toHaveLength(1);
  });
});

describe('a surface that cannot record must not ask', () => {
  it.each([
    [{ onExecute: null, onDismiss: null }, 'neither handler'],
    [{ onDismiss: null }, 'only an execute handler'],
    [{ onExecute: null }, 'only a dismiss handler'],
  ])('renders nothing given %s', (props) => {
    const { container } = renderIt(props);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing at all with no props', () => {
    const { container } = render(<DecisionLifecycle />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the five things it can say instead', () => {
  it.each([
    ['executing',  'Recording…'],
    ['dismissing', 'Recording…'],
    ['executed',   'Recorded as executed'],
    ['dismissed',  'Recorded as not applicable'],
    ['stale',      'This verdict was replaced — refresh to see the current one'],
    ['error',      "Couldn't record — refresh and try again"],
  ])('%s reads "%s"', (executionState, sentence) => {
    renderIt({ executionState });
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  // ONE-WAY. A control that still looks clickable after being answered invites
  // a second click, and a second click on a recorded claim is not a second
  // claim. `stale` and `error` are terminal for the same reason — neither gets
  // better by sending the same request again.
  it.each([['executing'], ['dismissing'], ['executed'], ['dismissed'], ['stale'], ['error']])(
    '%s replaces the buttons rather than disabling them', (executionState) => {
      const { container } = renderIt({ executionState });
      expect(container.querySelectorAll('button')).toHaveLength(0);
      expect(screen.queryByText('Did you act on this?')).not.toBeInTheDocument();
    },
  );

  // "Refresh" and "try again" mean different things: one says the call is gone,
  // the other says the write failed. Collapsing them would send an operator at
  // a request that 404s forever.
  it('keeps a replaced verdict distinct from a failed write', () => {
    const stale = render(<DecisionLifecycle onExecute={onExecute} onDismiss={onDismiss} executionState="stale" />);
    expect(stale.container.querySelector('.text-trend-danger')).toBeNull();
    stale.unmount();

    const failed = render(<DecisionLifecycle onExecute={onExecute} onDismiss={onDismiss} executionState="error" />);
    expect(failed.container.querySelector('.text-trend-danger')).not.toBeNull();
  });

  // An unknown state is not an invitation to guess. Better to show nothing than
  // to claim an answer was recorded, or to re-offer a question already answered.
  it('says nothing for a state it does not know', () => {
    const { container } = renderIt({ executionState: 'ZZ_NOT_A_STATE' });
    expect(container.textContent).toBe('');
  });
});

describe('it holds no state and no data access', () => {
  it('owns no hook, no request and no decision identity', () => {
    const code = codeOf();
    expect(code).not.toMatch(/useState|useEffect|useDecisionAction|decisionSignals|api|fetch\(/);
    expect(code).not.toMatch(/decisionId|entityId|by-entity/);
  });

  it('is the only definition of these sentences', () => {
    // If a second copy appears, the six answers can drift on the one surface
    // that must not drift. Both hosts render this component; neither restates it.
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const host of ['ExecutionContext.jsx', 'CampaignDetailPanel.jsx']) {
      const src = readFileSync(path.resolve(dir, host), 'utf8');
      expect(src).toMatch(/<DecisionLifecycle/);
      expect(src).not.toMatch(/I executed this|Recorded as executed/);
    }
  });
});
