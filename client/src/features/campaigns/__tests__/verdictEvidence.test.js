// ============================================================
// verdictEvidence — surfacing the engine's OWN reasoning, never inventing it
// ------------------------------------------------------------
// The helpers turn existing verdict fields (rationale / confidence / roas /
// spendMinor) into marketer-facing strings. The tests pin the two contracts
// that matter: (1) every figure shown comes from the backend rationale or a
// real snapshot metric, and (2) a missing input → null, never a made-up claim
// (no "/month" extrapolation — the spend window isn't known client-side).
// ============================================================
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/lib/money';
import { HELP } from '@/lib/helpContent';
import {
  NO_REVENUE_DISCLAIMER, confidenceLabel, evidenceClause, shortEvidence,
  nextActionFor, ignoreCostFor, decisiveMetric, FATIGUE_FREQ,
  buildRecommendationText, platformUrl, LINKABLE_CHANNELS,
  formatEvidenceValue, evidenceLabel, evidenceRows,
} from '../verdictEvidence.js';

// Verbatim shapes from relativeRanking.js and verdictEngine.js.
const RELATIVE_KILL =
  'Lowest CTR in the conversion group (0.85% vs 1.42% group average) — weakest engagement in your portfolio. Based on engagement signals only; add revenue data for ROAS-based scoring.';
const RELATIVE_SCALE =
  'Highest CTR in the awareness group (2.10% vs 1.20% group average) — strongest engagement in your portfolio. Based on engagement signals only; add revenue data for ROAS-based scoring.';
const ROAS_KILL = 'ROAS 0.42 below break-even with frequency 5.2 past the 3.5 ceiling.';

describe('confidenceLabel', () => {
  it('maps the engine numeric bands to High / Medium / Low', () => {
    expect(confidenceLabel(0.9)).toBe('High');   // absolute ROAS KILL
    expect(confidenceLabel(0.8)).toBe('High');   // absolute SCALE
    expect(confidenceLabel(0.6)).toBe('Medium'); // relative-ranking upgrades
    expect(confidenceLabel(0.5)).toBe('Low');
  });

  it('a missing/invalid confidence → null, never a fabricated label', () => {
    expect(confidenceLabel(null)).toBeNull();
    expect(confidenceLabel(undefined)).toBeNull();
    expect(confidenceLabel(NaN)).toBeNull();
    expect(confidenceLabel('high')).toBeNull();
  });
});

describe('evidenceClause', () => {
  it('extracts the measurable leading clause — the numbers stay verbatim', () => {
    expect(evidenceClause(RELATIVE_KILL))
      .toBe('Lowest CTR in the conversion group (0.85% vs 1.42% group average)');
  });

  it('a rationale with no commentary dash is returned whole (sans final period)', () => {
    expect(evidenceClause(ROAS_KILL))
      .toBe('ROAS 0.42 below break-even with frequency 5.2 past the 3.5 ceiling');
  });

  it('no rationale → null (the UI renders nothing, not an invented reason)', () => {
    expect(evidenceClause(null)).toBeNull();
    expect(evidenceClause('')).toBeNull();
    expect(evidenceClause('   ')).toBeNull();
  });
});

describe('shortEvidence', () => {
  it('drops the parenthetical numbers and shortens the cohort label', () => {
    expect(shortEvidence(RELATIVE_KILL)).toBe('Lowest CTR in its group');
    expect(shortEvidence(RELATIVE_SCALE)).toBe('Highest CTR in its group');
  });

  it('no rationale → null', () => {
    expect(shortEvidence(undefined)).toBeNull();
  });
});

