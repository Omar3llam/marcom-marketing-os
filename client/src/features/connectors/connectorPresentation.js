// Local connector copy only. P7-07 EXTRACTION CANDIDATE: validated age formatting.
// No thresholds or classification: the server owns every axis and its clock.
export function successfulSyncAge(iso, now = Date.now()) {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || timestamp > now) return null;
  const mins = Math.round((now - timestamp) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function connectorFactLabels(connection, { details = false } = {}) {
  const labels = [];
  switch (connection.readiness) {
    case 'CURRENT':
    case 'STALE': {
      const age = successfulSyncAge(connection.lastSuccessfulSync);
      const state = connection.readiness === 'CURRENT' ? 'Current' : 'Stale';
      labels.push(age ? `${state} · Last successful sync ${age}` : state);
      break;
    }
    case 'NEVER_SYNCED': labels.push('Never synced'); break;
    default: labels.push('Freshness unavailable');
  }

  if (connection.availability === 'FAILING') {
    const error = details ? connection.health?.lastError : null;
    labels.push(`Latest sync attempt failed${error ? ` · ${error}` : ''}`);
  } else if (connection.availability !== 'OK') {
    labels.push('Latest attempt status unavailable');
  }

  if (connection.completeness === 'INCOMPLETE') {
    const warning = details ? connection.health?.lastWarning : null;
    labels.push(`Last successful sync was incomplete${warning ? ` · ${warning}` : ''}`);
  } else if (connection.completeness !== 'COMPLETE') {
    labels.push('Completeness not recorded');
  }

  // An unfamiliar/unavailable knowledge value cannot silently reinforce success.
  // Missing additive siblings do not invent knowledge; published axes still render.
  for (const [field, copy] of [
    ['readinessKnowledge', 'Freshness knowledge unavailable'],
    ['availabilityKnowledge', 'Latest attempt knowledge unavailable'],
    ['completenessKnowledge', 'Completeness knowledge unavailable'],
  ]) {
    const knowledge = connection[field];
    if (knowledge != null && knowledge !== 'KNOWN' && knowledge !== 'NOTHING_THERE') {
      // The NOT_RECORDED axis already supplies the same unavailable expression.
      const axisUnavailable = field === 'readinessKnowledge' ? labels.includes('Freshness unavailable')
        : field === 'availabilityKnowledge' ? labels.includes('Latest attempt status unavailable')
          : labels.includes('Completeness not recorded');
      if (!axisUnavailable) labels.push(copy);
    }
  }
  return labels;
}
