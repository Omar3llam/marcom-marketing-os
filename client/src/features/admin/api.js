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
