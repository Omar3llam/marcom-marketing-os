// ============================================================
// MARCOM / Lumi — RoleContext (Phase 11A · the role-gating spine)
// ------------------------------------------------------------
// Fetches the caller's Phase-8 collabRole ONCE from GET /api/lumi/roles/me
// and exposes it app-wide. Every role-gated surface (RoleGate, the gated nav,
// the proof/blended pages) reads from here — one fetch, not one-per-screen.
//
// Default STRATEGIST on error/loading-miss: mirrors the backend's null→STRATEGIST
// rule so an unresolved role never LOCKS a seat out of its own data (it errs open
// to the fullest lens, never hides data the user is entitled to). The narrowing
// (CLIENT = narrative only) only ever applies when the role resolves explicitly.
// ============================================================
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';

export const WORKSPACE_ROLE = Object.freeze({ STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' });
const DEFAULT_ROLE = WORKSPACE_ROLE.STRATEGIST;

export const RoleContext = createContext({
  role: DEFAULT_ROLE, visibleStates: null, loading: true, error: null,
});

export function RoleProvider({ children }) {
  const [state, setState] = useState({ role: DEFAULT_ROLE, visibleStates: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/roles/me');
        if (cancelled) return;
        const role = res.data?.role ?? DEFAULT_ROLE;
        setState({ role, visibleStates: res.data?.visibleStates ?? null, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // Err OPEN to the fullest lens — never hide data on a transient role miss.
        setState({ role: DEFAULT_ROLE, visibleStates: null, loading: false, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <RoleContext.Provider value={state}>{children}</RoleContext.Provider>;
}

export function useRoleContext() {
  return useContext(RoleContext);
}
