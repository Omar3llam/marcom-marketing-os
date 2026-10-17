import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const render = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
const build = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts.build;
const release = readFileSync(new URL('../../docs/BACKEND_STABILIZATION_03A.md', import.meta.url), 'utf8');
const service = (type) => render.match(new RegExp(`  - type: ${type}\\r?\\n[\\s\\S]*?(?=\\r?\\n  - type:|\\r?\\n databases:|$)`))?.[0];

describe('AllocationPlan migration ownership after 03A', () => {
  it('holds both automatic releases and requires operator verification before either rollout', () => {
    const web = service('web');
    const worker = service('worker');
    expect(web).toContain('buildCommand: npm ci --include=dev && npm run build');
    expect(build).toBe('npm run prisma:generate && npm run build:client');
    expect(worker).toContain('buildCommand: npm ci --include=dev && npm run build:worker');
    for (const s of [web, worker]) {
      expect(s).toContain('autoDeployTrigger: off');
      expect(s).not.toMatch(/preDeployCommand:|buildCommand:.*(?:migrate|resolve)/);
    }
    expect(worker).toContain('startCommand: npm run worker');
    expect(release).toContain('One named migration owner');
    expect(release).toContain('history + native catalog compatibility passes');
    expect(release).toContain('Worker at the SAME SHA');
    // This checks the declared release contract, not an automated runtime gate.
    expect(release).toContain('OPEN release blockers');
  });
});
