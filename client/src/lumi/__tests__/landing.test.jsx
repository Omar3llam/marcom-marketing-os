// ============================================================
// Phase 4 — the LUMI landing page: structure, truth and interaction
// ------------------------------------------------------------
// Rendered, not read as source. Each check names the rule it holds.
// ============================================================
import fs from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { LandingPage } from '../landing/LandingPage.jsx';
import RoutedLandingPage from '../../pages/LandingPage.jsx';

const clientDir = localDir('../../../', import.meta.url);
const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);

describe('LUMI landing — structure', () => {
  it('is what the `/` route renders', () => {
    expect(RoutedLandingPage).toBe(LandingPage);
  });

  it('has one h1, a main landmark, and headings that never skip a level (Article 21)', () => {
    const { container } = renderLanding();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Verdicts. Not dashboards.');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main').id).toBe('main-content');
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
    levels.forEach((level, index) => {
      if (index > 0) expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
    });
  });

  it('answers the brief questions in order', () => {
    renderLanding();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Dashboards report everything and decide nothing.',
      'LUMI reasons in one direction.',
      'Six verdicts. Each one is a call, not a colour.',
      'A decision keeps its grounds.',
      'When LUMI cannot know, it says so.',
      'Decisions compound into memory.',
      'Not a dashboard. Not a chat window.',
      'Before you connect',
      'Start from your own evidence.',
    ]);
  });

  it('every in-page link lands on a section that exists', () => {
    const { container } = renderLanding();
    const anchors = [...container.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href'));
    expect(anchors.length).toBeGreaterThan(0);
    for (const href of anchors) expect(container.querySelector(href)).not.toBeNull();
  });

  it('sends every account call to action to the real auth routes', () => {
    renderLanding();
    for (const link of screen.getAllByRole('link', { name: 'Create an account' })) expect(link).toHaveAttribute('href', '/signup');
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) expect(link).toHaveAttribute('href', '/login');
  });
});

