// ============================================================
// C-13 · the client half — class, chip and destination  (RED)
// ------------------------------------------------------------
// Three claims, and they only make sense together:
//
//   C · the class SURVIVES the contract boundary. On `ea07e13` the planner
//       publishes `decisionClass` and `AgendaItemSchema` does not declare it,
//       so `z.object()` strips it and `useHome.js:44` stores the stripped
//       object. The field is on the wire and no component can read it.
//
//   D · the chip stops lying. `EVIDENCE_LABEL.VERDICT` is the literal string
//       'guardrail', so EVERY verdict — Signal included — renders
//       "backed by guardrail". That is the exact confusion C-10 existed to
//       remove, published to a person, while C-10's own cure
//       (`decisionClassLabel`) sits one file away with zero consumers.
//
//   E · a holdout goes where the holdout is. C-13 admits an item whose page is
//       /app/measure; without this the click lands on /app/testing, which
//       cannot show it. Destination correctness, not affordance design — B7
//       still owns deep-linking to a single experiment.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DECISION_CLASS } from '@marcom/runtime-contracts';

import AgendaItem, { agendaItemRoute } from './AgendaItem.jsx';
import { appRoutes } from '@/app/routeManifest.js';
import { AgendaItemSchema } from '@/contracts/schemas';

const base = {
  id: 'verdict:d-1', band: 'BUYER', type: 'VERDICT', title: 'KILL Summer Sale',
  rationale: 'CTR collapsed', severity: 'HIGH', evidenceRef: 'd-1',
  humanAction: 'review', entityId: 'camp-a', impactScore: null,
  decisionClass: null, subjectRef: null,
};

const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const chip = () => screen.getByText(/^backed by /i).textContent.trim();

// ── C · the boundary ───────────────────────────────────────────────────────
describe('C-13 · C — the contract boundary carries the whole item', () => {
  it('T29 · a parse PRESERVES decisionClass', () => {
    // The runtime half of the backend ratchet. That one proves the field is
    // DECLARED; this one proves declaring it actually works, because a schema
    // can declare a field and still drop it (wrong type, wrong nullability).
    const parsed = AgendaItemSchema.parse({ ...base, decisionClass: DECISION_CLASS.SIGNAL });
    expect(parsed.decisionClass).toBe(DECISION_CLASS.SIGNAL);
  });

  it('T30 · a parse PRESERVES subjectRef, object and all', () => {
    const parsed = AgendaItemSchema.parse({ ...base, subjectRef: { kind: 'HOLDOUT', id: 'ho-1' } });
    expect(parsed.subjectRef).toEqual({ kind: 'HOLDOUT', id: 'ho-1' });
  });

  it('T31 · an item from an OLDER server still parses', () => {
    // Both fields are optional deliberately. The failure mode of a missing
    // REQUIRED field here is not a blank chip — `useHome` does
    // `setHome(null)` + "failed contract validation", i.e. the entire home
    // page. Client and server deploy independently, so a strict field turns
    // any rolling deploy into a blank home screen.
    const { decisionClass, subjectRef, ...older } = base;
    void decisionClass; void subjectRef;
    expect(() => AgendaItemSchema.parse(older)).not.toThrow();
  });

  it('T32 · an explicit null is still a value, not an omission', () => {
    expect(AgendaItemSchema.parse({ ...base, decisionClass: null }).decisionClass).toBeNull();
  });
});

// ── D · the chip ───────────────────────────────────────────────────────────
describe('C-13 · D — the evidence chip names the class it actually has', () => {
  it('T33 · a SIGNAL verdict is not backed by a guardrail', () => {
    withRouter(<AgendaItem item={{ ...base, decisionClass: DECISION_CLASS.SIGNAL }} />);
    expect(chip()).toBe('backed by verdict');
  });

  it('T34 · a GUARDRAIL verdict still says guardrail', () => {
    // The old string was not wrong for every row — it was wrong for most. The
    // fix must keep the case it got right, or it trades one mislabel for another.
    withRouter(<AgendaItem item={{ ...base, decisionClass: DECISION_CLASS.GUARDRAIL }} />);
    expect(chip()).toBe('backed by guardrail');
  });

  it('T35 · an EXPERIMENT item can finally reach its own label', () => {
    withRouter(<AgendaItem item={{
      ...base, id: 'holdout-open:ho-1', type: 'TEST', evidenceRef: 'ho-1',
      decisionClass: DECISION_CLASS.EXPERIMENT, subjectRef: { kind: 'HOLDOUT', id: 'ho-1' },
    }} />);
    expect(chip()).toBe('backed by experiment');
  });

  it('T36 · an unclassifiable row degrades to something true, never to a guess', () => {
    // Null for three reasons C-10 already enumerated: pre-class row, non-decision
    // item, or a class this bundle has never heard of. "decision" is true of all
    // three and specific to none — narrowing, not invention.
    withRouter(<AgendaItem item={{ ...base, decisionClass: null }} />);
    expect(chip()).toBe('backed by decision');
  });

  it('T37 · no evidenceRef, no chip — backing is never implied', () => {
    withRouter(<AgendaItem item={{ ...base, evidenceRef: null, decisionClass: DECISION_CLASS.SIGNAL }} />);
    expect(screen.queryByText(/^backed by /i)).toBeNull();
  });

  it('T38 · non-VERDICT types keep the labels they already had', () => {
    withRouter(<AgendaItem item={{ ...base, type: 'FATIGUE', evidenceRef: 'f-1' }} />);
    expect(chip()).toBe('backed by forecast');
  });
});

// ── E · the destination ────────────────────────────────────────────────────
describe('C-13 · E — an experiment item routes to the page that holds it', () => {
  it('T39 · a holdout goes to Measure, where holdouts are listed', () => {
    expect(agendaItemRoute({ type: 'TEST', subjectRef: { kind: 'HOLDOUT', id: 'ho-1' } }))
      .toBe(appRoutes.measure);
  });

  it('T40 · an A/B test goes to Testing, where tests are listed', () => {
    expect(agendaItemRoute({ type: 'TEST', subjectRef: { kind: 'AB_TEST', id: 'te-1' } }))
      .toBe(appRoutes.testing);
  });

  it('T41 · a TEST item with no subject keeps its existing destination', () => {
    // The weekly suggestions carry no subjectRef by ruling — they propose an
    // experiment rather than being one — and they belong on Testing.
    expect(agendaItemRoute({ type: 'TEST' })).toBe(appRoutes.testing);
    expect(agendaItemRoute({ type: 'TEST', subjectRef: null })).toBe(appRoutes.testing);
  });

  it('T42 · an unknown subject kind does not fall through to Insights', () => {
    // A newer backend shipping a third kind must not silently send the operator
    // to an unrelated page. Testing is the Experiment surface of record.
    expect(agendaItemRoute({ type: 'TEST', subjectRef: { kind: 'SOMETHING_NEW', id: 'x' } }))
      .toBe(appRoutes.testing);
  });

  it('T43 · every other type is untouched', () => {
    expect(agendaItemRoute({ type: 'VERDICT', entityId: 'abc' }))
      .toBe(`${appRoutes.campaigns}?entity=abc`);
    expect(agendaItemRoute({ type: 'FATIGUE' })).toBe(appRoutes.insights);
    expect(agendaItemRoute({ type: 'PLAN_ADJUSTMENT', id: 'blended:gap' })).toBe(appRoutes.blendedTruth);
  });
});
