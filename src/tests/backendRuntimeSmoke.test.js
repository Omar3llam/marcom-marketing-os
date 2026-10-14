import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function run(mode) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return spawnSync(process.execPath, [
    '--import', pathToFileURL(resolve('src/tests/fixtures/backendSmoke.fixture.js')).href,
    resolve('scripts/backend-runtime-smoke.js'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 8000,
    env: {...env, SMOKE_FIXTURE_MODE: mode,
      SMOKE_DATABASE_URL: 'postgresql://fixture@127.0.0.1:55431/lumi_slice01_fixture',
      SMOKE_REDIS_URL: 'redis://127.0.0.1:56381'},
  });
}

describe('F-2 — smoke CLI must observe a live child through verification', () => {
  it.each(['worker-exit-17', 'worker-exit-0', 'worker-signal'])('refuses %s after readiness markers', mode => {
    const result = run(mode);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toMatch(/worker terminated before.*(?:code|signal)/);
    if (mode === 'worker-exit-17') expect(result.stderr).toContain('code=17');
    if (mode === 'worker-signal') expect(result.stderr).toContain('SIGTERM');
    expect(result.stdout).not.toContain('worker boot verified');
  }, 10000);

  it('refuses an API exit while waiting for its response', () => {
    const result = run('api-exit-17');
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toMatch(/api terminated before.*code=17/);
    expect(result.stdout).not.toContain('api boot verified');
  }, 10000);

  it('accepts live API/worker fixtures and performs expected SIGTERM cleanup', () => {
    const result = run('live');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('api boot verified');
    expect(result.stdout).toContain('worker boot verified');
    for (const kind of ['api', 'worker']) {
      expect(result.stdout).toContain(`FIXTURE kill ${kind}: SIGTERM`);
      expect(result.stdout).toContain(process.platform === 'win32'
        ? `FIXTURE closed ${kind}: code=null signal=SIGTERM`
        : `FIXTURE closed ${kind}: code=0 signal=null cleanup=true`);
    }
  }, 10000);
});
