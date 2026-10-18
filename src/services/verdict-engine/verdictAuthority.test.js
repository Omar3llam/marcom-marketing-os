// ============================================================
// R8 — the verdict topology, asserted structurally
// ------------------------------------------------------------
// The behavioural tests prove ONE sweep computes ONE verdict. This one proves
// the shape that makes that true and keeps it true: exactly one place runs the
// engine over connector evidence, exactly one place persists the result, and
// nothing anywhere derives a verdict of its own.
//
// A grep is the right instrument for this, and it is the only one. The defects
// R8 removed were all invisible to behavioural tests: four call sites each
// passed their own suite while collectively computing the same decision four
// times, because "did this function return the right verdict?" is a question
// every one of them answered correctly.
//
// SCOPE: the CONNECTOR verdict. Guardrail verdicts are a separate authority over
// a separate population (rule spec, OPERATIONAL) and are deliberately untouched
// — see the boundary test at the bottom.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, lstatSync, realpathSync, openSync, fstatSync, closeSync, constants, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC    = fileURLToPath(new URL('../..', import.meta.url));          // src/

// Comments stripped first — this file's own notes name the calls it constrains,
// as do the explanatory comments left at each R8 seam. A scanner that cannot
// tell prose from a call would force us to delete the explanation to pass.
const stripCode = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (file) => SNAPSHOT.code(file);

const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const filesMatching = (root, pattern, snapshot = SNAPSHOT) => snapshot.filesFor(root)
  .filter((f) => pattern.test(snapshot.code(f)))
  .map((f) => rel(root, f))
  .sort();


const REQUIRED_FILES = Object.freeze([
  'services/verdict-engine/verdictTypes.js',
  'services/verdict-engine/VerdictService.js',
  'routes/lumi/entities.js',
  'services/guardrail-engine/GuardrailSweepService.js',
]);

/** Eager per-suite capture; assertions receive only sealed strings and paths. */
function loadSourceSnapshot(root, { readSource = readFileSync, directoryEntries = readdirSync, requiredTargets = REQUIRED_FILES } = {}) {
  if (typeof root !== 'string' || !root || root.includes('\0') || !path.isAbsolute(root)) throw new Error('Malformed source root');
  const target = path.resolve(root);
  for (let ancestor = target; ; ancestor = path.dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlink in source root');
    if (ancestor === path.dirname(ancestor)) break;
  }
  if (!lstatSync(target).isDirectory()) throw new Error('Source root is not a directory');
  root = realpathSync(target);
  const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
  const inside = file => {
    const relative = path.relative(root, file);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  // Read-only fixture hard links change ctime/nlink without changing content.
  const unchanged = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
  const raw = new Map(), code = new Map(), records = [], files = [], seen = new Set();
  const capture = file => {
    const before = lstatSync(file);
    if (before.isSymbolicLink()) throw new Error('Symlink source file: ' + file);
    if (!before.isFile()) throw new Error('Invalid source file: ' + file);
    const canonical = realpathSync(file);
    if (!inside(canonical)) throw new Error('Source outside root: ' + file);
    if (raw.has(key(canonical))) throw new Error('Duplicate source file: ' + file);
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let text;
    try {
      const opened = fstatSync(fd);
      if (!unchanged(before, opened)) throw new Error('Source changed before capture: ' + file);
      text = readSource(fd, 'utf8');
      if (!unchanged(opened, fstatSync(fd))) throw new Error('Source changed during capture: ' + file);
    } finally { closeSync(fd); }
    const after = lstatSync(file);
    if (after.isSymbolicLink() || !unchanged(before, after) || realpathSync(file) !== canonical) throw new Error('Source changed after capture: ' + file);
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty source file: ' + file);
    raw.set(key(canonical), text);
    code.set(key(canonical), stripCode(text));
    records.push({ file, stat: after, canonical });
    return canonical;
  };
  const walk = dir => {
    const before = lstatSync(dir);
    if (before.isSymbolicLink()) throw new Error('Symlink source directory: ' + dir);
    if (!before.isDirectory()) throw new Error('Invalid source directory: ' + dir);
    const names = directoryEntries(dir);
    if (!Array.isArray(names)) throw new Error('Invalid directory entries');
    for (const name of names) {
      if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name) || path.basename(name) !== name) throw new Error('Malformed source entry');
      const folded = path.join(dir, name).normalize('NFC').toLowerCase();
      if (seen.has(folded)) throw new Error('Duplicate or case-colliding source entry');
      seen.add(folded);
    }
    for (const name of names) {
      const file = path.join(dir, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Symlink source entry: ' + file);
      if (stat.isDirectory()) { if (name !== 'node_modules') walk(file); }
      else if (!stat.isFile()) throw new Error('Invalid source entry: ' + file);
      else if (/\.(js|jsx)$/.test(name) && !name.includes('.test.')) files.push(capture(file));
    }
    records.push({ file: dir, stat: before, canonical: realpathSync(dir) });
  };
  walk(root);
  if (!files.length) throw new Error('Empty applicable source corpus');
  if (!Array.isArray(requiredTargets)) throw new Error('Malformed required targets');
  const required = new Set();
  for (const relative of requiredTargets) {
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Malformed required target');
    const file = path.resolve(root, relative);
    if (!inside(file)) throw new Error('Required target outside root');
    const folded = key(file).normalize('NFC').toLowerCase();
    if (required.has(folded)) throw new Error('Duplicate required target');
    required.add(folded);
    for (let ancestor = path.dirname(file); ancestor !== root; ancestor = path.dirname(ancestor)) {
      if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlink required target ancestor');
    }
    if (!raw.has(key(file))) capture(file);
  }
  // Detect changes to an earlier file/directory before sealing the whole capture.
  for (const record of records) {
    const current = lstatSync(record.file);
    if (current.isSymbolicLink() || !unchanged(record.stat, current) || realpathSync(record.file) !== record.canonical) throw new Error('Source changed before snapshot seal: ' + record.file);
  }
  const lookup = (map, file) => {
    if (typeof file !== 'string' || !file || file.includes('\0') || !path.isAbsolute(file)) throw new Error('Malformed snapshot target');
    const resolved = path.resolve(file);
    if (!inside(resolved)) throw new Error('Snapshot target outside root');
    if (!map.has(key(resolved))) throw new Error('Missing snapshot entry: ' + file);
    return map.get(key(resolved));
  };
  Object.freeze(files);
  return Object.freeze({ root, files, read: file => lookup(raw, file), code: file => lookup(code, file), filesFor(subjectRoot) {
    if (typeof subjectRoot !== 'string' || !subjectRoot || subjectRoot.includes('\0') || key(path.resolve(subjectRoot)) !== key(root)) throw new Error('Snapshot root mismatch');
    return files;
  } });
}

