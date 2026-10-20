// Candidate only: no caller, acquisition, mutation, account choice or admission.
// Accept passive compact JSON text, never live objects/getters/proxies/callbacks.
const base = Object.freeze({ contract: 'CREDENTIAL_RECONCILIATION_CANDIDATE_V1', scope: 'SYNTHETIC_ONLY',
  runtimeAdmission: 'NOT_WIRED', dataWrites: 'NO_DATA_WRITES', authority: 'NO_ACCOUNT_SELECTION_AUTHORITY' });
const malformed = () => ({ ...base, status: 'UNKNOWN', inspected: null, findings: [{ reason: 'MALFORMED_INPUT', count: 1 }] });
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = value => value === null || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$/.test(value));
const time = value => value === null || (Number.isSafeInteger(value) && value >= 0);
const list = (value, check) => Array.isArray(value) && value.length <= 10000 && value.every(check);
const credentialKeys = ['id', 'userId', 'workspaceId', 'platform', 'isActive', 'createdAt', 'updatedAt'];
const userKeys = ['id', 'clerkId', 'workspaceId'];
function valid(input) {
  return exact(input, ['scope', 'completeness', 'credentials', 'users', 'workspaces']) && input.scope === base.scope
    && exact(input.completeness, ['credentials', 'users', 'workspaces'])
    && Object.values(input.completeness).every(v => ['COMPLETE', 'INCOMPLETE', 'UNKNOWN'].includes(v))
    && list(input.credentials, c => exact(c, credentialKeys) && ['id', 'userId', 'workspaceId', 'platform'].every(k => identity(c[k]))
      && (c.isActive === null || typeof c.isActive === 'boolean') && time(c.createdAt) && time(c.updatedAt))
    && list(input.users, u => exact(u, userKeys) && userKeys.every(k => identity(u[k])))
    && list(input.workspaces, w => exact(w, ['id']) && identity(w.id));
}
function index(rows, key) {
  const out = new Map();
  for (const row of rows) if (row[key] !== null) {
    if (!out.has(row[key])) out.set(row[key], []);
    out.get(row[key]).push(row);
  }
  return out;
}
function group(groups, key, row) {
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(row);
}

/**
 * Pure synthetic DTO, not a database census or a policy/proof issuer.
 * compactJson must equal JSON.stringify(JSON.parse(compactJson)): rejects
 * duplicate keys (no last-key winner), noncanonical numbers and whitespace.
 * Timestamp fields are fixture epoch-millisecond integers or explicit null.
 * They are required metadata, never ranked, compared or refreshed here.
 * COMPLETE is an untrusted fixture declaration; it has no production authority.
 * Only aggregate counts and fixed reason codes leave this function.
 */
