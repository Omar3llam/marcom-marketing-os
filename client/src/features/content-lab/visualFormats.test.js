// ============================================================
// visualFormats — one pick yields a real format label + its real dimensions
// ============================================================
import { describe, it, expect } from 'vitest';
import { VISUAL_FORMATS, DEFAULT_FORMAT_ID, formatById, formatToPromptFields } from './visualFormats.js';

describe('visualFormats', () => {
  it('every format carries a real ratio + pixel dimensions', () => {
    for (const f of VISUAL_FORMATS) {
      expect(f.ratio).toMatch(/\d/);
      expect(f.dimensions).toMatch(/\d+×\d+/);
    }
  });

  it('formatById resolves a known id and falls back to the first format on a bad id', () => {
    expect(formatById('story-reel').dimensions).toBe('1080×1920');
    expect(formatById('nope')).toBe(VISUAL_FORMATS[0]);
  });

  it('formatToPromptFields pairs a label+ratio string with the matching dimensions', () => {
    expect(formatToPromptFields(DEFAULT_FORMAT_ID)).toEqual({
      format: 'Meta Feed · Square (1:1)',
      dimensions: '1080×1080',
    });
    expect(formatToPromptFields('link-landscape')).toEqual({
      format: 'Link · Landscape (1.91:1)',
      dimensions: '1200×628',
    });
  });
});