let SNAPSHOT;
beforeAll(() => {
  const started = performance.now();
  SNAPSHOT = loadSourceSnapshot(SRC);
  console.info('SOURCE_SNAPSHOT', JSON.stringify({ files: SNAPSHOT.files.length,
    js: SNAPSHOT.files.filter(f => f.endsWith('.js')).length,
    jsx: SNAPSHOT.files.filter(f => f.endsWith('.jsx')).length, captureMs: performance.now() - started }));
});

// A CALL, not a mention: `name(`. Import lines and re-exports never match.
const callsTo = (name) => new RegExp(`\\b${name}\\s*\\(`);

describe('R8 · one authority computes the connector verdict', () => {
  it('the canonical EVIDENCE read has exactly one VERDICT consumer', () => {
    // getCanonicalVerdictCampaigns is the door every connector verdict comes
    // through. One caller ⇒ one computation site, and no consumer can widen or
    // re-scope the population behind the engine's back (Controls 5–8).
    //
    // R13-C adds a SECOND reader that is not a verdict consumer: /entities/health
    // scores account health over the same canonical rows. It was reading the
    // OPERATIONAL population — an aggregate covering whatever the last sync
    // requested — while weighting it by canonical 30-day verdicts, so its
    // `wastedSpend` was a lifetime figure attached to a 30-day judgement.
    //
    // Why that does not breach this control: the route does not judge. It takes
    // verdicts verbatim from getConnectorVerdicts (pinned in
    // entities.health.test.js: "derives every health figure from that one verdict
    // set — it re-judges nothing"), and the two assertions below still forbid it
    // from running the engine on the rows it reads. Reading the population is
    // permitted; being a second authority over it is not.
    //
    // Adding a name here is therefore a deliberate act, not a formality: a new
    // entry must be a reader that provably does not judge.
    expect(filesMatching(SRC, callsTo('getCanonicalVerdictCampaigns'))).toEqual([
      'routes/lumi/entities.js',                           // R13-C — health scoring, judges nothing
      'services/entity-graph/EntityGraphService.js',       // the definition
      'services/verdict-engine/connectorVerdictService.js', // evaluateConnectorVerdicts
    ]);
  });

  it('the ENGINE is run in exactly two places, both inside the engine directory', () => {
    // connectorVerdictService — evaluateConnectorVerdicts, the connector path.
    // VerdictService      — persistLevelVerdicts, the raw-tree entry a
    //                       non-connector caller uses. It does NOT serve the
    //                       connector write path any more; persistConnectorVerdicts
    //                       stores what it was handed.
    expect(filesMatching(SRC, callsTo('rollupVerdicts'))).toEqual([
      'services/verdict-engine/VerdictService.js',
      'services/verdict-engine/connectorVerdictService.js',
      'services/verdict-engine/verdictEngine.js',      // the definition (recursive)
    ]);
    // evaluateVerdict — the per-node judgement — is called by nothing but the
    // rollup. A consumer reaching past rollupVerdicts to judge a single node
    // would be a second authority with none of the cohort context.
    expect(filesMatching(SRC, callsTo('evaluateVerdict'))).toEqual([
      'services/verdict-engine/verdictEngine.js',
    ]);
  });

  // CONTROL 12 — the agentic loop must never become a verdict engine.
  it('no consumer outside the engine directory runs the engine', () => {
    const engineCalls = /\b(rollupVerdicts|evaluateVerdict|applyRelativeRanking|buildConnectorVerdictTree)\s*\(/;
    const outsiders = filesMatching(SRC, engineCalls)
      .filter((f) => !f.startsWith('services/verdict-engine/'));
    expect(outsiders).toEqual([]);
  });

  // CONTROL 2/4 — no consumer re-derives a verdict from raw metrics (I27).
  it('nothing on the backend turns a number into a verdict', () => {
    // The precise shape of a second authority: a numeric comparison whose
    // branches are verdict literals. AccountHealthService's verdict→score maps
    // run the other way (verdict in, number out) and are consumers, not authors.
    const derivation = /[<>]=?\s*[\d.]+\s*\?\s*['"`](KILL|SCALE|HOLD|WATCH|REFRESH|REALLOCATE|OPTIMIZE)/;
    expect(filesMatching(SRC, derivation)).toEqual([]);
  });

  it('OPTIMIZE is not a verdict this system can emit', () => {
    // It appears in one dead client mapper and in no engine. Asserted so a
    // "missing" verdict is never quietly added to a consumer instead of the one
    // place verdict vocabulary is defined.
    const types = SNAPSHOT.read(path.join(SRC, 'services/verdict-engine/verdictTypes.js'));
    expect(types).not.toMatch(/OPTIMIZE/);
  });
});

describe('R8 · persistence is a sink, not a second computation', () => {
  it('persistConnectorVerdicts neither reads evidence nor runs the engine', () => {
    const src = codeOf(path.join(SRC, 'services/verdict-engine/VerdictService.js'));
    // The body between the signature and the end of the function. Scoped to the
    // function because persistLevelVerdicts, further up the same file, legitimately
    // annotates a raw tree for a non-connector caller.
    const body = src.slice(src.indexOf('export async function persistConnectorVerdicts'));
    expect(body).not.toMatch(callsTo('getCanonicalVerdictCampaigns'));
    expect(body).not.toMatch(callsTo('rollupVerdicts'));
    expect(body).not.toMatch(callsTo('applyRelativeRanking'));
    expect(body).not.toMatch(callsTo('buildConnectorVerdictTree'));
    // What it DOES do: check the result is usable, then store it.
    expect(body).toMatch(callsTo('assertUsableEvaluation'));
    expect(body).toMatch(callsTo('persistAnnotatedVerdicts'));
  });

  it('the synthetic ACCOUNT root is skipped EXPLICITLY, not by accident', () => {
    // It used to be skipped because the write path built a rootless literal and
    // persistNode ignores an id-less node. Both twins now share ONE tree, whose
    // root carries `id: workspaceId` — so the old accident would have started
    // writing an ACCOUNT Decision per sweep with a workspace id in entityId.
    const src = codeOf(path.join(SRC, 'services/verdict-engine/VerdictService.js'));
    const body = src.slice(src.indexOf('export async function persistConnectorVerdicts'));
    expect(body).toMatch(/skipRoot:\s*true/);
  });
});

describe('R8 · failure is explicit, never an empty verdict set (I29)', () => {
  it('no verdict read is caught into an empty verdicts array', () => {
    // The exact fallback R8 removed from copilot.js and PortfolioAnalysisService.
    // "The verdict engine failed" and "this account has no verdicts" are opposite
    // facts that render identically, and the model narrated the second one.
    const collapse = /catch\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*\{\s*verdicts:\s*\[\s*\]/;
    expect(filesMatching(SRC, collapse)).toEqual([]);
  });

  it('no verdict read is caught into a fabricated verdict', () => {
    const invented = /getConnectorVerdicts\([^)]*\)\s*\.catch\([^)]*(KILL|SCALE|HOLD|WATCH)/;
    expect(filesMatching(SRC, invented)).toEqual([]);
  });
});

// CONTROL 11 — a cached verdict must never become the current one.
describe('R8 · CampaignReasoning stays a cache', () => {
  it('only its writer and its labelled reader touch the table', () => {
    expect(filesMatching(SRC, /prisma\.campaignReasoning\b/)).toEqual([
      'routes/lumi/entities.js',                        // labelled reader (publishes `stale`)
      'services/analysis/CampaignReasoningService.js',  // the writer
    ]);
  });

  it('the reader publishes staleness beside the cached verdict', () => {
    // The row carries a `verdict` column. Publishing it without saying how old it
    // is would let a client treat a cached verdict as the current one — which is
    // precisely what I30 forbids. The live verdict lives on /entities/verdicts.
    const src = codeOf(path.join(SRC, 'routes/lumi/entities.js'));
    const route = src.slice(src.indexOf("'/entities/:id/reasoning'"));
    expect(route).toMatch(/stale/);
    // …and it never feeds a Decision or an account-health computation.
    expect(route).not.toMatch(callsTo('computeAccountHealth'));
    expect(route).not.toMatch(/prisma\.decision\.create/);
  });
});

// The boundary R8 must NOT cross (§16).
describe('R8 · Guardrail and Connector remain separate authorities', () => {
  it('the guardrail sweep does not run the connector verdict path', () => {
    const src = codeOf(path.join(SRC, 'services/guardrail-engine/GuardrailSweepService.js'));
    expect(src).not.toMatch(callsTo('evaluateConnectorVerdicts'));
    expect(src).not.toMatch(callsTo('getConnectorVerdicts'));
    expect(src).not.toMatch(callsTo('getCanonicalVerdictCampaigns'));
  });
});


// Private source subjects exercise the same rules without editing real source.
const FIXTURE = Object.freeze({
  'routes/lumi/entities.js': "getCanonicalVerdictCampaigns(); prisma.campaignReasoning.findMany(); const route = '/entities/:id/reasoning'; const cache = { stale: true };",
  'services/entity-graph/EntityGraphService.js': 'export function getCanonicalVerdictCampaigns() {}',
  'services/verdict-engine/connectorVerdictService.js': 'getCanonicalVerdictCampaigns(); rollupVerdicts();',
  'services/verdict-engine/verdictEngine.js': 'export function rollupVerdicts() { evaluateVerdict(); } export function evaluateVerdict() {}',
  'services/verdict-engine/verdictTypes.js': "export const VERDICTS = ['KILL', 'SCALE', 'HOLD'];",
  'services/verdict-engine/VerdictService.js': 'rollupVerdicts(); export async function persistConnectorVerdicts() { assertUsableEvaluation(); persistAnnotatedVerdicts({ skipRoot: true }); }',
  'services/analysis/CampaignReasoningService.js': 'prisma.campaignReasoning.create({ data: {} });',
  'services/guardrail-engine/GuardrailSweepService.js': 'export function guardrailSweep() {}',
});
const CANONICAL_CALLERS = Object.freeze([
  'routes/lumi/entities.js',
  'services/entity-graph/EntityGraphService.js',
  'services/verdict-engine/connectorVerdictService.js',
]);
function withSourceFixture(run, populate = true) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'lumi-verdict-snapshot-'));
  const root = path.join(sandbox, 'source');
  mkdirSync(root);
  const put = (relative, text) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  try {
    if (populate) for (const [file, text] of Object.entries(FIXTURE)) put(file, text);
    return run({ root, sandbox, put });
  } finally {
    const rel = path.relative(path.resolve(tmpdir()), path.resolve(sandbox));
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
      || !path.basename(sandbox).startsWith('lumi-verdict-snapshot-') || lstatSync(sandbox).isSymbolicLink()) {
      throw new Error('Unsafe private fixture teardown');
    }
    rmSync(sandbox, { recursive: true });
  }
}

