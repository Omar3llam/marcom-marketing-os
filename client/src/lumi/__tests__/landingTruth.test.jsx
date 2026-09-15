// ============================================================
// Phase 4.4 — landing truth closure: ruled copy, pinned to the engine it describes
// ------------------------------------------------------------
// Phase 4.3 discovery found four public claims the live engine contradicts. Each
// test below holds the ruled wording on the rendered page, refuses the false
// wording it replaced, and pins the backend behaviour that makes the new wording
// true. If the engine changes, the pin fails first and the copy is reviewed; if
// the copy drifts back, the refusal fails. Same source-pin method as Phase 4.2
// (landingIllumination.test.jsx).
// ============================================================
import fs from 'node:fs';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { LandingPage } from '../landing/LandingPage.jsx';

const clientDir = localDir('../../../', import.meta.url);
const read = (file) => fs.readFileSync(`${clientDir}${file}`, 'utf8');
const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);
const text = (el) => el.textContent.replace(/\s+/g, ' ');
const verdictRow = (container, verdict) =>
  container.querySelector(`#verdicts li [data-lumi-verdict="${verdict}"]`).closest('li');

describe('no measured revenue → engagement only, and KILL / SCALE are still possible', () => {
  it('says so in the ruled words, in the footnote, both rows and the FAQ', () => {
    const { container } = renderLanding();
    expect(text(container.querySelector('#verdicts'))).toContain(
      'Where a campaign’s revenue was never measured, LUMI judges it on engagement alone and says so. It can still call KILL or SCALE when that engagement is among the weakest or strongest of comparable campaigns in your account.',
    );
    expect(verdictRow(container, 'KILL')).toHaveTextContent(
      'Return is below break-even and the audience is past the fatigue ceiling — or, where revenue was never measured, its engagement is among the weakest of comparable campaigns in the account.',
    );
    expect(verdictRow(container, 'SCALE')).toHaveTextContent(
      'Return is strong and engagement is above the bar for the campaign’s objective — or, where revenue was never measured, its engagement is among the strongest of comparable campaigns in the account.',
    );
    expect(text(container.querySelector('#questions'))).toContain(
      'Where revenue, conversions or delivery were not measured, LUMI says so, and why. A campaign whose revenue was never measured is judged on engagement alone, and its verdict says so — including when it is compared with similar campaigns in your account.',
    );
  });

  it('never claims missing revenue rules out KILL or SCALE', () => {
    const page = text(renderLanding().container);
    // "…does not call KILL or SCALE on revenue" (the NOT_MEASURED state) stays: it is
    // true, because a relative KILL / SCALE is called on engagement, not on revenue.
    expect(page).toContain('LUMI does not call KILL or SCALE on revenue.');
    expect(page).not.toMatch(/(does not|never|cannot|can't|won't) (call|issue) KILL or SCALE(?! on revenue)/i);
    expect(page).not.toMatch(/(not|never) (be )?called KILL or SCALE/i);
  });

  it('is true in the engine: the connector sweep ranks no-revenue campaigns into KILL and SCALE', () => {
    const ranking = read('../src/services/verdict-engine/relativeRanking.js');
    expect(ranking).toContain("const UPGRADABLE = new Set([VERDICT.HOLD, VERDICT.WATCH]);");
    expect(ranking).toContain('node.signalInput?.revenueMeasured === false &&');
    expect(ranking).toMatch(/MIN_COHORT:\s+3,/);
    expect(ranking).toMatch(/verdict: VERDICT\.SCALE,[\s\S]*?Based on engagement signals only/);
    expect(ranking).toMatch(/verdict: VERDICT\.KILL,[\s\S]*?Based on engagement signals only/);
    expect(read('../src/services/verdict-engine/connectorVerdictService.js'))
      .toContain('const annotated = applyRelativeRanking(rollupVerdicts(tree));');
  });
});

describe('absence is claimed only where it is proven (Finding A stays open)', () => {
  it('scopes the Trust lead to the states it shows, and the FAQ to return on revenue', () => {
    const { container } = renderLanding();
    const trust = container.querySelector('#trust');
    expect(trust).toHaveTextContent(
      'These are the absences LUMI names. Each has its own words and its own reason, and none is shown as a zero.',
    );
    expect(trust.querySelectorAll('ul > li [data-lumi-state]').length).toBeGreaterThanOrEqual(5);
    expect(trust.textContent).not.toMatch(/\d/);
    expect(text(container.querySelector('#questions'))).toContain(
      'Where there is no revenue to judge return on, LUMI says so instead of showing a return of zero.',
    );
  });

  it('makes no universal claim that an unmeasured signal is never read as zero or healthy', () => {
    const page = text(renderLanding().container);
    expect(page).not.toMatch(/never treated as healthy/i);
    expect(page).not.toMatch(/never drawn as a zero/i);
    expect(page).not.toMatch(/measured zero or measured nothing/i);
  });
});

