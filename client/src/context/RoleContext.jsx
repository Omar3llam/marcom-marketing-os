// ============================================================
// MARCOM / Lumi — RoleContext (Phase 11A · the role-gating spine)
// ------------------------------------------------------------
// Fetches the caller's Phase-8 collabRole ONCE from GET /api/lumi/roles/me
// and exposes it app-wide. Every role-gated surface (RoleGate, the gated nav,
// the proof/blended pages) reads from here — one fetch, not one-per-screen.
//
// ── WHY THERE IS NO DEFAULT ROLE ANY MORE (Phase 5.11) ─────────────────────
// This used to answer STRATEGIST on any error or miss, "so an unresolved role
// never LOCKS a seat out of its own data". Measured in Phase 5.10, that meant a
// 500, a 403, a dropped connection AND a 200 with no role all rendered the full
// thirteen-item operator navigation — indistinguishable from a genuine
// STRATEGIST. A refusal granted the widest lens in the product. Worse, the same
// axis disagreed with itself: a MALFORMED role fell through to the narrowest
// seat, so "we could not read it" pointed in two opposite directions depending
// on how the read failed.
//
// So the role is now reported with the read that produced it. `role` carries a
// value ONLY when `status === READ.PRESENT`; every other status carries null.
// A null role is not CLIENT and not STRATEGIST — it is the absence of an
// answer, and consumers that must choose between seats are held at a boundary
// (MainLayout, RoleGate, LockFromClient) rather than guessing here.
//
// Backend authorization is unchanged and remains the enforcement layer; this
// governs what the client is willing to CLAIM, not what it is allowed to do.
// ============================================================
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { READ, readStatusForError } from '@/design-system/states/readStatus.js';

export const WORKSPACE_ROLE = Object.freeze({ STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' });

/** The seats this client recognises. Anything else is not a seat we can act on. */
const KNOWN_ROLES = Object.freeze(Object.values(WORKSPACE_ROLE));

/** The read vocabulary, re-exported so role consumers need not know its home. */
export { READ as ROLE_READ };

const INITIAL = Object.freeze({
  role: null, visibleStates: null, loading: true, error: null, status: READ.LOADING,
});

export const RoleContext = createContext(INITIAL);

export function RoleProvider({ children }) {
  const [state, setState] = useState(INITIAL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/roles/me');
        if (cancelled) return;
        const role = res.data?.role ?? null;
        if (KNOWN_ROLES.includes(role)) {
          setState({ role, visibleStates: res.data?.visibleStates ?? null, loading: false, error: null, status: READ.PRESENT });
        } else {
          // A 200 that does not answer the question — absent or unrecognised.
          // Unreadable, never a seat, and never the narrowest one by accident.
          setState({ role: null, visibleStates: null, loading: false, error: null, status: READ.NOT_REACHABLE });
        }
      } catch (err) {
        if (cancelled) return;
        // Fails CLOSED. A 403 is a refusal we can name; anything else is a read
        // we could not complete. Neither is a role.
        setState({ role: null, visibleStates: null, loading: false, error: err, status: readStatusForError(err) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <RoleContext.Provider value={state}>{children}</RoleContext.Provider>;
}

export function useRoleContext() {
  return useContext(RoleContext);
}