describe('nextActionFor', () => {
  it('KILL → pause, SCALE → grow, REALLOCATE → move, REFRESH → new creative', () => {
    expect(nextActionFor('KILL')).toBe('Pause and reallocate budget');
    expect(nextActionFor('SCALE')).toBe('Increase budget or expand audience');
    expect(nextActionFor('REALLOCATE')).toBe('Move spend to stronger campaigns');
    expect(nextActionFor('REFRESH')).toBe('Refresh the creative');
  });

  it('leaves the no-intervention verdicts alone', () => {
    expect(nextActionFor('HOLD')).toBeNull();
    expect(nextActionFor('WATCH')).toBeNull();
    expect(nextActionFor(null)).toBeNull();
    expect(nextActionFor('NOT_A_VERDICT')).toBeNull();
  });

  // REFRESH is the reason this exists: it has a real execution capability
  // (REFRESH_CREATIVE) and its spend counts as wasted beside a KILL, but it
  // returned null — and `intentAt` is stamped only from the ActionBar this gates.
  // So no REFRESH decision could ever be recorded as acted on, and
  // decisionLearning filters on intentAt. The verdict could not reach learning.
  it('REFRESH asks for a creative change — the motion no other verdict names', () => {
    const refresh = nextActionFor('REFRESH');
    expect(refresh).not.toBeNull();
    expect(refresh).toMatch(/creative/i);
    // Its own motion, not a restatement of another verdict's. Budget stays put;
    // the ad changes — which is exactly what distinguishes it from the other three.
    for (const other of ['KILL', 'SCALE', 'REALLOCATE']) {
      expect(refresh).not.toBe(nextActionFor(other));
    }
    expect(refresh).not.toMatch(/budget|spend|audience/i);
  });

  // The copy is the imperative of the product's own one-liner for the verdict,
  // never a second string invented at the call site.
  it('reuses the helpContent wording rather than inventing copy', () => {
    expect(HELP.REFRESH_VERDICT).toMatch(/refresh the creative/i);
    expect(HELP.REFRESH_VERDICT.toLowerCase()).toContain(nextActionFor('REFRESH').toLowerCase());
  });

  // The three verdicts that ask for an intervention, and nothing else. Since
  // the decision action moved onto the campaign panel, this list is also the
  // lifecycle gate — a verdict added here gains a "Did you act on this?", which
  // is why it is worth stating as a set rather than three separate cases.
  it('REALLOCATE has an actionable next step', () => {
    expect(nextActionFor('REALLOCATE')).toBeTruthy();
  });

  // ── The distinction the verdict itself is made of ──────────
  // SCALE and REALLOCATE share the lifecycle mechanism and nothing else. One
  // says put MORE behind a winner; the other says move what this has ELSEWHERE.
  // A shared sentence would erase the difference between "your campaign is
  // working" and "your campaign is not converting", on the line the operator
  // reads to decide what to do.
  it('does not tell a REALLOCATE to scale', () => {
    expect(nextActionFor('REALLOCATE')).not.toBe(nextActionFor('SCALE'));
    expect(nextActionFor('REALLOCATE')).not.toMatch(/increase|expand|more budget/i);
  });

  // Nor is it a KILL, whose step pauses the campaign first. A REALLOCATE keeps
  // running on a smaller share.
  it('does not tell a REALLOCATE to pause', () => {
    expect(nextActionFor('REALLOCATE')).not.toBe(nextActionFor('KILL'));
    expect(nextActionFor('REALLOCATE')).not.toMatch(/pause|stop/i);
  });

  it('speaks the allocation vocabulary the rest of the product uses', () => {
    expect(nextActionFor('REALLOCATE')).toMatch(/move|reallocat|elsewhere|stronger/i);
  });

  // Imperative phrases in one register, no trailing punctuation — they are
  // rendered inline after "Next step:" and inside the copied recommendation.
  it.each([['KILL'], ['SCALE'], ['REALLOCATE'], ['REFRESH']])('%s reads as an instruction', (verdict) => {
    const action = nextActionFor(verdict);
    expect(action).toMatch(/^[A-Z]/);
    expect(action).not.toMatch(/[.!]$/);
  });
});

