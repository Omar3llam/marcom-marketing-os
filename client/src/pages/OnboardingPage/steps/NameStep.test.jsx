import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NameStep } from './NameStep.jsx';

beforeEach(() => { localStorage.clear(); });

describe('NameStep', () => {
  it('Continue is disabled until a name is entered', () => {
    render(<NameStep onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('persists the name to localStorage and advances', () => {
    const onNext = vi.fn();
    render(<NameStep onNext={onNext} />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: '  Acme  ' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onNext).toHaveBeenCalledWith('Acme');
    expect(localStorage.getItem('marcom:onboarding:name')).toBe('Acme');
  });

  it('does NOT write the backend context (deferred until after OAuth)', () => {
    // NameStep must not import/call the api client — the write happens later so
    // OnboardingRoute can't bounce the user out mid-flow.
    const onNext = vi.fn();
    render(<NameStep onNext={onNext} />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme' } });
    fireEvent.keyDown(screen.getByLabelText(/workspace name/i), { key: 'Enter' });
    expect(onNext).toHaveBeenCalledWith('Acme');
  });
});
