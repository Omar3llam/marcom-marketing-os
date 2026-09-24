import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const render = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
const build = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts.build;
const service = (type) => render.match(new RegExp(`  - type: ${type}\\r?\\n[\\s\\S]*?(?=\\r?\\n  - type:|\\r?\\n databases:|$)`))?.[0];

describe('AllocationPlan additive migration deploy order', () => {
  it('migrates before either independently deployed service can start new code', () => {
    const web = service('web');
    const worker = service('worker');
    expect(web).toContain('buildCommand: npm run build');
    expect(build.indexOf('node scripts/prisma-migrate-safe.js')).toBeGreaterThan(-1);
    expect(build.indexOf('node scripts/prisma-migrate-safe.js')).toBeLessThan(build.indexOf('npm run build --workspace client'));
    expect(worker).toMatch(/buildCommand:.*npx prisma generate.*node scripts\/prisma-migrate-safe\.js/);
    expect(worker).toContain('startCommand: npm run worker');
  });
});
