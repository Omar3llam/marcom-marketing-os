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
  it('is versioned v1.2 (signals the template changed)', () => {
    expect(COPY_PROMPTS.GENERATE_COPY.version).toBe('v1.2');
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
