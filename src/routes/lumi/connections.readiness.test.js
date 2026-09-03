// ============================================================
// GET /api/lumi/connections — C-04 · the five axes reach the wire
// ------------------------------------------------------------
// The pure axes are proven in connectorReadiness.test.js. What is proven HERE
// is that they survive the projection: every one of these facts was already
// computable from stored data before C-04, and not one of them left the server.
//
// The negative assertions carry the weight. A route that published four axes
// and dropped the fifth would pass every positive test in this file.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listConnections } = vi.hoisted(() => ({ listConnections: vi.fn() }));
vi.mock('../../services/connectors/credentialStore.js', () => ({
  listConnections, updateCredentialAccount: vi.fn(),
}));
vi.mock('../../services/connectors/ConnectorSyncService.js', () => ({ runConnectorSync: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  requireCollabRole: () => (req, res, next) => next(),
}));

import { connectionsRouter } from './connections.js';
import { nextHealth } from '../../services/connectors/connectorHealth.js';
import { DAILY_STATE } from '../../services/connectors/connectorConfig.js';
import {
  AVAILABILITY_STATE, COMPLETENESS_STATE, READINESS_STATE,
  CONNECTION_STATE, CAPABILITY, CAPABILITY_RUN,
} from '../../services/connectors/connectorReadiness.js';

const WS = 'ws-1';
const NOW_ISO = new Date().toISOString();

/** Health as the WRITER produces it — never a hand-built shape. */
const health = (over = {}) => nextHealth({}, { platform: 'META', ok: true, records: 5, now: new Date(), ...over });

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.workspaceId = WS; next(); });
  a.use('/api/lumi', connectionsRouter);
  return a;
}

const get = () => request(app()).get('/api/lumi/connections');

