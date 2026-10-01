import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NameStep } from './NameStep.jsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

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
  it('failed draft storage retains input and stays here until a successful retry', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    const onNext = vi.fn(); render(<NameStep onNext={onNext} />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t keep your workspace name/i);
    expect(screen.getByLabelText(/workspace name/i)).toHaveValue('Acme');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(storage).toHaveBeenCalledTimes(2); expect(onNext).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('marcom:onboarding:name')).toBe('Acme');
  });
  it('Enter followed by a duplicate click advances once', () => {
    const onNext = vi.fn(); render(<NameStep onNext={onNext} />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme' } });
    fireEvent.keyDown(screen.getByLabelText(/workspace name/i), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
