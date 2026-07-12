// ============================================================
// CopilotPanel — slide-over chat UI (useCopilot mocked)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CopilotPanel from './CopilotPanel.jsx';
import { useCopilot } from '@/hooks/useCopilot.js';

vi.mock('@/hooks/useCopilot.js', () => ({ useCopilot: vi.fn() }));

const base = () => ({ messages: [], isAsking: false, error: null, ask: vi.fn(), clear: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  useCopilot.mockReturnValue(base());
});

describe('CopilotPanel', () => {
  it('shows the empty state with example questions and asks one on click', () => {
    const state = { ...base(), ask: vi.fn() };
    useCopilot.mockReturnValue(state);
    render(<CopilotPanel isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Ask Lumi')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Why did CPA increase this week?'));
    expect(state.ask).toHaveBeenCalledWith('Why did CPA increase this week?');
  });

  it('submits typed input on Enter', () => {
    const state = { ...base(), ask: vi.fn() };
    useCopilot.mockReturnValue(state);
    render(<CopilotPanel isOpen onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Ask about your campaigns...');
    fireEvent.change(input, { target: { value: 'why did CPA jump?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.ask).toHaveBeenCalledWith('why did CPA jump?');
  });

  it('renders messages and a typing indicator while asking', () => {
    useCopilot.mockReturnValue({
      ...base(),
      isAsking: true,
      messages: [{ id: '1', role: 'user', content: 'hi' }, { id: '2', role: 'assistant', content: 'hello there' }],
    });
    render(<CopilotPanel isOpen onClose={vi.fn()} />);

    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByTestId('copilot-typing')).toBeInTheDocument();
  });

  it('closes on backdrop click and on Escape', () => {
    const onClose = vi.fn();
    const { container } = render(<CopilotPanel isOpen onClose={onClose} />);

    fireEvent.click(container.querySelector('[aria-hidden="true"]'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows Clear only when there are messages, and calls clear', () => {
    const state = { ...base(), clear: vi.fn(), messages: [{ id: '1', role: 'user', content: 'hi' }] };
    useCopilot.mockReturnValue(state);
    render(<CopilotPanel isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Clear'));
    expect(state.clear).toHaveBeenCalled();
  });
});
