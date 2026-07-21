// ============================================================
// GENERATE_COPY v1.1 grounding — every real input reaches the prompt
// ------------------------------------------------------------
// Closes the loop the Content Lab audit opened: the values Content Lab sends
// (industry, objective, brand voice, tone, audience, CTR) must literally render
// into the GENERATE_COPY prompt, and the per-variant {angle} must make the
// STORY/PROOF/URGENCY prompts genuinely diverge (the bonus defect).
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCopyPrompt, COPY_PROMPTS } from './copyPrompts.js';

const GROUNDED = {
  diagnosis: 'CTR decay from creative fatigue',
  industry: 'E-commerce / Retail',
  objective: 'Maximize ROAS, minimize bleed',
  brandVoice: 'Warm & familial — Personal, story-led, MENA-rooted · Bilingual, Egyptian dialect',
  tone: 'Bold & rebellious',
  targetAudience: '25 – 34, 35 – 44 · Female-leaning · interested in Fashion',
  currentCTR: 1.85,
};

describe('GENERATE_COPY v1.1 — grounded fields render into the prompt', () => {
  it('is versioned v1.4 (signals the template changed)', () => {
    expect(COPY_PROMPTS.GENERATE_COPY.version).toBe('v1.4');
  });

  it('renders every real Content-Lab input verbatim (no field silently dropped)', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'Focus on social proof' });
    expect(prompt).toContain('E-commerce / Retail');
    expect(prompt).toContain('Maximize ROAS, minimize bleed');
    expect(prompt).toContain('Warm & familial — Personal, story-led, MENA-rooted');
    expect(prompt).toContain('Bold & rebellious');
    expect(prompt).toContain('25 – 34, 35 – 44 · Female-leaning · interested in Fashion');
    expect(prompt).toContain('1.85%');
    expect(prompt).toContain('CTR decay from creative fatigue');
    expect(prompt).toContain('Focus on social proof');
    // No unresolved placeholders for the fields we supplied.
    expect(prompt).not.toContain('{industry}');
    expect(prompt).not.toContain('{objective}');
    expect(prompt).not.toContain('{tone}');
    expect(prompt).not.toContain('{angle}');
  });

  it('the three copy angles produce genuinely different prompts', () => {
    const story   = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'Focus on storytelling and narrative arc' });
    const proof   = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'Focus on social proof and credibility' });
    const urgency = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'Focus on time-sensitivity and scarcity' });
    expect(story).not.toBe(proof);
    expect(proof).not.toBe(urgency);
    expect(story).not.toBe(urgency);
    expect(story).toContain('storytelling and narrative arc');
    expect(urgency).toContain('time-sensitivity and scarcity');
  });

  it('an omitted field resolves to N/A (backward-compatible — no crash)', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { diagnosis: 'X' });
    expect(prompt).toContain('Industry: N/A');
    expect(prompt).toContain('Campaign Objective: N/A');
  });

  it('renders the {campaignIntel} block when provided', () => {
    const intel = 'CURRENT CAMPAIGN PERFORMANCE (top campaigns by spend):\n- Eid Sale (META): KILL';
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', campaignIntel: intel });
    expect(prompt).toContain('CURRENT CAMPAIGN PERFORMANCE');
    expect(prompt).toContain('- Eid Sale (META): KILL');
  });

  it('omits {campaignIntel} entirely (blank, never "N/A") when absent — for content-lab AND other callers', () => {
    const withEmpty = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', campaignIntel: '' });
    const omitted   = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x' }); // key not passed at all
    for (const prompt of [withEmpty, omitted]) {
      expect(prompt).not.toContain('{campaignIntel}');
      expect(prompt).not.toContain('CURRENT CAMPAIGN PERFORMANCE');
      expect(prompt).not.toMatch(/\n\s*N\/A\s*\n\s*ANGLE FOR THIS VARIANT/); // no stray N/A section
    }
  });

  it('a "$" inside the block is not mangled as a regex replacement token', () => {
    const intel = 'CURRENT CAMPAIGN PERFORMANCE:\n- App (META): SCALE — CPI under $2.50 (ROAS 3.20)';
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', campaignIntel: intel });
    expect(prompt).toContain('CPI under $2.50 (ROAS 3.20)');
  });
});

