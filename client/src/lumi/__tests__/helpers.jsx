// Test helpers for LUMI primitives. Not a test file.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { Environment } from '../primitives/Environment.jsx';

/** Renders inside a router and an environment, the way a surface will. */
export function renderIn(ui, env = 'product') {
  return render(
    <MemoryRouter>
      <Environment env={env}>{ui}</Environment>
    </MemoryRouter>,
  );
}

/** React logs the errors that a refusing part throws; keep test output readable. */
export function quietRenderErrors() {
  let spy;
  // jsdom reports an error thrown during render as an uncaught window error
  // unless the event is cancelled; the throw itself still reaches the test.
  const cancel = (event) => event.preventDefault();
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', cancel);
  });
  afterEach(() => {
    spy.mockRestore();
    window.removeEventListener('error', cancel);
  });
}

/** Asserts that rendering `ui` is refused with a message matching `pattern`. */
export function expectRefused(ui, pattern, env) {
  expect(() => renderIn(ui, env)).toThrow(pattern);
}
