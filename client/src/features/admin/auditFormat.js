// ============================================================
// Admin audit — turning a before/after pair into a readable line
// ------------------------------------------------------------
// Pure, so the rendering rules are testable without a DOM. The governing rule
// is the product-wide one: never invent a value. When the server sent no
// before/after (or a shape this doesn't recognise) the row says so with an
// em dash instead of guessing at what changed.
// ============================================================

export const ACTION_LABELS = Object.freeze({
  CHANGE_ROLE: 'Changed role',
  CHANGE_PLAN: 'Changed plan',
  SEED_DEMO: 'Seeded demo workspace',
  DELETE_DEMO: 'Deleted demo workspace',
});

/** An unknown type is shown raw rather than hidden — the log stays complete. */
export function actionLabel(type) {
  return ACTION_LABELS[type] ?? type ?? '—';
}

const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// A null collabRole is not "no role" — roleScope reads it as STRATEGIST, so
// saying "None" here would contradict what the product actually does.
function roleText(value) {
  if (value === null || value === undefined) return 'Strategist (unset)';
  return typeof value === 'string' ? titleCase(value) : String(value);
}

/**
 * A one-line description of what an audit row changed.
 * @returns {{ text: string, forced: boolean }}
 */
export function describeChange(log = {}) {
  const before = log.before ?? null;
  const after = log.after ?? null;
  const forced = Boolean(after?.forced);

  switch (log.type) {
    case 'CHANGE_ROLE': {
      if (!before && !after) break;
      return { text: `${roleText(before?.collabRole)} → ${roleText(after?.collabRole)}`, forced };
    }
    case 'CHANGE_PLAN': {
      if (!before?.plan && !after?.plan) break;
      return { text: `${before?.plan ?? '—'} → ${after?.plan ?? '—'}`, forced };
    }
    case 'SEED_DEMO':
      if (!after?.name) break;
      return { text: after.name, forced };
    case 'DELETE_DEMO':
      if (!before?.name) break;
      return { text: before.name, forced };
    default:
      break;
  }

  return { text: '—', forced };
}

/** Ids are uuids; the head is enough to recognise one, the full value is the title. */
export function shortId(id) {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Never render "Invalid Date" — an unparseable timestamp is honestly unknown. */
export function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
