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
 *   - @anthropic-ai/sdk >= 0.91.0 (now installed)
 *
 * This script runs once and exits.
 * It does NOT modify any server files.
 * Save the Memory Store ID it outputs to your .env file as:
 *   ANTHROPIC_MEMORY_STORE_ID=<id>
 */

import { config } from 'dotenv';
config({ override: true });

import Anthropic from '@anthropic-ai/sdk';

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
  const client = new Anthropic({ apiKey: API_KEY });

  console.log('');
  console.log('Creating Anthropic Memory Store...');
  console.log('');

  let store;
  try {
    store = await client.beta.memoryStores.create({
      name: 'Lumi - User Memory Store',
      betas: ['managed-agents-2026-04-01'],
    });
  } catch (err) {
    console.error('');
    console.error('==========================================');
    console.error(' API ERROR');
    console.error('==========================================');
    const status = err.status ?? err.statusCode ?? 'unknown';
    console.error(`Status:  ${status}`);
    console.error('Message:', err.message);
    if (err.error) console.error('Body:   ', JSON.stringify(err.error, null, 2));
    console.error('==========================================');
    console.error('');
    if (status === 401) {
      console.error('  • Your ANTHROPIC_API_KEY is invalid or expired.');
    } else if (status === 403) {
      console.error('  • Your API key does not have access to Memory Stores (beta).');
      console.error('  • Ensure your Anthropic account has beta feature access enabled.');
    } else if (status === 429) {
      console.error('  • Rate limit hit — wait a moment and run again.');
    }
    console.error('');
    process.exit(1);
  }

  // ── Success ────────────────────────────────────────────────
  const storeId   = store.id;
  const createdAt = store.created_at ?? new Date().toISOString();

  console.log('==========================================');
  console.log(' MEMORY STORE CREATED SUCCESSFULLY');
  console.log('==========================================');
  console.log(`Name:       ${store.name}`);
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
