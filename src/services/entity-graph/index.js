export { getConnectorCampaigns, getCanonicalVerdictCampaigns, getCampaignAdSets, getAdSetAds, MAX_ADS_PER_ADSET } from './EntityGraphService.js';
// The failure identity of the campaign-identity read, exported beside the
// readers that raise it: a consumer that can reach the population through this
// barrel can identify its unavailability through it too. An empty population is
// a value; this is a different KIND of thing, which is what stops the two from
// collapsing back together.
export { CampaignIdentityUnavailableError, CAMPAIGN_IDENTITY_READ_FAILED } from './EntityGraphService.js';
export { latestByEntity, toCampaignRow, toAdSetRow, toAdRow } from './entityGraphEngine.js';
