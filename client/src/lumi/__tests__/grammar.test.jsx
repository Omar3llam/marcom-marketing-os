// Phase 3 — grammar parts: verdict, tense, agreement, identity, spine, action.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionControl, AgreementNote, DecisionIdentity, Spine, SpineStage, TenseLabel, Text, VerdictMark,
} from '../index.js';
import { VERDICTS } from '../grammar/vocabulary.js';
import { expectRefused, quietRenderErrors, renderIn } from './helpers.jsx';

describe('VerdictMark — the word is the verdict; the mark sits beside it', () => {
  quietRenderErrors();

  it('reads the six locked verdicts from the parse layer', () => {
    expect([...VERDICTS].sort()).toEqual(['HOLD', 'KILL', 'REALLOCATE', 'REFRESH', 'SCALE', 'WATCH']);
  });

  it.each(['KILL', 'HOLD', 'SCALE', 'WATCH', 'REFRESH', 'REALLOCATE'])('renders %s as a word with a hidden mark', (verdict) => {
    const { container } = renderIn(<VerdictMark verdict={verdict} />);
    const root = container.querySelector(`[data-lumi-verdict="${verdict}"]`);
    expect(root).toHaveTextContent(`Verdict: ${verdict}`);
    const mark = root.firstChild;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toBeEmptyDOMElement();
  });

  it('gives each verdict its own mark class, so no two verdicts share a colour role', () => {
    const { container } = renderIn(<>{VERDICTS.map((v) => <VerdictMark key={v} verdict={v} />)}</>);
    const classes = [...container.querySelectorAll('[data-lumi-verdict] > [aria-hidden]')].map((m) => m.className);
    expect(new Set(classes).size).toBe(6);
  });

  it('refuses an unknown or re-cased verdict instead of mapping it to HOLD', () => {
    expectRefused(<VerdictMark verdict="TEST" />, /not one of/);
    expectRefused(<VerdictMark verdict="kill" />, /not one of/);
    expectRefused(<VerdictMark verdict={undefined} />, /not one of/);
  });

  it('refuses an arbitrary colour, class or style', () => {
    expectRefused(<VerdictMark verdict="KILL" color="red" />, /"color" is not part of its API/);
    expectRefused(<VerdictMark verdict="KILL" className="text-signal-kill" />, /"className" is not part/);
    expectRefused(<VerdictMark verdict="KILL" style={{ background: 'red' }} />, /"style" is not part/);
  });

  it('exists only on Charcoal: refused on Off White, allowed in a marketing dark section', () => {
    expectRefused(<VerdictMark verdict="SCALE" />, /only on Charcoal/, 'marketing');
    renderIn(<VerdictMark verdict="SCALE" />, 'marketing-dark-section');
    expect(screen.getByText('SCALE')).toBeInTheDocument();
  });

  it('has a list context and no size scale', () => {
    renderIn(<VerdictMark verdict="HOLD" context="list" />);
    expectRefused(<VerdictMark verdict="HOLD" context="xs" />, /not one of claim/);
    expectRefused(<VerdictMark verdict="HOLD" size="sm" />, /"size" is not part/);
  });
});

describe('TenseLabel · AgreementNote — named, never diffed', () => {
  quietRenderErrors();

  it('states the tense and its clock in UTC', () => {
    renderIn(<><TenseLabel tense="NOW" at="2026-09-14T09:20:31Z" /><TenseLabel tense="AT_DECISION" at="2026-09-01T12:05:00+02:00" /></>);
    expect(screen.getByText('NOW')).toBeInTheDocument();
    expect(screen.getByText('computed 2026-09-14 09:20 UTC')).toHaveAttribute('dateTime', '2026-09-14T09:20:31Z');
    expect(screen.getByText('AT DECISION')).toBeInTheDocument();
    expect(screen.getByText('committed 2026-09-01 10:05 UTC')).toBeInTheDocument();
  });

  it('refuses a time it cannot place and a tense that does not exist', () => {
    expectRefused(<TenseLabel tense="NOW" at="14/09/2026" />, /not an ISO-8601 instant/);
    expectRefused(<TenseLabel tense="NOW" at="2026-09-14T09:20:00" />, /not an ISO-8601 instant/);
    expectRefused(<TenseLabel tense="LIVE" at="2026-09-14T09:20:00Z" />, /not one of NOW/);
  });

  it('names a divergence in language, and says nothing when they agree or no decision exists', () => {
    const { container } = renderIn(<AgreementNote knowledge="KNOWN" value="DIVERGES" storedVerdict="KILL" />);
    expect(container).toHaveTextContent('This differs from the decision recorded earlier: KILL.');
    for (const props of [{ knowledge: 'KNOWN', value: 'AGREES' }, { knowledge: 'NOTHING_THERE' }]) {
      const { container: quiet } = renderIn(<AgreementNote {...props} />);
      expect(quiet.querySelector('[data-lumi-agreement]')).toBeNull();
    }
  });

  it('never assumes agreement when the check could not be made', () => {
    renderIn(<AgreementNote knowledge="COULD_NOT_LOOK" />);
    expect(screen.getByText(/Could not check this assessment/)).toBeInTheDocument();
  });

  it('refuses shapes the backend does not publish', () => {
    expectRefused(<AgreementNote knowledge="KNOWN" />, /not one of AGREES/);
    expectRefused(<AgreementNote knowledge="NOTHING_THERE" value="AGREES" />, /carries no agreement value/);
    expectRefused(<AgreementNote knowledge="NOT_ENOUGH" />, /not one of KNOWN/);
    expectRefused(<AgreementNote knowledge="KNOWN" value="DIVERGES" />, /storedVerdict must be non-empty/);
  });
});

