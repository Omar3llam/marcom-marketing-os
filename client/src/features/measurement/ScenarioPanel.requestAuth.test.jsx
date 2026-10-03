import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioPanel } from './ScenarioPanel.jsx';

describe('Scenario request/auth presentation precedence', () => {
  it.each(['result', 'error', 'plan', 'permission', 'auth', 'message'])('pending suppresses prior %s presentation', (prior) => {
    const props = {
      result: { scenario: { projections: { volume: { low: 90, expected: 100, high: 110 } },
        confidence: 0.6, assumptions: ['Previous assumption'], basis: 'Previous basis' } },
      error: { error: new Error('Previous failure') },
      plan: { gated: true, gateReason: 'PLAN_REQUIRED' },
      permission: { gated: true, gateReason: 'NOT_PERMITTED' },
      auth: { error: { httpStatus: 401 }, failureReason: 'AUTH_REQUIRED' },
      message: { message: 'No channel data to project yet.' },
    };
    const { container } = render(<MemoryRouter><ScenarioPanel {...props[prior]} loading onRun={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Projecting…' })).toBeDisabled();
    expect(container.textContent).not.toMatch(/100|Projected outcome|confidence|Previous|Couldn’t project|Pro feature|isn’t available|session needs authentication|No channel data/);
  });

  it('auth evidence alone blocks direct form submission, without depending on error text', () => {
    const onRun = vi.fn();
    const { container } = render(<ScenarioPanel failureReason="AUTH_REQUIRED" onRun={onRun} />);
    const button = screen.getByRole('button', { name: 'Project' });
    expect(button).toBeDisabled(); fireEvent.click(button); fireEvent.submit(container.querySelector('form'));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByText(/session needs authentication/)).toBeInTheDocument();
  });
});
