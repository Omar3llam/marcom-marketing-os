// ============================================================
// MARCOM / Lumi — Meta mutation parameter validation  (R11 · I67)
// ============================================================
// Everything that reaches the Meta Graph API as part of a URL path or query
// string is validated HERE, in one place, so the route and the worker cannot
// disagree about what is acceptable.
//
// What this exists to stop:
//
//   `targetId` was validated as "a non-empty string" and then interpolated
//   straight into the request path — `/${targetId}?status=PAUSED`. A string may
//   contain `/`, `?` and `&`, so the caller controlled the path AND the query
//   of an authenticated POST issued with the workspace's own Meta token. The
//   blast radius was the OAuth scope, not the Lumi data model.
//
//   `OPTIMIZE_CAMPAIGN` was worse: `new URLSearchParams(options)` passed the
//   caller's entire options object through as Graph API fields. That is not an
//   optimisation endpoint, it is a generic Graph API proxy with someone else's
//   credentials attached.
//
// RULING RU-6 — R11 implements format validation plus an action-specific
// parameter allowlist, NOT mandatory canonical-entity resolution. Requiring
// every targetId to resolve to an ingested MetaEntity would close this more
// completely, but it would also refuse a legitimate action against a campaign
// Lumi has not synced yet. That is a product decision, deliberately left for
// a later stage; this module is where it would be added.
// ============================================================

// Meta object ids are numeric strings. Ad ACCOUNT ids carry the `act_` prefix;
// campaign / adset / ad ids do not. Anchored, so nothing may ride along after
// the digits — which is the whole point.
const META_ID_RE = /^(act_)?\d{1,32}$/;

/** Action → target types it may be applied to. */
export const ALLOWED_ACTIONS = Object.freeze({
  PAUSE_CAMPAIGN:    ['campaign'],
  RESUME_CAMPAIGN:   ['campaign'],
  SCALE_CAMPAIGN:    ['campaign'],
  OPTIMIZE_CAMPAIGN: ['campaign'],
  INCREASE_BUDGET:   ['campaign', 'adset'],
  DECREASE_BUDGET:   ['campaign', 'adset'],
  PAUSE_ADSET:       ['adset'],
  RESUME_ADSET:      ['adset'],
  REALLOCATE_BUDGET: ['campaign', 'adset'],
  REFRESH_CREATIVE:  ['adset', 'ad'],
});

/**
 * R11 (I67) — the finite, explicit set of Graph API fields each action may
 * write. Anything outside it is refused rather than forwarded.
 *
 * Only OPTIMIZE_CAMPAIGN takes free-form parameters; every other action derives
 * its own field from the action type, so its entry is empty by design. The
 * values here are Meta campaign-level optimisation fields — deliberately a
 * short list, because the alternative is arbitrary field writes.
 */
export const ALLOWED_OPTION_KEYS = Object.freeze({
  OPTIMIZE_CAMPAIGN: Object.freeze([
    'bid_strategy',
    'daily_budget',
    'lifetime_budget',
    'spend_cap',
    'status',
    'special_ad_categories',
  ]),
});

/** Values these fields are allowed to take, where the field is an enum. */
const ALLOWED_OPTION_VALUES = Object.freeze({
  status: ['ACTIVE', 'PAUSED'],
  bid_strategy: [
    'LOWEST_COST_WITHOUT_CAP',
    'LOWEST_COST_WITH_BID_CAP',
    'COST_CAP',
    'LOWEST_COST_WITH_MIN_ROAS',
  ],
});

// Fields that must be whole positive numbers of minor currency units.
const NUMERIC_OPTION_KEYS = ['daily_budget', 'lifetime_budget', 'spend_cap'];

/** True when `targetId` is a well-formed Meta object id. */
export function isValidTargetId(targetId) {
  return typeof targetId === 'string' && META_ID_RE.test(targetId);
}

/**
 * Validate a mutation's parameters.
 * @returns {string|null} an error message, or null when acceptable.
 */
export function validateMutationParams({ actionType, targetId, targetType, options }) {
  if (!actionType || !ALLOWED_ACTIONS[actionType]) {
    return `Invalid action type: ${actionType}. Must be one of: ${Object.keys(ALLOWED_ACTIONS).join(', ')}`;
  }

  if (!isValidTargetId(targetId)) {
    // Deliberately does not echo the value back — it is attacker-controlled and
    // ends up in logs and error surfaces.
    return 'targetId must be a Meta object id (digits, optionally prefixed with act_)';
  }

  if (!targetType || typeof targetType !== 'string'
      || !ALLOWED_ACTIONS[actionType].includes(targetType.toLowerCase())) {
    return `Invalid target type "${targetType}" for action "${actionType}". Must be one of: ${ALLOWED_ACTIONS[actionType].join(', ')}`;
  }

  return validateOptions(actionType, options);
}

/**
 * Validate the action-specific options object.
 * @returns {string|null}
 */
export function validateOptions(actionType, options) {
  if (options === undefined || options === null) return null;
  if (typeof options !== 'object' || Array.isArray(options)) {
    return 'options must be an object';
  }

  const keys = Object.keys(options);
  if (keys.length === 0) return null;

  const allowed = ALLOWED_OPTION_KEYS[actionType];
  if (!allowed) {
    // Every other action derives its field from the action type. Accepting
    // options here would reintroduce the pass-through by a different name.
    // `dailyBudget` / `amount` / `creativeId` are read by the endpoint builder
    // directly and are not Graph API fields, so they are permitted through the
    // narrower check below.
    const passthrough = keys.filter((k) => !['dailyBudget', 'amount', 'creativeId', 'creative_id'].includes(k));
    if (passthrough.length > 0) {
      return `Action ${actionType} does not accept option(s): ${passthrough.join(', ')}`;
    }
    return null;
  }

  const rejected = keys.filter((k) => !allowed.includes(k));
  if (rejected.length > 0) {
    return `Option(s) not permitted for ${actionType}: ${rejected.join(', ')}. Allowed: ${allowed.join(', ')}`;
  }

  for (const key of keys) {
    const value = options[key];

    if (NUMERIC_OPTION_KEYS.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return `Option "${key}" must be a positive whole number`;
      }
      continue;
    }

    const permitted = ALLOWED_OPTION_VALUES[key];
    if (permitted && !permitted.includes(value)) {
      return `Option "${key}" must be one of: ${permitted.join(', ')}`;
    }

    if (!permitted && typeof value !== 'string' && typeof value !== 'number') {
      return `Option "${key}" must be a string or number`;
    }
  }

  return null;
}
