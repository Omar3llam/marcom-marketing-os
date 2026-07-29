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
