// ============================================================
// MARCOM — URL Scraper with SSRF Protection
// ============================================================
import dns from 'dns/promises';
import { sanitizeUrl } from './sanitize.js';
import { logger } from './logger.js';

// Private / internal IP ranges (CIDR-style prefix check)
const BLOCKED_PREFIXES = [
  '10.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',
  '127.',
  '0.',
  '169.254.',   // link-local / AWS metadata
  '::1',
  'fc00::', 'fd',  // IPv6 ULA
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',   // AWS / GCP / Azure IMDS
  '100.100.100.200',   // Alibaba IMDS
];

async function isPrivateIp(hostname) {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) return true;

  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    return BLOCKED_PREFIXES.some(prefix => address.startsWith(prefix));
  } catch {
    // Can't resolve — treat as unsafe
    return true;
  }
}

export async function fetchUrlContent(rawUrl) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error('SCRAPINGBEE_API_KEY not configured.');

  // Sanitize & validate protocol
  const url = sanitizeUrl(rawUrl);
  const parsed = new URL(url);

  // SSRF guard: resolve hostname before sending to ScrapingBee
  if (await isPrivateIp(parsed.hostname)) {
    logger.warn({ hostname: parsed.hostname }, 'SSRF attempt blocked');
    throw new Error('URL resolves to a disallowed internal address.');
  }

  const endpoint = new URL('https://app.scrapingbee.com/api/v1/');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('render_js', 'false');
  endpoint.searchParams.set('extract_rules', JSON.stringify({ text: 'body' }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(endpoint.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ScrapingBee returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    const rawText = data.text || data.body || '';
    return rawText.replace(/\s+/g, ' ').trim().slice(0, 8_000) || 'No content extracted.';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('URL fetch timed out after 30 seconds.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
