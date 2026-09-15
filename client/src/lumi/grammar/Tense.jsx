// ============================================================
// TenseLabel · AgreementNote
// ------------------------------------------------------------
// GRAMMAR OBJECT  VERDICT — its tense (Constitution Article 9)
// CONTRACT        TenseLabel: `tense` NOW | AT_DECISION, `at` an ISO-8601 instant
//                 (the assessment's computed-at or the Decision's committed time).
//                 AgreementNote: the published `decisionAgreement` shape
//                 { knowledge, value } (src/services/verdict-engine/
//                 decisionAgreement.js) and, when it DIVERGES, the stored verdict.
// STATES          KNOWN+AGREES → nothing to say · KNOWN+DIVERGES → the divergence
//                 named · NOTHING_THERE → nothing (only NOW renders) ·
//                 COULD_NOT_LOOK → "could not check", never an assumed AGREES.
// WHY LUMI        🔒 PR-1 and FC-5: a live verdict must never pass as the stored
//                 one, and a disagreement is stated in language, never diffed.
// MOTION          none — divergence is not animated (MO-4 §5)
//
// Neither part computes agreement. The consumer passes what the backend
// published. There is no arrow, strikethrough or "was → now" copy anywhere here.
// ============================================================
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import { AGREEMENT, KNOWLEDGE, VERDICTS } from './vocabulary.js';
import css from './grammar.module.css';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An instant as `YYYY-MM-DD HH:MM UTC`. One clock for every reader, so a time
 * never shifts with the viewer's timezone. Anything but an ISO instant throws.
 */
export function formatInstant(component, iso) {
  if (typeof iso !== 'string' || !ISO_INSTANT.test(iso) || Number.isNaN(Date.parse(iso))) {
    throw new Error(`${component}: "${String(iso)}" is not an ISO-8601 instant with a zone.`);
  }
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

const TENSE = {
  NOW: { word: 'NOW', clock: 'computed' },
  AT_DECISION: { word: 'AT DECISION', clock: 'committed' },
};

export function TenseLabel(props) {
  assertProps('TenseLabel', props, ['tense', 'at']);
  const { tense, at } = props;
  useGround('TenseLabel');
  assertOneOf('TenseLabel', 'tense', tense, Object.keys(TENSE));
  const when = formatInstant('TenseLabel', at);

  return (
    <p className={css.tense} data-lumi-tense={tense}>
      <span className={css.tenseWord}>{TENSE[tense].word}</span>
      <time dateTime={at} className={css.clock}>{`${TENSE[tense].clock} ${when}`}</time>
    </p>
  );
}

export function AgreementNote(props) {
  assertProps('AgreementNote', props, ['knowledge', 'value', 'storedVerdict']);
  const { knowledge, value = null, storedVerdict } = props;
  useGround('AgreementNote');
  assertOneOf('AgreementNote', 'knowledge', knowledge, [KNOWLEDGE.KNOWN, KNOWLEDGE.NOTHING_THERE, KNOWLEDGE.COULD_NOT_LOOK]);

  if (knowledge !== KNOWLEDGE.KNOWN) {
    if (value !== null) throw new Error(`AgreementNote: ${knowledge} carries no agreement value.`);
    if (knowledge === KNOWLEDGE.NOTHING_THERE) return null;
    return (
      <p className={css.bodyText} data-lumi-agreement="COULD_NOT_LOOK">
        Could not check this assessment against the decisions recorded for it.
      </p>
    );
  }

  assertOneOf('AgreementNote', 'value', value, Object.values(AGREEMENT));
  if (value === AGREEMENT.AGREES) return null;
  assertText('AgreementNote', 'storedVerdict', storedVerdict);
  assertOneOf('AgreementNote', 'storedVerdict', storedVerdict, VERDICTS);

  return (
    <p className={css.bodyText} data-lumi-agreement="DIVERGES">
      {`This differs from the decision recorded earlier: ${storedVerdict}.`}
    </p>
  );
}
