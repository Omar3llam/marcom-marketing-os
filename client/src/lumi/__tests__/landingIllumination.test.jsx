// ============================================================
// Phase 4.2 prototype — selective illumination: truth and interaction contract
// ------------------------------------------------------------
// Hero H-B "Light what mattered" and the reader-driven model spine
// (PHASE_4_1_VISUAL_MOTION_RESEARCH.md §10, §11, §18). Rendered, not read as
// source, except where the claim IS about source: the verdict engine the hero
// describes, and the absence of timers and scroll listeners.
// ============================================================
import fs from 'node:fs';
import { act, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { LandingPage } from '../landing/LandingPage.jsx';
import { DATA, DID_NOT_DECIDE, EVIDENCE } from '../landing/sections/HeroDemonstration.jsx';
import { MODEL } from '../landing/sections/ModelSpine.jsx';
import { TOKENS_CSS } from './lumiAudit.js';

const clientDir = localDir('../../../', import.meta.url);
const read = (file) => fs.readFileSync(`${clientDir}${file}`, 'utf8');
const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);
const hero = (container) => container.querySelector('[data-landing-demo="light-what-mattered"]');
// The Data column is the demonstration's first column; its list holds the inputs.
const dataInputs = (demo) => demo.querySelector('ol > li:first-child ul').children;
const lightsOf = (items) => Object.fromEntries([...items].map((li) => [li.textContent, li.dataset.landingLight]));

describe('hero — the evidence each question reads is the verdict engine’s (PR-7, Q-4)', () => {
  it('pins the question-to-input map, and derives the inputs that did not decide the call', () => {
    expect(Object.fromEntries(EVIDENCE.map((q) => [q.asked, q.reads]))).toEqual({
      'Is it earning back what it spends?': ['Spend', 'Conversion value'],
      'Is the audience seeing it too often?': ['Frequency'],
      'Was revenue measured at all?': ['Spend', 'Conversion value'],
      'Has it been shown enough times to judge?': ['Impressions'],
    });
    expect(DID_NOT_DECIDE).toEqual(['Clicks', 'Click-through rate', 'Conversions', 'Campaign objective']);
    for (const q of EVIDENCE) for (const input of q.reads) expect(DATA).toContain(input);
  });

  it('matches the engine source: the gates and the KILL branch read exactly those inputs', () => {
    const engine = read('../src/services/verdict-engine/verdictEngine.js');
    expect(engine).toContain('const revenueMeasured = agg.revenueMinor > 0 && agg.spendMinor > 0;');
    expect(engine).toContain('roas:        revenueMeasured ? agg.revenueMinor / agg.spendMinor : null,');
    expect(engine).toContain('if (sampleKnown && impressions < MIN_IMPRESSIONS) {');
    const kill = engine.match(/\} else if \((roas < V\.BREAKEVEN_ROAS && frequency >= V\.FATIGUE_FREQ)\) \{\s*[^}]*verdict = VERDICT\.KILL;/);
    expect(kill, 'the KILL branch changed; re-verify the hero before changing this test').not.toBeNull();
    expect(kill[1]).not.toMatch(/ctr|clicks|conversions|objective/i);
  });
});

describe('hero — light what mattered (M-0, MO-2.2, FC-14)', () => {
  it('rests complete: the first question chosen, its inputs lit, and the call fully lit', () => {
    const { container } = renderLanding();
    const demo = hero(container);
    const pressed = within(demo).getAllByRole('button', { pressed: true });
    expect(pressed.map((b) => b.textContent)).toEqual(['Is it earning back what it spends?']);
    expect(lightsOf(dataInputs(demo))).toEqual({
      Spend: 'claim', Impressions: 'body', Frequency: 'body', Clicks: 'meta',
      'Click-through rate': 'meta', Conversions: 'meta', 'Conversion value': 'claim', 'Campaign objective': 'meta',
    });
    // Each question states what it reads beside itself, so the link survives a phone layout
    // where the Data column is scrolled away.
    for (const question of EVIDENCE) expect(demo).toHaveTextContent(`${question.asked}${question.answer}Reads: ${question.reads.join(' and ')}`);
    expect(demo).toHaveTextContent('Did not decide this call: Clicks, Click-through rate, Conversions and Campaign objective.');
  });

  it('lights the chosen question’s inputs and its clause of the call, and hides nothing', () => {
    const { container } = renderLanding();
    const demo = hero(container);
    const everyWord = [...DATA, ...EVIDENCE.flatMap((q) => [q.asked, q.answer])];
    for (const question of EVIDENCE) {
      fireEvent.click(within(demo).getByRole('button', { name: question.asked }));
      expect(within(demo).getAllByRole('button', { pressed: true })).toHaveLength(1);
      const lights = lightsOf(dataInputs(demo));
      for (const input of DATA) {
        const expected = question.reads.includes(input) ? 'claim' : DID_NOT_DECIDE.includes(input) ? 'meta' : 'body';
        expect(lights[input], `${input} under "${question.asked}"`).toBe(expected);
      }
      const [loss, fatigue] = [...demo.querySelectorAll('[data-landing-call] [data-landing-light]')].map((s) => s.dataset.landingLight);
      expect([loss, fatigue]).toEqual({ loss: ['claim', 'body'], fatigue: ['body', 'claim'] }[question.clause] ?? ['claim', 'claim']);
      for (const word of everyWord) expect(demo.textContent).toContain(word);
      const chosen = within(demo).getByRole('button', { pressed: true }).closest('li');
      expect(chosen.dataset.landingLight).toBe('claim');
      expect(chosen).toHaveTextContent(`Reads: ${question.reads.join(' and ')}`);
    }
  });

  it('keeps the verdict, its mark and its tense unchanged by any choice (a reading aid, not a recomputation)', () => {
    const { container } = renderLanding();
    const demo = hero(container);
    for (const question of EVIDENCE) {
      fireEvent.click(within(demo).getByRole('button', { name: question.asked }));
      expect([...demo.querySelectorAll('[data-lumi-verdict]')].map((m) => m.dataset.lumiVerdict)).toEqual(['KILL']);
      expect(demo.querySelector('[data-lumi-tense="NOW"]')).not.toBeNull();
    }
  });
});

