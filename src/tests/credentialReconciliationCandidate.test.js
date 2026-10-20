import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { evaluateCredentialReconciliation as evaluate } from '../services/startup/credentialReconciliationCandidate.js';

const sourceUrl = new URL('../services/startup/credentialReconciliationCandidate.js', import.meta.url);
const credential = (patch = {}) => ({ id: 'cred-a', userId: 'auth-a', workspaceId: 'ws-a',
  platform: 'meta_ads', isActive: true, createdAt: 1000, updatedAt: 2000, ...patch });
const fixture = (patch = {}) => ({ scope: 'SYNTHETIC_ONLY',
  completeness: { credentials: 'COMPLETE', users: 'COMPLETE', workspaces: 'COMPLETE' },
  credentials: [credential()], users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: 'ws-a' }],
  workspaces: [{ id: 'ws-a' }], ...patch });
const run = data => evaluate(JSON.stringify(data));
const count = (result, reason) => result.findings.find(f => f.reason === reason)?.count ?? 0;
const markers = { contract: 'CREDENTIAL_RECONCILIATION_CANDIDATE_V1', scope: 'SYNTHETIC_ONLY',
  runtimeAdmission: 'NOT_WIRED', dataWrites: 'NO_DATA_WRITES', authority: 'NO_ACCOUNT_SELECTION_AUTHORITY' };
const assertEnvelope = result => {
  expect(result).toMatchObject(markers);
  expect(Object.keys(result).sort()).toEqual([...Object.keys(markers), 'status', 'inspected', 'findings'].sort());
  expect(result.findings.map(f => f.reason)).toEqual(result.findings.map(f => f.reason).sort());
  for (const finding of result.findings) {
    expect(Object.keys(finding).sort()).toEqual(['count', 'reason']);
    expect(finding.reason).toMatch(/^[A-Z_]+$/);
    expect(Number.isSafeInteger(finding.count) && finding.count > 0).toBe(true);
  }
};