describe('GENERATE_COPY v1.3 — optional product brief (render, or omit — never "N/A")', () => {
  it('renders product / offer / key facts when the operator supplies them', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', {
      ...GROUNDED, angle: 'x',
      productName: 'Golf villa in New Cairo', offer: '5% down · 8-year installments', benefits: 'Ready to move',
    });
    expect(prompt).toContain('Product/Service: Golf villa in New Cairo');
    expect(prompt).toContain('Offer: 5% down · 8-year installments');
    expect(prompt).toContain('Key facts: Ready to move');
  });

  it('omits each product line entirely when absent — never "Product/Service: N/A"', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x' });
    expect(prompt).not.toContain('Product/Service:');
    expect(prompt).not.toContain('Offer:');
    expect(prompt).not.toContain('Key facts:');
    // The generic N/A convention still holds for the onboarding fields (regression guard).
    const bare = buildCopyPrompt('GENERATE_COPY', { diagnosis: 'X' });
    expect(bare).toContain('Industry: N/A');
    expect(bare).not.toContain('Product/Service: N/A');
  });

  it('a "$" in an offer value is not mangled as a regex replacement token', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', offer: '$500 off — today only' });
    expect(prompt).toContain('Offer: $500 off — today only');
  });
});

describe('GENERATE_COPY v1.4 — creative-strategy directive is variant-gated', () => {
  it('the FIRST variant is asked to populate the strategy object', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', isFirstVariant: true });
    expect(prompt).toContain('This is the FIRST variant.');
    expect(prompt).toContain('Populate the "strategy" object');
    // The output schema always advertises the object (and uses core_message, not message).
    expect(prompt).toContain('"core_message"');
    expect(prompt).not.toContain('"message":');
    // The directive placeholder must be fully resolved (never leaked, never N/A'd).
    expect(prompt).not.toContain('{strategyDirective}');
    expect(prompt).not.toContain('CREATIVE STRATEGY:\nN/A');
  });

  it('a follow-up variant is told to return strategy: null', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', isFirstVariant: false });
    expect(prompt).toContain('This is a follow-up variant.');
    expect(prompt).toContain('Return "strategy": null');
    expect(prompt).not.toContain('{strategyDirective}');
  });

  it('defaults to the follow-up directive when isFirstVariant is omitted (no leak, no crash)', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x' });
    expect(prompt).toContain('Return "strategy": null');
    expect(prompt).not.toContain('{strategyDirective}');
  });

  it('the strategy JSON schema braces are not mangled by the placeholder cleanup', () => {
    const prompt = buildCopyPrompt('GENERATE_COPY', { ...GROUNDED, angle: 'x', isFirstVariant: true });
    expect(prompt).toContain('"strategy": { "objective": "...", "core_message": "...", "hook": "...", "visual": "...", "cta_direction": "..." }');
  });
});

describe('GENERATE_HOOKS v1.2 — objective + tone now reach the headlines prompt', () => {
  it('is versioned v1.2', () => {
    expect(COPY_PROMPTS.GENERATE_HOOKS.version).toBe('v1.2');
  });

  it('renders objective + tone (brand context, not just campaign data)', () => {
    const prompt = buildCopyPrompt('GENERATE_HOOKS', GROUNDED);
    expect(prompt).toContain('Campaign Objective: Maximize ROAS, minimize bleed');
    expect(prompt).toContain('Tone for this piece: Bold & rebellious');
    expect(prompt).not.toContain('{objective}');
    expect(prompt).not.toContain('{tone}');
  });

  it('omitted objective/tone resolve to N/A (same convention as GENERATE_COPY)', () => {
    const prompt = buildCopyPrompt('GENERATE_HOOKS', { diagnosis: 'X' });
    expect(prompt).toContain('Campaign Objective: N/A');
    expect(prompt).toContain('Tone for this piece: N/A');
  });
});
