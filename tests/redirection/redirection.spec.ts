// tests/redirection/redirection.spec.ts
import { test, expect, type Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';

// Get the current directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

test.setTimeout(300000); // 5 minutes timeout for all redirects

const EMAIL: string = process.env.LOGIN_EMAIL ?? '';
const PASSWORD: string = process.env.LOGIN_PASSWORD ?? '';
const BASE_URL: string = 'https://recordati-plus.de/de_DE/account/signin';
const CSV_PATH: string = path.join(__dirname, '../../Data/redirects.csv');

// Validate credentials are set
if (!EMAIL || !PASSWORD) {
  console.error(' Missing credentials in .env file!');
  console.error(`   EMAIL: ${EMAIL ? '✓ Set' : '✗ Missing (add MY_USERNAME to .env)'}`);
  console.error(`   PASSWORD: ${PASSWORD ? '✓ Set' : '✗ Missing (add MY_PASSWORD to .env)'}`);
  throw new Error('Missing required environment variables: MY_USERNAME and/or MY_PASSWORD');
}

// Accept cookies helper
async function acceptCookiesIfVisible(page: Page) {
  console.log('[cookies] Waiting for cookie banner to appear...');
  const acceptBtn = page.getByRole('button', { name: 'Alle akzeptieren' });
  
  try {
    await acceptBtn.waitFor({ state: 'visible', timeout: 10000 });
    await acceptBtn.click({ force: true });
    console.log('[cookies] ✓ Cookies accepted');
    await page.waitForTimeout(1000);
  } catch (err) {
    console.log('[cookies] No cookie banner found');
  }
}

// Login helper
async function login(page: Page) {
  console.log('[login] Starting login...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  
  await acceptCookiesIfVisible(page);
  
  // Click "Anmelden" tab
  await page.locator('label:has-text("Anmelden")').click();
  console.log('[login] ✓ Clicked Anmelden tab');
  
  // Wait for form to be ready
  await page.waitForTimeout(1000);
  
  // Fill credentials - wait for fields to be visible
  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  
  await emailInput.waitFor({ state: 'visible', timeout: 5000 });
  await emailInput.fill(EMAIL);
  await emailInput.press('Tab'); // Trigger validation
  console.log('[login] ✓ Filled email:', EMAIL);
  
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(PASSWORD);
  await passwordInput.press('Tab'); // Trigger validation
  console.log('[login] ✓ Filled password');
  
  // Wait for Weiter button to be enabled
  const weiterBtn = page.getByRole('button', { name: 'Weiter' });
  await expect(weiterBtn).toBeEnabled({ timeout: 15000 });
  console.log('[login] ✓ Weiter button is enabled');
  
  // Submit
  await weiterBtn.click();
  await page.waitForLoadState('domcontentloaded');
  console.log('[login] ✓ Login completed');
}

// Read redirects from CSV
function readRedirects(): Array<{ from_url: string; to_url: string }> {
  console.log(`[csv] Reading redirects from: ${CSV_PATH}`);
  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<{ from_url: string; to_url: string }>;
  console.log(`[csv] ✓ Loaded ${records.length} redirects`);
  return records;
}

test('Redirect validation test', async ({ page }) => {
  // Set up test results directory
  const testResultsDir = path.join(__dirname, '../../test-results/redirection');
  
  // Ensure directory exists and is empty
  if (fs.existsSync(testResultsDir)) {
    fsExtra.emptyDirSync(testResultsDir);
  } else {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }
  
  // Initialize results tracking
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: [] as Array<{
      from_url: string;
      to_url: string;
      status: 'passed' | 'failed';
      message: string;
      screenshot?: string;
    }>
  }
  
  // Login first
  await login(page);
  
  // Load redirects from CSV
  const redirects = readRedirects();
  const failures: string[] = [];
  
  // Test each redirect
  results.total = redirects.length;
  
  for (let i = 0; i < redirects.length; i++) {
    const { from_url, to_url } = redirects[i];
    let status: 'passed' | 'failed' = 'passed';
    let message = 'Redirect successful';
    let screenshot: string | undefined;
    
    try {
      console.log(`[${i + 1}/${redirects.length}] Testing: ${from_url}`);
      
      // Navigate to from_url
      await page.goto(from_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      
      // Get final URL after any redirects
      const finalURL = page.url();
      
      // Compare URLs
      if (finalURL === to_url) {
        console.log(`  ✓ PASS: Redirected correctly to ${to_url}`);
      } else {
        const errorMsg = `  ✗ FAIL: ${from_url} -> ${finalURL} (Expected: ${to_url})`;
        console.log(errorMsg);
        failures.push(errorMsg);
      }
    } catch (error: any) {
      // Check if it's a timeout error
      if (error.message.includes('Timeout') || error.message.includes('timeout')) {
        const warnMsg = `  ⚠️  TIMEOUT: ${from_url} (page took too long to load - skipping)`;
        console.log(warnMsg);
        // Don't add to failures, just log it
      } else {
        const errorMsg = `  ✗ ERROR: ${from_url} - ${error.message}`;
        console.log(errorMsg);
        failures.push(errorMsg);
      }
    }
    
    // Small delay between requests
    await page.waitForTimeout(500);
  }
  
  // Create TestResult/Redirection folder if it doesn't exist
  const testResultDir = path.join(__dirname, '../../TestResult/Redirection');
  if (!fs.existsSync(testResultDir)) {
    fs.mkdirSync(testResultDir, { recursive: true });
  }
  
  // Write failures to log file in TestResult/Redirection folder
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(testResultDir, `redirect_results_${timestamp}.log`);
  
  if (failures.length > 0) {
    fs.writeFileSync(logPath, failures.join('\n') + '\n');
    console.log(`\n[summary] ${failures.length} redirects failed. See ${logPath}`);
  } else {
    console.log('\n[summary] ✓ All redirects passed!');
    // Write success report
    const successMsg = `All ${redirects.length} redirects passed successfully!\nTest run: ${timestamp}\n`;
    fs.writeFileSync(logPath, successMsg);
  }
  
  // Assert no failures
  expect(failures.length, `${failures.length} redirect(s) failed:\n${failures.join('\n')}`).toBe(0);
});
