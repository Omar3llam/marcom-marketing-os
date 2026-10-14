import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { healthLabel } from '../services/analysis/AccountHealthService.js';
const labels = [...new Set(Array.from({length: 101}, (_, score) => healthLabel(score)))];
describe('published account health vocabulary (legacy consumer parity is tested separately)', () => {
  it('publishes the five measured bands', () => {
    expect(labels.sort()).toEqual(['CRITICAL', 'FAIR', 'GOOD', 'HEALTHY', 'NEEDS ATTENTION'].sort());
    expect(labels).not.toContain('Fair — review soon');
    expect(labels).not.toContain('ZZZ_NOT_A_BAND');
  });
  it('publishes label beside score, and explicit nulls for no data', () => {
    const route = readFileSync(new URL('../routes/lumi/entities.js', import.meta.url), 'utf8');
    expect(route).toMatch(/score: null, label: null/);
    expect(route).toMatch(/\.\.\.health,/);
  });
});
