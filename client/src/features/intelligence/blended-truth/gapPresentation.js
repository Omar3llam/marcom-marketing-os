// Presentation only: the API ratio uses platform-reported revenue as its denominator.
// Keep direction separate from rounded magnitude; no verdict or monetary calculation.
function formatGapPercentMagnitude(gapPct) {
  const percent = Math.abs(gapPct) * 100;
  if (percent === 0) return '0%';
  if (percent < 0.1) return '<0.1%';
  if (percent < 1) {
    const rounded = Math.round(percent * 10) / 10;
    return rounded === 1 ? '1%' : `${rounded.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

export function gapPresentation(gapPct, gapMinor) {
  if (!Number.isFinite(gapPct) || (gapMinor !== undefined && !Number.isFinite(gapMinor))) {
    return { direction: 'UNAVAILABLE', pctText: '—', magnitudeMinor: null };
  }
  const signedGap = gapMinor === undefined ? gapPct : gapMinor;
  return {
    direction: signedGap > 0 ? 'ABOVE' : signedGap < 0 ? 'BELOW' : 'MATCH',
    pctText: formatGapPercentMagnitude(gapPct),
    magnitudeMinor: gapMinor === undefined ? null : Math.abs(gapMinor),
  };
}

export function channelGapText(gapPct) {
  const gap = gapPresentation(gapPct);
  return gap.direction === 'ABOVE' ? `${gap.pctText} above`
    : gap.direction === 'BELOW' ? `${gap.pctText} below` : gap.pctText;
}