describe('ignoreCostFor', () => {
  it('a revenue-track KILL quotes the real ROAS, in the engine break-even terms', () => {
    const s = ignoreCostFor({ verdict: 'KILL', roas: 0.42, spendMinor: 500000, currency: 'EGP' });
    expect(s).toContain('0.42x');
    expect(s).toContain('below break-even');
  });

  it('an engagement-only KILL quotes real spend-so-far via the currency formatter', () => {
    const s = ignoreCostFor({ verdict: 'KILL', roas: null, spendMinor: 500000, currency: 'EGP' });
    // The exact figure the shared money formatter produces (locale-dependent
    // digits) — proving the same minor→major path, never a /100-blind literal.
    expect(s).toContain(formatCurrency(500000, 'EGP'));
    expect(s).toContain('no revenue measured');
  });

  // The spend window varies per sync (can be lifetime) — a monthly rate cannot
  // be derived honestly, so the copy must never claim one.
  it('never fabricates a per-month rate', () => {
    for (const roas of [0.42, null]) {
      const s = ignoreCostFor({ verdict: 'KILL', roas, spendMinor: 500000, currency: 'EGP' });
      expect(s).not.toMatch(/month/i);
    }
  });

  it('KILL with no spend data still warns without a number', () => {
    const s = ignoreCostFor({ verdict: 'KILL', roas: null, spendMinor: null });
    expect(s).toContain('wastes budget');
    expect(s).not.toMatch(/\d/);
  });

  it('SCALE names return only when revenue is real, engagement otherwise', () => {
    expect(ignoreCostFor({ verdict: 'SCALE', roas: 4.2 })).toContain('highest-return');
    expect(ignoreCostFor({ verdict: 'SCALE', roas: null })).toContain('strongest-engagement');
  });

  it('non-action verdicts → null', () => {
    expect(ignoreCostFor({ verdict: 'HOLD', roas: 1.2 })).toBeNull();
    expect(ignoreCostFor()).toBeNull();
  });
});

describe('NO_REVENUE_DISCLAIMER', () => {
  it('names the signals actually used, in marketer language', () => {
    expect(NO_REVENUE_DISCLAIMER).toBe(
      'No revenue data found — recommendation based on CTR, Frequency and Spend only.',
    );
  });
});

// ── decisiveMetric ───────────────────────────────────────────
// The row shows ONE metric, chosen from the row's own data. The UI never reads
// signalType, so a new backend signal type never needs a frontend release.
describe('decisiveMetric', () => {
  it('measured revenue → ROAS (the verdict was scored on return)', () => {
    expect(decisiveMetric({ roas: 2.4, revenueMinor: 120000, ctr: 0.01, frequency: 1.2 }))
      .toEqual({ label: 'ROAS', value: 2.4, format: 'roas' });
  });

  it('no revenue but past the fatigue ceiling → Freq', () => {
    expect(decisiveMetric({ roas: null, revenueMinor: null, ctr: 0.01, frequency: 4.2 }))
      .toEqual({ label: 'Freq', value: 4.2, format: 'freq' });
  });

  it('no revenue, frequency below the ceiling → CTR', () => {
    expect(decisiveMetric({ roas: null, revenueMinor: null, ctr: 0.012, frequency: 2.4 }))
      .toEqual({ label: 'CTR', value: 0.012, format: 'ctr' });
  });

  // The ceiling is the ENGINE's (3.5). A lower client-side threshold would call
  // Freq "decisive" on a campaign the engine treats as perfectly healthy.
  it('uses the engine fatigue ceiling, inclusive', () => {
    expect(FATIGUE_FREQ).toBe(3.5);
    expect(decisiveMetric({ ctr: 0.01, frequency: FATIGUE_FREQ }).label).toBe('Freq');
    expect(decisiveMetric({ ctr: 0.01, frequency: 3.4 }).label).toBe('CTR');
  });

  // A measured 0 is not revenue data — matching the engine's own revenue gate.
  it('a real 0 revenue does not unlock ROAS', () => {
    expect(decisiveMetric({ roas: 0, revenueMinor: 0, ctr: 0.009, frequency: 1 }).label).toBe('CTR');
  });

  it('nothing reported → null, never a picked-at-random metric', () => {
    expect(decisiveMetric({ roas: null, ctr: null, frequency: null, revenueMinor: null })).toBeNull();
    expect(decisiveMetric({})).toBeNull();
    expect(decisiveMetric()).toBeNull();
  });

  // Future-proofing: the choice is made from the DATA, so a backend signal type
  // the client has never heard of cannot change (or break) what it renders.
  it('ignores signalType entirely — a new backend signal needs no frontend release', () => {
    const data = { roas: 3, revenueMinor: 90000, ctr: 0.02, frequency: 1.5 };
    expect(decisiveMetric({ ...data, signalType: 'SOME_UNRELEASED_SIGNAL' }))
      .toEqual(decisiveMetric(data));
  });
});

