// Phase 3 — grammar-agnostic primitives: environment, closed API, layout, type, icons.
import fs from 'node:fs';
import { render, screen } from '@testing-library/react';
import { Lock, Sparkles, Bot, Lightbulb } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import {
  Announcement, Environment, ENVIRONMENT_GROUNDS, Heading, Icon, Inline, Rule, Stack, Surface, Text, VisuallyHidden,
} from '../index.js';
import { expectRefused, quietRenderErrors, renderIn } from './helpers.jsx';

const semantic = JSON.parse(fs.readFileSync(localDir('../../../design-system/foundation/tokens/semantic.json', import.meta.url), 'utf8'));

describe('Environment — colour exists only inside a ground', () => {
  quietRenderErrors();

  it('mirrors semantic.json $environments exactly', () => {
    const declared = Object.fromEntries(
      Object.entries(semantic.$environments).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.ground]),
    );
    expect(ENVIRONMENT_GROUNDS).toEqual(declared);
  });

  it('stamps data-lumi-env, and refuses an environment that is not declared', () => {
    const { container } = render(<Environment env="product">x</Environment>);
    expect(container.firstChild).toHaveAttribute('data-lumi-env', 'product');
    expect(() => render(<Environment env="dark">x</Environment>)).toThrow(/not one of product/);
  });

  it('refuses a coloured part rendered outside any environment', () => {
    expect(() => render(<Text variant="body">x</Text>)).toThrow(/must render inside <Environment>/);
  });

  it('has no theme switch: no prop reads a preference', () => {
    expect(() => render(<Environment env="product" theme="light">x</Environment>)).toThrow(/"theme" is not part of its API/);
  });
});

describe('closed API — appearance never comes from the call site', () => {
  quietRenderErrors();

  it.each([
    ['className', { className: 'text-signal-kill' }],
    ['style', { style: { color: 'red' } }],
    ['color', { color: 'gold' }],
    ['tone', { tone: 'danger' }],
  ])('Text refuses %s', (name, extra) => {
    expectRefused(<Text variant="body" {...extra}>x</Text>, new RegExp(`"${name}" is not part of its API`));
  });

  it('keeps aria-* and data-* open, and reserves data-lumi-*', () => {
    renderIn(<Text variant="body" aria-label="named" data-testid="t">x</Text>);
    expect(screen.getByTestId('t')).toHaveAttribute('aria-label', 'named');
    expectRefused(<Text variant="body" data-lumi-state="FAILED">x</Text>, /reserved/);
  });
});

describe('Surface — levels are roles; a boundary needs its CMP-04 reason', () => {
  quietRenderErrors();

  it('renders each level as an unbounded region by default', () => {
    for (const level of ['base', 'raised', 'elevated']) {
      renderIn(<Surface level={level} data-testid={level}>x</Surface>);
      expect(screen.getByTestId(level)).toBeInTheDocument();
    }
  });

  it('accepts only the five CMP-04 boundary reasons', () => {
    renderIn(<Surface level="raised" boundary="evidenceGroup" as="section" aria-label="Evidence">x</Surface>);
    expect(screen.getByRole('region', { name: 'Evidence' })).toBeInTheDocument();
    expectRefused(<Surface level="raised" boundary="important">x</Surface>, /not one of object/);
    expectRefused(<Surface level="elevated" boundary="object">x</Surface>, /already an overlay container/);
  });

  it('refuses a level that is a look rather than a role', () => {
    expectRefused(<Surface level="card">x</Surface>, /not one of base/);
  });
});

describe('Stack · Inline · Rule — relationship tiers, not sizes', () => {
  quietRenderErrors();

  it('accepts the five relational tiers and refuses size names', () => {
    for (const gap of ['inline', 'meta', 'object', 'section', 'macro']) {
      render(<Stack gap={gap}><span>a</span></Stack>);
      render(<Inline gap={gap}><span>a</span></Inline>);
    }
    expect(() => render(<Stack gap="md">x</Stack>)).toThrow(/not one of inline/);
    expect(() => render(<Inline gap={16}>x</Inline>)).toThrow(/not one of inline/);
  });

  it('renders lists semantically when asked', () => {
    render(<Stack gap="meta" as="ul"><li>one</li><li>two</li></Stack>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('hides a decorative divider and announces a structural rule', () => {
    const { container } = renderIn(<><Rule kind="divider" /><Rule kind="structure" /></>);
    const rules = container.querySelectorAll('hr');
    expect(rules[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('separator')).toBe(rules[1]);
    expectRefused(<Rule kind="gold" />, /not one of divider/);
  });
});

describe('Text · Heading — the one typographic API', () => {
  quietRenderErrors();

  it('offers the five prose roles and no metric role', () => {
    for (const variant of ['claim', 'body', 'label', 'caption', 'identifier']) {
      renderIn(<Text variant={variant} data-testid={variant}>x</Text>);
    }
    expectRefused(<Text variant="metric">4.2x</Text>, /not one of claim/);
    expectRefused(<Text variant="title">x</Text>, /not one of claim/);
  });

  it('renders real heading levels and refuses the brand display role in the product', () => {
    renderIn(<Heading level={2} variant="section">Why</Heading>);
    expect(screen.getByRole('heading', { level: 2, name: 'Why' })).toBeInTheDocument();
    expectRefused(<Heading level={1} variant="brand">LUMI</Heading>, /marketing environments/);
    renderIn(<Heading level={1} variant="brand">Brand moment</Heading>, 'marketing');
    expect(screen.getByRole('heading', { level: 1, name: 'Brand moment' })).toBeInTheDocument();
  });

  it('keeps visually hidden text in the accessibility tree', () => {
    render(<p>Verdict<VisuallyHidden> for this campaign</VisuallyHidden></p>);
    expect(screen.getByText('for this campaign', { exact: false })).toBeInTheDocument();
  });
});

describe('Icon · Announcement', () => {
  quietRenderErrors();

  it.each([['Sparkles', Sparkles], ['Bot', Bot], ['Lightbulb', Lightbulb]])('refuses forbidden iconography: %s', (name, glyph) => {
    expect(() => render(<Icon glyph={glyph} />)).toThrow(new RegExp(`"${name}" is forbidden iconography`));
  });

  it('is decorative unless labelled', () => {
    const { container } = render(<Icon glyph={Lock} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    render(<Icon glyph={Lock} label="Locked" />);
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument();
  });

  it('announces politely by default and assertively only when asked', () => {
    render(<Announcement>Queued on Meta</Announcement>);
    expect(screen.getByRole('status')).toHaveTextContent('Queued on Meta');
    render(<Announcement politeness="assertive">Execution failed</Announcement>);
    expect(screen.getByRole('alert')).toHaveTextContent('Execution failed');
  });
});