describe('model spine — reader-driven, typographic (MO-6.1, MO-6.2, M-0)', () => {
  const spine = (container) => container.querySelector('#how [data-landing-spine="model"]');

  it('draws the seven stages in production order as native buttons, VERDICT chosen at rest', () => {
    const { container } = renderLanding();
    const buttons = within(spine(container)).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Data', 'Evidence', 'Verdict', 'Decision', 'Action', 'Outcome', 'Memory']);
    for (const button of buttons) expect(button).toHaveAttribute('type', 'button');
    expect(within(spine(container)).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Verdict']);
  });

  it('lights the chosen stage, keeps its neighbours readable, steps the rest down, and never hides a stage', () => {
    const { container } = renderLanding();
    const list = spine(container);
    const stops = () => [...list.children].map((li) => li.dataset.landingLight);
    expect(stops()).toEqual(['meta', 'body', 'claim', 'body', 'meta', 'meta', 'meta']);
    fireEvent.click(within(list).getByRole('button', { name: 'Data' }));
    expect(stops()).toEqual(['claim', 'body', 'meta', 'meta', 'meta', 'meta', 'meta']);
    fireEvent.click(within(list).getByRole('button', { name: 'Memory' }));
    expect(stops()).toEqual(['meta', 'meta', 'meta', 'meta', 'meta', 'body', 'claim']);
    for (const [stage, holds, never] of MODEL) {
      expect(list).toHaveTextContent(stage);
      expect(list).toHaveTextContent(holds);
      if (never) expect(list).toHaveTextContent(never);
    }
    expect(list.querySelectorAll('[data-lumi-verdict]')).toHaveLength(0);
  });
});

describe('resting state is presentation, and nothing advances by itself (Q-3, MO-2.3, MO-6.2)', () => {
  it('keeps the default question and VERDICT chosen however much time passes, and claims no one chose them', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderLanding();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(within(hero(container)).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual([EVIDENCE[0].asked]);
      expect(within(container.querySelector('[data-landing-spine]')).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Verdict']);
      for (const region of [hero(container), container.querySelector('#how')]) {
        expect(region.textContent).not.toMatch(/you (chose|selected|picked)|selected by|your (choice|selection)/i);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('copy truth: no invariant the current code cannot prove (Q-15, research §18.16)', () => {
  // Rejected because code contradicts them: backend integrity findings A, B and C.
  const REJECTED = [
    'Never a zero standing in for a number no platform reported', // A — engine defaults absent metrics to 0
    'Never a measurement without the window it was taken over', // B — unknown-window rows are read
    'Never claimed before it was measured', // C — a zero CTR can be scored as an outcome
    'Checked before any call', // gates 1–2 call WATCH before revenue is checked
    'for any call to be made', // impressions are one gate, not the only one
    'It makes LUMI more or less confident', // memory changes nothing when not consulted
  ];

  it('renders none of the rejected claims, anywhere on the page or in the landing source', () => {
    const { container } = renderLanding();
    const sources = ['HeroDemonstration.jsx', 'ModelSpine.jsx', 'ModelSections.jsx', 'HeroSection.jsx']
      .map((file) => read(`src/lumi/landing/sections/${file}`).replace(/^\s*\/\/.*$/gm, '')).join('\n');
    for (const claim of REJECTED) {
      expect(container.textContent, claim).not.toContain(claim);
      expect(sources, claim).not.toContain(claim);
    }
  });

  it('states the provable replacements', () => {
    const { container } = renderLanding();
    const spine = container.querySelector('[data-landing-spine]');
    const neverOf = (stage) => MODEL.find(([name]) => name === stage)[2];
    expect(neverOf('Data')).toBe('Never judges return on revenue no platform reported.');
    expect(neverOf('Decision')).toBe('Its call and reasons are never rewritten when a later assessment disagrees.');
    expect(neverOf('Memory')).toBe('Never changes a verdict. It can make LUMI more or less confident.');
    for (const stage of ['Data', 'Decision', 'Memory']) expect(spine).toHaveTextContent(neverOf(stage));
    expect(hero(container)).toHaveTextContent('Checked first');
    expect(hero(container)).toHaveTextContent('Yes — enough impressions to judge it.');
  });

  it('removes the Evidence and Outcome guarantees without replacing them, and keeps all seven stages', () => {
    const { container } = renderLanding();
    expect(MODEL.filter(([, , never]) => never === null).map(([stage]) => stage)).toEqual(['Evidence', 'Outcome']);
    const stops = [...container.querySelector('[data-landing-spine]').children];
    expect(stops.map((li) => li.querySelector('button').textContent)).toEqual(MODEL.map(([stage]) => stage));
    for (const stage of ['Evidence', 'Outcome']) {
      const stop = stops.find((li) => li.querySelector('button').textContent === stage);
      expect(stop.querySelectorAll('p')).toHaveLength(1);
      expect(stop.textContent).not.toMatch(/never/i);
    }
  });

  it('backs the Data line with the engine: return is judged only on measured revenue', () => {
    const engine = read('../src/services/verdict-engine/verdictEngine.js');
    expect(engine).toContain('const revenueMeasured = agg.revenueMinor > 0 && agg.spendMinor > 0;');
    expect(engine).toContain('roas:        revenueMeasured ? agg.revenueMinor / agg.spendMinor : null,');
    expect(engine).toMatch(/if \(!revenueMeasured\) \{[\s\S]*?\} else if \(roas < V\.BREAKEVEN_ROAS/);
  });
});

describe('wording and figures (PR-7, Phase 4.2 review §11–12)', () => {
  it('never says an input was "not read"; it says what did not decide the call', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toMatch(/not read/i);
    expect(read('src/lumi/landing/sections/HeroDemonstration.jsx')).not.toMatch(/not read/i);
    expect(hero(container)).toHaveTextContent('Did not decide this call:');
  });

  it('adds no figure: the spine has none, and the hero only the NOW clock it already had', () => {
    const { container } = renderLanding();
    // A product name is not a figure (the same exclusion as the census in landing.test.jsx).
    expect(container.querySelector('#how').textContent.replace(/Google Analytics 4/g, '')).not.toMatch(/\d/);
    const digits = [...hero(container).querySelectorAll('*')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /\d/.test(n.textContent)))
      .map((el) => el.textContent);
    expect(digits).toEqual(['computed 2026-09-14 09:00 UTC']);
  });
});

describe('motion: only the selection mark eases (MO-6.5, MO-7; review Q-12)', () => {
  it.each(['HeroDemonstration.jsx', 'ModelSpine.jsx'])('%s has no timer, effect, scroll or visibility listener', (file) => {
    const source = read(`src/lumi/landing/sections/${file}`).replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|useEffect|useLayoutEffect|IntersectionObserver|addEventListener|onScroll|scroll/);
  });

  it('transitions exactly one property on the landing, the mark opacity; text colour changes at once', () => {
    const css = read('src/lumi/landing/landing.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const transitions = [...css.matchAll(/transition(-[a-z]+)?\s*:\s*([^;]+);/g)].map((m) => m[0].replace(/\s+/g, ' '));
    expect(transitions).toEqual(['transition: opacity var(--lumi-motion-duration-reveal) var(--lumi-motion-easing-reveal);']);
  });

  it('declares no animation at all, so nothing can run at rest (Q-8 item 1)', () => {
    const css = read('src/lumi/landing/landing.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/animation|@keyframes/);
    for (const file of ['HeroDemonstration.jsx', 'ModelSpine.jsx']) {
      expect(read(`src/lumi/landing/sections/${file}`).replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/animat|keyframes|canvas|webgl|three/i);
    }
  });

  it('is deterministic: choosing the chosen control again changes nothing (Q-8 item 6)', () => {
    const { container } = renderLanding();
    const demo = hero(container);
    const spineList = container.querySelector('[data-landing-spine]');
    const snapshot = () => [
      ...[...demo.querySelectorAll('[data-landing-light]')].map((el) => el.dataset.landingLight),
      ...[...spineList.children].map((li) => li.dataset.landingLight),
    ].join();
    fireEvent.click(within(demo).getByRole('button', { name: EVIDENCE[1].asked }));
    fireEvent.click(within(spineList).getByRole('button', { name: 'Action' }));
    const once = snapshot();
    fireEvent.click(within(demo).getByRole('button', { name: EVIDENCE[1].asked }));
    fireEvent.click(within(spineList).getByRole('button', { name: 'Action' }));
    expect(snapshot()).toBe(once);
    expect(within(demo).getByRole('button', { name: EVIDENCE[1].asked })).toHaveAttribute('aria-pressed', 'true');
  });

  it('makes that fade 0 ms under reduced motion, in the token itself', () => {
    const reduced = fs.readFileSync(TOKENS_CSS, 'utf8').match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)[1];
    expect(reduced).toContain('--lumi-motion-duration-reveal: 0ms;');
  });
});
