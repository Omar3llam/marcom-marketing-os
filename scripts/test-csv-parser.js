// ============================================================
// MARCOM / Lumi — CSV Parser Validation Test
// ============================================================
// Tests the hardened CSV parser with multi-currency data.
// Run: node scripts/test-csv-parser.js
// ============================================================
import { parseMetaAdsCsv } from '../src/services/metaAdsParser.js';

// ── Test Case 1: EGP Currency ──────────────────────────────
const testEGP = `Campaign name,Ad set name,Amount spent (EGP),Impressions,Results,Frequency,Reach,Cost per result,Delivery status
Test Campaign A,AdSet 1,"1,234.56",10000,50,2.5,4000,"24.69",Active
Test Campaign B,AdSet 2,"5,432.10",25000,125,3.2,7800,"43.46",Active`;

// ── Test Case 2: USD Currency ──────────────────────────────
const testUSD = `Campaign name,Ad set name,Amount spent (USD),Impressions,Results,Frequency,Reach,Cost per result,Delivery status
Test Campaign A,AdSet 1,$1234.56,10000,50,2.5,4000,$24.69,Active
Test Campaign B,AdSet 2,"$5,432.10",25000,125,3.2,7800,$43.46,Active`;

// ── Test Case 3: Mixed Format with EU Decimals ────────────
const testMixed = `Campaign name,Ad set name,Amount spent (SAR),Impressions,Results,Frequency,Reach,Cost per result,Delivery status
Test Campaign A,AdSet 1,"SAR 1.234,56",10000,50,2.5,4000,"SAR 24,69",Active
Test Campaign B,AdSet 2,"SAR 5.432,10",25000,125,3.2,7800,"SAR 43,46",Active`;

// ── Test Case 4: Zero Spend (should trigger warning) ───────
// No spend column at all - parser should warn about $0 total
const testZeroSpend = `Campaign name,Ad set name,Random Data,Impressions,Results,Frequency,Reach,Another Column,Delivery status
Test Campaign A,AdSet 1,1234.56,10000,50,2.5,4000,24.69,Active
Test Campaign B,AdSet 2,5432.10,25000,125,3.2,7800,43.46,Active`;

// ═══════════════════════════════════════════════════════════
// Test Runner
// ═══════════════════════════════════════════════════════════

console.log('===================================================');
console.log('CSV Parser Hardening Validation');
console.log('===================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, csvText, expectedSpend, shouldWarn = false) {
  console.log(`\n[TEST] ${name}`);
  console.log('─'.repeat(50));

  try {
    const buffer = Buffer.from(csvText, 'utf8');
    const result = parseMetaAdsCsv(buffer);

    console.log(`✓ Parsed ${result.campaigns.length} campaigns`);
    console.log(`✓ Total spend: $${result.campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2)}`);

    if (result.errors) {
      console.log(`⚠ Errors/warnings:`, result.errors);
    }

    // Validate spend
    const totalSpend = result.campaigns.reduce((s, c) => s + c.spend, 0);
    const spendMatch = Math.abs(totalSpend - expectedSpend) < 0.01;

    if (shouldWarn && result.errors && result.errors.length > 0) {
      console.log('✓ WARNING TRIGGERED AS EXPECTED');
      passed++;
    } else if (!shouldWarn && spendMatch) {
      console.log('✓ SPEND PARSED CORRECTLY');
      passed++;
    } else {
      console.log(`✗ FAILED: Expected spend ${expectedSpend}, got ${totalSpend}`);
      failed++;
    }

    // Show sample campaign
    if (result.campaigns.length > 0) {
      const sample = result.campaigns[0];
      console.log('\nSample campaign:');
      console.log(`  Name: ${sample.campaignName}`);
      console.log(`  Spend: $${sample.spend}`);
      console.log(`  Impressions: ${sample.impressions}`);
      console.log(`  Results: ${sample.results}`);
      console.log(`  Cost per result: $${sample.costPerResult}`);
    }

  } catch (err) {
    console.log(`✗ EXCEPTION: ${err.message}`);
    failed++;
  }
}

// Run all test cases
runTest('EGP Currency Format', testEGP, 6666.66);
runTest('USD Currency Format', testUSD, 6666.66);
runTest('SAR Mixed Format (EU decimals)', testMixed, 6666.66);
runTest('Zero Spend Detection (should warn)', testZeroSpend, 0, true);

// Summary
console.log('\n===================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('===================================================');

if (failed === 0) {
  console.log('✓ All tests passed! CSV parser is production-ready.');
  process.exit(0);
} else {
  console.log('✗ Some tests failed. Review the output above.');
  process.exit(1);
}
