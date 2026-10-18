// ============================================================
// C-10 · the jurisdiction — every touch of `decisions` is accounted for
// ------------------------------------------------------------
// The eleven blind reads discovery found were not written carelessly. They were
// written BEFORE the class that would have contaminated them existed, and
// nothing told anyone to revisit them. A unit test per site cannot prevent the
// twelfth; only a rule over the whole table can.
//
// So this is a census, in the same family as `migrationCompatibility` (counts
// migrations), `epistemicInventory` (counts vocabularies) and `ciParityContract`
// (counts scripts): it scans the source, classifies every call site, and pins
// the totals. A new one shows up as a failure that names the file.
//
// SCOPE OF THE SCAN, stated so it can be argued with: `src/**` excluding tests.
// The client never queries Prisma, and `packages/` holds no I/O.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, lstatSync, realpathSync, openSync, fstatSync, closeSync, constants, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('../../', import.meta.url)));

/** Capture each applicable file once; assertions can only read sealed entries. */
function loadSourceSnapshot(root, { directoryEntries = readdirSync, readSource = readFileSync } = {}) {
  if (typeof root !== 'string' || !root || root.includes('\0') || !isAbsolute(root)) {
    throw new Error('Malformed source root');
  }
  const target = resolve(root);
  for (let ancestor = target; ; ancestor = dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlink in source root');
    if (dirname(ancestor) === ancestor) break;
  }
  if (!lstatSync(target).isDirectory()) throw new Error('Source root is not a directory');
  root = realpathSync(target);
  const inside = (file) => {
    const rel = relative(root, file);
    return rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
  };
  const key = (file) => process.platform === 'win32' ? file.toLowerCase() : file;
  const entries = new Map(), files = [], seen = new Set();
  // Other suites create read-only hard links: ctime/nlink can change without a write.
  const unchanged = (a, b) => a.dev === b.dev && a.ino === b.ino
    && a.size === b.size && a.mtimeMs === b.mtimeMs;
  const capture = (file) => {
    const before = lstatSync(file);
    if (before.isSymbolicLink()) throw new Error('Symlink source entry: ' + file);
    if (!before.isFile()) throw new Error('Invalid source file: ' + file);
    const canonical = realpathSync(file);
    if (!inside(canonical)) throw new Error('Source outside root: ' + file);
    if (entries.has(key(canonical))) throw new Error('Duplicate source entry: ' + file);
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let text;
    try {
      const opened = fstatSync(fd);
      if (!unchanged(before, opened)) throw new Error('Source changed before capture: ' + file);
      text = readSource(fd, 'utf8');
      if (!unchanged(opened, fstatSync(fd))) throw new Error('Source changed during capture: ' + file);
    } finally { closeSync(fd); }
    const after = lstatSync(file);
    if (after.isSymbolicLink() || !unchanged(before, after) || realpathSync(file) !== canonical) {
      throw new Error('Source changed after capture: ' + file);
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty source file: ' + file);
    entries.set(key(canonical), text);
    return canonical;
  };
  const walk = (dir) => {
    const before = lstatSync(dir);
    if (before.isSymbolicLink()) throw new Error('Symlink source directory: ' + dir);
    if (!before.isDirectory() || !inside(realpathSync(dir))) throw new Error('Invalid source directory: ' + dir);
    const names = directoryEntries(dir);
    if (!Array.isArray(names)) throw new Error('Invalid source directory entries');
    for (const name of names) {
      if (typeof name !== 'string' || !name || name === '.' || name === '..'
        || /[\\/\0]/.test(name) || basename(name) !== name) throw new Error('Malformed source entry');
      const full = join(dir, name), folded = full.normalize('NFC').toLowerCase();
      if (seen.has(folded)) throw new Error('Duplicate or case-colliding source entry: ' + full);
      seen.add(folded);
    }
    for (const name of names) {
      const file = join(dir, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Symlink source entry: ' + file);
      if (stat.isDirectory()) walk(file);
      else if (!stat.isFile()) throw new Error('Invalid source entry: ' + file);
      else if (file.endsWith('.js') && !file.endsWith('.test.js')) files.push(capture(file));
    }
    if (!unchanged(before, lstatSync(dir))) throw new Error('Source directory changed during capture: ' + dir);
  };
  walk(join(root, 'src'));
  if (!files.length) throw new Error('Empty applicable source corpus');
  const read = (file) => {
    if (typeof file !== 'string' || !file || file.includes('\0') || !isAbsolute(file)) {
      throw new Error('Malformed source target');
    }
    const target = resolve(file);
    if (!inside(target)) throw new Error('Source target outside root');
    if (!entries.has(key(target))) throw new Error('Missing snapshot entry: ' + file);
    return entries.get(key(target));
  };
  return Object.freeze({ root, files: Object.freeze(files), read });
}

let SNAPSHOT;
beforeAll(() => {
  const started = performance.now();
  SNAPSHOT = loadSourceSnapshot(resolve(SRC, '..'));
  console.info('SOURCE_SNAPSHOT', JSON.stringify({ suite: 'jurisdiction', files: SNAPSHOT.files.length, elapsedMs: performance.now() - started }));
});

const WRITE = /\bdecision\.(create|createMany)\s*\(/g;
const READ  = /\bdecision\.(findMany|findFirst|findUnique|findUniqueOrThrow|count|aggregate|groupBy|updateMany)\s*\(/g;

/** The call's argument text: from the opening paren to its match. */
function callBody(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/** Comments carry the defect verbatim in this slice — measure CODE only. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

function sites(pattern, snapshot = SNAPSHOT) {
  const found = [];
  for (const file of snapshot.files) {
    const source = stripComments(snapshot.read(file));
    for (const m of source.matchAll(pattern)) {
      const open = source.indexOf('(', m.index + m[0].length - 1);
      found.push({
        file: relative(join(snapshot.root, 'src'), file).split(sep).join('/'),
        op: m[1],
        body: callBody(source, open),
      });
    }
  }
  return found;
}

// A predicate that names ONE ROW is class-safe by construction: an id resolves
// to a single decision, so there is no population to mis-scope. This is the one
// legitimate way to touch the table without declaring a class.
const byId = (body) => (
  /\bwhere:\s*\{[^}]*\bid\s*[,:]/.test(body)  // `{ id, workspaceId }` and `{ id: x, … }` alike
  || /\bid:\s*\{\s*in:/.test(body)            // a batch of ids is still row addressing
);

// How a population read declares what it accepts. `scopeFor(id)` is the seam;
// a bare `decisionClass` predicate is accepted too, because a read that names
// the column inline has said the same thing — the ledger is for finding readers,
// not for gatekeeping the syntax.
const declares = (body) => (
  /\bscopeFor\s*\(\s*['"`]/.test(body)
  || /\bdecisionClass\s*:/.test(body)
);

function undeclaredWriters(snapshot) {
    const declares$ = /\bdecisionClass\s*:/;
    return sites(WRITE, snapshot)
      .filter((s) => (s.op === 'createMany'
        ? !declares$.test(stripComments(snapshot.read(join(snapshot.root, 'src', s.file))))
        : !declares$.test(s.body)))
      .map((s) => `${s.file} (decision.${s.op})`);
}

function blindReads(snapshot) {
    const inFile = new Map();
    const fileDeclares = (file) => {
      if (!inFile.has(file)) {
        inFile.set(file, declares(stripComments(snapshot.read(join(snapshot.root, 'src', file)))));
      }
      return inFile.get(file);
    };
    return sites(READ, snapshot)
      .filter((s) => !byId(s.body)
        && !declares(s.body)
        && !(/\bwhere\s*[,}]/.test(s.body) && fileDeclares(s.file)))
      .map((s) => `${s.file} (decision.${s.op})`);
}

describe('T1 — every writer declares its class', () => {
  it('names a decisionClass in every create payload', () => {
    // `create` carries its row inline, so the payload is checkable directly.
    // `createMany` is handed a prebuilt array — `data: rows` — and resolving
    // that variable back to its builder is more machinery than this guard is
    // worth, so for those two sites the check is per-FILE: the module that
    // mints rows must name a class token somewhere in itself.
    //
    // Weaker, and said out loud rather than dressed up. What it still catches
    // is the case that matters: a new writer added by someone who never met
    // this contract. The precise payload shape is covered behaviourally in
    // decisionClassWriters.test.js.
    const undeclared = undeclaredWriters(SNAPSHOT);

    // On trunk all five writers encode the class as a string PREFIX on
    // `rootCause` — three of them from a private const, one from a bare
    // literal repeated in three files, one from a const declared twice.
    expect(undeclared).toEqual([]);
  });

  it('there are exactly five writers, and a sixth must be ruled on', () => {
    // A ratchet, not a limit. A new producer of Decisions is a new class or a
    // new member of an existing one, and either way it is a decision somebody
    // makes rather than a line somebody adds.
    expect(sites(WRITE)).toHaveLength(5);
  });
});

describe('T13 — every population read declares, or reads one row', () => {
  it('leaves no read that says nothing about the classes it accepts', () => {
    // `findMany({ where, … })` builds its predicate above the call, so for those
    // the check falls back to the FILE — same concession, and the same reason,
    // as `createMany({ data: rows })` above. Following a variable to its
    // definition is more machinery than this guard earns; what it must still
    // catch is a module that touches the table having never met the contract.
    const blind = blindReads(SNAPSHOT);

    // TWENTY-ONE, not the eleven discovery named — and the gap is the contract,
    // not an error in either number. Discovery asked "which reads say nothing at
    // all"; this asks "which reads do not declare a CLASS". Ten sites answer
    // differently to those two questions: they are scoped today, but scoped
    // through `rootCause` — `connectorDecisionScope()` and
    // `startsWith: 'guardrail:'`. That is a class filter written as a string
    // match, which is precisely what stops being the source of truth here.
    //
    // So the eleven blind reads gain a declaration and the ten string-scoped
    // reads change what they declare it against. Three of the twenty-one are
    // legitimately general — and under this contract they say so, which is what
    // makes this list empty rather than merely shorter.
    expect(blind).toEqual([]);
  });

  it('the scanner still sees the whole table — the instrument checks itself', () => {
    // A test built on a scan has one silent failure mode that matters more than
    // any assertion above it: the scan stops finding call sites, every list
    // comes back empty, and the suite reports the jurisdiction as clean. That
    // is the same shape as the vitest worker crash that prints "310 passed" with
    // nothing failed — a green result meaning "we did not look".
    //
    // Discovery counted 31 reads by hand on this commit. The floor is stated
    // rather than the exact figure because the scanner and the hand count
    // disagree by a few sites and I have not yet reconciled them; a number I
    // guessed is not a measurement. The roster gets pinned exactly during
    // implementation, when the disagreement has been resolved.
    expect(sites(READ).length).toBeGreaterThanOrEqual(31);
    expect(sites(READ).every((s) => s.body.startsWith('('))).toBe(true);
  });
});

describe('the rootCause prefix stops being a class parser', () => {
  it('nothing outside the registry infers a class from a rootCause string', () => {
    // `NarrativeService` needed the class and wrote `/^allocation:([0-9a-f-]+)/i`
    // to get it. That regex is the proof the encoding had outlived itself: a
    // consumer parsing a string to learn what kind of row it holds is a
    // consumer that was never given the identity.
    //
    // Reading the plan id OUT of `allocation:<planId>` stays legitimate — that
    // is a subtype payload, which is exactly what `rootCause` keeps. What ends
    // is deriving the CLASS from it.
    const offenders = [];
    for (const file of SNAPSHOT.files) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel.startsWith('services/decisions/')) continue;      // the registry's own home
      if (rel === 'services/verdict-engine/decisionIdentity.js') continue;
      const source = stripComments(SNAPSHOT.read(file));
      if (/startsWith:\s*['"`](guardrail|allocation|test|incrementality):/.test(source)) offenders.push(rel);
      if (/rootCause[\s\S]{0,80}?\.(startsWith|match)\s*\(/.test(source)) offenders.push(rel);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

// Synthetic subjects are private temporary trees, never the tracked source.
function withSourceFixture(run) {
  const sandbox = mkdtempSync(join(tmpdir(), 'lumi-source-snapshot-'));
  const root = join(sandbox, 'checkout');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'prisma'));
  writeFileSync(join(root, 'src/probe.js'), 'export const safe = true;');
  writeFileSync(join(root, 'prisma/schema.prisma'), 'enum ActionType { PAUSE_CAMPAIGN }');
  writeFileSync(join(sandbox, 'outside.js'), 'export const outside = true;');
  try { return run({ root, sandbox }); }
  finally {
    const rel = relative(resolve(tmpdir()), resolve(sandbox));
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
      || !basename(sandbox).startsWith('lumi-source-snapshot-') || lstatSync(sandbox).isSymbolicLink()) {
      throw new Error('Refusing unsafe synthetic-fixture cleanup');
    }
    rmSync(sandbox, { recursive: true });
  }
}

describe('source snapshot fixture', () => {
  it('permits read-only fixture hard links without treating link-count metadata as content changes', () => withSourceFixture(({ root, sandbox }) => {
    const file = join(root, 'src/probe.js');
    const snapshot = loadSourceSnapshot(root, {
      readSource(fd, encoding) {
        if (fstatSync(fd).ino === lstatSync(file).ino) linkSync(file, join(sandbox, 'read-only-copy.js'));
        return readFileSync(fd, encoding);
      },
    });
    expect(lstatSync(file).nlink).toBe(2);
    expect(snapshot.read(file)).toContain('safe');
  }));
  it('eagerly reads once and exposes only immutable snapshot data', () => withSourceFixture(({ root }) => {
    let reads = 0;
    const snapshot = loadSourceSnapshot(root, { readSource(...args) { reads++; return readFileSync(...args); } });
    expect(reads).toBeGreaterThan(0);
    const count = reads, file = join(root, 'src/probe.js');
    const original = snapshot.read(file);
    writeFileSync(file, 'export const changed = true;');
    expect(snapshot.read(file)).toBe(original);
    expect(reads).toBe(count);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.files)).toBe(true);
    expect(() => snapshot.files.push(file)).toThrow();
  }));

  it('rejects an empty applicable source corpus', () => withSourceFixture(({ root }) => {
    unlinkSync(join(root, 'src/probe.js'));
    writeFileSync(join(root, 'src/ignored.test.js'), 'export const ignored = true;');
    writeFileSync(join(root, 'src/README.md'), 'No applicable JavaScript');
    expect(() => loadSourceSnapshot(root)).toThrow(/empty/i);
  }));

  it('rejects an empty source file before assertions', () => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/probe.js'), '');
    expect(() => loadSourceSnapshot(root)).toThrow(/empty/i);
  }));

  it('rejects missing source directories', () => withSourceFixture(({ root }) => {
    const missing = join(root, 'missing');
    mkdirSync(missing);
    expect(() => loadSourceSnapshot(missing)).toThrow();
  }));

  it('propagates unreadable source during eager fixture setup', () => withSourceFixture(({ root }) => {
    expect(() => loadSourceSnapshot(root, { readSource() { throw new Error('EACCES synthetic read'); } })).toThrow(/EACCES/);
  }));

  it('rejects malformed roots and out-of-root lookup targets', () => withSourceFixture(({ root, sandbox }) => {
    for (const malformed of [undefined, null, 42, '', '../relative', 'bad\0target']) {
      expect(() => loadSourceSnapshot(malformed)).toThrow();
    }
    const snapshot = loadSourceSnapshot(root);
    expect(() => snapshot.read(join(sandbox, 'outside.js'))).toThrow(/root|outside/i);
    expect(() => snapshot.read(null)).toThrow();
  }));

  it.each([
    ['duplicate', ['probe.js', 'probe.js']],
    ['case-colliding', ['probe.js', 'PROBE.js']],
    ['escaping', ['../outside.js']],
  ])('rejects %s directory entries', (_kind, entries) => withSourceFixture(({ root }) => {
    expect(() => loadSourceSnapshot(root, {
      directoryEntries(dir) { return dir === realpathSync(join(root, 'src')) ? entries : readdirSync(dir); },
    })).toThrow(/duplicate|collid|entry|escape|root/i);
  }));

  it('rejects descendant links and symlinked root ancestors', () => withSourceFixture(({ root, sandbox }) => {
    const outside = join(sandbox, 'outside');
    mkdirSync(outside); writeFileSync(join(outside, 'foreign.js'), 'export const foreign = true;');
    const descendant = join(root, 'src/linked');
    symlinkSync(outside, descendant, 'junction');
    try { expect(() => loadSourceSnapshot(root)).toThrow(/symlink|link/i); }
    finally { unlinkSync(descendant); }
    const ancestor = join(sandbox, 'alias');
    symlinkSync(sandbox, ancestor, 'junction');
    try { expect(() => loadSourceSnapshot(join(ancestor, 'checkout'))).toThrow(/symlink|link/i); }
    finally { unlinkSync(ancestor); }
  }));

  it('rejects absent snapshot entries without reading an alternate file', () => withSourceFixture(({ root }) => {
    const snapshot = loadSourceSnapshot(root), added = join(root, 'src/late.js');
    writeFileSync(added, 'export const late = true;');
    expect(() => snapshot.read(added)).toThrow(/snapshot entry/i);
  }));

  it('discovers newly added modules on each fresh snapshot invocation', () => withSourceFixture(({ root }) => {
    const first = loadSourceSnapshot(root), added = join(root, 'src/unseen.js');
    writeFileSync(added, 'export const unseen = true;');
    const second = loadSourceSnapshot(root);
    expect(first.files).not.toContain(added);
    expect(second.files).toContain(added);
    expect(second.read(added)).toContain('unseen');
  }));
});

describe('synthetic jurisdiction ratchets', () => {
  it.each(['create', 'createMany'])('fails the existing writer assertion for unscoped %s', (op) => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/unseen-writer.js'), 'prisma.decision.' + op + '({ data: {} });');
    const snapshot = loadSourceSnapshot(root);
    expect(undeclaredWriters(snapshot)).toEqual(['unseen-writer.js (decision.' + op + ')']);
    expect(() => expect(undeclaredWriters(snapshot)).toEqual([])).toThrow();
  }));

  it('fails the existing reader assertion for an unscoped population read', () => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/unseen-reader.js'), 'prisma.decision.findMany({ where: { workspaceId } });');
    const snapshot = loadSourceSnapshot(root);
    expect(blindReads(snapshot)).toEqual(['unseen-reader.js (decision.findMany)']);
    expect(() => expect(blindReads(snapshot)).toEqual([])).toThrow();
  }));

  it('excludes comments/test files and preserves legitimate class and by-id predicates', () => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/comments.js'), '// prisma.decision.create({ data: {} });\n/* prisma.decision.findMany({}); */');
    writeFileSync(join(root, 'src/ignored.test.js'), 'prisma.decision.create({ data: {} });');
    writeFileSync(join(root, 'src/scoped.js'), 'prisma.decision.create({ data: { decisionClass: "CONNECTOR" } });\nprisma.decision.findMany({ where: { decisionClass: "CONNECTOR" } });\nprisma.decision.findUnique({ where: { id: identity } });');
    const snapshot = loadSourceSnapshot(root);
    expect(undeclaredWriters(snapshot)).toEqual([]);
    expect(blindReads(snapshot)).toEqual([]);
    expect(sites(READ, snapshot)).toHaveLength(2);
  }));
});
