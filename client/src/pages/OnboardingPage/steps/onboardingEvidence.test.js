import { describe, expect, it } from 'vitest';
import { hasConfirmedMetaConnection } from './onboardingEvidence.js';

const active = { platform: 'META', isActive: true, connected: true, connection: 'CONNECTED' };
const history = { platform: 'META', isActive: false, connected: false, connection: 'DISCONNECTED' };
const read = (connections) => ({ data: { workspaceId: 'workspace-1', connections }, loading: false, error: null });

describe('META confirmation uses the published active credential population', () => {
  it.each([
    ['one active', [active], true],
    ['one active plus inactive history', [active, history], true],
    ['inactive history before the active row', [history, active, { ...history, accountId: 'older' }], true],
    ['another provider does not compete', [history, active, { ...active, platform: 'GOOGLE' }], true],
    ['two active META rows', [active, { ...active, accountId: 'other' }], false],
    ['two active rows with conflicting connection evidence', [active, { ...active, connected: false }], false],
    ['only inactive history', [history, { ...history, accountId: 'older' }], false],
    ['inactive compatibility connected flag is not authority', [{ ...history, connected: true }], false],
    ['empty active population', [], false],
    ['activity was not published', [{ platform: 'META', connected: true }], false],
    ['active credential contradicts connected', [{ ...active, connected: false }, history], false],
    ['active credential contradicts connection axis', [{ ...active, connection: 'DISCONNECTED' }, history], false],
    ['unrecognized active connection axis', [{ ...active, connection: 'FUTURE' }, history], false],
    ['missing active connected evidence', [{ platform: 'META', isActive: true }, history], false],
    ['legacy additive axis is absent', [{ platform: 'META', isActive: true, connected: true }, history], true],
  ])('%s', (_name, connections, expected) => {
    expect(hasConfirmedMetaConnection(read(connections))).toBe(expected);
  });

  it.each([
    { ...read([active, history]), loading: true },
    { ...read([active, history]), error: new Error('reader failed') },
    { ...read([active, history]), data: { workspaceId: null, connections: [active, history] } },
    { ...read([active, history]), data: { workspaceId: ' ', connections: [active, history] } },
  ])('reader and workspace safeguards still refuse: %j', (value) => {
    expect(hasConfirmedMetaConnection(value)).toBe(false);
  });
});
