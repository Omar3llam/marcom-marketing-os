module.exports = {
  testDir: './tests/e2e',
  testMatch: '**/*.cjs',
  timeout: 15000,
  use: {
    baseURL: 'http://localhost:10000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: '/tmp/pw-results.json' }]],
};
