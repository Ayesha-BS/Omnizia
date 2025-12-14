// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  // Run tests one at a time to ensure clean state
  fullyParallel: false,
  // Continue running tests even if some fail
  maxFailures: 0,

  // Consolidated output directories
  outputDir: 'test-results',
  snapshotDir: 'test-results/snapshots',
  reporter: [
    ['html', { outputFolder: 'playwright-reports/html-report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/test-results.json' }],
    ['./utils/pdf-reporter.ts', {}]
  ],

  use: {
    testIdAttribute: 'data-testid',
    baseURL: 'http://localhost:3000', // Update this with your base URL
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Timeout for each test
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },

  // Run tests one at a time
  workers: 1,
  
  // Don't retry failed tests - fail fast and move to next test
  retries: 0,

  // Report slow tests
  reportSlowTests: {
    max: 5,
    threshold: 30000,
  },
});