describe('source snapshot fixture', () => {
  it('captures eagerly once, stays immutable, and preserves raw versus code reads', () => withSourceFixture(({ root, put }) => {
    const file = put('probe.jsx', '// prose\nexport const value = 1;');
    let reads = 0;
    const snapshot = loadSourceSnapshot(root, { readSource(fd, encoding) { reads++; return readFileSync(fd, encoding); } });
    expect(reads).toBeGreaterThan(0);
    const captured = reads;
    writeFileSync(file, 'export const changed = true;');
    expect(snapshot.read(file)).toContain('// prose');
    expect(snapshot.code(file)).not.toContain('// prose');
    expect(snapshot.code(file)).toContain('value = 1');
    expect(reads).toBe(captured);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.files)).toBe(true);
    expect(() => snapshot.files.push(file)).toThrow();
  }));

  it('preserves exact js/jsx discovery and node_modules/test-name exclusions', () => withSourceFixture(({ root, put }) => {
    const jsx = put('unseen/view.jsx', 'export const view = true;');
    put('node_modules/dependency.js', 'getCanonicalVerdictCampaigns();');
    put('ignored.test.extra.jsx', 'getCanonicalVerdictCampaigns();');
    put('README.md', 'getCanonicalVerdictCampaigns();');
    const snapshot = loadSourceSnapshot(root);
    expect(snapshot.files).toContain(jsx);
    expect(snapshot.files).toHaveLength(Object.keys(FIXTURE).length + 1);
    expect(filesMatching(root, callsTo('getCanonicalVerdictCampaigns'), snapshot)).toEqual(CANONICAL_CALLERS);
  }));

  it('eagerly includes an explicitly required target excluded from traversal', () => withSourceFixture(({ root, put }) => {
    const file = put('required.test.js', '// raw literal\nexport const required = true;');
    const snapshot = loadSourceSnapshot(root, { requiredTargets: [...REQUIRED_FILES, 'required.test.js'] });
    expect(snapshot.files).not.toContain(file);
    writeFileSync(file, 'changed after capture');
    expect(snapshot.read(file)).toContain('raw literal');
  }));

  it('rejects missing and empty applicable corpora', () => withSourceFixture(({ root, put, sandbox }) => {
    expect(() => loadSourceSnapshot(path.join(sandbox, 'missing'))).toThrow();
    expect(() => loadSourceSnapshot(root)).toThrow(/empty/i);
    put('ignored.test.js', 'export const ignored = true;');
    put('README.md', 'not source');
    expect(() => loadSourceSnapshot(root)).toThrow(/empty/i);
  }, false));

  it('rejects empty files instead of partial capture', () => withSourceFixture(({ root, put }) => {
    put('empty.js', '');
    expect(() => loadSourceSnapshot(root)).toThrow(/empty/i);
  }));

  it('rejects a missing required single-file subject', () => withSourceFixture(({ root }) => {
    unlinkSync(path.join(root, REQUIRED_FILES[0]));
    expect(() => loadSourceSnapshot(root)).toThrow();
  }));

  it('fails eagerly on unreadable source', () => withSourceFixture(({ root }) => {
    expect(() => loadSourceSnapshot(root, { readSource() { throw new Error('EACCES: denied synthetic read'); } })).toThrow(/EACCES/);
  }));

  it('rejects malformed roots and outside or malformed reader targets', () => withSourceFixture(({ root, sandbox }) => {
    for (const bad of [undefined, null, 42, '', '../relative', 'bad\0root']) expect(() => loadSourceSnapshot(bad)).toThrow();
    const snapshot = loadSourceSnapshot(root), outside = path.join(sandbox, 'outside.js');
    writeFileSync(outside, 'outside');
    expect(() => snapshot.read(outside)).toThrow(/root|outside/i);
    expect(() => snapshot.read(null)).toThrow();
    expect(() => filesMatching(sandbox, /anything/, snapshot)).toThrow(/root/i);
  }));

  it.each([
    ['duplicate', ['probe.js', 'probe.js']],
    ['case collision', ['probe.js', 'PROBE.js']],
    ['path traversal', ['../outside.js']],
    ['malformed entry', ['']],
  ])('rejects %s directory entries', (_label, entries) => withSourceFixture(({ root }) => {
    expect(() => loadSourceSnapshot(root, { directoryEntries(dir) { return dir === realpathSync(root) ? entries : readdirSync(dir); } })).toThrow(/duplicate|collid|entry|escape|root/i);
  }));

  it.each([['../outside.js'], ['/absolute.js'], ['routes/lumi/entities.js', 'routes/lumi/entities.js']])('rejects malformed or duplicate required targets %j', (...requiredTargets) => withSourceFixture(({ root }) => {
    expect(() => loadSourceSnapshot(root, { requiredTargets })).toThrow(/root|target|duplicate|outside/i);
  }));

  it('rejects symlinked descendants and root ancestors', () => withSourceFixture(({ root, sandbox }) => {
    const outside = path.join(sandbox, 'outside'); mkdirSync(outside); writeFileSync(path.join(outside, 'escape.js'), 'outside');
    const descendant = path.join(root, 'linked'); symlinkSync(outside, descendant, 'junction');
    try { expect(() => loadSourceSnapshot(root)).toThrow(/symlink|link/i); } finally { unlinkSync(descendant); }
    const ancestor = path.join(sandbox, 'alias'); symlinkSync(sandbox, ancestor, 'junction');
    try { expect(() => loadSourceSnapshot(path.join(ancestor, 'source'))).toThrow(/symlink|link/i); } finally { unlinkSync(ancestor); }
  }));

  it('rejects files changed while capturing', () => withSourceFixture(({ root }) => {
    const file = path.join(root, REQUIRED_FILES[0]);
    expect(() => loadSourceSnapshot(root, { readSource(fd, encoding) {
      const text = readFileSync(fd, encoding);
      if (fstatSync(fd).ino === lstatSync(file).ino) writeFileSync(file, text + '\nchanged during capture');
      return text;
    } })).toThrow(/changed/i);
  }));

  it('permits read-only hard-link metadata changes without changing captured content', () => withSourceFixture(({ root, sandbox }) => {
    const file = path.join(root, REQUIRED_FILES[0]);
    const snapshot = loadSourceSnapshot(root, { readSource(fd, encoding) {
      const text = readFileSync(fd, encoding);
      if (fstatSync(fd).ino === lstatSync(file).ino) linkSync(file, path.join(sandbox, 'read-only-copy.js'));
      return text;
    } });
    expect(lstatSync(file).nlink).toBe(2);
    expect(snapshot.read(file)).toBe(FIXTURE[REQUIRED_FILES[0]]);
  }));

  it('rejects missing entries without a disk fallback and discovers new modules on a new capture', () => withSourceFixture(({ root, put }) => {
    const first = loadSourceSnapshot(root), added = put('new.jsx', 'getCanonicalVerdictCampaigns();');
    expect(() => first.read(added)).toThrow(/snapshot entry/i);
    expect(first.files).not.toContain(added);
    const second = loadSourceSnapshot(root);
    expect(second.files).toContain(added);
    expect(second.read(added)).toContain('getCanonicalVerdictCampaigns');
  }));

  it.each(['g', 'y'])('preserves RegExp %s flags and lastIndex semantics', (flags) => withSourceFixture(({ root }) => {
    const snapshot = loadSourceSnapshot(root), pattern = new RegExp('getCanonicalVerdictCampaigns', flags), reference = new RegExp(pattern.source, flags);
    pattern.lastIndex = reference.lastIndex = 2;
    const expected = snapshot.files.filter(file => reference.test(stripCode(snapshot.read(file)))).map(file => rel(root, file)).sort();
    expect(filesMatching(root, pattern, snapshot)).toEqual(expected);
    expect(pattern.lastIndex).toBe(reference.lastIndex);
  }));
});

