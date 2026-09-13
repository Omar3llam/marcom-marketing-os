// ============================================================
// The /webhook mount order is part of the security control
// ------------------------------------------------------------
// Each middleware on this path is only correct because of what runs before it:
//
//   request
//     ↓  captureRawBody      bounded — the cap must precede authentication
//     ↓  validateWebhook     authenticity over the captured bytes
//     ↓  dedupeWebhookEvent  idempotency over SIGNED material
//     ↓  express.json        parsing, after all three
//     ↓  chatLimiter
//     ↓  masterRouter        mutation
//
// The failure this guards against is specific and was the finding: the body
// size limit sitting BEHIND the parser. express.json's 10 MB limit does not
// protect the capture, because the capture has already buffered the request by
// the time the parser sees it. Move the cap behind the parser — or the parser
// in front of the capture — and the unauthenticated exhaustion surface is back
// with every test still green, because no unit test sees a mount order.
//
// So the order is asserted against server.js's own source. A guard that read a
// hand-maintained list of middleware names would drift from the product exactly
// the way PARITY-02's route table did.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = readFileSync(join(process.cwd(), 'src', 'server.js'), 'utf8');

/** The argument list of `app.use('/webhook', … );` as it is actually written. */
function webhookMount(src) {
  const m = src.match(/app\.use\(\s*'\/webhook'([\s\S]*?)\n\);/);
  return m ? m[1] : null;
}

/** Position of a middleware inside that mount, or -1. */
const at = (mount, name) => (mount ?? '').indexOf(name);

describe('the /webhook mount exists and is readable', () => {
  it('server.js declares it', () => {
    expect(webhookMount(SERVER)).not.toBeNull();
  });
});

describe('the order is the control', () => {
  const mount = webhookMount(SERVER);

  it('the bounded capture runs first', () => {
    const capture = at(mount, 'captureRawBody');
    expect(capture).toBeGreaterThanOrEqual(0);
    for (const later of ['validateWebhook', 'dedupeWebhookEvent', 'express.json', 'masterRouter']) {
      expect(at(mount, later)).toBeGreaterThan(capture);
    }
  });

  it('verification runs before idempotency', () => {
    expect(at(mount, 'validateWebhook')).toBeGreaterThanOrEqual(0);
    expect(at(mount, 'dedupeWebhookEvent')).toBeGreaterThan(at(mount, 'validateWebhook'));
  });

  it('the JSON parser runs AFTER capture, verification and idempotency', () => {
    const parser = at(mount, 'express.json');
    expect(parser).toBeGreaterThanOrEqual(0);
    for (const earlier of ['captureRawBody', 'validateWebhook', 'dedupeWebhookEvent']) {
      expect(at(mount, earlier)).toBeLessThan(parser);
    }
  });

  it('the mutation router is last', () => {
    const router = at(mount, 'masterRouter');
    expect(router).toBeGreaterThanOrEqual(0);
    for (const earlier of ['captureRawBody', 'validateWebhook', 'dedupeWebhookEvent', 'express.json']) {
      expect(at(mount, earlier)).toBeLessThan(router);
    }
  });

  // The global parser is what would silently consume the stream before the
  // webhook mount ever saw it.
  it('the global express.json is mounted after the webhook route', () => {
    const webhookMountAt = SERVER.indexOf("app.use('/webhook'");
    const globalParser = SERVER.indexOf('app.use(express.json(');
    expect(webhookMountAt).toBeGreaterThanOrEqual(0);
    expect(globalParser).toBeGreaterThanOrEqual(0);
    expect(globalParser).toBeGreaterThan(webhookMountAt);
  });
});

// A reader of an empty result must be able to tell "ordered correctly" from
// "the instrument found nothing to read".
describe('control — the reader actually reads', () => {
  it('finds nothing in a source with no webhook mount', () => {
    expect(webhookMount("app.use('/api', requireAuth, r);\n")).toBeNull();
  });

  it('reports a mount whose order is wrong', () => {
    const bad = "app.use('/webhook',\n  express.json(),\n  captureRawBody,\n  validateWebhook\n);\n";
    const m = webhookMount(bad);
    expect(at(m, 'captureRawBody')).toBeGreaterThan(at(m, 'express.json'));
  });

  it('distinguishes a present middleware from an absent one', () => {
    const m = webhookMount("app.use('/webhook',\n  captureRawBody\n);\n");
    expect(at(m, 'captureRawBody')).toBeGreaterThanOrEqual(0);
    expect(at(m, 'dedupeWebhookEvent')).toBe(-1);
  });
});