// ── buildRecommendationText ──────────────────────────────────
// What the marketer pastes must be exactly what the panel showed: the engine's
// own strings, with a missing field DROPPING its line rather than printing an
// "unknown" the reader could mistake for a finding.
describe('buildRecommendationText', () => {
  const full = () => buildRecommendationText({
    verdict: 'KILL',
    name: 'Ramadan Wave',
    rationale: RELATIVE_KILL,
    nextAction: nextActionFor('KILL'),
    confidence: 0.6,
    spendMinor: 500000,
    currency: 'EGP',
  });

  it('leads with the campaign and the verdict', () => {
    expect(full().startsWith('Recommendation\n\nCampaign: Ramadan Wave\nVerdict: KILL')).toBe(true);
  });

  it('carries the action, the evidence, the confidence and the spend', () => {
    const text = full();
    expect(text).toContain('Recommended action:\nPause and reallocate budget');
    // The evidence is the engine's clause, numbers verbatim.
    expect(text).toContain('Evidence:\nLowest CTR in the conversion group (0.85% vs 1.42% group average).');
    expect(text).toContain('Confidence: Medium');
    expect(text).toContain(`Spend analyzed: ${formatCurrency(500000, 'EGP')}`);
  });

  it('omits every line whose field is missing — no "unknown" placeholders', () => {
    const text = buildRecommendationText({ verdict: 'SCALE', name: 'Eid Push' });
    expect(text).toBe('Recommendation\n\nCampaign: Eid Push\nVerdict: SCALE');
    expect(text).not.toMatch(/Evidence:|Confidence:|Spend analyzed:|Recommended action:/);
    expect(text).not.toMatch(/unknown|n\/a|null/i);
  });

  it('drops the evidence line alone when only the rationale is missing', () => {
    const text = buildRecommendationText({ verdict: 'KILL', name: 'X', confidence: 0.9, spendMinor: 100 });
    expect(text).not.toContain('Evidence:');
    expect(text).toContain('Confidence: High');
  });

  it('a SCALE carries its own next action', () => {
    const text = buildRecommendationText({ verdict: 'SCALE', name: 'X', nextAction: nextActionFor('SCALE') });
    expect(text).toContain('Increase budget or expand audience');
  });

  // Same rule as ignoreCostFor: the sync window is unknown client-side.
  it('never turns spend into a rate', () => {
    expect(full()).not.toMatch(/month|\/mo|per day/i);
  });
});

