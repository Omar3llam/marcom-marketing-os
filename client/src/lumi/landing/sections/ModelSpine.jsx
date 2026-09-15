// ============================================================
// Landing — the product model as a typographic, reader-driven spine
// (Phase 4.2 prototype; PHASE_4_1_VISUAL_MOTION_RESEARCH.md §11 S-7, §18)
// ------------------------------------------------------------
// PAGE part (FC-18). Not the grammar <Spine>: that one reads a single Decision
// (VERDICT → … → MEMORY); this one is the product model, DATA → … → MEMORY.
//
// The seven stage words are the controls. The chosen stage is lit (claim), the
// stages either side of it stay readable (body) and the rest step down (meta).
// Every stage's text is present at every moment; choosing changes light, never
// content, order or position (M-0, MO-6.1). The spine never advances by itself
// and is not tied to scroll (MO-6.2, MO-8).
//
// A "Never" line appears only where CURRENT CODE proves it (Phase 4.2 Q-15; research
// §18.16). A stage without one has no provable invariant to state yet — never fill it.
//   Data      return is judged only on measured revenue: roas is null unless revenue
//             and spend are both > 0 (verdictEngine.js:156, :174); the return branch
//             requires revenueMeasured (:358, :387)
//   Verdict   every sweep writes PROPOSED decisions; an ExecutionRequest is created
//             only by a user request (routes/execution/meta.js:198, retry.js:185)
//   Decision  a changed call creates a NEW decision; the old row gets status and
//             outcome fields only, never its verdict or reasoning (VerdictService.js:73-99)
//   Action    same evidence as Verdict
//   Memory    memoryDecisionFacts changes confidence only, and only when memory was
//             consulted with a factor other than 1 (memoryProvenance.js:58-103)
// Removed as unprovable: Evidence (unknown-window rows are read, connectorTypes.js:74-77)
// and Outcome (a zero CTR can be scored, decisionLifecycle.js:82). Backend findings B, C.
//
// MOTION  Light steps change at once (no colour transition); only the selection
//         mark fades, in opacity, over motion.duration.reveal (0 ms reduced).
//         VERDICT at rest is presentation state, not a reader's choice.
//
// NOT NAVIGATION  The words are joined by hairlines into one phrase of the model;
// there is no tab chrome, panel, number, arrow or progress fill (review Q-16).
// ============================================================
import { useState } from 'react';
import { Text } from '../../index.js';
import css from '../landing.module.css';

export const MODEL = [
  ['Data', 'What Meta Ads, Google Ads and Google Analytics 4 report.', 'Never judges return on revenue no platform reported.'],
  ['Evidence', 'Measurements over a stated window, with anything unmeasured named.', null],
  ['Verdict', 'One of six calls on a campaign.', 'Never an action by itself. Not every verdict has one.'],
  ['Decision', 'The call LUMI commits to, recorded with its reason and evidence.', 'Its call and reasons are never rewritten when a later assessment disagrees.'],
  ['Action', 'What you confirm.', 'Never carried out before you confirm it.'],
  ['Outcome', 'What was measured after acting — or why it could not be.', null],
  ['Memory', 'What keeps holding across decisions on your account.', 'Never changes a verdict. It can make LUMI more or less confident.'],
];

const LIGHT_BY_DISTANCE = ['claim', 'body'];

export function ModelSpine() {
  const [selected, setSelected] = useState('Verdict');
  const at = MODEL.findIndex(([stage]) => stage === selected);

  return (
    <ol aria-label="How LUMI moves from data to memory" className={css.model} data-landing-spine="model">
      {MODEL.map(([stage, holds, never], index) => {
        const light = LIGHT_BY_DISTANCE[Math.abs(index - at)] ?? 'meta';
        const on = index === at;
        return (
          <li key={stage} className={css.modelStop} data-landing-light={light}>
            <div className={css.modelHead}>
              <button type="button" className={css.modelWord} aria-pressed={on} onClick={() => setSelected(stage)}>
                {stage}
              </button>
            </div>
            <Text variant="body" light={light} as="p">{holds}</Text>
            {never && <Text variant="caption" light={on ? 'body' : 'meta'} as="p">{never}</Text>}
          </li>
        );
      })}
    </ol>
  );
}
