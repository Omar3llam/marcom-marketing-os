// Authority for RELATIVE_BASELINE entity comparisons only. This never chooses
// a metric, infers a delivery period, recomputes a value or scores a verdict.
import { CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';
import { isAuthoritativeCurrency } from '../../lib/currencyProvenance.js';
import { sameWindow } from './metricWindow.js';

const UNITS = Object.freeze({ ctr: 'RATIO', roas: 'MULTIPLE', frequency: 'FREQUENCY' });
const SOURCES = Object.values(DATA_SOURCE);
const WINDOWS = Object.values(MEASUREMENT_WINDOW).filter((value) => value !== MEASUREMENT_WINDOW.LEGACY_UNKNOWN);

function instant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  // Accept persisted ISO bounds, not numbers, sync clocks or forgiving date
  // parsing (e.g. February 30 normalizing into March).
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function period(row) {
  if (!WINDOWS.includes(row?.measurementWindow)) return null;
  const start = instant(row.windowStart), end = instant(row.windowEnd);
  return start && end && start <= end ? { start, end } : null;
}

function primaryPlatformRoas(row) {
  // An overlay has TWO contributing evidence rows even if its currency happens
  // to match and both origins report it. Currency provenance alone is insufficient.
  const refs = row?.evidenceRows;
  return Object.values(CHANNEL).includes(row?.source) && isAuthoritativeCurrency(row)
    && Array.isArray(refs) && refs.length === 1
    && row.entityId != null && refs[0]?.entityId === row.entityId && refs[0]?.source === row.source;
}

/** The single pair predicate, shared by population selection and direct callers. */
export function isEntityComparisonEligible(parent, child, metric) {
  if (!Object.hasOwn(UNITS, metric) || !Number.isFinite(parent?.[metric]) || !Number.isFinite(child?.[metric])) return false;
  if (!SOURCES.includes(parent?.source) || child?.source !== parent.source) return false;
  const parentPeriod = period(parent), childPeriod = period(child);
  if (!parentPeriod || !childPeriod || child.measurementWindow !== parent.measurementWindow
    || !sameWindow(parentPeriod, childPeriod)) return false;
  return metric !== 'roas' || (primaryPlatformRoas(parent) && primaryPlatformRoas(child) && parent.currency === child.currency);
}

/** Input is the otherwise-rankable cohort. Counts describe that population. */
export function entityComparisonPopulation(parent, rankable, metric) {
  const comparable = rankable.filter((child) => isEntityComparisonEligible(parent, child, metric));
  if (comparable.length < 2) return { comparable, comparisonEnvelope: null };
  const { start, end } = period(parent);
  return { comparable, comparisonEnvelope: {
    status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric, valueUnit: UNITS[metric],
    gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE',
    source: parent.source, measurementWindow: parent.measurementWindow,
    windowStart: start.toISOString(), windowEnd: end.toISOString(),
    currency: metric === 'roas' ? parent.currency : null,
    currencyProvenance: metric === 'roas' ? parent.currencyProvenance : null,
    rankableCount: rankable.length, comparableCount: comparable.length,
    excludedByEnvelopeCount: rankable.length - comparable.length,
  } };
}