// ── platformUrl ──────────────────────────────────────────────
// A link that opens the wrong thing is worse than no link, so every path that
// cannot be built honestly returns null and the UI renders nothing.
describe('platformUrl', () => {
  it('builds a campaign-specific Meta link from the platform id', () => {
    const url = platformUrl('META', '120210987654321');
    expect(url).toContain('adsmanager.facebook.com');
    expect(url).toContain('selected_campaign_ids=120210987654321');
  });

  it('builds a campaign-specific Google link', () => {
    expect(platformUrl('GOOGLE', '99887766')).toContain('campaignId=99887766');
  });

  it('is case-insensitive about the channel', () => {
    expect(platformUrl('meta', '123')).toBe(platformUrl('META', '123'));
  });

  it('no platform id → null (a row that predates the connector gets no link)', () => {
    expect(platformUrl('META', null)).toBeNull();
    expect(platformUrl('META', undefined)).toBeNull();
    expect(platformUrl('META', '')).toBeNull();
  });

  it('no channel → null', () => {
    expect(platformUrl(null, '123')).toBeNull();
    expect(platformUrl('', '123')).toBeNull();
  });

  // TIKTOK's documented parameter (aadvid) is the ADVERTISER id — feeding it a
  // campaign id builds a link that resolves to nothing. Landing the marketer on
  // an error page is worse than showing no button, so it stays unmapped until
  // the real campaign deep-link format is verified against a live account.
  it('returns null for channels with no verified campaign deep-link', () => {
    for (const channel of ['TIKTOK', 'SNAP', 'LINKEDIN', 'SNAPCHAT']) {
      expect(platformUrl(channel, '12345')).toBeNull();
    }
    expect(LINKABLE_CHANNELS).toEqual(['META', 'GOOGLE']);
  });

  it('escapes the id rather than interpolating it raw', () => {
    expect(platformUrl('META', 'a b&c')).toContain('a%20b%26c');
  });
});

// The unit contract for the ad-level evidence evidenceProvider emits. Each new
// metric renders in the unit its number is actually in — the failure mode is
// silent (a 3.5 frequency printing as "350.0%"), so each one is pinned.
describe('formatEvidenceValue — ad-level evidence units', () => {
  it('SPEND_SHARE is a fraction of the parent, rendered as a percentage', () => {
    expect(formatEvidenceValue('SPEND_SHARE', 0.4)).toBe('40.0%');
  });

  it('FREQUENCY is times-seen-per-person, NOT a percentage', () => {
    expect(formatEvidenceValue('FREQUENCY', 3.5)).toBe('3.5×');
    expect(formatEvidenceValue('FREQUENCY', 3.5)).not.toContain('%');
  });

  it('video quartiles are whole view counts', () => {
    expect(formatEvidenceValue('VIDEO_25', 3000.4)).toBe('3000 views');
    expect(formatEvidenceValue('VIDEO_50', 1200)).toBe('1200 views');
  });

  it('the existing CTR and funnel-rate units are unchanged', () => {
    expect(formatEvidenceValue('CTR', 1.64)).toBe('1.64%');       // already percent
    expect(formatEvidenceValue('LPV_RATE', 0.42)).toBe('42.0%');  // ratio
  });

  it('an unregistered metric still shows its raw number rather than a guessed unit', () => {
    expect(formatEvidenceValue('SOME_FUTURE_METRIC', 7)).toBe('7');
  });

  it('every new metric has a marketer-facing label', () => {
    expect(evidenceLabel('SPEND_SHARE')).toBe('Share of parent spend');
    expect(evidenceLabel('FREQUENCY')).toBe('Frequency');
    expect(evidenceLabel('VIDEO_25')).toBe('Video 25% views');
  });
});

// evidenceProvider's CONTEXT items carry status null on purpose. The row must
// still render — dropping it would hide the spend behind the finding.
describe('evidenceRows — evidenceProvider items', () => {
  it('renders a CONTEXT row with a null status and no benchmark', () => {
    const [row] = evidenceRows({
      evidence: [{ metric: 'SPEND_SHARE', value: 0.4, benchmark: null, status: null, kind: 'context' }],
    });
    expect(row).toMatchObject({ metric: 'SPEND_SHARE', value: '40.0%', benchmark: null, status: null });
  });

  it('renders a graded FREQUENCY row against its ceiling', () => {
    const [row] = evidenceRows({
      evidence: [{ metric: 'FREQUENCY', value: 6, benchmark: 3.5, status: 'weak', severity: 'critical' }],
    });
    expect(row).toMatchObject({ value: '6.0×', benchmark: '3.5×', status: 'weak' });
  });
});