describe('LUMI landing — truth (PR-5, PR-7, PR-8, Article 28, Article 30)', () => {
  it('shows all six verdicts, and every verdict mark sits in a Charcoal section (CMP-09 §7)', () => {
    const { container } = renderLanding();
    const verdicts = container.querySelector('#verdicts');
    for (const verdict of ['KILL', 'HOLD', 'SCALE', 'WATCH', 'REFRESH', 'REALLOCATE']) {
      expect(verdicts.querySelector(`[data-lumi-verdict="${verdict}"]`)).not.toBeNull();
    }
    const marks = [...container.querySelectorAll('[data-lumi-verdict]')];
    expect(marks.length).toBe(9);
    for (const mark of marks) expect(mark.closest('[data-lumi-env]').dataset.lumiEnv).toBe('marketing-dark-section');
  });

  it('carries no figure outside a region labelled "Illustrative example"', () => {
    const { container } = renderLanding();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const figures = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.replace(/Google Analytics 4/g, '');
      if (!/\d/.test(text)) continue;
      const region = node.parentElement.closest('figure, section[id]');
      figures.push(node.textContent.replace(/\s+/g, ' ').trim());
      expect(region, `"${node.textContent}" is outside any region`).not.toBeNull();
      expect(region.textContent, `"${node.textContent}" is in an unlabelled region`).toMatch(/Illustrative example/);
    }
    // The complete list, so a new number on the page is a reviewed change.
    expect(figures).toEqual([
      'computed 2026-09-14 09:00 UTC',
      'committed 2026-09-01 09:00 UTC',
      'dec_illustrative_01',
      'computed 2026-09-14 09:00 UTC',
      'Illustrative account · Since 2026-06-02 · LUMI decisions and their outcomes',
      '6 decisions',
      'Since 2026-06-02',
      '5 of 6',
      'Since 2026-06-02',
    ]);
  });

  it('makes none of the legacy fabricated, liveness, chat or unsourced claims', () => {
    const { container } = renderLanding();
    const text = container.textContent;
    for (const forbidden of [
      /Know what to do next/, /94%/, /42%/, /\$\d/, /Ask anything/, /always[- ]on/i, /always watching/i,
      /\bwatching\b/i, /AI-powered/i, /\bmagic/i, /revolutionary/i, /next-generation/i, /cutting-edge/i,
      /\bunlock/i, /supercharge/i, /MENA/, /under 2 minutes/i, /Most Popular/i, /gets sharper/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('states Verdict ≠ Action: only KILL is carried out, and only on confirmation', () => {
    const { container } = renderLanding();
    const rows = [...container.querySelectorAll('#verdicts li')];
    const next = Object.fromEntries(rows.map((row) => [row.querySelector('[data-lumi-verdict]').dataset.lumiVerdict, row.textContent]));
    expect(next.KILL).toMatch(/pause the campaign on Meta once you confirm/);
    expect(next.HOLD).toMatch(/no action is offered/);
    expect(next.SCALE).toMatch(/Needs a budget figure from you/);
    expect(next.WATCH).toMatch(/No platform action/);
    expect(next.REFRESH).toMatch(/Needs a new creative from you/);
    expect(next.REALLOCATE).toMatch(/Needs your call/);
  });
});

describe('LUMI landing — the decision demonstration (PR-1, PR-2, FC-5)', () => {
  it('names the disagreement in words, never as a diff, and gives the NOW assessment no action', () => {
    const { container } = renderLanding();
    const evidence = container.querySelector('#evidence');
    const now = evidence.querySelector('[data-lumi-spine="NOW"]');
    expect(now).toHaveTextContent('This differs from the decision recorded earlier: KILL.');
    expect(within(now).queryByRole('button')).toBeNull();
    expect(evidence.textContent).not.toMatch(/[→←⇒⇐]/);
    expect(evidence.querySelector('s, del, strike')).toBeNull();
    const hero = container.querySelector('figure');
    expect(within(hero).queryByRole('button')).toBeNull();
    expect(hero.querySelector('[data-lumi-tense="NOW"]')).not.toBeNull();
  });

  it('shows no outcome until something was done, then confirms without pretending it was sent', () => {
    const { container } = renderLanding();
    const stored = container.querySelector('#evidence [data-lumi-spine="AT_DECISION"]');
    expect(stored.querySelector('[data-lumi-stage="OUTCOME"]')).toBeNull();
    expect(stored).toHaveTextContent('Open');

    fireEvent.click(within(stored).getByRole('button', { name: 'Pause campaign' }));

    expect(stored).toHaveTextContent('Paused on Meta. Illustrative example: nothing was sent to Meta.');
    expect(stored).toHaveTextContent('Executed');
    expect(stored.querySelector('[data-lumi-stage="OUTCOME"]')).toHaveTextContent('Not measured');
    expect(within(stored).queryByRole('button')).toBeNull();
    expect(document.activeElement).toHaveTextContent('nothing was sent to Meta');
  });

  it('keeps the human record in its own words', () => {
    const { container } = renderLanding();
    const stored = container.querySelector('#evidence [data-lumi-spine="AT_DECISION"]');
    fireEvent.click(within(stored).getByRole('button', { name: 'I paused it myself' }));
    expect(stored).toHaveTextContent('Recorded: you paused it yourself. Illustrative example: nothing was saved.');
  });

  it('asks its questions with native disclosures', () => {
    const { container } = renderLanding();
    expect(container.querySelectorAll('#questions details > summary')).toHaveLength(6);
  });
});

describe('LUMI landing — identity and first-load hygiene (Phase 4 remediation)', () => {
  const read = (file) => fs.readFileSync(`${clientDir}${file}`, 'utf8');

  it('names the product LUMI in its document metadata, never MARCOM AI', () => {
    const html = read('index.html');
    const title = 'LUMI | Decision Intelligence for Performance Marketing';
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
    expect(html).toContain('<meta property="og:site_name" content="LUMI" />');
    expect(html).not.toMatch(/marcom ai|AI Marketing Decision Engine|AI-powered/i);
  });

  it('states the category and the promise on the page itself', () => {
    const { container } = renderLanding();
    expect(container.querySelector('#hero-title').parentElement).toHaveTextContent('Decision Intelligence for Performance Marketing');
    expect(container.querySelector('footer')).toHaveTextContent('Clarity turns complexity into decisions.');
  });

  it('draws the document skip link with the neutral LUMI focus ring, never gold', () => {
    const skip = read('index.html').match(/<a\s[^>]*href="#main-content"[^>]*>/)[0];
    expect(skip).toContain('data-lumi-env="marketing"');
    expect(skip).toContain('lumi-skip-link');
    expect(skip).not.toMatch(/accent|gold/);
    const rule = read('src/index.css').match(/\.lumi-skip-link:focus-visible\s*\{([^}]*)\}/)[1];
    expect(rule).toContain('outline: var(--lumi-size-focus-width) solid var(--lumi-color-interaction-focus-ring);');
    expect(rule).toContain('box-shadow: none;');
  });

  it('keeps the legacy landing out of the Tailwind scan only while no route renders it', () => {
    const excluded = read('tailwind.config.js').includes("'!./src/pages/LandingPage/**'");
    const routed = /from '\.\/LandingPage\//.test(read('src/pages/LandingPage.jsx'));
    expect(excluded).toBe(true);
    expect(routed).toBe(false);
  });
});

describe('LUMI landing — review entry isolation', () => {
  it('is served only by the dev server and never built', () => {
    expect(fs.readFileSync(`${clientDir}lumi-landing.html`, 'utf8')).toContain('/src/lumi/lab/landingMain.jsx');
    expect(fs.readFileSync(`${clientDir}index.html`, 'utf8')).not.toMatch(/lumi-landing|landingMain/);
    expect(fs.readFileSync(`${clientDir}vite.config.js`, 'utf8')).not.toMatch(/lumi-landing|landingMain/);
  });
});
