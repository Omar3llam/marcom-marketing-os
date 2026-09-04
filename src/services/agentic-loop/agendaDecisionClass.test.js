// ============================================================
// C-10 · the class survives the merge and the projection
// ------------------------------------------------------------
// C-01 made the attention loader class-aware: two reads, each keeping its own
// identity rule, because Signal and Guardrail do not share a deduplication rule.
// Then, one line later:
//
//   const verdicts = [...signalVerdicts, ...guardrailEpisodes];
//
// and `agendaItem()` returns ten fields, none of them a class. Both arrive at
// the client as `type: VERDICT`, with the same `id: verdict:<id>` shape, the
// same severity table and the same `humanAction: REVIEW`. `rootCause` is not
// published at all, so the client CANNOT recover what it is looking at.
//
//   The reader declared its classes in the query and threw the declaration
//   away in the next statement.
//
// This is the deeper layer of the same finding: knowing the class at read time
// is worth nothing if the projection drops it, and B8-02's five-slot row needs
// the class to fill a slot.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { agendaItem, AGENDA_BAND, AGENDA_TYPE } from './agenticTypes.js';
import { planAgenda } from './agenticPlanner.js';

const now = new Date('2026-09-04T12:00:00Z');

const signalRow = {
  id: 'd-sig', entityId: 'camp-a', entityLevel: 'CAMPAIGN', verdict: 'KILL',
  diagnosis: 'CTR collapsed', rootCause: 'CREATIVE_FATIGUE', status: 'PROPOSED',
  decisionClass: DECISION_CLASS.SIGNAL, createdAt: new Date('2026-09-04T09:00:00Z'),
};

const guardrailRow = {
  id: 'd-grd', entityId: 'camp-a', entityLevel: 'CAMPAIGN', verdict: 'KILL',
  diagnosis: 'Frequency ceiling breached', rootCause: 'guardrail:Frequency ceiling',
  status: 'PROPOSED', decisionClass: DECISION_CLASS.GUARDRAIL,
  createdAt: new Date('2026-09-04T11:00:00Z'),
};

const itemsFor = (verdicts) => planAgenda({ verdicts, now }).buyerBand;

describe('T10 — the agenda item carries its decisionClass', () => {
  it('agendaItem publishes the class it was given', () => {
    const item = agendaItem({
      id: 'verdict:d-sig', band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.VERDICT,
      title: 'KILL camp-a', rationale: 'CTR collapsed',
      decisionClass: DECISION_CLASS.SIGNAL,
    });
    expect(item.decisionClass).toBe(DECISION_CLASS.SIGNAL);
  });

  it('a class the factory was not given is null, never guessed', () => {
    // A fatigue forecast and a pacing alert are not Decisions and have no class.
    // `null` says that; a default of SIGNAL would make every non-decision item
    // claim to be a connector verdict.
    const item = agendaItem({
      id: 'fatigue:camp-a:frequency', band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.FATIGUE,
      title: 'camp-a frequency nearing ceiling', rationale: '',
    });
    expect(item.decisionClass).toBeNull();
  });

  it('two rows that merge into one band stay distinguishable', () => {
    // The measured case: one entity, two open calls, the same verdict word, two
    // different meanings. On trunk these are two identical-looking rows.
    const band = itemsFor([signalRow, guardrailRow]);
    const byId = new Map(band.map((i) => [i.id, i]));

    expect(byId.get('verdict:d-sig').decisionClass).toBe(DECISION_CLASS.SIGNAL);
    expect(byId.get('verdict:d-grd').decisionClass).toBe(DECISION_CLASS.GUARDRAIL);
  });

  it('every Decision-derived item in the band carries a class', () => {
    const band = itemsFor([signalRow, guardrailRow]);
    const derived = band.filter((i) => i.type === AGENDA_TYPE.VERDICT);
    expect(derived.length).toBe(2);
    for (const item of derived) {
      expect(item.decisionClass, `${item.id} lost its class in the projection`).not.toBeNull();
    }
  });

  it('the class is not recoverable from anything else the item publishes', () => {
    // Why the field is required rather than nice to have: the item carries no
    // rootCause, and `verdict`, `title` and `severity` are identical for both
    // rows above. There is no string left to parse — which is the correct
    // outcome, and the reason the class has to travel as itself.
    const band = itemsFor([signalRow, guardrailRow]);
    for (const item of band) {
      expect(item).not.toHaveProperty('rootCause');
    }
    const [a, b] = band.filter((i) => i.type === AGENDA_TYPE.VERDICT);
    expect(a.title).toBe(b.title);
    expect(a.severity).toBe(b.severity);
  });
});
