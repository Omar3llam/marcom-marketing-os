import { describe, expect, it } from 'vitest';
import { assertion, candidate, FrontendDecoder } from './freshTargetBindingProtocolFixtures.js';

const target = () => ({ systemIdentifier: '7700077241095849956', databaseOid: 16384, database: 'lumi_protocol_unit', login: 'lumi_backend_migrator' });
const startup = Buffer.from([0, 0, 0, 8, 0, 3, 0, 0]);
const frame = text => { const body = Buffer.from(text + '\0'); const out = Buffer.alloc(5 + body.length); out[0] = 81; out.writeUInt32BE(body.length + 4, 1); body.copy(out, 5); return out; };

describe('03B-9A test-only protocol boundary', () => {
  it('submits assertion and payload as one Query request', async () => {
    const calls = [], sql = { unsafe(text) { calls.push(text); return { simple: async () => [] }; } };
    await candidate(sql, target()).write('CREATE TABLE public.protocol_payload(id int);');
    expect(calls).toHaveLength(1); expect(calls[0]).toContain('LUMI_BINDING_ASSERTION');
    expect(calls[0]).toContain('CREATE TABLE public.protocol_payload');
  });
  it('reassembles byte-fragmented and coalesced messages without inventing Q boundaries', () => {
    const messages = [], decoder = new FrontendDecoder(m => messages.push(m));
    const a = frame('SELECT 1; SELECT 2;'), b = frame('SELECT 3;'), stream = Buffer.concat([startup, a, b]);
    for (const byte of stream) decoder.push(Buffer.from([byte]));
    expect(messages.map(m => m.type)).toEqual(['startup', 'Q', 'Q']);
    expect(messages[1].frame).toEqual(a); expect(messages[1].sql).toBe('SELECT 1; SELECT 2;');
    expect(messages[2].frame).toEqual(b);
  });
  it('rejects malformed lengths and missing Query terminators', () => {
    expect(() => new FrontendDecoder(() => {}).push(Buffer.from([0, 0, 0, 0]))).toThrow('INVALID_PROTOCOL_LENGTH');
    const decoder = new FrontendDecoder(() => {}); decoder.push(startup);
    const bad = frame('SELECT 1'); bad[bad.length - 1] = 1;
    expect(() => decoder.push(bad)).toThrow('UNTERMINATED_QUERY');
  });
  for (const [name, value] of [['NULL system', { systemIdentifier: null }], ['NULL OID', { databaseOid: null }],
    ['zero OID', { databaseOid: 0 }], ['unsafe database', { database: "lumi_protocol_x'; SELECT 1; --" }], ['unsafe role', { login: "x'" }]]) {
    it(`refuses ${name} before SQL generation`, () => expect(() => assertion({ ...target(), ...value })).toThrow('UNQUALIFIED_TEST_TARGET'));
  }
  it('rejects proxies/accessors without executing claimant code', () => {
    expect(() => assertion(new Proxy(target(), {}))).toThrow('UNQUALIFIED_TEST_TARGET');
    const t = target(); Object.defineProperty(t, 'database', { get() { throw Error('CALLER_RAN'); } });
    expect(() => assertion(t)).toThrow('UNQUALIFIED_TEST_TARGET');
  });
  it('captures validated identity, preserves payload and poisons a failed lease', async () => {
    const claim = target(), calls = [], sql = { unsafe(text) { calls.push(text); return { simple: async () => { throw Error('CONNECTION_LOST'); } }; } };
    const lease = candidate(sql, claim); claim.systemIdentifier = '7700077254738810288';
    await expect(lease.write('SELECT 1;')).rejects.toThrow('CONNECTION_LOST');
    await expect(lease.write('SELECT 2;')).rejects.toThrow('TEST_LEASE_TERMINAL');
    expect(calls).toHaveLength(1); expect(calls[0]).toContain('7700077241095849956'); expect(calls[0]).not.toContain(claim.systemIdentifier);
  });
  it('does not accept an empty payload or embedded protocol terminator', async () => {
    const lease = candidate({}, target());
    await expect(lease.write('')).rejects.toThrow('UNQUALIFIED_TEST_PAYLOAD');
    await expect(lease.write('SELECT 1;\0SELECT 2;')).rejects.toThrow('UNQUALIFIED_TEST_PAYLOAD');
  });
});
