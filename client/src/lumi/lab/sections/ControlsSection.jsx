// LUMI Primitive Lab — interaction primitives. Local lab state only; nothing leaves the page.
import { useState } from 'react';
import { X } from 'lucide-react';
import {
  Announcement, Button, CheckboxField, IconButton, Inline, RadioGroup, SelectField, Stack, Text, TextField, TextLink,
} from '../../index.js';
import { LabCell, LabGrid, LabSection } from '../LabSection.jsx';

const CHANNELS = [{ value: 'META', label: 'Meta' }, { value: 'GOOGLE', label: 'Google' }];
const JUDGMENTS = [{ value: 'HELD', label: 'It held' }, { value: 'DID_NOT_HOLD', label: 'It did not hold' }];

export function ControlsSection() {
  const [last, setLast] = useState('');
  const [hypothesis, setHypothesis] = useState('Creative fatigue on the lead ad');
  const [required, setRequired] = useState('');
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState('META');
  const [unset, setUnset] = useState('');
  const [includePaused, setIncludePaused] = useState(false);
  const [judgment, setJudgment] = useState(null);

  return (
    <LabSection id="controls" title="Controls" note="Press Tab to move focus: the ring must be neutral, never gold and never a verdict colour. Disabled controls stay focusable and state their reason.">
      <LabGrid>
        <LabCell label="Button · IconButton">
          <Inline gap="meta" align="center">
            <Button prominence="standard" onActivate={() => setLast('Standard')}>Standard</Button>
            <Button prominence="quiet" onActivate={() => setLast('Quiet')}>Quiet</Button>
            <IconButton prominence="quiet" glyph={X} label="Close example" onActivate={() => setLast('Icon')} />
          </Inline>
          <Announcement>{last ? `Last activated: ${last}` : ''}</Announcement>
        </LabCell>
        <LabCell label="disabled (with reason)">
          <Inline gap="object" align="start">
            <Button prominence="standard" onActivate={() => {}} disabledReason="Your role cannot pause campaigns.">Pause campaign</Button>
            <Button prominence="quiet" onActivate={() => {}} disabledReason="This decision is no longer open.">Dismiss</Button>
          </Inline>
        </LabCell>
        <LabCell label="TextLink">
          <Text variant="body" as="p">
            Read the <TextLink href="#decision">Decision Spine example</TextLink>, or the{' '}
            <TextLink href="#controls" current="location">current section</TextLink>.
          </Text>
        </LabCell>
        <LabCell label="TextField">
          <Stack gap="object">
            <TextField label="Hypothesis" description="One sentence." value={hypothesis} onValueChange={setHypothesis} />
            <TextField label="Reason for dismissal" value={required} onValueChange={setRequired} invalidReason="A reason is required to dismiss." />
            <TextField label="Note" multiline value={note} onValueChange={setNote} />
            <TextField label="Budget" value="" onValueChange={() => {}} disabledReason="Your role cannot edit budgets." />
          </Stack>
        </LabCell>
        <LabCell label="SelectField">
          <Stack gap="object">
            <SelectField label="Channel" options={CHANNELS} value={channel} onValueChange={setChannel} />
            <SelectField label="Compare against" options={CHANNELS} value={unset} unsetLabel="Choose a channel" onValueChange={setUnset} />
          </Stack>
        </LabCell>
        <LabCell label="CheckboxField · RadioGroup">
          <Stack gap="object">
            <CheckboxField label="Include paused campaigns" checked={includePaused} onCheckedChange={setIncludePaused} />
            <CheckboxField label="Email me when it changes" checked={false} onCheckedChange={() => {}} disabledReason="Notifications need the Growth plan." />
            <RadioGroup label="Did the call hold?" name="lab-judgment" options={JUDGMENTS} value={judgment} onValueChange={setJudgment} />
          </Stack>
        </LabCell>
      </LabGrid>
    </LabSection>
  );
}