describe('INSUFFICIENT_DATA means nothing measurable, not "too little"', () => {
  it('uses the ruled reason and not the one it replaced', () => {
    const { container } = renderLanding();
    expect(container.querySelector('#trust')).toHaveTextContent(
      'The campaign delivered nothing measurable in its window. No verdict is issued; this reason is.',
    );
    expect(container.textContent).not.toMatch(/delivered too little/i);
  });

  it('is true in the engine: no delivery is gated out, while a thin sample is a WATCH', () => {
    const service = read('../src/services/verdict-engine/connectorVerdictService.js');
    expect(service).toContain('if (hasMeasuredRevenue(c) || hasEngagement(c)) {');
    expect(service).toContain('reason: GATING_REASON.NO_MEASURABLE_DELIVERY });');
    expect(read('../src/services/verdict-engine/verdictEngine.js'))
      .toMatch(/if \(sampleKnown && impressions < MIN_IMPRESSIONS\) \{\s*return finalise\(\s*VERDICT\.WATCH/);
  });
});

describe('a stored decision keeps its call and reasons (Phase 4.2 ruled form)', () => {
  it('uses the ruled wording in the lead and the caption, never the broader form', () => {
    const { container } = renderLanding();
    const evidence = text(container.querySelector('#evidence'));
    expect(evidence).toContain('Its call and reasons are never rewritten when a later assessment disagrees.');
    expect(evidence).toContain('Its call and reasons are never rewritten. LUMI states the difference and leaves the call to you.');
    expect(container.textContent).not.toMatch(/never rewrites that decision|recorded decision is not rewritten/i);
  });

  it('is true in the engine: superseding writes status and outcome, never the call or its reasons', () => {
    const service = read('../src/services/verdict-engine/VerdictService.js');
    const data = service.match(/async function resolvePrevious[\s\S]*?data: \{([\s\S]*?)\}/)[1];
    expect(data).toMatch(/status:\s+'SUPERSEDED'/);
    expect(data).not.toMatch(/\b(verdict|diagnosis|hypotheses|counterfactuals|rationale)\s*:/);
  });
});

describe('memory confidence is stated once, in the spine', () => {
  it('drops the repeated axis and its stronger wording, and keeps the belief record', () => {
    const { container } = renderLanding();
    const memory = container.querySelector('#memory');
    expect(container.textContent).not.toMatch(/raise or lower confidence/i);
    expect(memory.querySelector('ol')).toBeNull();
    expect(memory).not.toHaveTextContent('Next assessment');
    expect(memory.querySelector('#belief-title')).toHaveTextContent('On this account, creative wears out before the audience does.');
    expect(read('src/lumi/landing/parts.jsx')).not.toMatch(/export function Axis/);
    expect(read('src/lumi/landing/landing.module.css')).not.toMatch(/\.axis\b/);
  });

  it('keeps the approved spine line unchanged', () => {
    const { container } = renderLanding();
    const spine = [...container.querySelector('[data-landing-spine]').children]
      .find((li) => li.querySelector('button').textContent === 'Memory');
    expect(spine).toHaveTextContent('Never changes a verdict. It can make LUMI more or less confident.');
  });
});

describe('one quiet next step at the proof peak', () => {
  it('ends the decision band with a quiet link to /signup, inside the Charcoal band', () => {
    const { container } = renderLanding();
    const proof = container.querySelectorAll('[data-landing-cta="proof"]');
    expect(proof).toHaveLength(1);
    const [link] = proof;
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/signup');
    expect(link).toHaveTextContent('Create an account');
    expect(link).toHaveAttribute('data-lumi-prominence', 'quiet');
    expect(link.closest('#evidence')).not.toBeNull();
    expect(link.closest('[data-lumi-env]').dataset.lumiEnv).toBe('marketing-dark-section');
    const cta = [...container.querySelectorAll('[data-landing-cta]')].map((el) => el.dataset.landingCta);
    expect(cta).toEqual(['hero', 'proof', 'start']);
  });

  it('is a hook only: nothing on the landing sends an event', () => {
    for (const file of ['DecisionSection.jsx', 'HeroSection.jsx', 'CloseSections.jsx']) {
      expect(read(`src/lumi/landing/sections/${file}`)).not.toMatch(/sendBeacon|gtag\(|dataLayer|analytics[.(]|\btrack\(|fetch\(|telemetry|from '[^']*api/i);
    }
  });
});
