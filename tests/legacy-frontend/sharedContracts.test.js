import { describe, it, expect } from 'vitest';
import * as legacyAgenda from '../../client/src/contracts/schemas/agenda.schema';
import * as sharedAgenda from '../../packages/api-contracts/schemas/agenda.schema';
import * as legacyPattern from '../../client/src/contracts/schemas/accountPattern.schema';
import * as sharedPattern from '../../packages/api-contracts/schemas/accountPattern.schema';
import * as legacyAggregate from '../../client/src/contracts/schemas/accountAggregate.schema';
import * as sharedAggregate from '../../packages/api-contracts/schemas/accountAggregate.schema';
import * as legacyConnector from '../../client/src/contracts/schemas/connectorCampaigns.schema';
import * as sharedConnector from '../../packages/api-contracts/schemas/connectorCampaigns.schema';
import * as legacyNetwork from '../../client/src/contracts/schemas/networkInsight.schema';
import * as sharedNetwork from '../../packages/api-contracts/schemas/networkInsight.schema';
import * as legacyErrors from '../../client/src/contracts/errors/index';
import * as sharedErrors from '../../packages/api-contracts/errors/index';

describe('legacy compatibility entries preserve shared contract identity', () => {
  it.each([
    ['agenda', legacyAgenda, sharedAgenda],
    ['pattern', legacyPattern, sharedPattern],
    ['aggregate', legacyAggregate, sharedAggregate],
    ['connector', legacyConnector, sharedConnector],
    ['network', legacyNetwork, sharedNetwork],
    ['errors', legacyErrors, sharedErrors],
  ])('%s exports the same schemas, classes and policies', (_name, legacy, shared) => {
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(shared).sort());
    for (const key of Object.keys(shared)) expect(legacy[key]).toBe(shared[key]);
  });
});
