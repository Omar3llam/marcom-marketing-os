// Presentation only: the API ratio uses platform-reported revenue as its denominator.
// Keep direction separate from rounded magnitude; no verdict or monetary calculation.
export function gapPresentation(gapPct, gapMinor) {
  if (!Number.isFinite(gapPct) || (gapMinor !== undefined && !Number.isFinite(gapMinor))) {
    return { direction: 'UNAVAILABLE', pctText: '—', magnitudeMinor: null };
  }
  const signedGap = gapMinor === undefined ? gapPct : gapMinor;
  return {
    direction: signedGap > 0 ? 'ABOVE' : signedGap < 0 ? 'BELOW' : 'MATCH',
    pctText: `${Math.round(Math.abs(gapPct) * 100)}%`,
    magnitudeMinor: gapMinor === undefined ? null : Math.abs(gapMinor),
  };
}

export function channelGapText(gapPct) {
  const gap = gapPresentation(gapPct);
  return gap.direction === 'ABOVE' ? `${gap.pctText} above`
    : gap.direction === 'BELOW' ? `${gap.pctText} below` : gap.pctText;
}
