// ============================================================
// judgmentVocabulary — the client's copy of the canonical enum
// ------------------------------------------------------------
// The nine reason codes exist twice: once as a Postgres enum the server
// validates against, once as a list this bundle ships. That duplication is
// deliberate (importing the server module would pull Prisma into the browser)
// and it is exactly the kind of duplication that drifts silently — a tenth
// reason added server-side would simply never appear in the picker, and a code
// renamed client-side would 400 for every operator who chose it.
//
// So the guard is a test rather than an import: read the server file, extract
// its lists, and compare. It fails on the commit that introduces the drift, not
// on the support ticket three weeks later.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  HUMAN_RESPONSE, RESPONSE_LABEL, REASON_REQUIRED,
  JUDGMENT_REASONS, MAX_NOTE_LENGTH, needsReason, reasonLabel,
} from './judgmentVocabulary.js';

// Walk up from the runner's cwd rather than resolving against import.meta.url —
// the client bundle's import.meta.url is not a file URL under this transform,
// and vitest's cwd is the client workspace in CI but need not be locally.
const REL = 'src/services/decision-memory/humanJudgment.js';
function locateServerModule() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, REL);
    // The client has its own src/, so require the decision-memory path to exist
    // rather than the first src/ found.
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`could not locate ${REL} from ${process.cwd()} — the guard below would be vacuous`);
}

const serverSource = readFileSync(locateServerModule(), 'utf8');

/** Pull a `export const NAME = Object.freeze([ ... ])` string array off the source. */
function serverList(name) {
  const m = serverSource.match(new RegExp(`export const ${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`could not find ${name} in humanJudgment.js — the guard below is vacuous`);
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

describe('the client vocabulary matches the server enum', () => {
  it('extracts real lists from the server file (the guard is not vacuous)', () => {
    expect(serverList('HUMAN_RESPONSES')).toHaveLength(3);
    expect(serverList('HUMAN_REASONS')).toHaveLength(9);
  });

  it('ships exactly the three canonical responses, same spelling', () => {
    expect(Object.values(HUMAN_RESPONSE)).toEqual(serverList('HUMAN_RESPONSES'));
  });

  it('ships exactly the nine canonical reasons, same spelling', () => {
    // Order may differ — the picker is ordered by how often a marketer reaches
    // for it, the enum by how it was written. Membership may not differ.
    expect([...JUDGMENT_REASONS.map((r) => r.code)].sort())
      .toEqual([...serverList('HUMAN_REASONS')].sort());
  });

  it('requires a reason for exactly the responses the server requires one for', () => {
    expect([...REASON_REQUIRED]).toEqual(serverList('REASON_REQUIRED'));
    expect(needsReason('OVERRIDE')).toBe(true);
    expect(needsReason('ADJUST')).toBe(true);
    expect(needsReason('CONFIRM')).toBe(false);
  });

  it('uses the server note cap, not one of its own', () => {
    const m = serverSource.match(/export const MAX_NOTE_LENGTH\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(MAX_NOTE_LENGTH).toBe(Number(m[1]));
  });
});

describe('labels are display only', () => {
  it('gives every code a human-readable label that is not the code', () => {
    for (const r of JUDGMENT_REASONS) {
      expect(r.label).toBeTruthy();
      expect(r.label).not.toBe(r.code);
    }
    for (const r of Object.values(HUMAN_RESPONSE)) expect(RESPONSE_LABEL[r]).toBeTruthy();
  });

  it('never relabels an unknown code as OTHER', () => {
    // A reason we cannot name is not the OTHER bucket. Silently folding it in
    // would make an unrecognised value indistinguishable from a real choice.
    expect(reasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(reasonLabel(null)).toBeNull();
  });
});
