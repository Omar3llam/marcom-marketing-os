// ============================================================
// MARCOM Design System — Read Status (Phase 5.11)
// ------------------------------------------------------------
// What a READ established, as opposed to what it returned.
//
// Phase 5.9 introduced this shape inside useWorkspace as WORKSPACE_READ,
// because the workspace read was the first place a failure was being rendered
// as an answer. The role read has exactly the same problem and exactly the same
// five outcomes, so the vocabulary is lifted here rather than written twice —
// two sets of state names that meant the same thing would be the duplicate this
// module exists to prevent.
//
// The four resolved values ARE B8-02's locked ABSENCE tokens, by value. Only
// LOADING is added, and only because B8-02 describes what a surface knows about
// a CLAIM and says nothing about a request still in flight; "loading ≠ success"
// is precisely why it cannot borrow a token that already means something else.
//
// Classifying a transport outcome is not frontend-derived product truth: the
// HTTP result IS the API's answer, observed directly. What a consumer may never
// do is turn "we could not ask" into a value — not a plan, and not a role.
// ============================================================
import { ABSENCE } from './absence.js';

export const READ = Object.freeze({
  /** The request has not resolved. No decision may be taken from it. */
  LOADING: 'LOADING',
  /** A valid answer we recognise. The only state that may be trusted. */
  PRESENT: ABSENCE.PRESENT,
  /** The server answered, and there is nothing. A FINDING, not a failure. */
  NOTHING_FOUND: ABSENCE.NOTHING_FOUND,
  /** The read failed, or what came back is unreadable. A retry is honest. */
  NOT_REACHABLE: ABSENCE.NOT_REACHABLE,
  /** We are not entitled to ask. Never the same thing as a narrower answer. */
  NOT_PERMITTED: ABSENCE.NOT_PERMITTED,
});

/**
 * PURE: classify a rejected API call.
 *
 * api.js rejects with a mapped domain error carrying `httpStatus`;
 * `response.status` is read too so a raw axios error classifies identically
 * rather than silently falling through to "unreachable".
 */
export function readStatusForError(err) {
  const httpStatus = err?.httpStatus ?? err?.response?.status;
  return httpStatus === 403 ? READ.NOT_PERMITTED : READ.NOT_REACHABLE;
}

/** A setup absence must be explicitly established by the backend. */
export function isNoWorkspaceError(err) {
  const status = err?.httpStatus ?? err?.response?.status;
  const code = err?.response?.data?.error ?? err?.code;
  return status === 409 && code === 'NoWorkspace';
}
