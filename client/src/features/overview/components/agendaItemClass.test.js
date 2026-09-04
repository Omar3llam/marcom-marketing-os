// ============================================================
// C-10 · the client is TOLD the class; it never works it out
// ------------------------------------------------------------
// Two agenda rows about one campaign, both saying KILL. One is the connector's
// judgement of performance; the other is a policy breach episode. On trunk the
// client receives them as the same shape — same type, same title, same
// severity — and `rootCause` is not on the wire at all.
//
// So today the client cannot tell them apart, and tomorrow, asked to, the only
// tools available would be the wrong ones: parse a string, infer from the
// verdict, guess from the title. Each of those is a second classifier, and the
// third one always disagrees with the first two.
//
//   The client receives an explicit classification, and no client module
//   derives a decision class from a rootCause string.
//
// B8-02 depends on this: the class fills one slot of the five-slot attention row.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { decisionClassLabel } from './agendaItemClass.js';

// From cwd, not from `import.meta.url`: the client suite runs under jsdom, where
// `import.meta.url` is not a file: URL and `fileURLToPath` throws. Vitest's cwd
// is the client package root.
const CLIENT_SRC = resolve('src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(p) && !/\.test\.jsx?$/.test(p)) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('T11 — the client never parses rootCause to learn the class', () => {
  it('no client module matches a class prefix', () => {
    const offenders = [];
    for (const file of walk(CLIENT_SRC)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/['"`/](guardrail|allocation|incrementality):/.test(src)) {
        offenders.push(relative(CLIENT_SRC, file).split(sep).join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders a label from the class token itself', () => {
    // A label, not a style: what a class LOOKS like is B8-02's question. What it
    // IS arrives already decided, which is the only part C-10 owns.
    expect(decisionClassLabel(DECISION_CLASS.SIGNAL)).toBeTruthy();
    expect(decisionClassLabel(DECISION_CLASS.GUARDRAIL)).toBeTruthy();
    expect(decisionClassLabel(DECISION_CLASS.SIGNAL))
      .not.toBe(decisionClassLabel(DECISION_CLASS.GUARDRAIL));
  });

  it('says nothing at all for an item with no class', () => {
    // C-07's degradation rule, unchanged: silence is honest, a confident wrong
    // label is not. A fatigue forecast has no decision class, and a legacy row
    // the backfill could not place has none either — neither may be dressed as
    // a connector verdict because that is the commonest value.
    expect(decisionClassLabel(null)).toBeNull();
    expect(decisionClassLabel(undefined)).toBeNull();
  });

  it('says nothing for a class it does not recognise', () => {
    // A fifth class shipped by a newer backend reaches an older client. Naming
    // it wrongly is worse than not naming it.
    expect(decisionClassLabel('ANOMALY')).toBeNull();
  });
});
