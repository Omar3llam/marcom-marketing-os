// ============================================================
// CsvConnector — CSV upload behind the ChannelConnector contract
// ============================================================
// Not credentialed/cron-driven: it ingests an uploaded CSV (the existing
// csvParser output) rather than pulling from a platform. fetchRaw is a
// passthrough of the parsed rows it is handed; normalize maps them via the pure
// csvNormalize. `ingestCsv` is the helper an upload route calls to land snapshots.
// ============================================================
import { logger } from '../../utils/logger.js';
import { ChannelConnector, assertNormalized } from './ChannelConnector.js';
import { csvNormalize } from './normalize/csvNormalize.js';
import { landSnapshots } from './snapshotSink.js';
import { CHANNEL } from './connectorTypes.js';

export class CsvConnector extends ChannelConnector {
  channel = CHANNEL.META; // CSV has no native channel — treated as META, as today

  async authenticate() {
    return { ok: true }; // uploaded data needs no platform auth
  }

  async fetchRaw(parsedRows = []) {
    return parsedRows; // passthrough of csvParser output
  }

  normalize({ accountExternalId, accountName, currency = 'USD', date = new Date(), channel = CHANNEL.META, rows = [] }) {
    const out = csvNormalize({ accountExternalId, accountName, currency, date, channel, rows });
    return assertNormalized(out);
  }
}

export const csvConnector = new CsvConnector();

/**
 * Land an uploaded CSV as snapshots for a workspace. The thin seam an upload
 * route calls (the connector stays dumb; the sink owns persistence).
 */
export async function ingestCsv(workspaceId, parsedRows, { accountExternalId, accountName, currency, date } = {}) {
  const acct = accountExternalId || `csv:${workspaceId}`;
  const normalized = csvConnector.normalize({ accountExternalId: acct, accountName, currency, date, rows: parsedRows });
  const result = await landSnapshots(workspaceId, csvConnector.channel, normalized);
  logger.info({ workspaceId, ...result }, '[CsvConnector] ingested CSV');
  return result;
}
