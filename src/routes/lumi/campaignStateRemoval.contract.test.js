// ============================================================
// Backend Closure S1-B — CampaignState is removed, and stays removed
// ============================================================
// `CampaignState` lost its only writer when R7 deleted temporalObserver. Three
// production readers survived it, and the loudest published the result: GET
// /api/lumi/feed returned `campaigns: []` on every poll for every workspace.
//
// That array was not a fact about the account. It was a fact about us — two
// tables that can no longer be written — and the two are indistinguishable to
// anything downstream, which is the whole reason this file exists.
//
// THE DISTINCTION THIS FILE DEFENDS
//   "you have no campaigns"          ← a real answer, from a writable population
//   "we can no longer answer that"   ← what the removed field actually meant
//
// The first still has an endpoint: GET /api/lumi/entities/campaigns reads the
// connector entity graph, which snapshotSink writes on every sync, and an empty
// list there is an honest measured zero. The second has no endpoint at all any
// more, which is the point — a retired capability answers nothing rather than
// answering `[]`.
//
// So the behavioural assertions below are a PAIR, and neither means much alone:
// the feed must not carry the key even when a workspace genuinely has campaigns,
// and the live surface must still carry it even when a workspace genuinely has
// none. Asserting array shape on one endpoint would pass against exactly the bug
// this slice removed.
//
// The source ratchets sit beside them because the behavioural half cannot see a
// reader that has not been wired up yet — a reinstated `prisma.campaignState`
// read in a service, or a `campaigns: []` fallback on a branch no fixture takes.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');
const { feedRouter }     = await import('./feed.js');
const { entitiesRouter } = await import('./entities.js');

const DB_OK = await dbAvailable();

const WS      = '00000000-0000-4000-8000-00000000s1b0'.replace(/s/g, '5');
const ACCOUNT = '00000000-0000-4000-8000-00000000s1b1'.replace(/s/g, '5');
const CAMPAIGN = '00000000-0000-4000-8000-00000000s1b2'.replace(/s/g, '5');

// ── source ratchets ─────────────────────────────────────────────────────────
const SRC = resolve(process.cwd(), 'src');
const production = (() => {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && !entry.includes('.test.')) out.push(full);
    }
  })(SRC);
  return out;
})();
const strip = (s) => s
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const rel = (f) => f.split(/[\\/]/).join('/').replace(/^.*\/src\//, 'src/');
const code = new Map(production.map((f) => [rel(f), strip(readFileSync(f, 'utf8'))]));
const filesMatching = (re) => [...code.entries()].filter(([, c]) => re.test(c)).map(([f]) => f).sort();

function app(router) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.workspaceId = WS; req.collabRole = 'STRATEGIST';
    req.userId = 'user-s1b'; req.userRole = 'MEMBER';
    next();
  });
  a.use('/api/lumi', router);
  return a;
}

describe('S1-B — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

// ── NC1 · nothing reads CampaignState ───────────────────────────────────────
describe('S1-B · CampaignState has no production reader', () => {
  it('no production file touches prisma.campaignState at all', () => {
    const readers = filesMatching(/(?:prisma|tx|db)\.campaignState\./);
    expect(
      readers,
      'A production CampaignState access came back. The model has had no writer '
      + 'since R7 deleted temporalObserver, so any read here returns rows nobody '
      + 'can create — restore the writer or remove the read; do not add a fallback.',
    ).toEqual([]);
  });

  it('the modules that used to read it are gone, not merely quiet', () => {
    // A file that still exists is a file someone can re-import. contextBuilder
    // rendered the prompt block; orchestratorCircuit wrapped the orchestration
    // that loaded the row as its subject.
    expect(code.has('src/agents/contextBuilder.js')).toBe(false);
    expect(code.has('src/resilience/orchestratorCircuit.js')).toBe(false);
  });
});

// ── NC3 · the retired route and its consumer are both gone ──────────────────
describe('S1-B · the orchestration capability is retired end to end', () => {
  it('no route declares POST /orchestrate/:campaignId', () => {
    expect(filesMatching(/['"`]\/orchestrate\/:campaignId['"`]/)).toEqual([]);
  });

  it('runOrchestration has neither a definition nor a caller', () => {
    // Removing the route while leaving the function would leave the CampaignState
    // read one import away from being live again.
    expect(filesMatching(/\brunOrchestration\b/)).toEqual([]);
    expect(filesMatching(/\bexecuteOrchestration\b/)).toEqual([]);
  });

  it('the agents no longer inject a campaign-context block', () => {
    for (const f of ['src/agents/ClaudeAgent.js', 'src/agents/ChatGPTAgent.js']) {
      expect(code.get(f)).not.toMatch(/getRenderedContext/);
      expect(code.get(f)).not.toMatch(/contextBuilder/);
    }
  });
});

// ── NC2 · the behavioural pair ──────────────────────────────────────────────
describe.skipIf(!DB_OK)('S1-B · "no campaigns" and "no longer answered" are different', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'S1B' } });
  });
  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
    await prisma.account.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(async () => {
    await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
    await prisma.account.deleteMany({ where: { workspaceId: WS } });
  });

  const seedCampaign = async () => {
    await prisma.account.create({
      data: { id: ACCOUNT, workspaceId: WS, externalId: 'act_s1b', channel: 'META', name: 'S1B Account' },
    });
    await prisma.campaign.create({
      data: {
        id: CAMPAIGN, workspaceId: WS, accountId: ACCOUNT,
        externalId: 'c_s1b', channel: 'META', name: 'S1B Campaign',
      },
    });
  };

  it('the feed omits `campaigns` even for a workspace that HAS campaigns', async () => {
    // The discriminating case. A `campaigns: []` fallback would look correct on
    // an empty workspace and would only be caught here, where the honest answer
    // to "how many campaigns" is one.
    await seedCampaign();

    const { status, body } = await request(app(feedRouter)).get('/api/lumi/feed');
    expect(status).toBe(200);
    expect(Object.keys(body)).not.toContain('campaigns');
    expect(body.campaigns).toBeUndefined();
    // The rest of the feed is untouched — this removed a field, not an endpoint.
    expect(body.workspaceId).toBe(WS);
    expect(Array.isArray(body.guardrailVerdicts)).toBe(true);
  });

  it('the live surface still answers, and answers ONE', async () => {
    await seedCampaign();

    const { status, body } = await request(app(entitiesRouter)).get('/api/lumi/entities/campaigns');
    expect(status).toBe(200);
    expect(body.campaigns).toHaveLength(1);
  });

  it('an honestly empty account still gets a real empty answer', async () => {
    // The other half of the pair: removal must not have taken "you have none"
    // with it. This workspace has no campaigns, the population is writable, and
    // `[]` here is a measured zero rather than a missing capability.
    const { status, body } = await request(app(entitiesRouter)).get('/api/lumi/entities/campaigns');
    expect(status).toBe(200);
    expect(body.campaigns).toEqual([]);
  });

  it('the no-workspace feed omits it too', async () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.workspaceId = null; req.userId = null; next(); });
    a.use('/api/lumi', feedRouter);

    const { status, body } = await request(a).get('/api/lumi/feed');
    expect(status).toBe(200);
    expect(Object.keys(body)).not.toContain('campaigns');
  });
});
