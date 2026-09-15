// LUMI Primitive Lab — claim states, evidence, measurements, money. Illustrative fixtures only.
import { ClaimState, EvidenceGroup, Measurement, Money, Stack, Text } from '../../index.js';
import { LabCell, LabGrid, LabSection } from '../LabSection.jsx';

const noop = () => {};

// [state, claim, reason, value?, extra props]
const CLAIMS = [
  ['LOADING', 'Open decisions', undefined],
  ['AVAILABLE', 'Meta connection', undefined, 'Connected, syncing daily'],
  ['EMPTY', 'Open decisions on this account', 'LUMI looked and found no open decisions.', undefined, { remedy: { label: 'Review closed decisions', onActivate: noop } }],
  ['FAILED', 'Decisions list', 'The decisions list could not be read.', undefined, { remedy: { label: 'Try again', onActivate: noop } }],
  ['UNAVAILABLE', 'Outcome evidence', 'Meta did not report delivery for this window.'],
  ['NOT_CONNECTED', 'Revenue', 'Revenue needs a connected sales source.', undefined, { remedy: { label: 'Connect a sales source', onActivate: noop } }],
  ['NOT_PERMITTED', 'Memory', 'Memory is part of the Growth plan.', undefined, { requiredPlan: 'GROWTH' }],
  ['NOT_SUPPORTED', 'Pause on this channel', 'This channel has no pause action LUMI can perform.'],
  ['STALE', 'Campaign spend', 'Last synced three days ago.', 'Synced figures shown as of the last sync'],
  ['PROCESSING', 'Pause campaign', 'Queued on Meta'],
  ['SUCCESS', 'Pause campaign', 'Paused on Meta. The decision now reads Executed.'],
  ['NOT_MEASURED', 'Reach', 'Meta did not report reach for this window.'],
  ['INSUFFICIENT_DATA', 'Verdict', 'The campaign delivered too little in the verdict window to judge.'],
  ['NO_CONVERSIONS', 'Cost per conversion', 'Conversion tracking reported no conversions, so there is no denominator.'],
  ['MIXED_CURRENCY', 'Account spend', 'Campaigns report in more than one currency; LUMI does not convert or sum them.'],
  ['PARTIAL', 'Account spend', 'Not every ad account has reported yet.', 'Reported accounts only'],
];

export function StatesSection() {
  return (
    <LabSection id="states" title="States" note="Sixteen claim states; DISABLED is shown on controls. Read the words only: failed, empty, unavailable, not connected and not supported must never be confused.">
      <LabGrid>
        {CLAIMS.map(([state, claim, reason, value, extra]) => (
          <LabCell key={state} label={state}>
            <ClaimState state={state} claim={claim} reason={reason} {...extra}>
              {value && <Text variant="body" as="p">{value}</Text>}
            </ClaimState>
          </LabCell>
        ))}
      </LabGrid>
    </LabSection>
  );
}

export function EvidenceSection() {
  return (
    <LabSection id="evidence" title="Evidence and measurements" note="Every figure carries its window. An absence keeps its label and window and shows its state in place of a number. All figures here are illustrative fixtures.">
      <LabGrid>
        <LabCell label="EvidenceGroup — value states">
          <EvidenceGroup question="Is it working?" headingLevel={3} population="Campaign lab_fixture" window="1–7 Sep 2026 · UTC" source="Meta Ads">
            <Measurement label="Spend" state="AVAILABLE" prominence="headline" figure={{ amountMinor: 1250000, currency: 'KWD' }} />
            <Measurement label="Impressions" state="AVAILABLE" figure={{ number: 184320, fractionDigits: 0 }} />
            <Measurement label="Click-through rate" state="AVAILABLE" figure={{ number: 1.84, fractionDigits: 2, unit: '%' }} />
            <Measurement label="Clicks" state="STALE" reason="Last synced three days ago." figure={{ number: 3391, fractionDigits: 0 }} />
            <Measurement label="Conversions" state="PARTIAL" reason="Two of five ad sets have reported." figure={{ number: 41, fractionDigits: 0 }} />
          </EvidenceGroup>
        </LabCell>
        <LabCell label="EvidenceGroup — absence states">
          <EvidenceGroup question="What does it cost to convert?" headingLevel={3} population="Campaign lab_fixture" window="1–7 Sep 2026 · UTC" source="Meta Ads">
            <Measurement label="Cost per conversion" state="NO_CONVERSIONS" reason="No conversions were reported, so there is no denominator." />
            <Measurement label="Revenue" state="MIXED_CURRENCY" reason="Rows report EGP and KWD; LUMI does not convert them." />
            <Measurement label="Reach" state="NOT_MEASURED" reason="Meta did not report reach for this window." />
            <Measurement label="Frequency" state="LOADING" />
            <Measurement label="Return on ad spend" state="FAILED" reason="The revenue read failed." />
          </EvidenceGroup>
        </LabCell>
        <LabCell label="Money — canonical formatter and refusals">
          <Stack gap="meta">
            <Text variant="body" as="p">KWD (3 decimals): <Money amountMinor={150000} currency="KWD" /></Text>
            <Text variant="body" as="p">JPY (0 decimals): <Money amountMinor={5000} currency="JPY" /></Text>
            <Text variant="body" as="p">EGP (canonical locale): <Money amountMinor={500000} currency="EGP" /></Text>
            <Text variant="body" as="p">Currency missing: <Money amountMinor={100} currency={null} /></Text>
            <Text variant="body" as="p">Currency not declared: <Money amountMinor={100} currency="CHF" /></Text>
          </Stack>
        </LabCell>
      </LabGrid>
    </LabSection>
  );
}
