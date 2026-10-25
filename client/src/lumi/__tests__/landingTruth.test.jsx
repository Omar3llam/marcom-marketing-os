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

describe('current-product narrative is grounded in distinct capabilities (P8-03)', () => {
  const rowFor = (container, label) => [...container.querySelectorAll('#how li')]
    .find(row => row.querySelector('p')?.textContent === label);

  it('bridges campaign evidence into planning, experiments and reusable history in the hero', () => {
    const hero = text(renderLanding().container.querySelector('[aria-labelledby="hero-title"]'));
    expect(hero).toContain('supported connected ad accounts');
    expect(hero).toContain('helps you plan spend, test hypotheses and build a decision history');
    expect(hero).toContain('You decide what to commit and execute');
    expect(hero).toContain('outcomes only where they can be observed safely');
  });

  it('gives Budget Allocation its own plan authority rather than calling every capability a decision', () => {
    const { container } = renderLanding();
    expect(container.querySelector('#how')).not.toHaveTextContent('What LUMI decides about');
    const row = rowFor(container, 'Budget Allocation');
    expect(row).toBeDefined();
    expect(text(row)).toMatch(/Preview a proposed budget plan.*comparable currency evidence.*spend period/i);
    expect(text(row)).toMatch(/Committing an eligible plan creates proposed moves.*confirm them before execution/i);
  });

  it('identifies Testing OS and preserves operator lifecycle, association and causal boundaries', () => {
    const row = rowFor(renderLanding().container, 'Testing OS');
    expect(row).toBeDefined();
    expect(text(row)).toMatch(/Choose suggested experiments.*start and conclude the tests you commit/i);
    expect(text(row)).toMatch(/A\/B experiments.*supported winner.*correlational/i);
    expect(text(row)).toMatch(/Holdouts evaluate incremental causal lift.*Either can remain inconclusive/i);
  });

  it('makes the strategic trio discoverable in the first Hero/How reading path without equal cards', () => {
    const { container } = renderLanding();
    const how = container.querySelector('#how');
    expect(how).toHaveTextContent('Different capabilities, one decision system');
    for (const label of ['Campaign decisions', 'Budget Allocation', 'Testing OS', 'Decision Memory']) {
      expect(rowFor(container, label)).toBeDefined();
    }
    expect(how).toHaveTextContent('Available capabilities depend on your account, role and plan.');
    expect(text(rowFor(container, 'Decision Memory'))).toMatch(/captured grounds.*outcomes where safely observable.*not chat memory/i);
    expect(text(rowFor(container, 'Decision Memory'))).toContain('Proof of Learning checks qualifying scored calls; insufficient evidence means no calibrated claim.');
  });

  it('distinguishes Proof of Learning from Memory and withholds unsupported calibrated claims', () => {
    const { container } = renderLanding();
    const memory = container.querySelector('#memory');
    expect(memory.querySelector('#proof-learning-title')).toHaveTextContent('Proof of Learning');
    expect(text(memory)).toMatch(/confidence of qualifying scored decisions.*observed outcomes/i);
    expect(text(memory)).toMatch(/evidence is sufficient.*When it is not, LUMI withholds a calibrated claim/i);
    expect(text(memory)).not.toMatch(/accuracy improves|learning is guaranteed|retrain|\d+% accurate/i);
    expect(memory).toHaveTextContent('Illustrative example — an invented belief and record.');
  });

  it('pins preview, eligibility and proposed moves to the reaching allocation contract', () => {
    const service = read('../src/services/allocation-engine/AllocationService.js');
    const preview = service.slice(service.indexOf('export async function previewAllocation('), service.indexOf('function unmeasuredAllocation'));
    expect(preview).toContain('coverage: PERIOD_COVERAGE.COMPLETE');
    expect(preview).toContain('matchBudgetCurrency(spend.portfolio, totalBudgetCurrency)');
    expect(preview).toContain('sameMonetaryUnit');
    expect(preview).not.toMatch(/\.create\(|\.update\(|executeMeta|executeAction/);
    expect(service).toContain('Number.isFinite(a.deltaMinor) && a.deltaMinor !== 0');
    expect(service).toMatch(/verdict:\s+'REALLOCATE'[\s\S]*?status:\s+'PROPOSED'/);
    const panel = read('src/features/intelligence/blended-truth/AllocationPanel.jsx');
    expect(panel).toContain('Confirm');
    expect(panel).toContain('in Decisions to execute.');
    expect(read('../src/routes/lumi/portfolio.js')).toContain("requirePlan('GROWTH')");
  });

  it('pins proposed/running tests and separate guarded holdout readouts', () => {
    expect(read('../src/services/test-generator/TestGeneratorService.js')).toMatch(/commitAgenda[\s\S]*?status:\s+'PROPOSED'/);
    expect(read('../src/services/test-tracker/TestTrackerService.js')).toMatch(/startTest[\s\S]*?status:\s+'RUNNING'/);
    expect(read('../src/services/test-readout/testReadoutEngine.js')).toMatch(/minSample < floor[\s\S]*?return inconclusive/);
    expect(read('../src/services/incrementality-engine/incrementalityEngine.js')).toContain("status: conclusive ? 'CONCLUSIVE' : 'INCONCLUSIVE'");
    expect(read('../src/routes/lumi/testing.js')).toContain("testingRouter.use('/tests', requirePlan('PRO'))");
    expect(read('../src/routes/lumi/testing.js')).toContain('requireOperator, requireMeasurementTier, requireStrategist');
  });

  it('pins incomplete provenance, conditional pattern support and confidence-only memory contribution', () => {
    expect(read('../src/services/verdict-engine/VerdictService.js')).toContain('if (!basis) return null;');
    expect(read('../src/services/decision-accuracy/outcomeEvidence.js')).toContain('A recorded outcome is HUMAN-REPORTED.');
    expect(read('../src/services/pattern-engine/patternEngine.js')).toContain('effectiveSupport >= cfg.minEstablished && accuracy != null && accuracy >= cfg.minAccuracy');
    const connector = read('../src/services/verdict-engine/connectorVerdictService.js');
    expect(connector).toMatch(/verdict:\s+c.verdict,[\s\S]*?confidence: applyMemoryToConfidence\(c.verdictConfidence, memoryFactor\)/);
    const { container } = renderLanding();
    expect(container.querySelector('[data-landing-spine]')).toHaveTextContent('Never changes a verdict. It can make LUMI more or less confident.');
  });

  it('pins qualifying scored evidence and reliability publication gates to current Proof authority', () => {
    const engine = read('../src/services/decision-accuracy/decisionAccuracyEngine.js');
    expect(engine).toContain("if (d.accuracyStatus !== 'EXECUTED') continue;");
    expect(engine).toContain('if (!Number.isFinite(d.confidence))');
    expect(engine).toContain('scoredCount < cfg.minSample');
    expect(engine).toContain('scoredFraction < cfg.reliableFraction');
    const proof = read('src/features/intelligence/proof/ProofView.jsx');
    expect(proof).toContain("data?.coverage?.verdict === 'RELIABLE'");
    expect(proof).toContain('if (!reliable || role === WORKSPACE_ROLE.CLIENT)');
    expect(read('../src/services/decision-accuracy/DecisionAccuracyService.js')).toContain("scopeFor('accuracy/population')");
  });
});

// P8-02A: rendered claims plus reaching source authority. These pins are review
// triggers, not instructions to preserve today's limitations in future engines.
describe('public claims stay within their reaching authority (P8-02A)', () => {
  it('separates correlational A/B winners from causal holdouts, with either inconclusive', () => {
    const { container } = renderLanding();
    const tests = [...container.querySelectorAll('#how li')]
      .find((row) => row.querySelector('p')?.textContent === 'Testing OS');
    expect(text(tests)).toMatch(/A\/B experiments compare variants.*supported winner.*correlational/i);
    expect(text(tests)).toMatch(/Holdouts evaluate incremental causal lift/i);
    expect(text(tests)).toMatch(/Either can remain inconclusive.*evidence/i);
    expect(text(tests)).not.toMatch(/experiments and holdouts.*caused the result/i);
  });

  it('pins separate test readout and holdout paths, both able to withhold conclusions', () => {
    const tracker = read('../src/services/test-tracker/TestTrackerService.js');
    expect(tracker).toMatch(/readTest\(/);
    expect(tracker).toMatch(/designTest\(/);
    expect(tracker).toMatch(/correlational[\s\S]*?causal/);
    expect(read('../src/services/test-readout/testReadoutEngine.js'))
      .toMatch(/winnerLabel: null,[\s\S]*?CONFIDENCE_LABEL\.INCONCLUSIVE/);
    expect(read('../src/services/incrementality-engine/incrementalityEngine.js'))
      .toMatch(/status: conclusive \? 'CONCLUSIVE' : 'INCONCLUSIVE'/);
  });

  it('offers Meta setup and qualifies configured Google reporting, not equivalent new setup', () => {
    const { container } = renderLanding();
    expect(container.querySelector('#start')).toHaveTextContent('Create an account, then connect Meta Ads.');
    expect(text(container)).not.toMatch(/connect Meta Ads or Google Ads/i);
    expect(container.querySelector('#questions')).toHaveTextContent('Google Ads reporting is supported for configured accounts; first-time Google setup is not currently available through the self-service connection flow.');
    expect(text(container)).toContain('supported connected ad accounts');
  });

  it('pins the sunset Google discovery limitation; restoration requires landing claim review', () => {
    const discovery = read('../src/routes/auth/google.js');
    // A changed discovery path must trigger review of the public qualification.
    // This does NOT assert v17 is a permanent requirement of the product.
    expect(discovery, 'Google discovery changed: review landing availability claims against the restored reaching flow.')
      .toContain('https://googleads.googleapis.com/v17/customers:listAccessibleCustomers');
    expect(discovery).toMatch(/accountId = \(body\.resourceNames/);
    expect(read('../src/services/connectors/GoogleAdsConnector.js'))
      .toContain("if (!cred.accountId) return { ok: false, error: 'Google credential has no customerId' }");
    expect(read('../src/services/connectors/google/googleAdsClient.js'))
      .toMatch(/fetchGoogleCampaignMetrics[\s\S]*?\$\{API_VERSION\}/);
    expect(read('src/features/connectors/services.js')).toContain("GOOGLE: '/api/auth/google/connect'");
  });

  it('does not present GA4 backend support as public self-service connection readiness', () => {
    const { container } = renderLanding();
    const data = [...container.querySelectorAll('[data-landing-spine] > li')]
      .find((row) => row.querySelector('button').textContent === 'Data');
    expect(data).toHaveTextContent('What supported connected sources report.');
    expect(container.querySelector('#questions')).toHaveTextContent('Google Analytics 4 data support exists, but self-service connection is not currently available.');
    expect(text(container)).not.toMatch(/Meta Ads and Google Ads, plus Google Analytics 4|connect (GA4|Google Analytics 4)|revenue automatically comes from GA4/i);
  });

  it('pins GA4 foundation and the actual onboarding, settings and mounted auth paths', () => {
    expect(read('../src/services/connectors/connectorRegistry.js')).toContain('[GA4]:            ga4Connector');
    expect(read('../src/services/connectors/GA4Connector.js')).toContain("if (!cred.accountId) return { ok: false, error: 'GA4 credential has no property id' }");
    const services = read('src/features/connectors/services.js');
    const paths = services.match(/export const CONNECT_PATH = (\{[^;]+\});/)[1];
    expect(paths, 'New self-service path: review landing provider availability.').toBe("{ GOOGLE: '/api/auth/google/connect', META: '/api/auth/meta/connect' }");
    expect(services).toContain('return Boolean(CONNECT_PATH[platform]);');
    expect(services).toContain('const path = CONNECT_PATH[platform];');
    const settings = read('src/features/connectors/ConnectorsView.jsx');
    expect(settings).toContain("const KNOWN = ['META', 'GOOGLE', 'TIKTOK', 'LINKEDIN', 'SNAP'];");
    expect(settings).toMatch(/isConnectable\(platform\)[\s\S]*?startConnect\(platform, projectId\)/);
    expect(read('src/pages/OnboardingPage/steps/ConnectStep.jsx')).toContain("startConnect('META', projectId, RETURN_TO)");
    const mountedAuth = [...read('../src/server.js').matchAll(/app\.use\('(\/api\/auth\/[^']+)'/g)].map((match) => match[1]);
    expect(mountedAuth).toContain('/api/auth/meta');
    expect(mountedAuth).toContain('/api/auth/google');
    expect(mountedAuth).not.toContain('/api/auth/ga4');
  });

  it('replaces universal missing-zero and decide-nothing claims with an operator context task', () => {
    const problem = text(renderLanding().container.querySelector('#problem'));
    expect(problem).toContain('The decision about what to do next is still yours.');
    expect(problem).toContain('A metric without enough context');
    expect(problem).toContain('Deciding whether the value is real, comparable, or usable.');
    expect(problem).not.toMatch(/report everything and decide nothing|a zero where a number is missing/i);
  });

  it('removes universal dashboard memory and missing-value claims from the comparison', () => {
    const difference = text(renderLanding().container.querySelector('#difference'));
    expect(difference).not.toMatch(/Nothing between visits|A zero or an empty chart/i);
    expect(difference).toContain('A reporting workflow');
    expect(difference).toContain('The operator’s tasks in reporting and question-answer workflows, alongside what LUMI records and supports.');
  });

  it('removes unsupported chat evidence, memory and action limitations', () => {
    const difference = text(renderLanding().container.querySelector('#difference'));
    expect(difference).not.toMatch(/whether or not the data supports it|The conversation\.|No one\./i);
    expect(difference).toContain('A question-answer workflow');
    expect(difference).toContain('Check what evidence supports the answer.');
  });

  it('limits Memory to captured grounds, safely observable outcomes and supported patterns', () => {
    const { container } = renderLanding();
    expect(container.querySelector('#memory')).toHaveTextContent('Recorded decisions keep the grounds captured when the call was made.');
    expect(container.querySelector('#memory')).toHaveTextContent('When an outcome can be observed safely, LUMI measures it against the recorded decision.');
    expect(container.querySelector('#memory')).toHaveTextContent('Patterns that keep holding can become account beliefs.');
    expect(container.querySelector('#how')).toHaveTextContent('Observed outcomes or human reports, with their limits — or why no outcome can be measured.');
    expect(container.querySelector('#difference')).toHaveTextContent('Recorded decisions, captured grounds, and outcomes where safely observable.');
    expect(text(container)).not.toMatch(/Every decision is kept with what LUMI knew|Every decision, and what happened after it\./);
  });

  it('pins uncaptured decision provenance, human outcome origin/window limits and belief eligibility', () => {
    expect(read('../src/services/verdict-engine/VerdictService.js')).toContain('if (!basis) return null;');
    expect(read('../src/services/decision-accuracy/outcomeEvidence.js')).toContain('A recorded outcome is HUMAN-REPORTED.');
    expect(read('../src/services/decision-accuracy/DecisionAccuracyService.js')).toContain('an outcome cannot cover time that has not happened');
    expect(read('../src/services/pattern-engine/patternEngine.js'))
      .toContain('effectiveSupport >= cfg.minEstablished && accuracy != null && accuracy >= cfg.minAccuracy');
  });

  it('metadata describes supported connected evidence without promising new provider setup', () => {
    const metadata = read('index.html');
    expect(metadata).toMatch(/name="description" content="LUMI reads evidence from supported connected ad accounts/);
    expect(metadata).not.toMatch(/name="description" content="[^"]*your Meta Ads and Google Ads accounts/);
  });
});

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

  it('keeps engagement ranking formulas behind cohort authority and refuses unproved capture-v1 comparisons', () => {
    const ranking = read('../src/services/verdict-engine/relativeRanking.js');
    expect(ranking).toContain("const UPGRADABLE = new Set([VERDICT.HOLD, VERDICT.WATCH]);");
    expect(ranking).toContain('node.signalInput?.revenueMeasured === false &&');
    expect(ranking).toMatch(/MIN_COHORT:\s+3,/);
    expect(ranking).toMatch(/verdict: VERDICT\.SCALE,[\s\S]*?Based on engagement signals only/);
    expect(ranking).toMatch(/verdict: VERDICT\.KILL,[\s\S]*?Based on engagement signals only/);
    expect(ranking).toContain('const hasApprovedCohortAuthority = () => false;');
    expect(ranking).toContain("if (!hasApprovedCohortAuthority()) return { ...node, relativeRefusal: { reason: 'COHORT_COMPLETENESS_UNPROVEN',");
    const service = read('../src/services/verdict-engine/connectorVerdictService.js');
    expect(service).toContain('const annotated = applyRelativeRanking({ ...rollupVerdicts(tree), cohort:');
    expect(service).toContain("cohort: cohort ?? { membershipCoverage: 'UNKNOWN', evaluationCoverage: 'UNKNOWN' }");
    expect(service).toContain('relativeRefusal: annotated.relativeRefusal ?? null,');
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
