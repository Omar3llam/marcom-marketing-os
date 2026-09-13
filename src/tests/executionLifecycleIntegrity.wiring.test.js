// ============================================================
// SLICE D · RED — the lifecycle, read at SOURCE
// ------------------------------------------------------------
// ⚠️ A HARNESS CANNOT PROVE ITS OWN WIRING. The behavioural suite can show that
// a zombie survives; it cannot show WHY. The why is a wiring fact: the timeout
// transition is fully implemented and nothing in production invokes it.
//
// This is the C-12 shape — the cure exists with ZERO callers — for the third
// time in this programme. C-12 itself, then R11 (I61)'s invalidateWorkspaceCache
// exported with no caller, and now lifecycleService.timeout().
//
// ⚠️ INSTRUMENT NOTE, recorded because it changed a reported number.
// The discovery pass that opened this slice first claimed "TIMED_OUT has NO
// writer". That was measured with a grep piped through `head -8`, and the
// writer sat below the cut. TIMED_OUT *is* written — by
// ExecutionLifecycleService.timeout(). The real finding is one level in: the
// writer has no CALLER. Every census here is therefore untruncated, and the
// controls below prove the reader can see a known positive before any absence
// is believed.
//
// ⚠️ THIS FILE IS RED on trunk.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/** Every .js under a root, tests included, from the FILESYSTEM (never git). */
function walkJs(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules') continue;
    const full = `${dir}/${e}`;
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (e.endsWith('.js')) out.push(full);
  }
  return out;
}

const ALL = [...walkJs('src'), ...walkJs('packages')];
const isTest = (f) => f.includes('.test.') || f.includes('/tests/');
const PRODUCTION = ALL.filter((f) => !isTest(f));
const TESTS = ALL.filter(isTest);

const SERVICE = 'src/services/execution/ExecutionLifecycleService.js';
const META = 'src/routes/execution/meta.js';
const RETRY = 'src/routes/execution/retry.js';
const read = (f) => readFileSync(f, 'utf8');

