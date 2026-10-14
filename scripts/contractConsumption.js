// ============================================================
// FE-06 · The contract-consumption graph
// ------------------------------------------------------------
// Measures three seams between the client and the API it is typed against:
//
//   1. which modules call the API client, and which of them PARSE the response
//   2. which client contract schemas are REACHED from a schema a hook parses
//   3. which published endpoints have no client caller at all
//
// It only ever DETECTS. Nothing here deletes a schema, arms a validator or
// retires a route — those are rulings, not measurements (LOCK 2).
//
// ── WHY EACH RULE IS SHAPED THIS WAY ────────────────────────────────────────
// Every rule below exists because a simpler version of it produced a wrong
// answer during FE-06's discovery. They are not defensive style; each one is a
// measured failure:
//
//   • NAME MATCHING said `approval.schema` had a consumer. `useApprovals.js`
//     imports those very names from `plan.schema`, where they are DUPLICATED.
//     A name cannot tell you which module it came from — so consumption is
//     attributed by IMPORT SOURCE, resolving the barrel by hand.
//
//   • PREFIX MATCHING let `/connections` count as called because
//     `/api/lumi/connections/account` is called. A parent is not consumed
//     because a child is — so endpoint matching is EXACT.
//
//   • RAW TEXT counted a dozen doc-comments as call sites for
//     `GET /api/lumi/feed`, an endpoint FE-03 proved has no reader — so every
//     source is comment-stripped first.
//
//   • Even stripped, `/api/lumi/feed` still read as consumed, because
//     `contracts/adapters/lumiFeed.adapter.ts` names it in an error label. That
//     module has zero importers and parses a payload someone else fetched — so
//     `contracts/` is excluded from the CALLER corpus. It describes contracts;
//     it does not call them.
//
//   • REFERENCE is not REACHABILITY. `campaign.schema` is referenced by
//     `api.schema`, and nothing imports api.schema — so the graph is walked
//     from the roots a production hook actually parses.
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CLIENT_SRC = join(ROOT, 'client', 'src');
const SCHEMA_DIR = join(CLIENT_SRC, 'contracts', 'schemas');
const ROUTES_DIR = join(ROOT, 'src', 'routes');

const SOURCE_EXT = ['.js', '.jsx', '.ts', '.tsx'];
const isTest = (p) => /\.test\.|__tests__|[\\/]tests[\\/]/.test(p);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.some((e) => full.endsWith(e)) && !isTest(full)) out.push(full);
  }
  return out;
}

const posix = (p) => relative(ROOT, p).split('\\').join('/');

/**
 * Remove comments while PRESERVING string literals.
 *
 * A regex stripper cannot do this. The obvious one runs the block-comment
 * pattern first, which opens a phantom comment on the `/*` inside a path glob
 * — `//   /app/(star)   ProtectedRoute` in App.jsx swallowed 350 lines and made
 * a verifier report a line that was plainly there as MISSING. Deciding per
 * position which token comes first fixes that; tracking string state also keeps
 * `'https://x'` and `'/app/(star)'` intact without a special case for `://`.
 */