describe('synthetic authority ratchets', () => {
  it('retains all legitimate rosters and raw-literal behavior', () => withSourceFixture(({ root }) => {
    const snapshot = loadSourceSnapshot(root);
    expect(filesMatching(root, callsTo('getCanonicalVerdictCampaigns'), snapshot)).toEqual(CANONICAL_CALLERS);
    expect(filesMatching(root, callsTo('rollupVerdicts'), snapshot)).toEqual(['services/verdict-engine/VerdictService.js', 'services/verdict-engine/connectorVerdictService.js', 'services/verdict-engine/verdictEngine.js']);
    expect(filesMatching(root, callsTo('evaluateVerdict'), snapshot)).toEqual(['services/verdict-engine/verdictEngine.js']);
    expect(snapshot.read(path.join(root, REQUIRED_FILES[0]))).not.toMatch(/OPTIMIZE/);
  }));

  it.each(['new-consumer.js', 'unseen/view.jsx'])('fails the original exact-three-caller rule for %s', (file) => withSourceFixture(({ root, put }) => {
    put(file, 'getCanonicalVerdictCampaigns();');
    const snapshot = loadSourceSnapshot(root), offenders = filesMatching(root, callsTo('getCanonicalVerdictCampaigns'), snapshot);
    expect(offenders).toContain(file);
    expect(() => expect(offenders).toEqual(CANONICAL_CALLERS)).toThrow();
  }));

  it('fails the original outside-owner engine invocation rule', () => withSourceFixture(({ root, put }) => {
    put('outsider.js', 'rollupVerdicts(tree);');
    const snapshot = loadSourceSnapshot(root);
    const outsiders = filesMatching(root, /\b(rollupVerdicts|evaluateVerdict|applyRelativeRanking|buildConnectorVerdictTree)\s*\(/, snapshot).filter(file => !file.startsWith('services/verdict-engine/'));
    expect(outsiders).toEqual(['outsider.js']);
    expect(() => expect(outsiders).toEqual([])).toThrow();
  }));

  it.each([
    ['numeric verdict', "const verdict = spend > 0 ? 'SCALE' : 'HOLD';", /[<>]=?\s*[\d.]+\s*\?\s*['"`](KILL|SCALE|HOLD|WATCH|REFRESH|REALLOCATE|OPTIMIZE)/],
    ['empty fallback', 'read().catch(() => ({ verdicts: [] }));', /catch\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*\{\s*verdicts:\s*\[\s*\]/],
    ['fabricated fallback', "getConnectorVerdicts(id).catch(error => 'KILL');", /getConnectorVerdicts\([^)]*\)\s*\.catch\([^)]*(KILL|SCALE|HOLD|WATCH)/],
  ])('fails the original %s rule', (_label, source, rule) => withSourceFixture(({ root, put }) => {
    put('forbidden.js', source);
    const snapshot = loadSourceSnapshot(root), offenders = filesMatching(root, rule, snapshot);
    expect(offenders).toEqual(['forbidden.js']);
    expect(() => expect(offenders).toEqual([])).toThrow();
  }));

  it('excludes comments-only decoys while retaining the URL-safe comment expression', () => withSourceFixture(({ root, put }) => {
    put('decoy.jsx', '// getCanonicalVerdictCampaigns();\n/* rollupVerdicts(); */\nconst url = "https://example.test";');
    const snapshot = loadSourceSnapshot(root);
    expect(filesMatching(root, callsTo('getCanonicalVerdictCampaigns'), snapshot)).toEqual(CANONICAL_CALLERS);
    expect(snapshot.code(path.join(root, 'decoy.jsx'))).toContain('https://example.test');
  }));

  it('keeps the raw OPTIMIZE check distinct from stripped code', () => withSourceFixture(({ root, put }) => {
    const file = put(REQUIRED_FILES[0], FIXTURE[REQUIRED_FILES[0]] + '\n// OPTIMIZE');
    const snapshot = loadSourceSnapshot(root);
    expect(snapshot.code(file)).not.toMatch(/OPTIMIZE/);
    expect(() => expect(snapshot.read(file)).not.toMatch(/OPTIMIZE/)).toThrow();
  }));

  it('keeps the guardrail/connector authority boundary executable', () => withSourceFixture(({ root, put }) => {
    const file = put(REQUIRED_FILES[3], 'getConnectorVerdicts();');
    const snapshot = loadSourceSnapshot(root);
    expect(() => expect(snapshot.code(file)).not.toMatch(callsTo('getConnectorVerdicts'))).toThrow();
  }));
});
