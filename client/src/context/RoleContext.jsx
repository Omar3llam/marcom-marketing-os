// ============================================================
// MARCOM / Lumi — RoleContext (Phase 11A · the role-gating spine)
// ------------------------------------------------------------
// Fetches the caller's Phase-8 collabRole from GET /api/lumi/roles/me
// and exposes it app-wide with explicit transient-read recovery. Every role-gated surface (RoleGate, the gated nav,
// the proof/blended pages) reads from here — one fetch, not one-per-screen.
//
// ── WHY THERE IS NO DEFAULT ROLE (Phase 5.11) ──────────────────────────────
// This used to answer STRATEGIST on any error or miss. Measured in Phase 5.10:
// a 500, a 403, a dropped connection AND a 200 with no role all rendered the
// full operator navigation, indistinguishable from a genuine STRATEGIST — while
// a MALFORMED role fell the other way, to the narrowest seat. So `role` now
// carries a value ONLY when `status === READ.PRESENT`; a null role is not
// CLIENT and not STRATEGIST but the absence of an answer, and consumers that
// must choose a seat are held at a boundary (MainLayout, RoleGate,
// LockFromClient) rather than guessing here.
//
// ── PHASE 5.14 (R-14.a) — THE SERVER NOW SAYS WHEN IT DOES NOT KNOW ────────
// That was only half the boundary. The endpoint answered
// `resolveCollabRoleForDisplay`, which maps every failure onto DEFAULT_ROLE, so
// a database blip or an unassigned seat arrived as a 200 carrying "STRATEGIST"
// — a role this file RECOGNISES, and therefore recorded as PRESENT. The client
// cannot fail closed on a failure it is never told about.
//
// It now publishes `roleStatus` (RESOLVED | UNRESOLVED) and `roleReason`:
//
//     ROLE_UNSET          → NOTHING_FOUND   we looked; this seat has no role.
//                                           A Strategist must assign one.
//     ROLE_LOOKUP_FAILED  → NOT_REACHABLE   the read failed. A retry is honest.
//
// Both tokens already exist in B8-02; no vocabulary was added. KNOWN_ROLES stays
// as the belt, so an un-updated server still lands on NOT_REACHABLE.
//
// Backend authorization is unchanged and remains the enforcement layer; this
// governs what the client is willing to CLAIM, not what it is allowed to do.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { READ, readStatusForError, isRetryableReadError } from '@/design-system/states/readStatus.js';

export const WORKSPACE_ROLE = Object.freeze({ STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' });

/** The seats this client recognises. Anything else is not a seat we can act on. */
const KNOWN_ROLES = Object.freeze(Object.values(WORKSPACE_ROLE));

/** The read vocabulary, re-exported so role consumers need not know its home. */
export { READ as ROLE_READ };

const INITIAL = Object.freeze({
  role: null, visibleStates: null, loading: true, error: null, status: READ.LOADING, canRetry: false,
});

export const RoleContext = createContext(INITIAL);

export function RoleProvider({ children }) {
  const [state, setState] = useState(INITIAL);

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => { setState(INITIAL); setReloadKey((k) => k + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/roles/me');
        if (cancelled) return;
        const role = res.data?.role ?? null;
        // BOTH conditions. `roleStatus` is the stated fact; KNOWN_ROLES is the
        // belt — a seat we do not recognise is not a seat, whatever the server
        // called the read. An older server sends no roleStatus at all, and a
        // valid role still resolves, so the fix degrades safely either way.
        if (res.data?.roleStatus !== 'UNRESOLVED' && KNOWN_ROLES.includes(role)) {
          setState({ role, visibleStates: res.data?.visibleStates ?? null, loading: false, error: null, status: READ.PRESENT, canRetry: false });
        } else {
          // The server established that this seat carries no role. That is an
          // ANSWER, not a failure, and it has its own next step — so it may not
          // borrow the sentence that says a retry might help.
          const unset = res.data?.roleReason === 'ROLE_UNSET';
          setState({
            role: null,
            visibleStates: null,
            loading: false,
            error: null,
            status: unset ? READ.NOTHING_FOUND : READ.NOT_REACHABLE,
            canRetry: res.data?.roleReason === 'ROLE_LOOKUP_FAILED',
          });
        }
      } catch (err) {
        if (cancelled) return;
        // Fails CLOSED. A 403 is a refusal we can name; anything else is a read
        // we could not complete. Neither is a role.
        setState({ role: null, visibleStates: null, loading: false, error: err, status: readStatusForError(err), canRetry: isRetryableReadError(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return <RoleContext.Provider value={{ ...state, refetch }}>{children}</RoleContext.Provider>;
}

export function useRoleContext() {
  return useContext(RoleContext);
}
