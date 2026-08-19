// ============================================================
// DecisionJudgment — what the six answers look like
// ------------------------------------------------------------
// A pure renderer, so every state is reachable by props alone. The properties
// worth pinning are not "the button exists" but the ones a well-meaning change
// would quietly remove:
//   · no decisionId ⇒ ask NOTHING (there is no row to attach reasoning to)
//   · a recorded judgement REPLACES the controls, and offers no way to edit
//   · an absence is a sentence, never a zero
//   · a 409 shows the server's judgement instead of claiming success
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionJudgment } from './DecisionJudgment.jsx';

const AT = '2026-08-19T12:41:00.000Z';
const JUDGED = {
  humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE',
  humanReasonNote: 'Prospecting budget, measured on reach', humanRespondedAt: AT,
};
const setup = (props = {}) =>
  render(<DecisionJudgment decisionId="dec_1" onSubmit={vi.fn()} {...props} />);

describe('identity gate', () => {
  it('renders NOTHING without a decisionId', () => {
    // A campaign no sweep has written a Decision for has no row to judge.
    // Asking anyway would collect reasoning we could only attach by guessing.
    const { container } = render(<DecisionJudgment decisionId={null} onSubmit={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks the question when a decision exists and none is judged', () => {
    setup();
    expect(screen.getByText('What did you decide?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjust' })).toBeInTheDocument();
  });

  it('says the judgment changes nothing in the ad account', () => {
    // Without this, three buttons beside a KILL read as instructions to Lumi.
    setup();
    expect(screen.getByText(/changes nothing in your ad account/i)).toBeInTheDocument();
  });
});

describe('CONFIRM — one click, no reason', () => {
  it('submits immediately with the response alone', () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith({ response: 'CONFIRM' });
  });
});

describe.each([
  ['Override', 'OVERRIDE'],
  ['Adjust', 'ADJUST'],
])('%s — a reason is required', (label, response) => {
  it('does not submit on the first click; it asks why', () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Pick a reason to record this/i)).toBeInTheDocument();
  });

  it('submits the canonical CODE once a reason is picked', () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Top-of-funnel role' }));
    fireEvent.click(screen.getByRole('button', { name: `Record ${label}` }));
    // The label is what the marketer read; TOF_ROLE is what the column stores.
    expect(onSubmit).toHaveBeenCalledWith({ response, reasonCode: 'TOF_ROLE', reasonNote: '' });
  });

  it('keeps the note optional and sends it when written', () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Seasonality' }));
    fireEvent.change(screen.getByPlaceholderText('Optional note'), { target: { value: 'Ramadan push' } });
    fireEvent.click(screen.getByRole('button', { name: `Record ${label}` }));
    expect(onSubmit).toHaveBeenCalledWith({ response, reasonCode: 'SEASONALITY', reasonNote: 'Ramadan push' });
  });

  it('offers all nine canonical reasons and no others', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: label }));
    for (const name of [
      'Top-of-funnel role', 'Brand role', 'Different objective', 'Business constraint',
      'Seasonality', 'Deliberate test', 'Data is misleading', 'Risk tolerance', 'Other',
    ]) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('can be cancelled back to the question', () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('What did you decide?')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('a recorded judgment', () => {
  it('renders the response, reason, note and time', () => {
    setup({ judgment: JUDGED });
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
    expect(screen.getByText('Top-of-funnel role')).toBeInTheDocument();
    expect(screen.getByText(/Prospecting budget, measured on reach/)).toBeInTheDocument();
    expect(screen.getByText(/^Recorded /)).toBeInTheDocument();
  });

  it('REPLACES the controls — the record is first-write-wins', () => {
    setup({ judgment: JUDGED });
    expect(screen.queryByText('What did you decide?')).not.toBeInTheDocument();
    for (const name of ['Confirm', 'Override', 'Adjust']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('offers no way to edit, change, delete or reset it', () => {
    setup({ judgment: JUDGED });
    expect(screen.queryByText(/edit|change|delete|reset|undo/i)).not.toBeInTheDocument();
  });

  it('names no actor — R13 stores none, and the session is not one', () => {
    setup({ judgment: JUDGED });
    expect(screen.queryByText(/\bby\s+\S/i)).not.toBeInTheDocument();
  });

  it('omits the reason line entirely for a CONFIRM', () => {
    setup({ judgment: { humanResponse: 'CONFIRM', humanReasonCode: null, humanReasonNote: null, humanRespondedAt: AT } });
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    // A blank line here would read as a reason we failed to load.
    expect(screen.queryByText('Top-of-funnel role')).not.toBeInTheDocument();
  });

  it('renders no time when the stamp is unparseable, rather than a made-up one', () => {
    setup({ judgment: { ...JUDGED, humanRespondedAt: 'not-a-date' } });
    expect(screen.queryByText(/^Recorded /)).not.toBeInTheDocument();
  });
});

describe('states', () => {
  it('loading says it is recording, and shows no judgment yet', () => {
    setup({ state: 'saving' });
    expect(screen.getByText(/Recording…/)).toBeInTheDocument();
    expect(screen.queryByText('Your decision')).not.toBeInTheDocument();
  });

  it('success confirms, beside the judgment that was written', () => {
    setup({ state: 'recorded', judgment: JUDGED });
    expect(screen.getByText('Recorded')).toBeInTheDocument();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
  });

  it('409 shows the judgment on record and does NOT claim success', () => {
    setup({ state: 'conflict', judgment: JUDGED });
    expect(screen.getByText(/already recorded/i)).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
    expect(screen.queryByText('Recorded')).not.toBeInTheDocument();
  });

  it('400 shows the server validation message', () => {
    setup({ state: 'invalid', message: 'OVERRIDE requires a structured reasonCode' });
    expect(screen.getByText(/requires a structured reasonCode/)).toBeInTheDocument();
  });

  it('403 says permission, not failure', () => {
    setup({ state: 'denied' });
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('404 says unavailable, not "no judgment yet"', () => {
    setup({ state: 'unavailable' });
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByText(/No judgment recorded yet/i)).not.toBeInTheDocument();
  });

  it('a superseded verdict is terminal, not retryable', () => {
    setup({ state: 'superseded' });
    expect(screen.getByText(/replaced/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('500 fails honestly and never degrades into an empty state', () => {
    setup({ state: 'error' });
    expect(screen.getByText(/Couldn't record your judgment/i)).toBeInTheDocument();
    expect(screen.queryByText(/No judgment recorded yet/i)).not.toBeInTheDocument();
  });
});

describe('read-only (no onSubmit)', () => {
  it('renders a recorded judgment with no controls', () => {
    render(<DecisionJudgment decisionId="dec_1" judgment={JUDGED} onSubmit={null} />);
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('states the absence as a sentence, never as a zero', () => {
    render(<DecisionJudgment decisionId="dec_1" judgment={null} onSubmit={null} />);
    expect(screen.getByText('No judgment recorded yet')).toBeInTheDocument();
    // "0 judgments" / "0% override" would be metrics, and no query backs them.
    expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

describe('no fabricated aggregates anywhere', () => {
  it('never renders a count, a rate or an accuracy figure', () => {
    const { container } = setup({ judgment: JUDGED });
    expect(container.textContent).not.toMatch(/override rate|judgments?\b.*\d|accuracy|win rate|\d+%/i);
  });
});
