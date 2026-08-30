// ============================================================
// B5-01P′ — the execution seam, asserted rather than assumed
// ============================================================
// The verified topology this file exists to keep true:
//
//     route  →  enqueueExecution()  →  BullMQ  →  executionWorker
//                                                      ↓
//                                              executeMetaAction()
//                                                      ↓
//                                              provider mutation
//
// Two properties make that diagram meaningful, and neither is enforced by
// anything else in the repository:
//
//   1. ONE provider seam. `executeMetaAction` is reachable from exactly one
//      place. A second caller is a second way to mutate a live ad account,
//      bypassing the row/job agreement checks the worker performs.
//
//   2. QUEUED IMPLIES A JOB. A route that transitions a row to QUEUED must
//      also create the job that backs it. B5-01P′ exists because POST
//      /:id/retry did the first without the second: it claimed QUEUED, logged
//      "Retry queued", returned 201, and never enqueued anything. The row sat
//      QUEUED forever, the Live Monitor showed a QUEUED pill, and no worker
//      ever received a job. Nothing failed — which is precisely why it went
//      unnoticed through every prior audit of this route.
//
// SOURCE-LEVEL, deliberately. These are structural facts about who may call
// what; a runtime test would need the very wiring it is trying to prove.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Every .js file under src/, excluding tests. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles().map((f) => ({
  path: relative(SRC, f).replace(/\\/g, '/'),
  src: readFileSync(f, 'utf8'),
}));

/** Source with comments stripped — this file's own prose names every symbol it
 *  guards, and a ratchet that cannot tell a call from a paragraph about a call
 *  would fire on its own documentation. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const calls = (needle) => FILES.filter((f) => new RegExp(`\\b${needle}\\s*\\(`).test(code(f.src)));

describe('B5-01P′ · the provider seam is single', () => {
  // The one module allowed to perform a Meta mutation, and the one module
  // allowed to ask it to. Adding a name here is a deliberate act; arriving
  // here by accident is what this test prevents.
  const PROVIDER_CALLERS = ['workers/executionWorker.js'];
  const DEFINITION = 'services/metaExecutionService.js';

  it('executeMetaAction is called from exactly one module', () => {
    const callers = calls('executeMetaAction')
      .map((f) => f.path)
      .filter((p) => p !== DEFINITION);

    expect(callers.sort()).toEqual(PROVIDER_CALLERS.sort());
  });

  it('the provider seam is reached through the worker, not a route', () => {
    const routeCallers = calls('executeMetaAction').filter((f) => f.path.startsWith('routes/'));
    // A route calling the provider directly would skip the job/row agreement
    // checks and the EXECUTING transition the worker performs.
    expect(routeCallers.map((f) => f.path)).toEqual([]);
  });
});

describe('B5-01P′ · QUEUED implies a job', () => {
  const ENQUEUE_DEFINITION = 'queues/index.js';

  /** Files that MAKE a row QUEUED — a claim that work is underway. Reading or
   *  filtering on QUEUED is not a claim, so the predicate is the transition. */
  const CLAIMS_QUEUED = /newStatus:\s*ExecutionStatus\.QUEUED/;

  it('every module that transitions a row to QUEUED also enqueues a job', () => {
    const claimants = FILES.filter((f) => CLAIMS_QUEUED.test(code(f.src)));

    // Guard the guard: if the transition idiom is ever renamed this test would
    // silently pass by matching nothing at all.
    expect(claimants.length).toBeGreaterThan(0);

    const withoutJob = claimants
      .filter((f) => !/\benqueueExecution\s*\(/.test(code(f.src)))
      .map((f) => f.path);

    expect(withoutJob).toEqual([]);
  });

  it('enqueueExecution is called only from the execution routes', () => {
    const callers = calls('enqueueExecution')
      .map((f) => f.path)
      .filter((p) => p !== ENQUEUE_DEFINITION);

    // Both are execution routes that create an ExecutionRequest and hand it to
    // the worker. A caller outside routes/execution/ would be queueing a real
    // ad-platform mutation from somewhere with no request-time guards.
    expect(callers.sort()).toEqual([
      'routes/execution/meta.js',
      'routes/execution/retry.js',
    ]);
  });

  it('the retired substrates still refuse rather than enqueue', () => {
    // rollback.js and quickaction.js once enqueued onto a queue whose worker
    // performed no real mutation, so both reported success for work that never
    // happened — the same failure this slice removes from retry. They must not
    // quietly rejoin the execution path.
    for (const path of ['routes/lumi/rollback.js', 'routes/lumi/quickaction.js']) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} should exist`).toBeDefined();
      expect(code(file.src)).not.toMatch(/\benqueueExecution\s*\(/);
      expect(code(file.src)).not.toMatch(/\bexecuteMetaAction\s*\(/);
    }
  });
});
