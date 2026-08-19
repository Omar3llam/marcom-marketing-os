// ============================================================
// LumiExecute — what the operator is told, and when
// ------------------------------------------------------------
// This is the surface that could lie. Everything below is about the two ways it
// must not: offering to run something that cannot be run, and calling a queued
// request a completed one.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LumiExecute } from './LumiExecute.jsx';
import { EXEC_STATE } from './useLumiExecution.js';

const supported = { supported: true, actionType: 'PAUSE_CAMPAIGN', targetId: '2385', targetType: 'campaign', reason: null };
const refused = (reason, over = {}) => ({ supported: false, actionType: null, targetId: null, targetType: null, reason, ...over });

const show = (props = {}) => render(<LumiExecute execution={supported} onExecute={() => {}} {...props} />);

describe('it only offers what the server said is runnable', () => {
  it('renders nothing without a server descriptor', () => {
    const { container } = render(<LumiExecute execution={null} onExecute={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without a handler — a surface that cannot act must not offer to', () => {
    const { container } = render(<LumiExecute execution={supported} onExecute={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the platform action in the button', () => {
    show();
    expect(screen.getByRole('button')).toHaveTextContent(/pause this campaign on meta/i);
  });

  it('says out loud that it changes the ad account', () => {
    show();
    // Without this, "Run this for me" sits beside "I executed this" and the two
    // read as the same act phrased differently.
    expect(screen.getByText(/make this change on your ad account/i)).toBeInTheDocument();
  });

  it('calls back exactly once per click', async () => {
    const onExecute = vi.fn();
    show({ onExecute });
    await userEvent.click(screen.getByRole('button'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });
});

describe('refusals say something useful, or stay silent', () => {
  it.each([
    ['NEEDS_OPERATOR_INPUT', /budget or creative you choose/i],
    ['UNSUPPORTED_CHANNEL', /only run actions on meta/i],
    ['NO_PLATFORM_ID', /no platform link/i],
  ])('%s explains itself and offers no button', (reason, copy) => {
    render(<LumiExecute execution={refused(reason)} onExecute={() => {}} />);
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['NO_DECISION', 'NO_ACTION_FOR_VERDICT'])('%s renders nothing at all', (reason) => {
    // A HOLD needs no explanation for the absence of a button; explaining it
    // would be noise about something the operator never asked for.
    const { container } = render(<LumiExecute execution={refused(reason)} onExecute={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('queued is never rendered as done', () => {
  it.each([
    [EXEC_STATE.SUBMITTING, /sending to meta/i],
    [EXEC_STATE.QUEUED, /queued/i],
    [EXEC_STATE.EXECUTING, /running on meta/i],
  ])('%s reads as in-flight, not complete', (state, copy) => {
    show({ state });
    expect(screen.getByText(copy)).toBeInTheDocument();
    // The assertion this file exists for.
    expect(screen.queryByText(/confirmed/i)).toBeNull();
    expect(screen.queryByText(/\bdone\b/i)).toBeNull();
  });

  it('QUEUED says Meta has not been called yet', () => {
    show({ state: EXEC_STATE.QUEUED });
    expect(screen.getByText(/hasn’t called meta yet/i)).toBeInTheDocument();
  });

  it('only EXECUTED_SUCCESS claims Meta confirmed it', () => {
    show({ state: EXEC_STATE.EXECUTED_SUCCESS });
    expect(screen.getByText(/meta confirmed this change/i)).toBeInTheDocument();
  });

  it('a platform refusal says nothing was changed', () => {
    show({ state: EXEC_STATE.EXECUTED_FAILED });
    expect(screen.getByText(/meta refused this action\. nothing was changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a timeout is neither a success nor a platform refusal', () => {
    show({ state: EXEC_STATE.TIMED_OUT });
    expect(screen.getByText(/timed out before meta confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/refused/i)).toBeNull();
    expect(screen.queryByText(/confirmed this change/i)).toBeNull();
  });

  it('every in-flight and terminal state replaces the button', () => {
    for (const state of [
      EXEC_STATE.SUBMITTING, EXEC_STATE.QUEUED, EXEC_STATE.EXECUTING,
      EXEC_STATE.EXECUTED_SUCCESS, EXEC_STATE.EXECUTED_FAILED, EXEC_STATE.REJECTED,
    ]) {
      const { unmount } = show({ state });
      expect(screen.queryByRole('button'), `${state} must not keep a clickable control`).toBeNull();
      unmount();
    }
  });
});

describe('rejections name the real problem', () => {
  it('an unresolvable attribution says so, and never suggests a name fallback', () => {
    show({ state: EXEC_STATE.REJECTED, rejection: 'ATTRIBUTION_UNRESOLVED' });
    expect(screen.getByText(/couldn't be linked to an executable request/i)).toBeInTheDocument();
    expect(screen.queryByText(/campaign name/i)).toBeNull();
  });

  it.each([
    ['NOT_PERMITTED', /role cannot run platform actions/i],
    ['BUSY', /queue is full/i],
    ['ALREADY_QUEUED', /already has an execution in progress/i],
  ])('%s renders its own sentence', (rejection, copy) => {
    show({ state: EXEC_STATE.REJECTED, rejection });
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it('an unknown rejection falls back without claiming anything about Meta', () => {
    show({ state: EXEC_STATE.REJECTED, rejection: 'SOMETHING_ELSE' });
    expect(screen.getByText(/couldn't start this action/i)).toBeInTheDocument();
    expect(screen.queryByText(/meta refused/i)).toBeNull();
  });
});
