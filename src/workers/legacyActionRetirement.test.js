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
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

/** Every .js file under src/, excluding tests. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (!entry.endsWith('.js')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

const FILES = sourceFiles();
const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

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
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');      // whole-line comments
}

/** Files whose CODE (never comments) matches, as repo-relative POSIX paths. */
const filesWhereCode = (re) => FILES
  .filter((f) => re.test(code(f)))
  .map((f) => f.replace(process.cwd(), '').replace(/\\/g, '/'))
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



  it('the Action model is KEPT — but S1-B left it one diagnostic reader', () => {
    // §6/§17 still holds: the model is not removed merely because its worker is
    // gone, and removing it is a schema change this slice does not authorise.
    //
    // What changed is the EVIDENCE. This used to point at the feed and the
    // intelligence route as proof the table had legitimate readers. S1-B removed
    // both — the feed's `campaigns` array was built from Action rows joined to
    // CampaignState, and the intelligence route resolved a PENDING Action before
    // handing it to the retired orchestrator. Neither could ever match anything:
    // `no source file creates one` above is the reason.
    //
    // The last reference is a row COUNT on /lumi/_health. It reads real
    // historical rows and is the only thing that can still say how many exist,
    // which is why it survives and why this assertion follows it rather than
    // being deleted.
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/model Action \{/);
    expect(read('src/routes/lumi/health.js')).toMatch(/prisma\.action\.count/);

    // …and the two former readers stay gone. Restoring either re-creates a read
    // of a table with no writer, which is what S1-B existed to end.
    expect(read('src/routes/lumi/feed.js')).not.toMatch(/prisma\.action\./);
    expect(read('src/routes/lumi/intelligence.js')).not.toMatch(/prisma\.action\./);
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
