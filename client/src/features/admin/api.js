// ============================================================
// MARCOM / Lumi — Admin panel API helpers
// ------------------------------------------------------------
// Thin wrappers over the ONE api client (Firebase token attached by its
// interceptor). Every /api/admin/* route is requireAdmin-gated server-side.
// ============================================================
import { api } from '@/api/client';

export const fetchStatus     = ()   => api.get('/api/admin/status').then((r) => r.data);
export const fetchWorkspaces = ()   => api.get('/api/admin/workspaces').then((r) => r.data);
export const fetchUsers      = ()   => api.get('/api/admin/users').then((r) => r.data);
export const seedDemo        = ()   => api.post('/api/admin/demo/seed').then((r) => r.data);
export const deleteDemo      = (id) => api.delete(`/api/admin/demo/${id}`).then((r) => r.data);

// Set a workspace's feature-gating entitlement (FREE | GROWTH | PRO). The manual
// upgrade path — there is no billing.
export const updateWorkspacePlan = (id, plan) =>
  api.patch(`/api/admin/workspaces/${id}/plan`, { plan }).then((r) => r.data);

// Set a user's workspace role. `force` overrides the last-strategist guard and
// travels in the BODY — a destructive override belongs with the payload, not in
// a URL that gets logged, copied and retried.
export const updateUserRole = (id, collabRole, force = false) =>
  api.patch(`/api/admin/users/${id}/role`, { collabRole, force }).then((r) => r.data);
