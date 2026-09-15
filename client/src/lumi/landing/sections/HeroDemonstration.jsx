// ============================================================
// Landing — the hero demonstration: "Light what mattered" (Phase 4.2 prototype)
// ------------------------------------------------------------
// PAGE part (FC-18). DATA → EVIDENCE → VERDICT in production order (Article 5).
// The reader chooses an evidence question; the inputs that question reads go to
// claim light, inputs another question of this call reads stay at body light, and
// inputs that did not decide the call stay at meta light (Article 11's three
// steps). Every word is present at the first frame and nothing moves on its own
// (M-0, MO-2.2, MO-2.3). PHASE_4_1_VISUAL_MOTION_RESEARCH.md §10 H-B, §18.
//
// TRUTH — src/services/verdict-engine/verdictEngine.js, KILL on the absolute pass:
//   delivery   impressions >= MIN_IMPRESSIONS before any call (:290; confidenceEngine.js:53)
//   revenue    revenueMeasured = revenueMinor > 0 && spendMinor > 0 (:156; routes at :358)
//   return     roas = revenueMinor / spendMinor, below BREAKEVEN_ROAS (:174, :387)
//   frequency  frequency >= FATIGUE_FREQ (:387)
// Clicks, click-through rate, conversions and objective ARE computed (diagnosis,
// funnel, benchmarks, data confidence) but no branch reaching KILL reads them, so
// the page says they "did not decide this call" — never that they went uncomputed.
//
// MOTION  Light steps change at once: text colour is never transitioned (MO-6.5;
//         Phase 4.2 review Q-12). Only the selection mark fades, in opacity, over
//         motion.duration.reveal, which is 0 ms under reduced motion (MO-7).
//         No timer, no scroll link, no autoplay. The chosen question at rest is
//         presentation state: no one chose it, and nothing is recorded.
// ============================================================
import { useState } from 'react';
import { Stack, Text, TenseLabel, VerdictMark } from '../../index.js';
import { IllustrativeNote } from '../parts.jsx';
import css from '../landing.module.css';

export const DATA = [
  'Spend', 'Impressions', 'Frequency', 'Clicks', 'Click-through rate', 'Conversions', 'Conversion value', 'Campaign objective',
];

export const EVIDENCE = [
  { id: 'return', group: 'grounds', asked: 'Is it earning back what it spends?', answer: 'Return is below break-even.', reads: ['Spend', 'Conversion value'], clause: 'loss' },
  { id: 'frequency', group: 'grounds', asked: 'Is the audience seeing it too often?', answer: 'Frequency is past the fatigue ceiling.', reads: ['Frequency'], clause: 'fatigue' },
  { id: 'revenue', group: 'checks', asked: 'Was revenue measured at all?', answer: 'Yes — so a revenue verdict can be called.', reads: ['Spend', 'Conversion value'], clause: null },
  { id: 'delivery', group: 'checks', asked: 'Has it been shown enough times to judge?', answer: 'Yes — enough impressions to judge it.', reads: ['Impressions'], clause: null },
];

const GROUPS = [['grounds', 'The grounds for this call'], ['checks', 'Checked first']];

/** Inputs no question of this call reads: derived, so the page cannot drift from EVIDENCE. */
export const DID_NOT_DECIDE = DATA.filter((input) => !EVIDENCE.some((question) => question.reads.includes(input)));

const lightOf = (input, question) => {
  if (question.reads.includes(input)) return 'claim';
  return DID_NOT_DECIDE.includes(input) ? 'meta' : 'body';
};

const listed = (words) => `${words.slice(0, -1).join(', ')}${words.length > 1 ? ' and ' : ''}${words[words.length - 1]}`;

function DemoColumn({ stage, question, children }) {
  return (
    <li className={css.demoColumn}>
      <Stack gap="inline">
        <Text variant="label" as="p">{stage}</Text>
        <Text variant="caption" as="p">{question}</Text>
      </Stack>
      {children}
    </li>
  );
}

export function HeroDemonstration() {
  const [selectedId, setSelectedId] = useState(EVIDENCE[0].id);
  const selected = EVIDENCE.find((question) => question.id === selectedId);
  // A ground lights its own clause of the call and steps the other down; a check
  // made before any call leaves the whole call lit.
  const lossLight = selected.clause === 'fatigue' ? 'body' : 'claim';
  const fatigueLight = selected.clause === 'loss' ? 'body' : 'claim';

  return (
    <figure className={css.demo} data-landing-demo="light-what-mattered">
      <Stack gap="section">
        <figcaption>
          <Stack gap="inline">
            <Text variant="claim" as="p">From what the platforms report to one call — and which of it mattered.</Text>
            <IllustrativeNote>an invented campaign. No account data appears on this page.</IllustrativeNote>
          </Stack>
        </figcaption>
        <ol className={css.demoGrid} aria-label="Data, then evidence, then verdict">
          <DemoColumn stage="Data" question="What the ad platforms report">
            <ul className={css.dataList}>
              {DATA.map((input) => {
                const light = lightOf(input, selected);
                return (
                  <li key={input} className={css.lit} data-landing-light={light}>
                    <Text variant="caption" light={light} as="span">{input}</Text>
                  </li>
                );
              })}
            </ul>
            <Text variant="caption" as="p">{`Did not decide this call: ${listed(DID_NOT_DECIDE)}.`}</Text>
          </DemoColumn>
          <DemoColumn stage="Evidence" question="What LUMI asks of it — choose a question">
            <Stack gap="section">
              {GROUPS.map(([group, title]) => (
                <Stack gap="meta" key={group}>
                  <Text variant="caption" as="p">{title}</Text>
                  <ul className={css.plainList}>
                    {EVIDENCE.filter((question) => question.group === group).map((question) => {
                      const on = question.id === selectedId;
                      return (
                        <li key={question.id} className={css.lit} data-landing-light={on ? 'claim' : 'body'}>
                          <Stack gap="inline">
                            <button type="button" className={css.lightControl} aria-pressed={on} onClick={() => setSelectedId(question.id)}>
                              {question.asked}
                            </button>
                            <Text variant="body" light={on ? 'claim' : 'meta'} as="p">{question.answer}</Text>
                            <Text variant="caption" light={on ? 'body' : 'meta'} as="p">{`Reads: ${listed(question.reads)}`}</Text>
                          </Stack>
                        </li>
                      );
                    })}
                  </ul>
                </Stack>
              ))}
            </Stack>
          </DemoColumn>
          <DemoColumn stage="Verdict" question="What LUMI concludes">
            <Stack gap="object">
              <TenseLabel tense="NOW" at="2026-09-14T09:00:00Z" />
              <VerdictMark verdict="KILL" />
              <Text variant="claim" as="p" data-landing-call="true">
                <Text variant="claim" light={lossLight} as="span" data-landing-light={lossLight}>It is losing money,</Text>
                {' '}
                <Text variant="claim" light={fatigueLight} as="span" data-landing-light={fatigueLight}>and the people it reaches have already seen it too often.</Text>
              </Text>
              <Text variant="caption" as="p">
                A current assessment carries no action. Acting belongs to a recorded decision.
              </Text>
            </Stack>
          </DemoColumn>
        </ol>
      </Stack>
    </figure>
  );
}
