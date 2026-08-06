// ============================================================
// Decision lifecycle signals — fire-and-forget telemetry
// ------------------------------------------------------------
// Records that a human opened the reasoning behind a verdict (explain) or took
// it somewhere they could act on it (intent). Keyed by entityId because the
// verdict surfaces never receive a Decision id — the server resolves the click
// to whichever verdict was live at that moment.
//
// BEST-EFFORT BY CONSTRUCTION. These never block, never surface an error, and
// never gate the thing the user actually clicked. A 404 (no live decision) and
// a 403 (a CLIENT seat, which must not seed the learning loop) are both normal
// outcomes, not failures worth interrupting anyone over. Losing a telemetry
// write is cheap; failing to copy a recommendation because telemetry was down
// is not.
// ============================================================
import { api } from '@/api/client';

const send = (entityId, signal) => {
  if (!entityId) return Promise.resolve(null);
  // try/catch AND .catch, deliberately. A rejected promise is only half the
  // exposure: if the client is unavailable the call throws SYNCHRONOUSLY, before
  // any promise exists, and a bare .catch cannot see it. That threw straight
  // through handleCopy and left the Copy button stuck with no feedback — a
  // telemetry write breaking the action it was only supposed to observe.
  try {
    return api
      .patch(`/api/lumi/decisions/by-entity/${encodeURIComponent(entityId)}/${signal}`)
      .then((r) => r.data)
      .catch(() => null); // swallowed on purpose — see the header
  } catch {
    return Promise.resolve(null);
  }
};

/** A human opened the reasoning. Reading is not acting. */
export const recordExplain = (entityId) => send(entityId, 'explain');

/** A human copied the recommendation or opened the ad platform. */
export const recordIntent = (entityId) => send(entityId, 'intent');

// ============================================================
// Execute / dismiss — NOT telemetry. Deliberately not `send`.
// ============================================================
// The two above observe a click. These two record a CLAIM ABOUT THE WORLD: the
// operator asserting they acted, or chose not to. That claim is the entire
// population the Proof Engine scores, so it is the one write in this file that
// must not fail quietly.
//
// `send` swallows everything by design, which is right for telemetry and exactly
// wrong here: a swallowed failure leaves the operator believing it landed while
// the accuracy surface stays empty — the same silent under-reporting Track B
// spent three PRs climbing out of. So these throw, and callers MUST await and
// render the outcome.
//
// Arity is entityId, matching the two above — TEMPORARY. The server resolves it
// to the live decision (see the adapter note in routes/lumi/decisions.js).
// TODO: switch to `/api/lumi/decisions/${decisionId}/execute` when a Decision id
//       reaches the verdict surfaces.

/** A human says they acted on this call. Rejects on failure — never swallow. */
export const recordExecute = (entityId) =>
  api.patch(`/api/lumi/decisions/by-entity/${encodeURIComponent(entityId)}/execute`);

/** A human says they saw this call and chose not to act. Rejects on failure. */
export const recordDismiss = (entityId) =>
  api.patch(`/api/lumi/decisions/by-entity/${encodeURIComponent(entityId)}/dismiss`);
