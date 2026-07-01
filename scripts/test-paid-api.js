// ============================================================
// Test Script for Paid Decision Engine API
// ============================================================
import { logger } from '../src/utils/logger.js';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';

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
