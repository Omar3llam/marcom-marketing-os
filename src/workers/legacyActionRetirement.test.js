// ============================================================
// R13-D / B3-C — the legacy Action execution substrate stays retired
// ============================================================
// This file is a ratchet. Every assertion below is something that was TRUE in
// the codebase and is now false, and each one is cheap to reintroduce by
// accident — an import restored during a merge, a stub executor added back "so
// the flow works for now", a queue re-registered because an admin panel wanted
// a row for it.
//
// What was retired, and why it was not merely unused:
//
//   actionWorker consumed the `actions` queue and dispatched through executors
//   that returned `{ ok: true, result: { stub: true } }` without calling any ad
//   platform. That writes EXECUTED_SUCCESS and stamps `executedAt`. Its two
//   feeders — rollback and quick-action — were themselves unreachable (nothing
//   in the repository ever created the Action rows both require), so the
//   substrate could only ever have produced a fake success, never a real one.
//
// These are source-level assertions on purpose. "No module reports a stub
// success" is a property of the repository, not of one function, and a test
// that imported a single module could not see a copy reintroduced elsewhere.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, lstatSync, realpathSync, openSync, fstatSync, closeSync, constants, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const SRC = resolve(process.cwd(), 'src');

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
      else if (name.endsWith('.js') && !name.includes('.test.')) files.push(capture(file));
    }
    if (!unchanged(before, lstatSync(dir))) throw new Error('Source directory changed during capture: ' + dir);
  };
  walk(join(root, 'src'));
  if (!files.length) throw new Error('Empty applicable source corpus');
  if (lstatSync(join(root, 'prisma')).isSymbolicLink()) throw new Error('Symlink schema directory');
  capture(join(root, 'prisma/schema.prisma'));
  const read = (file) => {
    if (typeof file !== 'string' || !file || file.includes('\0') || !isAbsolute(file)) {
      throw new Error('Malformed source target');
    }
    const target = resolve(file);
    if (!inside(target)) throw new Error('Source target outside root');
    if (!entries.has(key(target))) throw new Error('Missing snapshot entry: ' + file);
    return entries.get(key(target));
  };
  return Object.freeze({ root, files: Object.freeze(files), read, code: (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') });
}

let SNAPSHOT, FILES;
beforeAll(() => {
  const started = performance.now();
  SNAPSHOT = loadSourceSnapshot(process.cwd());
  FILES = SNAPSHOT.files;
  console.info('SOURCE_SNAPSHOT', JSON.stringify({ suite: 'retirement', files: SNAPSHOT.files.length, elapsedMs: performance.now() - started }));
});

const read = (rel) => SNAPSHOT.read(resolve(SNAPSHOT.root, rel));

/**
 * Source with comments removed.
 *
 * These assertions are about what the code DOES. The retirement is documented
 * at length in the files it affects — rollback.js explains that it used to
 * enqueue onto actionWorker and that the stub returned `{ ok: true, stub: true }`
 * — and scanning raw text would flag that prose as a violation of itself. The
 * fix is to read code, not to delete the explanation.
 */
function code(file) {
  return SNAPSHOT.code(file);
}

/** Files whose CODE (never comments) matches, as repo-relative POSIX paths. */
const filesWhereCode = (re, snapshot = SNAPSHOT) => snapshot.files
  .filter((f) => re.test(snapshot.code(f)))
  .map((f) => f.replace(snapshot.root, '').replace(/\\/g, '/'))
  .sort();

describe('the worker itself is gone', () => {
  it('actionWorker.js no longer exists', () => {
    expect(existsSync(resolve(SRC, 'workers/actionWorker.js'))).toBe(false);
  });

  it('no source file imports it or starts it', () => {
    expect(filesWhereCode(/actionWorker|startActionWorker/)).toEqual([]);
  });

  it('the worker bootstrap does not boot it — a booting worker is not retired', () => {
    // §8: "A worker that is 'unused' but still boots is not retired." It held a
    // live queue listener, so anything reaching that queue by any route would
    // have been processed by the stub.
    const boot = read('src/workers/index.js');
    expect(boot).not.toMatch(/startActionWorker/);
    expect(boot).not.toMatch(/actionWorker\.close/);
  });

  it('the workers that remain are the canonical set', () => {
    const boot = read('src/workers/index.js');
    for (const w of ['startExecutionWorker', 'startSyncWorker', 'startAgenticWorker']) {
      expect(boot, `${w} must still boot`).toMatch(new RegExp(w));
    }
  });
});

describe('the queue that fed it is gone', () => {
  it('queues/index.js no longer registers or names the actions queue', () => {
    const queues = read('src/queues/index.js');
    expect(queues).not.toMatch(/export const actionQueue/);
    expect(queues).not.toMatch(/export const ACTION_QUEUE_NAME/);
  });

  it('enqueueAction no longer exists', async () => {
    const mod = await import('../queues/index.js');
    expect(mod.enqueueAction).toBeUndefined();
    expect(mod.actionQueue).toBeUndefined();
    // …and the canonical one is still there.
    expect(typeof mod.enqueueExecution).toBe('function');
  });

  it('no source file enqueues onto it', () => {
    expect(filesWhereCode(/enqueueAction\s*\(/)).toEqual([]);
  });
});

describe('no fake platform success is reachable anywhere', () => {
  it('no source file returns a stub result', () => {
    // The literal shape that used to be returned for meta.pause_ad,
    // meta.scale_budget and google.pause_keyword.
    expect(filesWhereCode(/stub:\s*true/)).toEqual([]);
  });

  it('no Prisma write sets a row to EXECUTED_SUCCESS directly', () => {
    // A `data: { ... EXECUTED_SUCCESS }` write is how the legacy worker marked
    // an Action succeeded off a stub. Success must be reached only by a
    // lifecycle transition following a real provider result — never stamped
    // straight onto a row.
    //
    // Deliberately matching `data:` and not `status:`: vitals.js and
    // AgenticLoopService both READ this status in a `where:` clause, which is
    // legitimate and must stay possible. Reads and writes are different claims.
    expect(filesWhereCode(/data:\s*\{[^}]*EXECUTED_SUCCESS/)).toEqual([]);
  });

  it('only the canonical execution modules drive lifecycle transitions', () => {
    expect(filesWhereCode(/lifecycleService\.transition/)).toEqual([
      '/src/routes/execution/meta.js',   // PENDING → QUEUED
      '/src/routes/execution/retry.js',  // a fresh row, PENDING → QUEUED
      '/src/workers/executionWorker.js', // QUEUED → EXECUTING → terminal
    ]);
  });

  it('the Action model has no writer that can mark one executed', () => {
    // actionWorker was the only thing that set Action.status = EXECUTED_SUCCESS,
    // and it did so off a stub. With it gone, no code path can.
    const offenders = FILES.filter((f) => {
      const src = code(f);
      return /(prisma|tx)\.action\.update/.test(src) && /EXECUTED_SUCCESS/.test(src);
    }).map((f) => f.replace(process.cwd(), '').replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});

describe('nothing creates legacy Action rows any more', () => {
  it('no source file creates one', () => {
    // Before this slice the only creator was rollback's own inverse — a row
    // minted from a row nothing else ever minted. Now there is none at all.
    expect(filesWhereCode(/(prisma|tx)\.action\.create/)).toEqual([]);
  });



  it('SC-2 · the Action model is GONE, and so is its last reader', () => {
    // This assertion has inverted twice, and the reason each time is the same:
    // the EVIDENCE moved, not the guarantee.
    //
    //   R13-D  the model is KEPT — the feed and the intelligence route read it
    //   S1-B   the model is KEPT — one diagnostic row count on /lumi/_health is
    //          all that is left, and removing the model is a schema slice
    //   SC-2   that schema slice. Production answered the one question the
    //          count existed to answer — 0 rows, 0 workspaces, no earliest and
    //          no latest — and the table went with the answer.
    //
    // What this file protects is unchanged: no fake platform success is
    // reachable. It is now protected at the strongest level available, because
    // the substrate that could report one does not exist.
    const schema = read('prisma/schema.prisma');
    expect(schema).not.toMatch(/^model Action \{/m);
    expect(schema).not.toMatch(/^enum ActionStatus \{/m);

    // The count is ABSENT from the health payload, not zeroed. A count of a
    // table that does not exist is not a measurement.
    // Stripped, not raw: the comment left at the removal site names the field
    // it removed, and a raw scan would score that explanation as the defect.
    const health = code(resolve(process.cwd(), 'src/routes/lumi/health.js'));
    expect(health).not.toMatch(/prisma\.action/);
    expect(health).not.toMatch(/legacyActions/);

    // …and the earlier readers stay gone. Restoring any of them would now be a
    // read of a model that cannot be resolved at all.
    expect(read('src/routes/lumi/feed.js')).not.toMatch(/prisma\.action\./);
    expect(read('src/routes/lumi/intelligence.js')).not.toMatch(/prisma\.action\./);
  });

  it('SC-2 · ActionType survives — a different enum with a live owner', () => {
    // The one thing a careless Action closure breaks. `ActionType` names the
    // execution a request performs (PAUSE_CAMPAIGN, SCALE_CAMPAIGN…) and is
    // owned by AuditLog.actionType, which routes/execution/meta.js writes on
    // every request. `ActionStatus` named the lifecycle of the retired Action
    // row. Same prefix, unrelated contracts, and only one of them was dead.
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/^enum ActionType \{/m);
    expect(schema).toMatch(/actionType\s+ActionType/);
    expect(read('src/routes/execution/meta.js')).toMatch(/prisma\.auditLog\.create/);
  });

  it('B4-B · but the agentic loop is no longer one of them', () => {
    // Reading Action as HISTORY is fine — those rows really happened. Reading
    // it as EXECUTION AUTHORITY is not, and that is what the loop's EXECUTE
    // stage was doing: after this retirement the table can never gain a row, so
    // the stage reported a dead substrate as a dead loop for every workspace,
    // however many mutations Lumi actually landed. Fixed in B4-B by sourcing
    // the stage from Decision.platformExecutedAt.
    const loop = code(resolve(process.cwd(), 'src/services/agentic-loop/AgenticLoopService.js'));
    expect(loop).not.toMatch(/prisma\.action\./);

  });
});

describe('the canonical path is the only real mutation architecture', () => {
  it('exactly one module calls the Meta mutation service', () => {
    // The service that defines it, and the one worker that calls it.
    expect(filesWhereCode(/executeMetaAction\s*\(/)).toEqual([
      '/src/services/metaExecutionService.js',
      '/src/workers/executionWorker.js',
    ]);
  });

  it('there is still exactly one execution producer', () => {
    // §16: no second producer. `executionRequest.create` belongs to the
    // canonical route and to retry, which mints a fresh row by design.
    expect(filesWhereCode(/executionRequest\.create/)).toEqual([
      '/src/routes/execution/meta.js',
      '/src/routes/execution/retry.js',
    ]);
  });

  it('no second queue or worker was introduced to replace the retired one', () => {
    const boot = read('src/workers/index.js');
    const workerStarts = boot.match(/start\w+Worker\(\)/g) ?? [];
    // execution, sync, agentic, narrative, maintenance. If this number grows,
    // the retirement turned into a rewrite.
    expect(workerStarts.length).toBe(5);
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

describe('synthetic retirement ratchets', () => {
  it('rejects a newly introduced forbidden worker file', () => withSourceFixture(({ root }) => {
    mkdirSync(join(root, 'src/workers'));
    writeFileSync(join(root, 'src/workers/actionWorker.js'), 'export const worker = true;');
    loadSourceSnapshot(root);
    expect(() => expect(existsSync(join(root, 'src/workers/actionWorker.js'))).toBe(false)).toThrow();
  }));

  it.each([
    ['worker import', 'import { startActionWorker } from "./workers/actionWorker.js";', /actionWorker|startActionWorker/],
    ['enqueue', 'enqueueAction({ id: 1 });', /enqueueAction\s*\(/],
    ['stub success', 'return { ok: true, result: { stub: true } };', /stub:\s*true/],
    ['direct fake success', 'prisma.action.update({ data: { status: "EXECUTED_SUCCESS" } });', /data:\s*\{[^}]*EXECUTED_SUCCESS/],
  ])('fails the existing forbidden-code assertion for %s', (_name, text, pattern) => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/unseen-offender.js'), text);
    const snapshot = loadSourceSnapshot(root);
    expect(filesWhereCode(pattern, snapshot)).toEqual(['/src/unseen-offender.js']);
    expect(() => expect(filesWhereCode(pattern, snapshot)).toEqual([])).toThrow();
  }));

  it('excludes comments and test files while detecting executable forbidden code', () => withSourceFixture(({ root }) => {
    writeFileSync(join(root, 'src/comments.js'), '// actionWorker enqueueAction() stub: true\n/* startActionWorker stub: true */\nexport const safe = true;');
    writeFileSync(join(root, 'src/ignored.test.js'), 'startActionWorker();');
    const snapshot = loadSourceSnapshot(root);
    expect(filesWhereCode(/actionWorker|startActionWorker|enqueueAction|stub:\s*true/, snapshot)).toEqual([]);
  }));
});
