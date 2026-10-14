import { existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

// One traversal for frontend subjects. Options preserve the scanners' existing
// test/generated-file policies; unreadable directories fail rather than vanish.
export function discoverFrontendSources(dir, extensions = ['.js', '.jsx'], {includeTests = true, includeDist = true} = {}) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || (!includeDist && entry.name === 'dist')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...discoverFrontendSources(full, extensions, {includeTests, includeDist}));
    else if (extensions.includes(extname(entry.name)) && (includeTests || !full.includes('.test.'))) files.push(full);
  }
  return files;
}

// Full checks require their frontend subject. A backend invocation makes a
// narrower claim explicitly, while retaining every backend rule.
export function verificationScope(root, args = process.argv.slice(2)) {
  if (args.length && (args.length !== 1 || args[0] !== '--backend')) {
    throw new Error('Expected no arguments (full verification) or --backend');
  }
  const includeFrontend = args.length === 0;
  const required = ['src', 'prisma', 'packages/runtime-contracts'];
  for (const dir of required) {
    const full = join(root, dir);
    if (!existsSync(full) || readdirSync(full).length === 0) {
      throw new Error(`Verification subject missing or empty: ${dir}`);
    }
  }
  if (includeFrontend && discoverFrontendSources(join(root, 'client/src'), ['.js', '.jsx'], {includeTests: false, includeDist: false}).length === 0) {
    throw new Error('Missing frontend source: client/src is missing, empty, or contains no applicable non-test JS/JSX files');
  }
  console.log(`Verification scope: ${includeFrontend ? 'backend + legacy frontend' : 'backend only; frontend rules belong to the separate legacy checks'}`);
  return { includeFrontend };
}
