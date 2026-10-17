import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture } from './fixtures/buildBoundary.fixture.js';

describe('03A P1 explicit legacy migration target', () => {
  for (const [label, value] of [['absent', undefined], ['empty', '']]) {
    it(`fails the actual npm entrypoint with DATABASE_URL ${label}, before any database attempt`, () => {
      // Fresh isolated cwd, credential allowlist and inert dotenv/config: no .env
      // is loaded. The real migration script uses a rejecting postgres sentinel.
      const f = buildFixture({ client: false });
      try {
        expect(existsSync(join(f.root, '.env'))).toBe(false);
        const r = f.run(['run', 'db:migrate:legacy'], {
          DATABASE_URL: value, DIRECT_URL: undefined,
        });
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain('[migrate] DATABASE_URL is required — refusing migration.');
        expect(r.out).not.toContain('[migrate] Applying schema');
        expect(r.events, 'no postgres constructor, socket, SQL or CLI attempt').toEqual([]);
      } finally { f.close(); }
    }, 35_000);
  }

  it('a supplied fixture URL still reaches the existing postgres boundary, which prevents real SQL', () => {
    const f = buildFixture({ client: false });
    try {
      // Uses only the fixture's unreachable loopback URL; constructor throws
      // before any socket/SQL. This does not certify a successful migration.
      const r = f.run(['run', 'db:migrate:legacy']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).not.toContain('DATABASE_URL is required');
      expect(r.events).toEqual([{ kind: 'FORBIDDEN', detail: 'postgres constructor' }]);
    } finally { f.close(); }
  }, 35_000);
});
