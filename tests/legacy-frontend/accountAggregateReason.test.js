import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
it('the account aggregate reader branches on the published no-measurement reason', () => {
  const read = (...path) => readFileSync(join(process.cwd(), ...path), 'utf8');
  expect(read('src', 'routes', 'lumi', 'account.js')).toContain("reason: 'NO_CANONICAL_MEASUREMENT'");
  expect(read('client', 'src', 'lib', 'accountAggregate.js')).toContain('NO_CANONICAL_MEASUREMENT');
});
