// Phase 3 — interaction primitives: keyboard, focus, names, disabled with reason.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lock, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, CheckboxField, IconButton, RadioGroup, SelectField, TextField, TextLink } from '../index.js';
import { expectRefused, quietRenderErrors, renderIn } from './helpers.jsx';

describe('Button', () => {
  quietRenderErrors();

  it('is a native button operated by pointer, Enter and Space', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderIn(<Button prominence="standard" onActivate={onActivate}>Pause campaign</Button>);
    const button = screen.getByRole('button', { name: 'Pause campaign' });
    expect(button).toHaveAttribute('type', 'button');
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(button);
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('offers two prominences and no semantic colour variants', () => {
    renderIn(<><Button prominence="standard" onActivate={() => {}}>A</Button><Button prominence="quiet" onActivate={() => {}}>B</Button></>);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('data-lumi-prominence', 'standard');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('data-lumi-prominence', 'quiet');
    expectRefused(<Button prominence="primary" onActivate={() => {}}>x</Button>, /not one of standard/);
    expectRefused(<Button prominence="standard" variant="danger" onActivate={() => {}}>x</Button>, /"variant" is not part/);
    expectRefused(<Button prominence="standard" color="gold" onActivate={() => {}}>x</Button>, /"color" is not part/);
  });

  it('requires a visible text label and an activation handler', () => {
    expectRefused(<Button prominence="quiet" onActivate={() => {}} />, /visible label/);
    expectRefused(<Button prominence="quiet">Save</Button>, /onActivate is required/);
  });

  it('never disables without a reason; a disabled button stays focusable, announces why, and does not act', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderIn(<Button prominence="standard" onActivate={onActivate} disabledReason="This decision is no longer open.">Pause campaign</Button>);
    const button = screen.getByRole('button', { name: 'Pause campaign' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('This decision is no longer open.');
    await user.tab();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onActivate).not.toHaveBeenCalled();
    expectRefused(<Button prominence="standard" onActivate={() => {}} disabledReason="">x</Button>, /disabledReason must be non-empty/);
  });
});

describe('IconButton', () => {
  quietRenderErrors();

  it('takes its accessible name from label, never from the glyph', () => {
    renderIn(<IconButton prominence="quiet" glyph={Lock} label="Locked: requires Growth" onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Locked: requires Growth' })).toBeInTheDocument();
    expectRefused(<IconButton prominence="quiet" glyph={Lock} onActivate={() => {}} />, /label must be non-empty/);
    expectRefused(<IconButton prominence="quiet" glyph={Wand2} label="Magic" onActivate={() => {}} />, /forbidden iconography/);
  });
});

describe('TextLink', () => {
  quietRenderErrors();

  it('routes in-app with `to`, leaves with `href`, and marks the current location', () => {
    renderIn(<><TextLink to="/app/decisions" current="page">Decisions</TextLink><TextLink href="https://example.com">Docs</TextLink></>);
    expect(screen.getByRole('link', { name: 'Decisions' })).toHaveAttribute('href', '/app/decisions');
    expect(screen.getByRole('link', { name: 'Decisions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'noreferrer');
    expectRefused(<TextLink>Nowhere</TextLink>, /exactly one of/);
    expectRefused(<TextLink to="/a" href="/b">Both</TextLink>, /exactly one of/);
  });
});

function ControlledText(props) {
  const [value, setValue] = useState('');
  return <TextField label="Hypothesis" value={value} onValueChange={(v) => { setValue(v); props.onValueChange?.(v); }} {...props} />;
}

describe('TextField', () => {
  quietRenderErrors();

  it('associates its visible label, description and invalid reason', async () => {
    const user = userEvent.setup();
    renderIn(<ControlledText description="One sentence." invalidReason="A hypothesis is required." />);
    const input = screen.getByLabelText('Hypothesis');
    expect(input).toHaveAccessibleDescription('One sentence. A hypothesis is required.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.type(input, 'Creative fatigue');
    expect(input).toHaveValue('Creative fatigue');
  });

  it('keeps a disabled field focusable, read-only and explained', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderIn(<TextField label="Budget" value="" onValueChange={onValueChange} disabledReason="Your role cannot edit budgets." />);
    const input = screen.getByLabelText('Budget');
    expect(input).toHaveAttribute('aria-disabled', 'true');
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAccessibleDescription('Your role cannot edit budgets.');
    await user.type(input, '500');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is controlled and refuses a non-string value', () => {
    expectRefused(<TextField label="Spend" value={0} onValueChange={() => {}} />, /value must be a string/);
    expectRefused(<TextField label="" value="" onValueChange={() => {}} />, /label must be non-empty/);
  });
});

describe('SelectField', () => {
  quietRenderErrors();
  const options = [{ value: 'META', label: 'Meta' }, { value: 'GOOGLE', label: 'Google' }];

  it('changes value through the native control', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderIn(<SelectField label="Channel" value="META" options={options} onValueChange={onValueChange} />);
    await user.selectOptions(screen.getByLabelText('Channel'), 'GOOGLE');
    expect(onValueChange).toHaveBeenCalledWith('GOOGLE');
  });

  it('never falls back to its first option', () => {
    expectRefused(<SelectField label="Channel" value="TIKTOK" options={options} onValueChange={() => {}} />, /not one of META/);
    expectRefused(<SelectField label="Channel" value="" options={options} onValueChange={() => {}} />, /unsetLabel/);
    renderIn(<SelectField label="Channel" value="" unsetLabel="Choose a channel" options={options} onValueChange={() => {}} />);
    expect(screen.getByLabelText('Channel')).toHaveValue('');
  });
});

describe('CheckboxField · RadioGroup', () => {
  quietRenderErrors();

  it('toggles a checkbox from its label and from the keyboard', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderIn(<CheckboxField label="Include paused campaigns" checked={false} onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Include paused campaigns' });
    await user.click(screen.getByText('Include paused campaigns'));
    box.focus();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('refuses a disabled checkbox change and states why', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderIn(<CheckboxField label="Notify me" checked={false} onCheckedChange={onCheckedChange} disabledReason="Notifications need the Growth plan." />);
    const box = screen.getByRole('checkbox', { name: 'Notify me' });
    expect(box).toHaveAccessibleDescription('Notifications need the Growth plan.');
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('groups radios under a legend and refuses a value outside its options', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const choices = [{ value: 'HELD', label: 'It held' }, { value: 'DID_NOT_HOLD', label: 'It did not hold' }];
    renderIn(<RadioGroup label="Outcome" name="outcome" options={choices} value={null} onValueChange={onValueChange} />);
    expect(screen.getByRole('group', { name: 'Outcome' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'It held' }));
    expect(onValueChange).toHaveBeenCalledWith('HELD');
    expectRefused(<RadioGroup label="Outcome" name="o" options={choices} value="MAYBE" onValueChange={() => {}} />, /not one of HELD/);
    expectRefused(<RadioGroup label="Outcome" name="o" options={[choices[0]]} value={null} onValueChange={() => {}} />, /at least two/);
  });
});
