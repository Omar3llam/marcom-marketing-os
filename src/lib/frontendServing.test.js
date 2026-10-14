import { describe, it, expect } from 'vitest';
import { shouldServeFrontend } from './frontendServing.js';

describe('static UI deployment contract', () => {
  it('preserves the existing defaults', () => {
    expect(shouldServeFrontend('production', undefined)).toBe(true);
    expect(shouldServeFrontend('development', undefined)).toBe(false);
    expect(shouldServeFrontend('test', undefined)).toBe(false);
  });
  it('allows a production API deployment to opt out explicitly', () => {
    expect(shouldServeFrontend('production', 'false')).toBe(false);
    expect(shouldServeFrontend('production', 'true')).toBe(true);
    expect(shouldServeFrontend('development', 'true')).toBe(false);
  });
  it.each(['', '0', '1', 'FALSE', 'yes'])('refuses ambiguous configuration %j', value => {
    expect(() => shouldServeFrontend('production', value)).toThrow('SERVE_FRONTEND');
  });
});
