#!/usr/bin/env node
/*
 * HOW TO RUN THIS SCRIPT
 * ----------------------
 * From your project root, run:
 *   node scripts/create-memory.js
 *
 * Or via npm:
 *   npm run create-memory
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY must be set in .env (or already in environment)
 *   - Node.js 18+ (native fetch is used — no extra install needed)
 *
 * This script runs once and exits.
 * It does NOT modify any server files.
 * Save the Memory Store ID it outputs to your .env file as:
 *   ANTHROPIC_MEMORY_STORE_ID=<id>
 */

// ============================================================
// SDK check: @anthropic-ai/sdk ^0.30.0 does NOT expose a
// memory-stores namespace. Using the raw REST API directly.
// Once the SDK ships native support, replace this fetch call with:
//   await client.beta.memoryStores.create({ name, description })
// Upgrade command: npm install @anthropic-ai/sdk@latest
//
// Endpoint note: POST https://api.anthropic.com/v1/beta/memory-stores
// If this returns 400 / 404, verify the exact endpoint and beta header
// version string at: https://docs.anthropic.com/en/docs/memory-stores
// ============================================================

import 'dotenv/config';

const SDK_VERSION          = '0.30.0';
const MEMORY_STORE_ENDPOINT = 'https://api.anthropic.com/v1/beta/memory-stores';
const ANTHROPIC_VERSION    = '2023-06-01';
// Verify this beta header value at https://docs.anthropic.com if you get a 400/404
const BETA_HEADER          = 'memory-stores-2025-11-05';

// ── API key check ────────────────────────────────────────────
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('');
  console.error('ERROR: ANTHROPIC_API_KEY not found in environment.');
  console.error('Add it to your .env file and try again.');
  console.error('  Example: ANTHROPIC_API_KEY=sk-ant-...');
  console.error('');
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────
async function createMemoryStore() {
  const body = {
    name:        'Lumi - User Memory Store',
    description: 'Persistent memory store for Lumi AI — MARCOM AI platform',
    metadata: {
      project:    'marcom-ai',
      created_by: 'setup-script',
    },
  };

  console.log('');
  console.log('Creating Anthropic Memory Store...');
  console.log('Endpoint:', MEMORY_STORE_ENDPOINT);
  console.log('');

  let res;
  try {
    res = await fetch(MEMORY_STORE_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta':  BETA_HEADER,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    console.error('');
    console.error('NETWORK ERROR — could not reach Anthropic API:');
    console.error(networkErr.message);
    console.error('');
    process.exit(1);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`API returned non-JSON response (status ${res.status}).`);
    process.exit(1);
  }

  // ── Error handling ─────────────────────────────────────────
  if (!res.ok) {
    console.error('');
    console.error('==========================================');
    console.error(' API ERROR');
    console.error('==========================================');
    console.error(`Status:  ${res.status} ${res.statusText}`);
    console.error('Body:   ', JSON.stringify(data, null, 2));
    console.error('==========================================');
    console.error('');
    console.error('Likely causes:');
    if (res.status === 401) {
      console.error('  • Your ANTHROPIC_API_KEY is invalid or expired.');
    } else if (res.status === 403) {
      console.error('  • Your API key does not have access to Memory Stores (beta).');
      console.error('  • Ensure your Anthropic account has beta feature access enabled.');
    } else if (res.status === 404) {
      console.error('  • Memory Stores endpoint not found.');
      console.error(`  • The beta header "${BETA_HEADER}" may be outdated.`);
      console.error('  • Verify at: https://docs.anthropic.com/en/docs/memory-stores');
    } else if (res.status === 400) {
      console.error('  • Request body was rejected — the API schema may have changed.');
      console.error('  • Check the "description" or "metadata" fields are supported.');
      console.error(`  • The beta header "${BETA_HEADER}" may need updating.`);
    } else if (res.status === 429) {
      console.error('  • Rate limit hit — wait a moment and run again.');
    }
    console.error('');
    console.error(`  • SDK version too old (current: ${SDK_VERSION})`);
    console.error('    Try: npm install @anthropic-ai/sdk@latest');
    console.error('');
    process.exit(1);
  }

  // ── Success ────────────────────────────────────────────────
  const storeId   = data.id          ?? data.store_id  ?? '(check API response above)';
  const createdAt = data.created_at  ?? data.createdAt ?? new Date().toISOString();

  console.log('==========================================');
  console.log(' MEMORY STORE CREATED SUCCESSFULLY');
  console.log('==========================================');
  console.log(`Name:       ${data.name ?? body.name}`);
  console.log(`Store ID:   ${storeId}`);
  console.log(`Created At: ${createdAt}`);
  console.log('==========================================');
  console.log('NEXT STEP:');
  console.log('Copy the Store ID above and add it to your .env file:');
  console.log(`ANTHROPIC_MEMORY_STORE_ID=${storeId}`);
  console.log('==========================================');
  console.log('');
}

createMemoryStore();
