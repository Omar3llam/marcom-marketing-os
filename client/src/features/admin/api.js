// ============================================================
// MARCOM / Lumi — Admin panel API helpers
// ------------------------------------------------------------
// Thin wrappers over the ONE api client (Firebase token attached by its
// interceptor). Every /api/admin/* route is requireAdmin-gated server-side.
// ============================================================
import { api } from '@/api/client';

export const fetchStatus     = ()   => api.get('/api/admin/status').then((r) => r.data);

// Drop empty filters rather than sending `?q=&plan=` — the server treats an
// empty string as "no filter" anyway, and a clean URL is what shows up in logs.
function listParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );
}

// Both lists are searched and paged SERVER-side: filtering the loaded page in
// the browser would report "no matches" for a row that simply sat past the cap.
export const fetchWorkspaces = (params = {}) =>
  api.get('/api/admin/workspaces', { params: listParams(params) }).then((r) => r.data);

// The operator drill-down: members, counts, connector health and recent sweeps
// for ONE workspace. Deliberately separate from the list — the connector half
// is a raw-SQL round trip, so folding it into the list would be an N+1.
export const fetchWorkspaceDetail = (id) =>
  api.get(`/api/admin/workspaces/${id}`).then((r) => r.data);
export const fetchUsers = (params = {}) =>
  api.get('/api/admin/users', { params: listParams(params) }).then((r) => r.data);
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

// The admin action log. Cursor-paginated on createdAt (`before`), not an
// offset — rows only ever arrive at the head, so an offset would re-serve or
// skip entries as the log grows underneath the reader.
export const fetchAuditLog = (before = null) =>
  api.get('/api/admin/audit', { params: before ? { before } : undefined }).then((r) => r.data);
