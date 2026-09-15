// ============================================================
// Phase 3 — the isolated demonstration surface (spec §15)
// ------------------------------------------------------------
// Composes the parts into one Decision experience: a current assessment (NOW)
// and the stored decision (AT DECISION) for the same subject, disagreeing.
// No route, page or production screen is involved. Every figure here is a test
// fixture, not product evidence.
// ============================================================
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionControl, AgreementNote, ClaimState, DecisionIdentity, EvidenceGroup, Measurement, Rule, Spine, SpineStage,
  Stack, Text, VerdictMark,
} from '../index.js';
import { renderIn } from './helpers.jsx';

function DecisionExperience({ onPause }) {
  return (
    <Stack gap="section">
      <Spine tense="NOW" at="2026-09-14T09:20:00Z">
        <SpineStage stage="VERDICT" headingLevel={2}>
          <VerdictMark verdict="SCALE" />
          <AgreementNote knowledge="KNOWN" value="DIVERGES" storedVerdict="KILL" />
        </SpineStage>
        <SpineStage stage="WHY" headingLevel={2}>
          <Text variant="body" as="p">Cost per conversion fell below the account target for the whole window.</Text>
        </SpineStage>
        <SpineStage stage="EVIDENCE" headingLevel={2}>
          <EvidenceGroup question="Is it working?" headingLevel={3} population="Campaign cmp_fixture" window="Last 7 days · UTC" source="Meta">
            <Measurement label="Spend" state="AVAILABLE" figure={{ amountMinor: 1250000, currency: 'EGP' }} />
            <Measurement label="Cost per conversion" state="NO_CONVERSIONS" reason="Conversion tracking reported no conversions over this window." />
          </EvidenceGroup>
        </SpineStage>
      </Spine>

      <Rule kind="structure" />

      <Spine tense="AT_DECISION" at="2026-09-01T12:00:00Z">
        <SpineStage stage="VERDICT" headingLevel={2}>
          <VerdictMark verdict="KILL" />
          <DecisionIdentity decisionClass="SIGNAL" status="PROPOSED" decisionId="dec_fixture" />
        </SpineStage>
        <SpineStage stage="ACTION" headingLevel={2}>
          <ActionControl kind="platformMutation" platform="Meta" decisionId="dec_fixture" label="Pause campaign" onActivate={onPause} />
        </SpineStage>
        <SpineStage stage="OUTCOME" headingLevel={2}>
          <ClaimState state="NOT_MEASURED" claim="Outcome after acting" reason="No action has been taken on this decision yet." />
        </SpineStage>
        <SpineStage stage="MEMORY" headingLevel={2}>{null}</SpineStage>
      </Spine>
    </Stack>
  );
}

describe('a Decision experience composed from Phase 3 parts', () => {
  it('shows both tenses, each with its own verdict, and names the divergence in language', () => {
    const { container } = renderIn(<DecisionExperience onPause={() => {}} />);
    const [now, stored] = container.querySelectorAll('[data-lumi-spine]');
    expect(now).toHaveAttribute('data-lumi-spine', 'NOW');
    expect(stored).toHaveAttribute('data-lumi-spine', 'AT_DECISION');
    expect(within(now).getByText('SCALE')).toBeInTheDocument();
    expect(within(stored).getByText('KILL')).toBeInTheDocument();
    expect(now).toHaveTextContent('This differs from the decision recorded earlier: KILL.');
  });

  it('is not a visual diff: no arrows, no strikethrough, no struck elements', () => {
    const { container } = renderIn(<DecisionExperience onPause={() => {}} />);
    expect(container.textContent).not.toMatch(/[→←⇒⇐↦➔]|was\s+\w+\s*→|\bwas\b.*\bnow\b/i);
    expect(container.querySelector('s, del, strike')).toBeNull();
    expect(container.innerHTML).not.toMatch(/line-through/);
  });

  it('attaches the action only to the stored decision, bound to its id', () => {
    const onPause = vi.fn();
    const { container } = renderIn(<DecisionExperience onPause={onPause} />);
    const [now, stored] = container.querySelectorAll('[data-lumi-spine]');
    expect(within(now).queryByRole('button')).toBeNull();
    within(stored).getByRole('button', { name: 'Pause campaign' }).click();
    expect(onPause).toHaveBeenCalledWith('dec_fixture');
  });

  it('reads as one ordered spine per tense, with no empty Memory heading', () => {
    renderIn(<DecisionExperience onPause={() => {}} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Verdict', 'Why', 'Evidence', 'Verdict', 'Action', 'Outcome',
    ]);
  });

  it('keeps evidence honest: spend renders, and the ratio without a denominator renders its state', () => {
    const { container } = renderIn(<DecisionExperience onPause={() => {}} />);
    const states = [...container.querySelectorAll('[data-lumi-state]')].map((n) => n.getAttribute('data-lumi-state'));
    expect(states).toEqual(['AVAILABLE', 'NO_CONVERSIONS', 'NOT_MEASURED']);
    expect(screen.getByText('No conversions')).toBeInTheDocument();
  });
});
