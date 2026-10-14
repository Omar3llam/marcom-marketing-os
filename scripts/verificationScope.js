import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Full checks require their frontend subject. A backend invocation makes a
// narrower claim explicitly, while retaining every backend rule.
export function verificationScope(root, args = process.argv.slice(2)) {
  if (args.length && (args.length !== 1 || args[0] !== '--backend')) {
    throw new Error('Expected no arguments (full verification) or --backend');
  }
  const includeFrontend = args.length === 0;
  const required = ['src', 'prisma', 'packages/runtime-contracts'];
  if (includeFrontend) required.push('client/src');
  for (const dir of required) {
    const full = join(root, dir);
    if (!existsSync(full) || readdirSync(full).length === 0) {
      throw new Error(`Verification subject missing or empty: ${dir}`);
    }
  }
  console.log(`Verification scope: ${includeFrontend ? 'backend + legacy frontend' : 'backend only; frontend rules belong to the separate legacy checks'}`);
  return { includeFrontend };
}
