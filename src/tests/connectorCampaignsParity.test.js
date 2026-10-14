// ============================================================
// PARITY-04 · the one closed vocabulary crosses the boundary intact
// ------------------------------------------------------------
// `verdict` is the only field in the connector-campaigns contract the client
// parses as a CLOSED enum, and B8-01's law makes that a claim I have to earn:
// a strict zod enum does not drop one field, it fails the parse and takes the
// whole surface with it. So this proves BOTH directions — the client admits
// every verdict the engine can emit, and admits none the engine cannot.
//
// ── WHY STRICT IS SAFE HERE, AND WOULD NOT BE ELSEWHERE ─────────────────────
// A strict enum in a separately-deployed client is a time bomb: the server ships
// a new value, and every browser running the old bundle dies until it updates.
// That is not this repo's deploy model, and the test below asserts it rather
// than assuming it — render.yaml's buildCommand runs the root `build`, which
// builds the CLIENT from the same commit. Server and client cannot desync in
// production, so enum drift is a CI failure before it can be a runtime one.
//
// Everything else in that contract stays an OPEN vocabulary on purpose:
// `channel` is rendered as text, and `gatedOut[].reason` already degrades to
// "no instruction" rather than a guessed one (C-07). Arming those would convert
// a graceful degradation into a dead page.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERDICT } from '../services/verdict-engine/verdictTypes.js';

const SCHEMA_PATH = join(
  process.cwd(), 'packages', 'api-contracts', 'schemas', 'connectorCampaigns.schema.ts',
);
const source = readFileSync(SCHEMA_PATH, 'utf8');

/** Members of `export const <name> = z.enum([...])`, as the client declares them. */
function enumMembers(name) {
  const m = source.match(new RegExp(name + '\\s*=\\s*z\\.enum\\(\\[([^\\]]*)\\]'));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('PARITY-04 · the verdict vocabulary crosses the boundary intact', () => {
  it('the extractor works, and can fail', () => {
    expect(source.length).toBeGreaterThan(500);
    expect(enumMembers('ConnectorVerdictValueSchema')).toContain('KILL');
    expect(enumMembers('ZzzNotASchema')).toBeNull();
    expect(enumMembers('ConnectorVerdictValueSchema')).not.toContain('ZZZ_NOT_A_VERDICT');
  });

  it('admits every verdict the engine can emit, and no other', () => {
    expect([...enumMembers('ConnectorVerdictValueSchema')].sort())
      .toEqual([...Object.values(VERDICT)].sort());
  });

  it('and the deploy model that makes strict safe is real, not assumed', () => {
    // If this ever stops being true — a separately-deployed client — the enum
    // above must be reopened, because a server ahead of a browser would blank
    // the Campaigns surface rather than degrade it.
    const render = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');
    expect(render).toMatch(/buildCommand:\s*npm run build\b/);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('npm run build --workspace client');
  });

  it('the OPEN vocabularies are still open', () => {
    // Self-refutation for the case above: if everything were enumerated, the
    // "strict is safe here" argument would be doing no work — and `channel` and
    // the gating reason would both be able to kill the page.
    expect(enumMembers('ConnectorChannelSchema')).toBeNull();
    expect(enumMembers('GatingReasonSchema')).toBeNull();
    expect(source).toMatch(/channel:\s*z\.string\(\)/);
    expect(source).toMatch(/reason:\s*z\.string\(\)/);
  });

  it('the collections the defect turned into [] are REQUIRED arrays', () => {
    // The whole slice in one assertion pair: `campaigns`, `verdicts` and
    // `gatedOut` may not be optional, because optional is what let a malformed
    // 200 render as a measured empty account.
    expect(source).toMatch(/campaigns:\s*z\.array\(ConnectorCampaignRowSchema\)/);
    expect(source).toMatch(/verdicts:\s*z\.array\(ConnectorVerdictRowSchema\)/);
    expect(source).toMatch(/gatedOut:\s*z\.array\(GatedOutRowSchema\)/);
    expect(source).not.toMatch(/campaigns:\s*z\.array\([^)]*\)\.(optional|nullish|nullable)\(\)/);
    expect(source).not.toMatch(/verdicts:\s*z\.array\([^)]*\)\.(optional|nullish|nullable)\(\)/);
    expect(source).not.toMatch(/gatedOut:\s*z\.array\([^)]*\)\.(optional|nullish|nullable)\(\)/);
  });
});
