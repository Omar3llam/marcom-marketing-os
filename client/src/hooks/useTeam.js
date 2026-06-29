// ============================================================
// MARCOM / Lumi — useTeam
// ------------------------------------------------------------
// Backs the Settings → Team & Roles tab. Reads the workspace roster + pending
// invitations and exposes the STRATEGIST-only mutations. Mutations let errors
// propagate so the view can surface the server's honest message (e.g. the
// "last STRATEGIST" guard); every successful mutation reloads the roster.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';

export function useTeam() {
  const { currentUser } = useAuth();
  const [members, setMembers] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isInviting, setIsInviting] = useState(false);

  const load = useCallback(async ({ isCancelled = () => false } = {}) => {
    if (!currentUser) { if (!isCancelled()) setIsLoading(false); return; }
    try {
      if (isCancelled()) return;
      setIsLoading(true);
      setError(null);
      const res = await api.get('/api/team/members');
      if (isCancelled()) return;
      setMembers(res.data?.members ?? []);
      setPendingInvitations(res.data?.pendingInvitations ?? []);
    } catch (err) {
      if (isCancelled()) return;
      setError(err.response?.data?.message || 'Failed to load your team.');
    } finally {
      if (!isCancelled()) setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    let cancelled = false;
    load({ isCancelled: () => cancelled });
    return () => { cancelled = true; };
  }, [load]);

  const invite = useCallback(async (email, collabRole) => {
    setIsInviting(true);
    try {
      const res = await api.post('/api/team/invite', { email, collabRole });
      await load();
      return res.data;
    } finally {
      setIsInviting(false);
    }
  }, [load]);

  const changeRole = useCallback(async (userId, collabRole) => {
    await api.put(`/api/team/${userId}/role`, { collabRole });
    await load();
  }, [load]);

  const removeMember = useCallback(async (userId) => {
    await api.delete(`/api/team/${userId}`);
    await load();
  }, [load]);

  const cancelInvitation = useCallback(async (id) => {
    await api.delete(`/api/team/invitations/${id}`);
    await load();
  }, [load]);

  return {
    members,
    pendingInvitations,
    isLoading,
    error,
    isInviting,
    invite,
    changeRole,
    removeMember,
    cancelInvitation,
    reload: load,
  };
}
