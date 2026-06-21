// ============================================================
// MARCOM / Lumi — Content Lab · visual ad formats
// ------------------------------------------------------------
// One picked format drives BOTH the visual brief's {format} and {dimensions}
// placeholders — dimensions are implied by the format, not a second input. The
// values are real Meta ad placement specs (1:1 feed, 4:5 portrait, 9:16
// story/reel, 1.91:1 link), so what reaches the image-prompt is a real target
// size, never a fabricated guess.
// ============================================================
export const VISUAL_FORMATS = [
  { id: 'feed-square',   label: 'Meta Feed · Square',   ratio: '1:1',     dimensions: '1080×1080' },
  { id: 'feed-portrait', label: 'Meta Feed · Portrait', ratio: '4:5',     dimensions: '1080×1350' },
  { id: 'story-reel',    label: 'Story / Reel',         ratio: '9:16',    dimensions: '1080×1920' },
  { id: 'link-landscape', label: 'Link · Landscape',    ratio: '1.91:1',  dimensions: '1200×628' },
];

export const DEFAULT_FORMAT_ID = 'feed-square';

export function formatById(id) {
  return VISUAL_FORMATS.find((f) => f.id === id) || VISUAL_FORMATS[0];
}

// The two strings the prompt wants: a human format label (with ratio) and the
// pixel dimensions. Kept together so they can never drift apart.
export function formatToPromptFields(id) {
  const f = formatById(id);
  return { format: `${f.label} (${f.ratio})`, dimensions: f.dimensions };
}
