import crypto from 'node:crypto';
import fs from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { LandingPage } from '../landing/LandingPage.jsx';

const assets = [
  ['lumi-primary-lockup-v1.svg', '8fc5a26db6903306e09a1b1314ed9de6aa4f5a2803b9bedee7dec2a7c7570cac', '0 0 378.67 344.42'],
  ['lumi-symbol-v1.svg', '7034cf5e24f6ef233728838631e75e9f8a98d2df90695fe3be71036a66a0c852', '0 0 378.67 234.85'],
];
const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);
const repoDir = localDir('../../../../', import.meta.url);

describe('Official owner-approved LUMI Brand v1', () => {
  it.each(assets)('preserves exact approved bytes and intrinsic proportions: %s', (name, hash, viewBox) => {
    const source = fs.readFileSync(`${repoDir}design-governance/brand/${name}`);
    expect(crypto.createHash('sha256').update(source).digest('hex')).toBe(hash);
    const publicSource = fs.readFileSync(`${repoDir}client/public/brand/${name}`);
    expect(publicSource.equals(source)).toBe(true);
    expect(source.toString()).toContain(`viewBox="${viewBox}"`);
    // The original internal gradient remains; no executable or remote SVG content.
    expect(source.toString()).toContain('<linearGradient');
    expect(source.toString()).not.toMatch(/<\s*(?:script|foreignObject|image|filter|text|animate)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=|@import|@font-face|url\(\s*[^#]/i);
  });

  it('replaces both placeholders with local approved resources and one accessible home-link name', () => {
    const { container } = renderLanding();
    expect(container.querySelector('[data-brand-placeholder]')).toBeNull();
    const brands = screen.getAllByRole('link', { name: 'LUMI', exact: true });
    expect(brands).toHaveLength(2);
    for (const brand of brands) {
      expect(brand).toHaveAttribute('href', '/');
      expect(brand).toHaveAttribute('data-lumi-brand', 'v1');
      const images = [...brand.querySelectorAll('img')];
      expect(images).toHaveLength(2);
      expect(images.map(image => image.getAttribute('src'))).toEqual([
        '/brand/lumi-symbol-v1.svg',
        '/brand/lumi-primary-lockup-v1.svg',
      ]);
      for (const image of images) expect(image).toHaveAttribute('alt', '');
    }
  });

  it('keeps readable LUMI identification when either original image fails', () => {
    const { container } = renderLanding();
    const brands = screen.getAllByRole('link', { name: 'LUMI', exact: true });
    for (const brand of brands) {
      expect(brand.querySelectorAll('img')).toHaveLength(2);
      for (const image of [...brand.querySelectorAll('img')]) {
        const slot = image.parentElement;
        fireEvent.error(image);
        expect(slot).toHaveTextContent('LUMI');
      }
      expect(brand.querySelectorAll('img')).toHaveLength(0);
      expect(brand).toHaveAttribute('aria-label', 'LUMI');
      expect(brand).toHaveAttribute('href', '/');
    }
    expect(container.querySelector('[data-brand-placeholder]')).toBeNull();
  });
});
