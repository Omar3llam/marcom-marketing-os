// Phase 4 — ActionLink: a real link that carries a control's weight, through the
// same closed API and the same controls stylesheet as Button.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ActionLink } from '../primitives/ActionLink.jsx';
import { Button } from '../primitives/Button.jsx';
import { expectRefused, quietRenderErrors, renderIn } from './helpers.jsx';

describe('ActionLink', () => {
  quietRenderErrors();

  it('is a link with an address, in either prominence, drawn with the control classes', () => {
    renderIn(
      <>
        <ActionLink prominence="standard" to="/signup">Create an account</ActionLink>
        <ActionLink prominence="quiet" href="#evidence">See a verdict</ActionLink>
        <Button prominence="standard" onActivate={() => {}}>Compare</Button>
      </>,
      'marketing',
    );
    const route = screen.getByRole('link', { name: 'Create an account' });
    const anchor = screen.getByRole('link', { name: 'See a verdict' });
    expect(route).toHaveAttribute('href', '/signup');
    expect(route).toHaveAttribute('data-lumi-prominence', 'standard');
    expect(anchor).toHaveAttribute('href', '#evidence');
    expect(anchor).toHaveAttribute('data-lumi-prominence', 'quiet');
    // One look for a control: the standard link shares every class with the standard button.
    expect(route.className).toBe(screen.getByRole('button', { name: 'Compare' }).className);
  });

  it('passes aria-* and data-* through', () => {
    renderIn(<ActionLink prominence="standard" to="/signup" data-landing-cta="hero" aria-describedby="x">Go</ActionLink>, 'marketing');
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('data-landing-cta', 'hero');
    expect(link).toHaveAttribute('aria-describedby', 'x');
  });

  it.each([
    ['a className', { prominence: 'standard', to: '/a', className: 'btn-gold' }, /not part of its API/],
    ['a style', { prominence: 'standard', to: '/a', style: { color: 'gold' } }, /not part of its API/],
    ['an unknown prominence', { prominence: 'primary', to: '/a' }, /prominence "primary" is not one of/],
    ['no address', { prominence: 'standard' }, /exactly one of `to`/],
    ['two addresses', { prominence: 'standard', to: '/a', href: '/b' }, /exactly one of `to`/],
    ['a reserved data-lumi-* attribute', { prominence: 'standard', to: '/a', 'data-lumi-prominence': 'x' }, /reserved/],
  ])('refuses %s', (_, props, pattern) => {
    expectRefused(<ActionLink {...props}>Go</ActionLink>, pattern, 'marketing');
  });

  it('refuses a link without a visible label', () => {
    expectRefused(<ActionLink prominence="standard" to="/a">{' '}</ActionLink>, /visible label/, 'marketing');
  });

  it('refuses to render outside an environment, where no colour token exists', () => {
    expect(() => render(<MemoryRouter><ActionLink prominence="standard" to="/a">Go</ActionLink></MemoryRouter>)).toThrow(/must render inside <Environment>/);
  });
});
