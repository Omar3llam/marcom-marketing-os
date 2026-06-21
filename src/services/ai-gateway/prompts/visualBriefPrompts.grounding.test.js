// ============================================================
// GENERATE_VISUAL_PROMPT grounding — the four placeholders + leak guard
// ------------------------------------------------------------
// The visual-brief template had {visualBrief}{brandStyle}{format}{dimensions}
// that content-generate never supplied, so they leaked as raw {tokens} into the
// model prompt (buildVisualBriefPrompt lacked the sweep buildCopyPrompt got).
// Asserts: supplied fields render; unsupplied fields become N/A, never a raw
// {token}; the JSON OUTPUT braces survive the sweep.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildVisualBriefPrompt } from './visualBriefPrompts.js';

const GROUNDED = {
  visualBrief: 'Creative challenge: CTR decay. Audience: 25–34, Fashion',
  brandStyle: 'Premium & refined — Editorial, considered, restrained',
  format: 'Meta Feed · Square (1:1)',
  dimensions: '1080×1080',
};

describe('buildVisualBriefPrompt — GENERATE_VISUAL_PROMPT', () => {
  it('renders all four supplied fields verbatim', () => {
    const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_PROMPT', GROUNDED);
    expect(prompt).toContain('Creative challenge: CTR decay');
    expect(prompt).toContain('Premium & refined — Editorial, considered, restrained');
    expect(prompt).toContain('Meta Feed · Square (1:1)');
    expect(prompt).toContain('1080×1080');
    expect(prompt).not.toContain('{visualBrief}');
    expect(prompt).not.toContain('{brandStyle}');
    expect(prompt).not.toContain('{format}');
    expect(prompt).not.toContain('{dimensions}');
  });

  it('sweeps unsupplied placeholders to N/A — never leaks a raw {token}', () => {
    const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_PROMPT', { visualBrief: 'just this' });
    expect(prompt).toContain('just this');
    expect(prompt).not.toMatch(/\{brandStyle\}|\{format\}|\{dimensions\}/);
    expect(prompt).toContain('N/A');
  });

  it('leaves the JSON OUTPUT FORMAT braces intact (sweep targets only bare {ident})', () => {
    const prompt = buildVisualBriefPrompt('GENERATE_VISUAL_PROMPT', GROUNDED);
    expect(prompt).toContain('"prompt": "detailed prompt text"');
    expect(prompt).toContain('"aspectRatio": "16:9"');
  });
});
