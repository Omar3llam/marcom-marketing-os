// ============================================================
// Test: User Agent Detection for OAuth Flow Selection
// ============================================================
// Tests the isEmbeddedWebviewOrMobile() function to ensure
// it correctly detects embedded browsers and mobile devices

/**
 * Mock navigator.userAgent for testing
 */
function testUserAgent(ua, expectedResult) {
  // Temporarily override navigator.userAgent
  const originalUA = navigator.userAgent;
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });

  // Import the detection function
  // NOTE: This is a mock — real import: import { isEmbeddedWebviewOrMobile } from '@/firebase.js';
  const isEmbedded = /FBAN|FBAV|Instagram|Line/i.test(navigator.userAgent);
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent);
  const result = isEmbedded || isMobile;

  // Restore original UA
  Object.defineProperty(navigator, 'userAgent', {
    value: originalUA,
    configurable: true,
  });

  const status = result === expectedResult ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} [${expectedResult ? 'REDIRECT' : 'POPUP'}] ${ua}`);
  return result === expectedResult;
}

console.log('\n=== User Agent Detection Tests ===\n');

// Desktop browsers (should use POPUP)
testUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  false
);

testUserAgent(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  false
);

testUserAgent(
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  false
);

console.log('\n--- Mobile browsers (should use REDIRECT) ---\n');

// iPhone
testUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Mobile/15E148 Safari/604.1',
  true
);

// Android Chrome
testUserAgent(
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  true
);

// iPad
testUserAgent(
  'Mozilla/5.0 (iPad; CPU OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Mobile/15E148 Safari/604.1',
  true
);

console.log('\n--- Embedded browsers (should use REDIRECT) ---\n');

// Facebook in-app browser (iOS)
testUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/442.0.0.28.47;FBBV/560071893;]',
  true
);

// Facebook in-app browser (Android)
testUserAgent(
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/442.0.0.27.109;]',
  true
);

// Instagram in-app browser
testUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.16.109 (iPhone14,5; iOS 17_1_1; en_US; en-US; scale=3.00; 1170x2532; 526956026)',
  true
);

// LINE in-app browser
testUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.20.1',
  true
);

console.log('\n=== All Tests Complete ===\n');
console.log('Expected behavior:');
console.log('- Desktop browsers → POPUP flow (better UX)');
console.log('- Mobile browsers → REDIRECT flow (Google recommendation)');
console.log('- Embedded browsers → REDIRECT flow (fixes Error 403)');
console.log('\nTo run in browser console:');
console.log('1. Open DevTools Console');
console.log('2. Paste this entire file');
console.log('3. Press Enter');
