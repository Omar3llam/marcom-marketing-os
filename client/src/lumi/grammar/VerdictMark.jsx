// ============================================================
// VerdictMark
// ------------------------------------------------------------
// GRAMMAR OBJECT  VERDICT (PRODUCT_GRAMMAR.md §2)
// CONTRACT        `verdict` ∈ VerdictSchema (client/src/contracts/schemas/
//                 decision.schema.ts) — KILL · HOLD · SCALE · WATCH · REFRESH ·
//                 REALLOCATE (🔒 PR-5)
// STATES          AVAILABLE only. A gated, forbidden, failed or loading verdict
//                 is not a verdict: the surface renders <ClaimState> instead.
// WHY LUMI        PR-5 and Constitution Article 21 (FC-3): the verdict word is
//                 mandatory because HOLD and REFRESH are ΔE 5.1 apart under
//                 deuteranopia, so colour can never carry the call alone.
// MOTION          none
//
// Anatomy: [mark] WORD. The word is set in neutral claim light, never in the
// verdict colour (KILL on Charcoal is 4.02:1). The mark is decorative beside
// the word (CMP-09 §1) and resolves through `color.verdict.<v>.mark`, which
// never aliases brand gold — REALLOCATE included (FC-2).
//
// Refused: an unknown verdict (no `unknown → HOLD`, audit P0-14); any colour,
// tone or class prop; a mark on Off White, where verdict marks do not exist
// (CMP-09 §7 — use a marketing-dark-section).
// ============================================================
import { assertOneOf, assertProps, cx } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import { VisuallyHidden } from '../primitives/Text.jsx';
import { stateKey, VERDICTS } from './vocabulary.js';
import css from './grammar.module.css';

const CONTEXT = { claim: css.verdictClaim, list: css.verdictList };

export function VerdictMark(props) {
  assertProps('VerdictMark', props, ['verdict', 'context']);
  const { verdict, context = 'claim', children } = props;
  const { ground } = useGround('VerdictMark');
  assertOneOf('VerdictMark', 'verdict', verdict, VERDICTS);
  assertOneOf('VerdictMark', 'context', context, Object.keys(CONTEXT));
  if (children !== undefined) {
    throw new Error('VerdictMark: the verdict word is the verdict itself; it takes no children.');
  }
  if (ground !== 'charcoal') {
    throw new Error(
      'VerdictMark: verdict marks exist only on Charcoal (CMP-09 §7). On a marketing page, place it '
      + 'inside a marketing-dark-section.',
    );
  }

  return (
    <span className={cx(css.verdict, CONTEXT[context])} data-lumi-verdict={verdict}>
      <span aria-hidden="true" className={cx(css.verdictMark, css[`mark${stateKey(verdict)}`])} />
      <span>
        <VisuallyHidden>Verdict: </VisuallyHidden>
        {verdict}
      </span>
    </span>
  );
}