/** Files that CALL the timeout transition (the definition itself excluded). */
function timeoutCallers(files) {
  const CALL = /(?:lifecycleService|service|this)\s*\.\s*timeout\s*\(/;
  return files.filter((f) => f !== SERVICE && CALL.test(read(f)));
}

// ── CONTROLS — before any absence is believed ───────────────────────────────
describe('control — the reader can see what it claims to look for', () => {
  it('it enumerates a real codebase', () => {
    expect(PRODUCTION.length).toBeGreaterThan(200);
    expect(TESTS.length).toBeGreaterThan(50);
  });

  it('it finds a KNOWN POSITIVE — the timeout transition does have callers in tests', () => {
    // If this were empty the census would be broken, and "no production caller"
    // would be an artefact of a reader that cannot see any caller at all.
    expect(timeoutCallers(TESTS).length).toBeGreaterThan(0);
  });

  it('it finds the transition METHOD where it is defined', () => {
    expect(read(SERVICE)).toMatch(/async\s+timeout\s*\(/);
  });

  it('it reports a KNOWN ABSENCE as absent', () => {
    const CALL = /\.\s*zzzNotARealMethod\s*\(/;
    expect(ALL.filter((f) => CALL.test(read(f)))).toEqual([]);
  });

  it('it survives a receiver spelled differently from the shipped one', () => {
    // The ledger census once missed POST /api/export because it only looked for
    // `router.`. This reader accepts any of the receivers the codebase uses.
    const CALL = /(?:lifecycleService|service|this)\s*\.\s*timeout\s*\(/;
    expect(CALL.test('await service.timeout(id, corr);')).toBe(true);
    expect(CALL.test('await this.timeout(id, corr);')).toBe(true);
    expect(CALL.test('await lifecycleService.timeout(id, corr);')).toBe(true);
  });
});

// ── THE STRUCTURAL RED ──────────────────────────────────────────────────────
describe('the declared timeout policy is reachable from production code', () => {
  it('something in PRODUCTION calls the timeout transition', () => {
    const callers = timeoutCallers(PRODUCTION);
    expect(callers, 'timeout() is implemented but never invoked outside tests').not.toEqual([]);
  });

  it('the policy is not merely computed on read — something ACTS on it', () => {
    // isExecutionTimedOut is documented as "Used by timeout handler to identify
    // candidates for automatic TIMED_OUT transition". Consulting it inside a
    // read that only REPORTS staleness is not acting on it.
    const consumers = PRODUCTION.filter((f) => f !== SERVICE && read(f).includes('isExecutionTimedOut'));
    const contract = 'packages/runtime-contracts/src/timeoutPolicy.js';
    const acting = consumers.filter((f) => f !== contract && !f.includes('runtime-contracts'));
    expect(acting, 'nothing outside the policy module and the service consults the predicate').not.toEqual([]);
  });
});

// ── THE DRIFT GUARD — the root cause, not the symptom ───────────────────────
describe('the declarations about timeouts agree with each other', () => {
  // Slice D found FOUR declarations describing what a timeout is, and one
  // disagreed: TIMEOUT_POLICY gave PENDING and QUEUED a budget while
  // STATE_TRANSITION_MATRIX made TIMED_OUT reachable only from EXECUTING. A
  // budget for a state that cannot legally time out is a rule with no way to
  // apply — and nothing would have reported it, because each declaration was
  // internally consistent.
  it('every status with a declared timeout budget can legally reach TIMED_OUT', async () => {
    const { TIMEOUT_POLICY, isLegalTransition, ExecutionStatus, isTerminalState } =
      await import('@marcom/runtime-contracts');

    const budgeted = Object.keys(TIMEOUT_POLICY)
      .filter((s) => TIMEOUT_POLICY[s] != null && !isTerminalState(s));
    expect(budgeted.length, 'the policy must declare at least one budget').toBeGreaterThan(0);

    const unreachable = budgeted.filter((s) => !isLegalTransition(s, ExecutionStatus.TIMED_OUT));
    expect(unreachable, 'these statuses hold a timeout budget they cannot act on').toEqual([]);
  });

  it('control — the reader would notice a status that genuinely cannot time out', async () => {
    const { isLegalTransition, ExecutionStatus } = await import('@marcom/runtime-contracts');
    // A terminal state must NOT be able to time out. If this were true the
    // check above would pass vacuously for anything.
    expect(isLegalTransition(ExecutionStatus.EXECUTED_SUCCESS, ExecutionStatus.TIMED_OUT)).toBe(false);
  });

  it('the sweep is dispatched by the maintenance worker, not by a timer', () => {
    // Omar's implementation constraint: the backstop belongs to the worker
    // topology that already owns scheduled work, never a setInterval bolted to
    // an API process that runs N instances behind a load balancer.
    const worker = read('src/workers/maintenanceWorker.js');
    expect(worker).toContain('EXECUTION_TIMEOUT_JOB');
    expect(worker).toContain('runExecutionTimeoutSweep');

    const sweep = read('src/services/execution/executionTimeoutSweep.js');
    // Matched as a CALL, not as a word: the sweep's own header explains why it
    // is not a setInterval, and my first version of this guard flagged that
    // sentence. An instrument that cannot tell code from prose about code is
    // reporting on the wrong thing.
    const SELF_SCHEDULING = /\b(?:setInterval|setTimeout)\s*\(/;
    expect(SELF_SCHEDULING.test('setInterval(fn, 1000)'), 'the guard sees a real timer').toBe(true);
    expect(SELF_SCHEDULING.test('not a setInterval in the API process'), 'and ignores prose').toBe(false);
    expect(sweep, 'the sweep must not schedule itself').not.toMatch(SELF_SCHEDULING);
    expect(sweep, 'every transition goes through the lifecycle service')
      .toContain('lifecycleService.timeout(');
    const DIRECT_WRITE = new RegExp('executionRequest\\s*\\.\\s*(?:update|updateMany)\\s*\\(');
    // The guard is controlled: it must match a direct write when shown one.
    expect(DIRECT_WRITE.test('await prisma.executionRequest.update({ data })')).toBe(true);
    expect(sweep, 'ARCHITECTURAL LAW 1 — no direct status write').not.toMatch(DIRECT_WRITE);
  });
});

describe('both canonical entry paths resolve an execution whose job cannot run', () => {
  it('CONTROL — retry.js already names the failure class', () => {
    // The precedent. The invariant is not being invented by this slice.
    expect(read(RETRY)).toContain('EXECUTION_ENQUEUE_FAILED');
    expect(read(RETRY)).toMatch(/newStatus:\s*ExecutionStatus\.CANCELLED/);
  });

  it('meta.js resolves the same failure the same way', () => {
    // POST /meta transitions PENDING → QUEUED and then enqueues. When the
    // enqueue throws it logs, writes an AuditLog row saying FAILED, and returns
    // 500 — leaving the execution at QUEUED. Two records of one event,
    // disagreeing, and a row nothing will ever run.
    expect(read(META), 'the primary path does not name the enqueue-failure class')
      .toContain('EXECUTION_ENQUEUE_FAILED');
  });
});