describe('DecisionIdentity', () => {
  quietRenderErrors();

  it('reads PROPOSED as Open, never New', () => {
    renderIn(<DecisionIdentity decisionClass="SIGNAL" status="PROPOSED" decisionId="dec_123" />);
    expect(screen.getByText('Open', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/new/i)).toBeNull();
    expect(screen.getByText('dec_123', { exact: false })).toBeInTheDocument();
  });

  it('refuses an ALLOCATION row and an unknown status', () => {
    expectRefused(<DecisionIdentity decisionClass="ALLOCATION" status="PROPOSED" decisionId="d" />, /plan artifact/);
    expectRefused(<DecisionIdentity decisionClass="SIGNAL" status="NEW" decisionId="d" />, /not one of PROPOSED/);
  });
});

describe('Spine — one object on one axis', () => {
  quietRenderErrors();
  const at = '2026-09-14T09:20:00Z';

  it('always states its tense, and renders stages in order', () => {
    renderIn(
      <Spine tense="AT_DECISION" at={at}>
        <SpineStage stage="VERDICT" headingLevel={3}><VerdictMark verdict="KILL" /></SpineStage>
        <SpineStage stage="ACTION" headingLevel={3}><Text variant="body">Paused on Meta.</Text></SpineStage>
      </Spine>,
    );
    expect(screen.getByText('AT DECISION')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Verdict', 'Action']);
  });

  it('draws no empty heading for a stage without a fact', () => {
    renderIn(
      <Spine tense="AT_DECISION" at={at}>
        <SpineStage stage="VERDICT" headingLevel={3}><VerdictMark verdict="KILL" /></SpineStage>
        <SpineStage stage="MEMORY" headingLevel={3}>{null}</SpineStage>
      </Spine>,
    );
    expect(screen.queryByRole('heading', { name: 'Memory' })).toBeNull();
  });

  it('refuses stages out of order, repeated, or wrapped in something else', () => {
    expectRefused(<Spine tense="AT_DECISION" at={at}><SpineStage stage="WHY" headingLevel={3}>a</SpineStage><SpineStage stage="VERDICT" headingLevel={3}>b</SpineStage></Spine>, /out of order/);
    expectRefused(<Spine tense="AT_DECISION" at={at}><SpineStage stage="WHY" headingLevel={3}>a</SpineStage><SpineStage stage="WHY" headingLevel={3}>b</SpineStage></Spine>, /out of order or repeated/);
    expectRefused(<Spine tense="AT_DECISION" at={at}><div>card</div></Spine>, /SpineStages only/);
  });

  it('refuses ACTION, OUTCOME and MEMORY on a NOW assessment (PR-1)', () => {
    for (const stage of ['ACTION', 'OUTCOME', 'MEMORY']) {
      expectRefused(<Spine tense="NOW" at={at}><SpineStage stage={stage} headingLevel={3}>x</SpineStage></Spine>, /NOW assessment has no/);
    }
  });
});

describe('ActionControl — bound to a Decision, never to a verdict', () => {
  quietRenderErrors();

  it('distinguishes "LUMI will do this" from "I did this" in words and in weight', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const { container } = renderIn(<>
      <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_1" label="Pause campaign" onActivate={onActivate} />
      <ActionControl kind="humanRecord" decisionId="dec_1" label="I paused it myself" onActivate={onActivate} />
    </>);
    const [platform, record] = container.querySelectorAll('[data-lumi-action]');
    expect(platform).toHaveTextContent('LUMI will do this on Meta');
    expect(record).toHaveTextContent('LUMI changes nothing');
    expect(within(platform).getByRole('button')).toHaveAttribute('data-lumi-prominence', 'standard');
    expect(within(record).getByRole('button')).toHaveAttribute('data-lumi-prominence', 'quiet');
    await user.click(screen.getByRole('button', { name: 'Pause campaign' }));
    expect(onActivate).toHaveBeenCalledWith('dec_1');
  });

  it('renders a NOT_EXECUTABLE refusal as the copy, with no control', () => {
    renderIn(<ActionControl kind="platformMutation" platform="Meta" decisionId="dec_1" label="Pause campaign" refusal="No platform action exists for a HOLD verdict." />);
    expect(screen.getByText('No platform action exists for a HOLD verdict.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the published stage while in flight, and a 409 as a disabled control with its reason', () => {
    renderIn(<ActionControl kind="platformMutation" platform="Meta" decisionId="d" label="Pause campaign" state="processing" stateReason="Queued on Meta" />);
    expect(screen.getByRole('status')).toHaveTextContent('Queued on Meta');
    expect(screen.queryByRole('button')).toBeNull();
    renderIn(<ActionControl kind="humanRecord" decisionId="d" label="Dismiss" state="noLongerOpen" stateReason="This decision is no longer open." onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAccessibleDescription('This decision is no longer open.');
  });

  it('refuses an entity target, a verdict, and a missing decision id', () => {
    expectRefused(<ActionControl kind="platformMutation" platform="Meta" entityId="cmp_1" label="Pause" onActivate={() => {}} />, /ENTITY action has no backend contract/);
    expectRefused(<ActionControl kind="platformMutation" platform="Meta" decisionId="d" verdict="KILL" label="Pause" onActivate={() => {}} />, /verdict ≠ action/);
    expectRefused(<ActionControl kind="humanRecord" label="Dismiss" onActivate={() => {}} />, /decisionId must be non-empty/);
    expectRefused(<ActionControl kind="humanRecord" platform="Meta" decisionId="d" label="Dismiss" onActivate={() => {}} />, /changes no platform/);
    expectRefused(<ActionControl kind="execute" decisionId="d" label="Go" onActivate={() => {}} />, /not one of platformMutation/);
  });
});