describe('synthetic credential reconciliation candidate', () => {
  it('recognizes an already-linked fixture without granting any account authority', () => {
    const result = run(fixture());
    expect(result).toEqual({ ...markers, status: 'NO_LINK_CHANGE_INDICATED',
      inspected: { credentials: 1, users: 1, workspaces: 1 }, findings: [{ reason: 'ALREADY_LINKED', count: 1 }] });
  });

  it('reports duplicate active mapped and unmapped rows without selecting the newest', () => {
    const data = fixture({ credentials: [credential(), credential({ id: 'cred-b', workspaceId: null, updatedAt: 99999 })] });
    const result = run(data);
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(count(result, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP')).toBe(1);
    expect(count(result, 'NEEDS_LINK_POLICY')).toBe(1);
    expect(count(result, 'ALREADY_LINKED')).toBe(1);
    assertEnvelope(result);
  });

  it('keeps a unique unlinked association at policy review, never auto-link eligible', () => {
    const result = run(fixture({ credentials: [credential({ workspaceId: null })] }));
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.findings).toEqual([{ reason: 'NEEDS_LINK_POLICY', count: 1 }]);
  });

  it('distinguishes a complete empty fixture from missing or unknown source evidence', () => {
    const data = fixture({ credentials: [], users: [], workspaces: [] });
    expect(run(data)).toEqual({ ...markers, status: 'NO_LINK_CHANGE_INDICATED',
      inspected: { credentials: 0, users: 0, workspaces: 0 }, findings: [] });
    data.completeness.credentials = 'UNKNOWN';
    expect(run(data).status).toBe('UNKNOWN');
    expect(count(run(data), 'EVIDENCE_INCOMPLETE')).toBe(1);
  });

  it.each(['credentials', 'users', 'workspaces'])('refuses incomplete %s coverage even with rows', name => {
    for (const state of ['INCOMPLETE', 'UNKNOWN']) {
      const data = fixture(); data.completeness[name] = state;
      const result = run(data);
      expect(result.status).toBe('UNKNOWN');
      expect(count(result, 'EVIDENCE_INCOMPLETE')).toBe(1);
      assertEnvelope(result);
    }
  });

  it.each([
    ['credential identity', { credentials: [credential({ id: null })] }, 'CREDENTIAL_IDENTITY_MISSING'],
    ['credential user', { credentials: [credential({ userId: null })] }, 'CREDENTIAL_USER_IDENTITY_MISSING'],
    ['platform', { credentials: [credential({ platform: null })] }, 'PLATFORM_IDENTITY_MISSING'],
    ['active evidence', { credentials: [credential({ isActive: null })] }, 'ACTIVE_STATE_UNKNOWN'],
    ['created time', { credentials: [credential({ createdAt: null })] }, 'TIMESTAMP_EVIDENCE_MISSING'],
    ['updated time', { credentials: [credential({ updatedAt: null })] }, 'TIMESTAMP_EVIDENCE_MISSING'],
    ['user primary identity', { users: [{ id: null, clerkId: 'auth-a', workspaceId: 'ws-a' }] }, 'USER_RECORD_IDENTITY_MISSING'],
    ['user join identity', { users: [{ id: 'user-a', clerkId: null, workspaceId: 'ws-a' }] }, 'USER_JOIN_IDENTITY_MISSING'],
    ['user workspace', { users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: null }] }, 'USER_WORKSPACE_IDENTITY_MISSING'],
    ['workspace identity', { workspaces: [{ id: null }] }, 'WORKSPACE_RECORD_IDENTITY_MISSING'],
  ])('refuses missing %s evidence', (_label, patch, reason) => {
    const result = run(fixture(patch));
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, reason)).toBeGreaterThan(0);
    assertEnvelope(result);
  });

  it('never joins a credential auth identity to a users primary identity', () => {
    const result = run(fixture({ credentials: [credential({ userId: 'user-a' })] }));
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(count(result, 'USER_UNMATCHED')).toBe(1);
    expect(count(result, 'ALREADY_LINKED')).toBe(0);
  });

  it('does not label missing user-workspace evidence complete just because no credential references it', () => {
    const data = fixture({ credentials: [], users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: null }] });
    const result = run(data);
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, 'USER_WORKSPACE_IDENTITY_MISSING')).toBe(1);
  });

  it('refuses every permutation of ambiguous joins without discarding known linked collisions', () => {
    const data = fixture({ credentials: [credential(), credential({ id: 'cred-b' })],
      users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: 'ws-a' },
        { id: 'user-b', clerkId: 'auth-a', workspaceId: 'ws-b' }], workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] });
    const result = run(data);
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, 'USER_MAPPING_AMBIGUOUS')).toBe(2);
    expect(count(result, 'DUPLICATE_ACTIVE_LINKED_GROUP')).toBe(1);
    expect(count(result, 'ALREADY_LINKED')).toBe(0);
    expect(run({ ...data, credentials: [...data.credentials].reverse(), users: [...data.users].reverse(),
      workspaces: [...data.workspaces].reverse() })).toEqual(result);
  });

  it('reports unmatched workspace and conflicting pre-existing links separately', () => {
    const missing = run(fixture({ workspaces: [] }));
    expect(count(missing, 'WORKSPACE_UNMATCHED')).toBe(1);
    expect(count(missing, 'LINKED_WORKSPACE_UNMATCHED')).toBe(1);
    const conflict = run(fixture({ credentials: [credential({ workspaceId: 'ws-b' })],
      workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] }));
    expect(conflict.status).toBe('REVIEW_REQUIRED');
    expect(count(conflict, 'WORKSPACE_CONFLICT')).toBe(1);
    expect(count(conflict, 'ALREADY_LINKED')).toBe(0);
  });

  it.each([
    ['credential IDs', f => f.credentials.push(credential()), 'DUPLICATE_CREDENTIAL_IDENTITY'],
    ['user IDs', f => f.users.push({ id: 'user-a', clerkId: 'auth-b', workspaceId: 'ws-a' }), 'DUPLICATE_USER_IDENTITY'],
    ['auth joins', f => f.users.push({ id: 'user-b', clerkId: 'auth-a', workspaceId: 'ws-b' }), 'AMBIGUOUS_USER_JOIN'],
    ['workspace IDs', f => f.workspaces.push({ id: 'ws-a' }), 'DUPLICATE_WORKSPACE_IDENTITY'],
  ])('rejects ambiguous %s instead of taking the first match', (_label, change, reason) => {
    const data = fixture(); change(data);
    const result = run(data);
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, reason)).toBe(1);
    expect(count(result, 'ALREADY_LINKED')).toBe(0);
  });

  it('retains linked duplicates even when all user joins are unmatched', () => {
    const result = run(fixture({ users: [], credentials: [credential(), credential({ id: 'cred-b', userId: 'auth-b' })] }));
    expect(count(result, 'DUPLICATE_ACTIVE_LINKED_GROUP')).toBe(1);
    expect(count(result, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP')).toBe(1);
    expect(count(result, 'USER_UNMATCHED')).toBe(2);
  });

  it('reports active duplicates among unmapped historical rows with no matching user', () => {
    const result = run(fixture({ users: [], credentials: [credential({ workspaceId: null }),
      credential({ id: 'cred-b', workspaceId: null })] }));
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, 'DUPLICATE_ACTIVE_UNMAPPED_IDENTITY_GROUP')).toBe(1);
    expect(count(result, 'ACTIVE_COHORT_UNRESOLVED')).toBe(2);
  });

  it('detects collisions across different auth identities mapping to one workspace', () => {
    const result = run(fixture({ users: [{ id: 'u1', clerkId: 'auth-a', workspaceId: 'ws-a' },
      { id: 'u2', clerkId: 'auth-b', workspaceId: 'ws-a' }], credentials: [credential({ workspaceId: null }),
      credential({ id: 'cred-b', userId: 'auth-b', workspaceId: null })] }));
    expect(count(result, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP')).toBe(1);
    expect(count(result, 'DUPLICATE_ACTIVE_UNMAPPED_IDENTITY_GROUP')).toBe(0);
  });

  it('does not classify known inactive rows or distinct platforms/workspaces as active duplicates', () => {
    for (const patch of [{ isActive: false }, { platform: 'google_ads' }]) {
      const result = run(fixture({ credentials: [credential(), credential({ id: 'cred-b', ...patch })] }));
      expect(count(result, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP')).toBe(0);
      expect(result.status).toBe('NO_LINK_CHANGE_INDICATED');
    }
    const result = run(fixture({ credentials: [credential(), credential({ id: 'cred-b', userId: 'auth-b', workspaceId: 'ws-b' })],
      users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: 'ws-a' }, { id: 'user-b', clerkId: 'auth-b', workspaceId: 'ws-b' }],
      workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] }));
    expect(count(result, 'DUPLICATE_ACTIVE_CANDIDATE_GROUP')).toBe(0);
  });

  it('retains known duplicate risks when source completeness is unknown', () => {
    const data = fixture({ credentials: [credential(), credential({ id: 'cred-b' })] });
    data.completeness.credentials = 'UNKNOWN';
    const result = run(data);
    expect(result.status).toBe('UNKNOWN');
    expect(count(result, 'DUPLICATE_ACTIVE_LINKED_GROUP')).toBe(1);
  });

  it('is invariant under every permutation of a mixed fixture and timestamp reversals', () => {
    const data = fixture({ credentials: [credential(), credential({ id: 'cred-b', workspaceId: null }),
      credential({ id: 'cred-c', userId: 'auth-b', workspaceId: 'ws-b' })],
      users: [{ id: 'user-a', clerkId: 'auth-a', workspaceId: 'ws-a' }, { id: 'user-b', clerkId: 'auth-b', workspaceId: 'ws-a' }],
      workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] });
    const permutations = list => list.length < 2 ? [list] : list.flatMap((v, i) => permutations(list.filter((_, j) => i !== j)).map(tail => [v, ...tail]));
    const expected = run(data);
    for (const credentials of permutations(data.credentials)) for (const users of permutations(data.users)) for (const workspaces of permutations(data.workspaces)) {
      const variant = { ...data, credentials: credentials.map((c, i) => ({ ...c, createdAt: 9000 - i, updatedAt: i })), users, workspaces };
      expect(run(variant)).toEqual(expected);
    }
    expect(count(expected, 'WORKSPACE_CONFLICT')).toBe(1);
  });

  it.each([undefined, null, 0, false, {}, [], () => {}, '{', 'null', '[]', '{}',
    '{"scope":"SYNTHETIC_ONLY","scope":"SYNTHETIC_ONLY"}', ' '.repeat(1048577)])('refuses malformed/non-text input %# without echoing it', input => {
    const result = evaluate(input);
    expect(result.status).toBe('UNKNOWN');
    expect(result.inspected).toBeNull();
    expect(result.findings).toEqual([{ reason: 'MALFORMED_INPUT', count: 1 }]);
    assertEnvelope(result);
  });

  it.each([
    f => { f.scope = 'PRODUCTION'; }, f => { delete f.completeness; },
    f => { f.completeness.credentials = true; }, f => { f.credentials = null; },
    f => { f.credentials[0].isActive = 'true'; }, f => { f.credentials[0].platform = ''; },
    f => { f.credentials[0].updatedAt = -1; }, f => { f.credentials[0].createdAt = 0.5; },
    f => { delete f.credentials[0].createdAt; }, f => { f.credentials[0].id = 7; },
    f => { f.users[0].id = ' user-a'; }, f => { f.workspaces[0].id = 'x'.repeat(257); },
    f => { f.credentials[0].accessToken = 'TOKEN_CANARY'; }, f => { f.error = 'SECRET_ERROR_CANARY'; },
    f => { f.workspaces = Array.from({ length: 10001 }, () => ({ id: 'ws-a' })); },
  ])('refuses malformed fixture fields %#', change => {
    const data = fixture(); change(data);
    const result = run(data);
    expect(result.status).toBe('UNKNOWN');
    expect(result.inspected).toBeNull();
    expect(result.findings).toEqual([{ reason: 'MALFORMED_INPUT', count: 1 }]);
    assertEnvelope(result);
  });

  it('refuses duplicate JSON keys, whitespace and prototype payloads without last-key selection', () => {
    const text = JSON.stringify(fixture());
    for (const input of [text.replace('"userId":"auth-a"', '"userId":"auth-b","userId":"auth-a"'),
      ' ' + text, text.replace('"scope":', '"__proto__":{"polluted":true},"scope":')]) {
      expect(evaluate(input).findings).toEqual([{ reason: 'MALFORMED_INPUT', count: 1 }]);
    }
    expect({}.polluted).toBeUndefined();
  });

  it('never reads getters, proxies, coercions or callbacks supplied as input', () => {
    const touch = vi.fn(() => { throw Error('SECRET_CALLBACK_ERROR'); });
    const object = { get scope() { return touch(); }, toString: touch, toJSON: touch };
    for (const input of [object, new Proxy({}, { get: touch, ownKeys: touch, getPrototypeOf: touch }), Object.assign(touch, { context: 'SYNTHETIC_ONLY' })]) {
      expect(evaluate(input).status).toBe('UNKNOWN');
    }
    expect(touch).not.toHaveBeenCalled();
  });

  it('emits no input identities, secret-like values, SQL, raw errors or selection instructions', () => {
    const data = fixture({ credentials: [credential({ id: 'TOKEN_CANARY', userId: 'AUTH_CANARY', workspaceId: 'WORKSPACE_CANARY', platform: 'ACCOUNT_CANARY' })] });
    const result = run(data);
    const output = JSON.stringify(result);
    for (const value of ['TOKEN_CANARY', 'AUTH_CANARY', 'WORKSPACE_CANARY', 'ACCOUNT_CANARY', 'winner', 'selected', 'UPDATE ', 'accountId']) expect(output).not.toContain(value);
    expect(result.status).toBe('REVIEW_REQUIRED');
    assertEnvelope(result);
  });

  it('runs import-free with I/O, environment, clocks, random and logging poisoned', () => {
    const source = readFileSync(sourceUrl, 'utf8');
    const touch = vi.fn(() => { throw Error('forbidden effect'); });
    const denied = new Proxy(touch, { get: touch, apply: touch, construct: touch });
    const math = Object.create(Math); math.random = touch;
    const isolated = vm.runInNewContext(source.replace('export function ', 'function ') + '\nevaluateCredentialReconciliation;',
      { process: denied, console: denied, fetch: denied, Date: denied, Math: math, performance: denied,
        setTimeout: denied, setInterval: denied, require: denied, XMLHttpRequest: denied, WebSocket: denied }, { timeout: 1000 });
    for (const input of [JSON.stringify(fixture()), JSON.stringify(fixture({ credentials: [credential(),
      credential({ id: 'cred-b', workspaceId: null })] })), JSON.stringify(fixture({ users: [] })), '{', undefined]) {
      expect(JSON.stringify(isolated(input))).toBe(JSON.stringify(evaluate(input)));
    }
    expect(touch).not.toHaveBeenCalled();
    expect(source).not.toMatch(/\b(?:import|require)\s*(?:\(|[{'"*])/);
  });

  it('does not mutate the fixture text and shares no mutable output state across calls', () => {
    const text = JSON.stringify(fixture());
    const first = evaluate(text); const expected = evaluate(text);
    first.findings.push({ reason: 'TAMPERED', count: 999 });
    if (first.inspected) first.inspected.credentials = 999;
    expect(evaluate(text)).toEqual(expected);
    expect(text).toBe(JSON.stringify(fixture()));
  });
});
