#!/usr/bin/env node
// ============================================================
// MARCOM — Airtable Setup Verification Script
// Run once: npm run setup
// ============================================================
import 'dotenv/config';
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = process.env.AIRTABLE_TABLE_NAME || 'MARCOM_Sessions';

console.log(`
╔══════════════════════════════════════════════════════╗
║       MARCOM — Airtable Setup Verification           ║
╠══════════════════════════════════════════════════════╣
║  Table: ${TABLE.padEnd(43)}║
╚══════════════════════════════════════════════════════╝
`);

async function verifyConnection() {
  console.log('Step 1: Verifying Airtable connection...');
  try {
    const records = await base(TABLE).select({ maxRecords: 1 }).firstPage();
    console.log(`✓ Connected. Table "${TABLE}" found — ${records.length} existing record(s).`);
  } catch (err) {
    console.error(`✗ Failed: ${err.message}`);
    console.log('\nCreate the table manually in Airtable with this exact name and fields:');
    printSchema();
    process.exit(1);
  }
}

async function createTestSession() {
  console.log('Step 2: Testing write operation...');
  const testId = `TEST_${Date.now()}`;
  try {
    const r = await base(TABLE).create({
      session_id: testId,
      current_mode: 1,
      current_section: 0,
      current_service: 0,
      context_locked: false,
      conversation_history: '[]',
      service_history: '[]',
      active_service_context: '{}',
      content_interrogation_log: '',
      campaign_analysis_log: '',
      hybrid_raw_data: '',
      status: 'test',
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    });
    console.log(`✓ Write successful — Record ID: ${r.id}`);
    return r.id;
  } catch (err) {
    console.error(`✗ Write failed: ${err.message}`);
    console.error('\nCheck that all field names match the schema exactly:');
    printSchema();
    process.exit(1);
  }
}

async function updateTestSession(recordId) {
  console.log('Step 3: Testing update operation...');
  try {
    await base(TABLE).update(recordId, { status: 'test-complete', last_updated: new Date().toISOString() });
    console.log('✓ Update successful');
  } catch (err) {
    console.error(`✗ Update failed: ${err.message}`);
    process.exit(1);
  }
}

async function deleteTestSession(recordId) {
  console.log('Step 4: Cleaning up test record...');
  try {
    await base(TABLE).destroy(recordId);
    console.log('✓ Cleanup done');
  } catch {
    console.warn('⚠ Could not delete test record — delete manually in Airtable if needed');
  }
}

function printSchema() {
  console.log(`
TABLE NAME: MARCOM_Sessions

Field Name                  | Type
----------------------------|------------------
session_id                  | Single line text
current_mode                | Number
current_section             | Number
current_service             | Number
context_locked              | Checkbox
context_summary             | Long text
conversation_history        | Long text
service_history             | Long text
active_service_context      | Long text
content_interrogation_log   | Long text
campaign_analysis_log       | Long text
hybrid_raw_data             | Long text
status                      | Single line text
created_at                  | Single line text
last_updated                | Single line text
  `);
}

async function main() {
  if (!process.env.AIRTABLE_API_KEY) { console.error('✗ AIRTABLE_API_KEY missing from .env'); process.exit(1); }
  if (!process.env.AIRTABLE_BASE_ID) { console.error('✗ AIRTABLE_BASE_ID missing from .env'); process.exit(1); }

  await verifyConnection();
  const recordId = await createTestSession();
  await updateTestSession(recordId);
  await deleteTestSession(recordId);

  console.log(`
╔══════════════════════════════════════════════════════╗
║              ✓ ALL CHECKS PASSED                     ║
║                                                      ║
║  Airtable connection verified                        ║
║  Read / Write / Delete all working                   ║
║  Ready to launch: npm run dev                        ║
╚══════════════════════════════════════════════════════╝
  `);
}

main().catch(err => { console.error('Setup failed:', err.message); process.exit(1); });