const row = (over = {}) => ({
  platform: 'META', isActive: true, lastSyncedAt: NOW_ISO,
  accountId: 'act_1', availableAccounts: [], health: health(), ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('the five axes are published, separately', () => {
  it('a healthy channel reports all five', async () => {
    listConnections.mockResolvedValue([row()]);
    const { body } = await get().expect(200);
    const c = body.connections[0];

    expect(c.connection).toBe(CONNECTION_STATE.CONNECTED);
    expect(c.availability).toBe(AVAILABILITY_STATE.OK);
    expect(c.completeness).toBe(COMPLETENESS_STATE.COMPLETE);
    expect(c.readiness).toBe(READINESS_STATE.CURRENT);
    expect(Array.isArray(c.capabilities)).toBe(true);
  });

  // THE SHAPE OF THE WHOLE SLICE. Four different truths about one channel, none
  // of which explains another, and none folded into a single badge.
  it('a channel can be CONNECTED, FAILING, INCOMPLETE and CURRENT at once', async () => {
    const partial = health({ warning: 'pagination limit' });
    listConnections.mockResolvedValue([row({
      health: nextHealth(partial, { platform: 'META', ok: false, error: 'rate limited', now: new Date() }),
    })]);
    const c = (await get().expect(200)).body.connections[0];

    expect(c.connection).toBe(CONNECTION_STATE.CONNECTED);
    expect(c.availability).toBe(AVAILABILITY_STATE.FAILING);
    expect(c.completeness).toBe(COMPLETENESS_STATE.INCOMPLETE);
    expect(c.readiness).toBe(READINESS_STATE.CURRENT);
  });

  it('never-synced is NEVER_SYNCED on the wire, not stale', async () => {
    listConnections.mockResolvedValue([row({ health: null, lastSyncedAt: null })]);
    const c = (await get().expect(200)).body.connections[0];

    expect(c.readiness).toBe(READINESS_STATE.NEVER_SYNCED);
    expect(c.readiness).not.toBe(READINESS_STATE.STALE);
    expect(c.availability).toBe(AVAILABILITY_STATE.NOT_RECORDED);
    expect(c.completeness).toBe(COMPLETENESS_STATE.NOT_RECORDED);
  });
});

// ── D-1 · the defect that lived in a contract, not a component ──────────────
describe('lastWarning reaches the wire', () => {
  it('a successful-but-short sync publishes its warning', async () => {
    listConnections.mockResolvedValue([row({ health: health({ warning: 'Large account: some ad sets were not read.' }) })]);
    const c = (await get().expect(200)).body.connections[0];

    expect(c.health.lastWarning).toMatch(/ad sets were not read/);
    // …and the axis derived from it, so a renderer never has to parse prose.
    expect(c.completeness).toBe(COMPLETENESS_STATE.INCOMPLETE);
    // INCOMPLETE is not an error. The data landed.
    expect(c.availability).toBe(AVAILABILITY_STATE.OK);
  });
});

describe('capabilities — one line each, never one verdict', () => {
  it('publishes the three that have a predicate in code', async () => {
    listConnections.mockResolvedValue([row()]);
    const c = (await get().expect(200)).body.connections[0];
    expect(c.capabilities.map((x) => x.capability))
      .toEqual([CAPABILITY.DAILY_OBSERVATIONS, CAPABILITY.CANONICAL_WINDOW, CAPABILITY.EXECUTION]);
  });

  it('a stored daily outcome survives to the wire', async () => {
    listConnections.mockResolvedValue([row({
      health: health({ capabilities: { [CAPABILITY.DAILY_OBSERVATIONS]: DAILY_STATE.NO_DATA } }),
    })]);
    const c = (await get().expect(200)).body.connections[0];
    const daily = c.capabilities.find((x) => x.capability === CAPABILITY.DAILY_OBSERVATIONS);

    expect(daily.implemented).toBe(true);
    expect(daily.lastRun).toBe(DAILY_STATE.NO_DATA);
  });

  it('a pre-C-04 row is NOT_RECORDED, never NO_DATA', async () => {
    listConnections.mockResolvedValue([row()]);
    const daily = (await get().expect(200)).body.connections[0]
      .capabilities.find((x) => x.capability === CAPABILITY.DAILY_OBSERVATIONS);

    expect(daily.lastRun).toBe(CAPABILITY_RUN.NOT_RECORDED);
    expect(daily.lastRun).not.toBe(DAILY_STATE.NO_DATA);
  });
});

describe('what C-04 did NOT change', () => {
  // `stale` is superseded, not replaced: BlendedTruthService consumes the same
  // predicate and ConnectionHealthStrip renders this field.
  it('keeps every field that was already on the wire', async () => {
    listConnections.mockResolvedValue([row()]);
    const c = (await get().expect(200)).body.connections[0];

    for (const k of ['platform', 'isActive', 'connected', 'stale', 'lastSyncedAt', 'accountId', 'availableAccounts', 'health']) {
      expect(c).toHaveProperty(k);
    }
  });

  // R-8: readiness explains absence, it does not gate a claim. A route that
  // started withholding connections on a bad axis would be the exact inversion
  // the ruling forbids.
  it('publishes a DISCONNECTED, never-synced, failing channel rather than hiding it', async () => {
    listConnections.mockResolvedValue([row({ isActive: false, health: null })]);
    const { body } = await get().expect(200);

    expect(body.connections).toHaveLength(1);
    expect(body.connections[0].connection).toBe(CONNECTION_STATE.DISCONNECTED);
  });
});

// ── C-06 · the axes reach the wire in the shared language too ───────────────
describe('C-06 · each axis carries its knowledge token', () => {
  it('publishes a token beside availability, completeness and readiness', async () => {
    listConnections.mockResolvedValue([row()]);
    const res = await get();
    const c = res.body.connections[0];
    expect(c.availabilityKnowledge).toBe('KNOWN');
    expect(c.completenessKnowledge).toBe('KNOWN');
    expect(c.readinessKnowledge).toBe('KNOWN');
    // The domain values are UNTOUCHED. The token is additive, never a
    // replacement — the fifty-two client mirrors still describe the wire.
    expect(c.availability).toBe(AVAILABILITY_STATE.OK);
    expect(c.completeness).toBe(COMPLETENESS_STATE.COMPLETE);
    expect(c.readiness).toBe(READINESS_STATE.CURRENT);
  });

  it('separates "we hold no record" from "we hold nothing"', async () => {
    // A channel that has never been synced at all: NOT_RECORDED on the axes
    // that need an attempt, NEVER_SYNCED on the one that needs a success. The
    // two are different sentences and C-06 keeps them different — this is the
    // distinction C-04 was fought over, now stated in one language.
    listConnections.mockResolvedValue([row({ health: null })]);
    const c = (await get()).body.connections[0];
    expect(c.availabilityKnowledge).toBe('COULD_NOT_LOOK');
    expect(c.completenessKnowledge).toBe('COULD_NOT_LOOK');
    expect(c.readinessKnowledge).toBe('NOTHING_THERE');
    expect(c.readinessKnowledge).not.toBe(c.availabilityKnowledge);
  });

  it('says a failing connector is KNOWN — a bad answer is still an answer', async () => {
    listConnections.mockResolvedValue([row({ health: health({ ok: false, error: 'token expired' }) })]);
    const c = (await get()).body.connections[0];
    expect(c.availability).toBe(AVAILABILITY_STATE.FAILING);
    expect(c.availabilityKnowledge).toBe('KNOWN');
  });

  it('gives CONNECTION no token at all, by ruling', async () => {
    // CONNECTED / DISCONNECTED are facts about a credential row. No value of
    // that axis reports our position, so it is outside the epistemic registry
    // and publishing a token for it would be noise dressed as knowledge.
    listConnections.mockResolvedValue([row()]);
    const c = (await get()).body.connections[0];
    expect(c.connection).toBe(CONNECTION_STATE.CONNECTED);
    expect(c).not.toHaveProperty('connectionKnowledge');
  });

  it('carries one token per capability row, not one for the source', async () => {
    listConnections.mockResolvedValue([row({
      health: health({ daily: { state: DAILY_STATE.NO_DATA } }),
    })]);
    const caps = (await get()).body.connections[0].capabilities;
    const byName = Object.fromEntries(caps.map((c) => [c.capability, c]));
    // NOT_APPLICABLE and UNIMPLEMENTED are both CANNOT_ASK; NOT_RECORDED is
    // COULD_NOT_LOOK. Three words, and the token says which KIND each one is
    // without a reader learning all seven.
    expect(byName[CAPABILITY.EXECUTION].lastRun).toBe(CAPABILITY_RUN.NOT_APPLICABLE);
    expect(byName[CAPABILITY.EXECUTION].lastRunKnowledge).toBe('CANNOT_ASK');
    expect(byName[CAPABILITY.CANONICAL_WINDOW].lastRunKnowledge).toBe('COULD_NOT_LOOK');
    for (const cap of caps) expect(cap.lastRunKnowledge).toBeTruthy();
  });
});