export function stripComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 1; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') { state = { "'": 'sq', '"': 'dq', '`': 'tpl' }[c]; out += c; continue; }
      out += c;
      continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 1; } else if (c === '\n') out += c; continue; }
    // inside a string literal
    if (c === '\\') { out += c + (d ?? ''); i += 1; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) { state = 'code'; }
    out += c;
  }
  return out;
}

const API_CALL = /\bapi\.(get|post|put|patch|delete)\s*\(/;
const VALIDATES = /safeParse|contracts\/schemas/;

/** Production client sources, comment-stripped, keyed by repo-relative path. */
function clientSources() {
  const map = new Map();
  for (const f of walk(CLIENT_SRC)) map.set(posix(f), stripComments(readFileSync(f, 'utf8')));
  return map;
}

/** [1] Who calls the API client, and who parses what comes back. */
export function measureCallers(sources = clientSources()) {
  const callers = [];
  for (const [path, src] of sources) {
    if (!API_CALL.test(src)) continue;
    const verbs = [...src.matchAll(/\bapi\.(get|post|put|patch|delete)\s*\(/g)].map((m) => m[1]);
    callers.push({
      path,
      validates: VALIDATES.test(src),
      mutates: verbs.some((v) => v !== 'get'),
    });
  }
  callers.sort((a, b) => a.path.localeCompare(b.path));
  return callers;
}

// Compatibility entries preserve the legacy public names. Follow their shared
// implementation so moving a schema cannot erase its reachability edges.
function schemaSource(file) {
  const source = readFileSync(join(SCHEMA_DIR, file), 'utf8');
  const proxy = source.match(/export \* from '\.\.\/\.\.\/\.\.\/\.\.\/packages\/api-contracts\/schemas\/([A-Za-z0-9_]+\.schema)'/);
  return proxy ? readFileSync(join(ROOT, 'packages/api-contracts/schemas', proxy[1] + '.ts'), 'utf8') : source;
}

/** [2] Which schemas are REACHED from a schema a production module parses. */
export function measureSchemas(sources = clientSources()) {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.ts'));

  // the barrel: which schema file does each re-exported name come from?
  const barrel = readFileSync(join(SCHEMA_DIR, 'index.ts'), 'utf8');
  const nameToFile = new Map();
  for (const m of barrel.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.replace(/\btype\b/, '').trim();
      if (n) nameToFile.set(n, `${m[2]}.ts`);
    }
  }

  // roots: schemas a production module outside contracts/ actually imports
  const roots = new Set();
  const importers = new Map(files.map((f) => [f, new Set()]));
  for (const [path, src] of sources) {
    if (path.startsWith('client/src/contracts/')) continue;
    for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']*contracts\/schemas[^']*)'/g)) {
      const names = m[1].split(',').map((s) => s.replace(/\btype\b/, '').trim()).filter(Boolean);
      const direct = m[2].match(/schemas\/([A-Za-z0-9_.]+)$/);
      const hit = (file) => { if (importers.has(file)) { roots.add(file); importers.get(file).add(path); } };
      if (direct) hit(`${direct[1]}.ts`);
      else names.forEach((n) => { const f = nameToFile.get(n); if (f) hit(f); });
    }
  }

  // edges, then the walk
  const deps = new Map(files.map((f) => [
    f,
    new Set([...schemaSource(f).matchAll(/from\s*'\.\/([A-Za-z0-9_]+)\.schema'/g)].map((m) => `${m[1]}.schema.ts`)),
  ]));
  const reached = new Set();
  const walkDeps = (f) => { if (reached.has(f)) return; reached.add(f); for (const d of deps.get(f) ?? []) walkDeps(d); };
  [...roots].forEach(walkDeps);

  return {
    all: files.map((f) => f.replace('.schema.ts', '')).sort(),
    roots: [...roots].map((f) => f.replace('.schema.ts', '')).sort(),
    reached: [...reached].map((f) => f.replace('.schema.ts', '')).sort(),
    unreached: files.filter((f) => !reached.has(f)).map((f) => f.replace('.schema.ts', '')).sort(),
    importers,
  };
}

/** [3] Which published endpoints no client module calls. */
export function measureEndpoints(sources = clientSources()) {
  const endpoints = [];
  for (const f of walk(ROUTES_DIR)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:\w+Router|router)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      endpoints.push({ file: posix(f), verb: m[1].toUpperCase(), path: m[2] });
    }
  }

  // contracts/ is excluded: it describes contracts, it does not call them.
  const clientPaths = new Set();
  for (const [path, src] of sources) {
    if (path.startsWith('client/src/contracts/')) continue;
    for (const m of src.matchAll(/['"`](\/api\/[^'"`$\s]*)/g)) clientPaths.add(m[1]);
  }

  const calledBy = (routePath) => {
    const stat = routePath.replace(/\/:.*$/, '');
    for (const c of [`/api/lumi${stat}`, `/api${stat}`, stat]) {
      if (clientPaths.has(c)) return c;
      if (clientPaths.has(`${c}/`)) return `${c}/`;
    }
    return null;
  };

  const lumi = endpoints.filter((e) => e.file.includes('src/routes/lumi/'));
  return {
    total: endpoints.length,
    clientPaths: clientPaths.size,
    uncalled: lumi
      .filter((e) => !calledBy(e.path))
      .map((e) => `${e.verb} ${e.path}`)
      .sort(),
    calledBy,
  };
}

export function buildGraph() {
  const sources = clientSources();
  return {
    sources,
    callers: measureCallers(sources),
    schemas: measureSchemas(sources),
    endpoints: measureEndpoints(sources),
  };
}

// Run by hand: `node scripts/contractConsumption.js`
if (process.argv[1] && process.argv[1].endsWith('contractConsumption.js')) {
  const g = buildGraph();
  const unval = g.callers.filter((c) => !c.validates);
  console.log(`callers ${g.callers.length}  validating ${g.callers.length - unval.length}  unvalidated ${unval.length} (${unval.filter((c) => c.mutates).length} mutating)`);
  console.log(`schemas ${g.schemas.all.length}  roots ${g.schemas.roots.length}  reached ${g.schemas.reached.length}  unreached ${g.schemas.unreached.length}`);
  console.log(`lumi endpoints with no client caller: ${g.endpoints.uncalled.length}`);
  console.log('\nunvalidated:\n  ' + unval.map((c) => c.path.replace('client/src/', '')).join('\n  '));
  console.log('\nunreached schemas:\n  ' + g.schemas.unreached.join('\n  '));
  console.log('\nuncalled endpoints:\n  ' + g.endpoints.uncalled.join('\n  '));
}
