// ============================================================
// Test Script for Paid Decision Engine API
// ============================================================
import { logger } from '../src/utils/logger.js';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';

// Sample CSV content for testing
const SAMPLE_CSV = `campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,conversions,cpa,roas,frequency
123,Summer Sale,1000,50000,2500,0.05,0.4,120,8.33,3.2,4.5
456,Winter Promo,800,30000,900,0.03,0.89,45,17.78,1.1,7.2`;

async function testHealthCheck() {
  console.log('\n📋 Testing Health Check...');
  try {
    const res = await fetch(`${BASE_URL}/api/v1/paid/health`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const data = await res.json();
    console.log('✅ Health Check:', JSON.stringify(data, null, 2));
    return data.status === 'healthy';
  } catch (error) {
    console.error('❌ Health Check Failed:', error.message);
    return false;
  }
}

async function testRadar() {
  console.log('\n🔴 Testing Radar Endpoint...');
  try {
    const res = await fetch(`${BASE_URL}/api/v1/paid/radar`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const data = await res.json();
    console.log('✅ Radar Alerts:', JSON.stringify(data, null, 2));
    return data.success && Array.isArray(data.alerts);
  } catch (error) {
    console.error('❌ Radar Failed:', error.message);
    return false;
  }
}

async function testAnalyzeJSON() {
  console.log('\n📊 Testing Analyze (JSON)...');
  try {
    const res = await fetch(`${BASE_URL}/api/v1/paid/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaigns: [
          {
            campaign_id: '123',
            campaign_name: 'Test Campaign',
            spend: 1000,
            impressions: 50000,
            clicks: 2500,
            ctr: 0.05,
            cpc: 0.4,
            conversions: 120,
            cpa: 8.33,
            roas: 3.2,
            frequency: 4.5,
          },
        ],
      }),
    });
    const data = await res.json();
    console.log('✅ Analysis Result:', JSON.stringify(data, null, 2));
    return data.success && data.verdict;
  } catch (error) {
    console.error('❌ Analysis Failed:', error.message);
    return false;
  }
}

async function testAnalyzeCSV() {
  console.log('\n📄 Testing Analyze (CSV)...');
  try {
    const formData = new FormData();
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    formData.append('file', blob, 'test.csv');

    const res = await fetch(`${BASE_URL}/api/v1/paid/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: formData,
    });
    const data = await res.json();
    console.log('✅ CSV Analysis:', JSON.stringify(data, null, 2));
    return data.success && data.verdict;
  } catch (error) {
    console.error('❌ CSV Analysis Failed:', error.message);
    return false;
  }
}

async function testExecute() {
  console.log('\n⚡ Testing Execute Endpoint...');
  console.log('⚠️  Skipping actual execution (would pause real campaign)');
  console.log('💡 To test: curl -X POST with valid campaign_id');
  return true;
}

async function runTests() {
  console.log('🚀 Starting Paid Decision Engine API Tests...');
  console.log(`📍 Base URL: ${BASE_URL}`);

  if (!AUTH_TOKEN) {
    console.warn('⚠️  No AUTH_TOKEN provided. Tests may fail if auth is required.');
    console.log('💡 Set TEST_AUTH_TOKEN environment variable');
  }

  const results = {
    health: await testHealthCheck(),
    radar: await testRadar(),
    analyzeJSON: await testAnalyzeJSON(),
    analyzeCSV: await testAnalyzeCSV(),
    execute: await testExecute(),
  };

  console.log('\n═══════════════════════════════════════');
  console.log('📊 Test Results:');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`  ${passed ? '✅' : '❌'} ${test}`);
  });
  console.log('═══════════════════════════════════════\n');

  const allPassed = Object.values(results).every(r => r);
  process.exit(allPassed ? 0 : 1);
}

runTests();
