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
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('../../', import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') && !p.endsWith('.test.js')) out.push(p);
  }
  return out;
}

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

function sites(pattern) {
  const found = [];
  for (const file of walk(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const m of source.matchAll(pattern)) {
      const open = source.indexOf('(', m.index + m[0].length - 1);
      found.push({
        file: relative(SRC, file).split(sep).join('/'),
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
    const declares$ = /\bdecisionClass\s*:/;
    const undeclared = sites(WRITE)
      .filter((s) => (s.op === 'createMany'
        ? !declares$.test(stripComments(readFileSync(join(SRC, s.file), 'utf8')))
        : !declares$.test(s.body)))
      .map((s) => `${s.file} (decision.${s.op})`);

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
    const inFile = new Map();
    const fileDeclares = (file) => {
      if (!inFile.has(file)) {
        inFile.set(file, declares(stripComments(readFileSync(join(SRC, file), 'utf8'))));
      }
      return inFile.get(file);
    };
    const blind = sites(READ)
      .filter((s) => !byId(s.body)
        && !declares(s.body)
        && !(/\bwhere\s*[,}]/.test(s.body) && fileDeclares(s.file)))
      .map((s) => `${s.file} (decision.${s.op})`);

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
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel.startsWith('services/decisions/')) continue;      // the registry's own home
      if (rel === 'services/verdict-engine/decisionIdentity.js') continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (/startsWith:\s*['"`](guardrail|allocation|test|incrementality):/.test(source)) offenders.push(rel);
      if (/rootCause[\s\S]{0,80}?\.(startsWith|match)\s*\(/.test(source)) offenders.push(rel);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
