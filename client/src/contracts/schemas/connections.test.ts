import { describe, expect, it } from 'vitest';
import { ConnectionsResponseSchema } from './connections.schema';

const base = { platform: 'META', connected: true, isActive: true, stale: false };
describe('P7-05B additive freshness authority', () => {
  it.each(['lastSuccessfulSync', 'availabilityKnowledge', 'completenessKnowledge', 'readinessKnowledge'])('%s survives exactly', (field) => {
    const input = { workspaceId: 'ws', connections: [{ ...base, [field]: 'FUTURE_VALUE' }] };
    const snapshot = structuredClone(input);
    expect(ConnectionsResponseSchema.parse(input).connections[0][field]).toBe('FUTURE_VALUE');
    expect(input).toEqual(snapshot);
  });
  it('capability lastRunKnowledge survives exactly', () => {
    const capability = { capability: 'FUTURE_CAPABILITY', implemented: false, lastRun: 'FUTURE_RUN', lastRunKnowledge: 'FUTURE_KNOWLEDGE' };
    expect(ConnectionsResponseSchema.parse({ connections: [{ ...base, capabilities: [capability] }] }).connections[0].capabilities[0]).toEqual(capability);
  });
  it('missing additive fields remain absent, never defaulted', () => {
    expect(ConnectionsResponseSchema.parse({ connections: [base] }).connections[0]).toEqual(base);
  });
  it('explicit nulls and all published knowledge values survive', () => {
    const input = { connections: [{ ...base, lastSuccessfulSync: null, availabilityKnowledge: 'COULD_NOT_LOOK',
      completenessKnowledge: null, readinessKnowledge: 'NOTHING_THERE',
      capabilities: [{ capability: 'EXECUTION', implemented: false, lastRun: 'NOT_APPLICABLE', lastRunKnowledge: 'CANNOT_ASK' }] }] };
    expect(ConnectionsResponseSchema.parse(input)).toEqual(input);
  });
});