export function evaluateCredentialReconciliation(compactJson) {
  try {
    if (typeof compactJson !== 'string' || compactJson.length > 1048576) return malformed();
    const input = JSON.parse(compactJson);
    if (JSON.stringify(input) !== compactJson || !valid(input)) return malformed();
    const findings = new Map();
    let unknown = false;
    const note = (reason, uncertain = false, count = 1) => {
      findings.set(reason, (findings.get(reason) || 0) + count);
      if (uncertain) unknown = true;
    };
    if (Object.values(input.completeness).some(v => v !== 'COMPLETE')) note('EVIDENCE_INCOMPLETE', true);
    const credentialIds = index(input.credentials, 'id'), userIds = index(input.users, 'id');
    const authIds = index(input.users, 'clerkId'), workspaceIds = index(input.workspaces, 'id');
    for (const [rows, reason] of [[credentialIds, 'DUPLICATE_CREDENTIAL_IDENTITY'], [userIds, 'DUPLICATE_USER_IDENTITY'],
      [authIds, 'AMBIGUOUS_USER_JOIN'], [workspaceIds, 'DUPLICATE_WORKSPACE_IDENTITY']]) {
      for (const matches of rows.values()) if (matches.length > 1) note(reason, true);
    }
    for (const u of input.users) {
      if (u.id === null) note('USER_RECORD_IDENTITY_MISSING', true);
      if (u.clerkId === null) note('USER_JOIN_IDENTITY_MISSING', true);
      if (u.workspaceId === null) note('USER_WORKSPACE_IDENTITY_MISSING', true);
    }
    for (const w of input.workspaces) if (w.id === null) note('WORKSPACE_RECORD_IDENTITY_MISSING', true);
    const linkedGroups = new Map(), candidateGroups = new Map(), unmappedGroups = new Map();
    input.credentials.forEach((c, row) => {
      if (c.id === null) note('CREDENTIAL_IDENTITY_MISSING', true);
      if (c.platform === null) note('PLATFORM_IDENTITY_MISSING', true);
      if (c.isActive === null) note('ACTIVE_STATE_UNKNOWN', true);
      if (c.createdAt === null || c.updatedAt === null) note('TIMESTAMP_EVIDENCE_MISSING', true);
      if (c.workspaceId !== null) {
        const linked = workspaceIds.get(c.workspaceId) || [];
        if (!linked.length) note('LINKED_WORKSPACE_UNMATCHED');
        else if (linked.length !== 1) note('LINKED_WORKSPACE_AMBIGUOUS', true);
      }
      let target = null;
      if (c.userId === null) note('CREDENTIAL_USER_IDENTITY_MISSING', true);
      else {
        const users = authIds.get(c.userId) || [];
        if (!users.length) note('USER_UNMATCHED');
        else if (users.length !== 1) note('USER_MAPPING_AMBIGUOUS', true);
        else {
          const [user] = users;
          if (user.id === null || userIds.get(user.id)?.length !== 1) note('USER_MAPPING_AMBIGUOUS', true);
          else if (user.workspaceId !== null) {
            const workspaces = workspaceIds.get(user.workspaceId) || [];
            if (!workspaces.length) note('WORKSPACE_UNMATCHED');
            else if (workspaces.length !== 1) note('WORKSPACE_MAPPING_AMBIGUOUS', true);
            else target = user.workspaceId;
          }
        }
      }
      if (target !== null && c.id !== null && credentialIds.get(c.id).length === 1) {
        if (c.workspaceId === null) note('NEEDS_LINK_POLICY');
        else if (c.workspaceId !== target) note('WORKSPACE_CONFLICT');
        else note('ALREADY_LINKED');
      }
      if (c.isActive !== true) return; // null was explicitly refused above, never treated as inactive evidence.
      if (c.workspaceId === null && target === null) note('ACTIVE_COHORT_UNRESOLVED', true);
      if (c.platform === null) return;
      // Current links and unique join candidates are separate observations. The
      // union is a potential-collision census, NOT permission to apply that join.
      if (c.workspaceId !== null) {
        const key = JSON.stringify([c.workspaceId, c.platform]);
        group(linkedGroups, key, row); group(candidateGroups, key, row);
      } else if (c.userId !== null) group(unmappedGroups, JSON.stringify([c.userId, c.platform]), row);
      if (target !== null) group(candidateGroups, JSON.stringify([target, c.platform]), row);
    });
    for (const [groups, reason] of [[linkedGroups, 'DUPLICATE_ACTIVE_LINKED_GROUP'],
      [candidateGroups, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP'], [unmappedGroups, 'DUPLICATE_ACTIVE_UNMAPPED_IDENTITY_GROUP']]) {
      for (const members of groups.values()) if (members.size > 1) note(reason);
    }
    const report = [...findings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([reason, count]) => ({ reason, count }));
    return { ...base, status: unknown ? 'UNKNOWN' : report.some(f => f.reason !== 'ALREADY_LINKED')
      ? 'REVIEW_REQUIRED' : 'NO_LINK_CHANGE_INDICATED',
    inspected: { credentials: input.credentials.length, users: input.users.length, workspaces: input.workspaces.length }, findings: report };
  } catch {
    return malformed(); // Never serialize an exception, input identity, token or untrusted message.
  }
}
