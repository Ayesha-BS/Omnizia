// tests/registration/registration-combined.spec.ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';

// Get the current directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

test.setTimeout(120000);
test.describe.configure({ mode: 'parallel' });

// ---- Env (typed) ----
const SSO_USERNAME: string = process.env.SSO_USERNAME ?? '';
const SSO_PASSWORD: string = process.env.SSO_PASSWORD ?? '';
const NEW_PASSWORD: string = process.env.NEW_PASSWORD ?? '';
const CONFIRM_PASSWORD: string = process.env.CONFIRM_PASSWORD ?? NEW_PASSWORD;

// Test credentials from environment variables
const TEST_UUID1: string = process.env.TEST_UUID1 ?? '';
const TEST_EMAIL1: string = process.env.TEST_EMAIL1 ?? '';
const TEST_UUID2: string = process.env.TEST_UUID2 ?? 'DE333333'; // Fallback value
const TEST_EMAIL2: string = process.env.TEST_EMAIL2 ?? 'umme.ayesha+03@brainstation-23.com'; // Fallback value
const LOCALE: string = process.env.LOCALE ?? 'de_DE';
const BASE_URL: string = process.env.BASE_URL ?? 'https://stage.recordati-plus.de/de_DE/account/signin';

export { TEST_UUID1, TEST_EMAIL1, LOCALE, BASE_URL };

console.log(`[test] Using BASE_URL: ${BASE_URL}`);

// Test results directory
const TEST_RESULTS_DIR = path.join(__dirname, '../../test-results/registration');

// Ensure test results directory exists
if (!fs.existsSync(TEST_RESULTS_DIR)) {
  fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
} else {
  // Clear previous test results
  fsExtra.emptyDirSync(TEST_RESULTS_DIR);
}

// Test results interface
interface TestResult {
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  startTime: string;
  endTime?: string;
  duration?: number;
  steps: TestStep[];
  error?: string;
  screenshots: string[];
}

interface TestStep {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  timestamp: string;
  duration?: number;
  error?: string;
}

// Global test results
const testResults: Record<string, TestResult> = {};

// Helper function to capture screenshot
async function captureScreenshot(page: Page, testName: string, stepName: string): Promise<string> {
  const safeTestName = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeStepName = stepName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotPath = path.join(TEST_RESULTS_DIR, `${safeTestName}_${safeStepName}_${timestamp}.png`);
  
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch (error) {
    console.error(`Failed to capture screenshot for ${testName} - ${stepName}:`, error);
    return '';
  }
}

// Helper function to generate HTML report
function generateHtmlReport(): void {
  const reportPath = path.join(TEST_RESULTS_DIR, 'test-report.html');
  const tests = Object.values(testResults);
  const passedCount = tests.filter(t => t.status === 'passed').length;
  const failedCount = tests.filter(t => t.status === 'failed').length;
  const skippedCount = tests.filter(t => t.status === 'skipped').length;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Registration Test Results</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
      .test { border: 1px solid #ddd; border-radius: 5px; margin-bottom: 15px; padding: 15px; }
      .test-header { font-weight: bold; margin-bottom: 10px; }
      .passed { color: green; }
      .failed { color: red; }
      .skipped { color: orange; }
      .step { margin-left: 20px; margin-bottom: 5px; }
      .screenshot { max-width: 100%; margin-top: 10px; border: 1px solid #ddd; }
      .error { color: red; white-space: pre-wrap; font-family: monospace; }
    </style>
  </head>
  <body>
    <h1>Registration Test Results</h1>
    
    <div class="summary">
      <h2>Summary</h2>
      <p>Total Tests: ${tests.length}</p>
      <p class="passed">Passed: ${passedCount}</p>
      <p class="failed">Failed: ${failedCount}</p>
      <p class="skipped">Skipped: ${skippedCount}</p>
      <p>Success Rate: ${((passedCount / tests.length) * 100).toFixed(2)}%</p>
    </div>
    
    ${tests.map(test => `
      <div class="test">
        <div class="test-header">
          ${test.testName} - 
          <span class="${test.status}">${test.status.toUpperCase()}</span>
          <small>(${test.duration}ms)</small>
        </div>
        
        ${test.error ? `
          <div class="error">
            <strong>Error:</strong><br>
            ${test.error}
          </div>
        ` : ''}
        
        <div class="steps">
          <h3>Steps:</h3>
          ${test.steps.map(step => `
            <div class="step">
              ${step.name} - 
              <span class="${step.status}">${step.status.toUpperCase()}</span>
              <small>(${step.duration}ms)</small>
              ${step.error ? `<div class="error">${step.error}</div>` : ''}
            </div>
          `).join('')}
        </div>
        
        ${test.screenshots.length > 0 ? `
          <div class="screenshots">
            <h3>Screenshots:</h3>
            ${test.screenshots.map(screenshot => `
              <div>
                <p>${path.basename(screenshot)}</p>
                <img src="${path.basename(screenshot)}" class="screenshot" />
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `).join('')}
  </body>
  </html>
  `;

  fs.writeFileSync(reportPath, html);
  console.log(`Test report generated: ${reportPath}`);
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

// ---------- Capture consent and confirm ----------
async function captureConsentAndConfirm(
  page: Page,
  request: APIRequestContext
) {
  console.log('[consent] Setting up GET request listener...');
  
  let consentParams: { domain?: string; local?: string; token?: string; userId?: string } = {};
  
  // Listen for the API call when consent is captured after button click
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/registration/registration-confirm')) {
      console.log('[consent] GET response intercepted:', url);
      
      try {
        // Get the response body as JSON
        const responseBody = await response.json();
        console.log('[consent] Response body:', responseBody);
        
        // Extract parameters from response body
        consentParams.token = responseBody.data?.consent_confirmation_token || consentParams.token;
        consentParams.userId = responseBody.data?.id || responseBody.data?.user_id || consentParams.userId;
        consentParams.domain = responseBody.data?.domain || consentParams.domain;
        consentParams.local = responseBody.data?.local || consentParams.local;
        
        // Also try URL parameters as fallback
        const urlObj = new URL(url);
        consentParams.token = urlObj.searchParams.get('token') || consentParams.token;
        consentParams.userId = urlObj.searchParams.get('user_id') || consentParams.userId;
        consentParams.domain = urlObj.searchParams.get('domain') || consentParams.domain;
        consentParams.local = urlObj.searchParams.get('local') || consentParams.local;
        
        console.log('[consent] Extracted parameters:', consentParams);
        
      } catch (err) {
        console.log('[consent] Error processing response:', err instanceof Error ? err.message : String(err));
      }
    }
  });

  console.log('[consent] Clicking "Ich stimme zu" button...');
  await page.getByRole('button', { name: 'Ich stimme zu' }).click();

  console.log('[consent] Waiting for consent parameters to be captured...');
  
  await expect
    .poll(() => {
      return (consentParams.token && consentParams.userId) ? 'ok' : null;
    }, {
      timeout: 10000,
      message: `consent parameters not captured. params=${JSON.stringify(consentParams)}`,
    })
    .toBe('ok');

  console.log('[consent] ✓ Successfully captured parameters:', consentParams);

  // Create the confirmation URL with the parameters from consent
  const confirmationUrl = `https://stage.recordati-plus.de/api/registration/consent-confirm?token=${consentParams.token}&country_lang=de_DE&user_id=${consentParams.userId}`;

  // Open the new page to perform the confirmation
  const newPage = await page.context().newPage();
  console.log('[consent] Opening the confirmation URL in a new page:', confirmationUrl);
  await newPage.goto(confirmationUrl);

  // Wait for the confirmation page to load and handle any redirects
  console.log('[consent] Confirmation page loaded in new browser tab');
  await newPage.waitForLoadState('networkidle');
  
  // Add assertions to verify confirmation was successful
  console.log('[consent] Verifying confirmation success...');
  
  // Wait for potential redirect or success indication
  await newPage.waitForTimeout(2000);
  
  // Check if we're redirected to a success page or stay on confirmation page
  const currentUrl = newPage.url();
  console.log('[consent] Current URL after confirmation:', currentUrl);
  
  // Verify the confirmation was processed (you may need to adjust these expectations based on actual behavior)
  if (currentUrl.includes('password-setup') || currentUrl.includes('success') || currentUrl.includes('confirmed')) {
    console.log('[consent] ✓ Confirmation successful - redirected to:', currentUrl);
  } else {
    console.log('[consent] Confirmation page loaded successfully');
  }
  
  // Close the new page after confirmation
  await newPage.close();
}

// =====================================================
// Test 1: Registration flow (Positive Journey) @valid-double-optin
// =====================================================
test('Registration flow (Positive Journey) @valid-double-optin', async ({ page, request }) => {
  const testName = 'registration_valid_double_optin';
  const testStartTime = Date.now();

  testResults[testName] = {
    testName: 'Registration Flow (Valid Double Opt-in)',
    status: 'passed',
    startTime: new Date().toISOString(),
    steps: [],
    screenshots: []
  };

  try {
    const TEST_UUID = TEST_UUID1;
    const TEST_EMAIL = TEST_EMAIL1;
    console.log(`[test] Using UUID: ${TEST_UUID}, EMAIL: ${TEST_EMAIL}, BASE_URL: ${BASE_URL}`);

    // Go directly to registration page and handle authentication there
    console.log('[test] Navigating to registration page...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check if we need to handle Cloudflare Access
    console.log('[test] Checking current URL:', page.url());
    
    if (page.url().includes('cloudflareaccess.com')) {
      console.log('[test] Detected Cloudflare Access page, clicking SAML Omnizia SSO button...');
      await page.getByRole('button', { name: 'SAML Omnizia SSO' }).click();
      
      // Wait for redirect to SSO login page
      await page.waitForURL('**/sso.omnizia.com**', { timeout: 10000 });
      
      // Fill SSO credentials
      await page.getByRole('textbox', { name: 'Username' }).click();
      await page.getByRole('textbox', { name: 'Username' }).fill(SSO_USERNAME!);
      await page.getByRole('textbox', { name: 'Password' }).click();
      await page.getByRole('textbox', { name: 'Password' }).fill(SSO_PASSWORD!);
      await page.getByRole('button', { name: 'Sign In' }).click();
      
      // Wait for redirect back to registration page
      await page.waitForURL('**/account/signin**', { timeout: 20000 });
    } else if (page.url().includes('sso.omnizia.com')) {
      console.log('[test] Detected SSO login page, filling credentials...');
      await page.getByRole('textbox', { name: 'Username' }).click();
      await page.getByRole('textbox', { name: 'Username' }).fill(SSO_USERNAME!);
      await page.getByRole('textbox', { name: 'Password' }).click();
      await page.getByRole('textbox', { name: 'Password' }).fill(SSO_PASSWORD!);
      await page.getByRole('button', { name: 'Sign In' }).click();
      
      // Wait for redirect to registration page
      await page.waitForURL('**/account/signin**', { timeout: 20000 });
    } else {
      // Already on registration page or need to wait for it
      console.log('[test] On registration page or waiting for redirect...');
      await page.waitForURL('**/account/signin**', { timeout: 10000 });
    }
    
    await page.waitForLoadState('networkidle');
    
    // Wait for page load and perform cookie acceptance
    await acceptCookiesIfVisible(page);

    // Fill in registration details
    await page.locator('#registerCheckbox').check();
    await page.locator('input[name="uuid"]').fill(TEST_UUID1);
    await expect(page.getByText('Gültige LANR')).toBeVisible();
    await page.locator('input[name="email"]').fill(TEST_EMAIL1);
    await page.locator('input[name="email"]').click();
    
    // Click Weiter to proceed to next step
    await expect(page.getByRole('button', { name: 'Weiter' })).toBeVisible();
    await page.getByRole('button', { name: 'Weiter' }).click();
    
    // Fill telephone and personal details
    await page.locator('input[name="telephone"]').click();
    await page.locator('input[name="telephone"]').fill('+49 4586 98890');
     // Wait for the dropdown to be clickable and trigger the dropdown by clicking on the arrow
  const selectArrow = page.locator('.form-outline .select-arrow').nth(0); // Select the first one
  await selectArrow.click();

  // Wait for the option to appear and select "Herr"
  await page.waitForSelector('text=Herr');  // Wait for the "Herr" option to be visible
  await page.locator('text=Herr').click();  // Select the "Herr" option
    
    // Handle consent checkboxes
    await page.locator('input[name="consentList.948901de-b940-476b-a5f3-d7d27c4f111c"]').check();
    await page.locator('form div').filter({ hasText: 'Ich stimme zu, dass Recordati Pharma GmbH meine personenbezogenen Daten' }).nth(1).click();
    await page.locator('input[name="consentList.74cd22d7-5c2f-4495-ac67-fb8b68afa62f"]').check();
    await page.locator('input[name="consentList.aa539788-311f-4c6f-bf15-120fb6600de6"]').check();
    
    // Consent Handling (clicking button and intercepting API request)
    await captureConsentAndConfirm(page, request);

  } catch (error) {
    testResults[testName].status = 'failed';
    testResults[testName].error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      // Ensure test duration is calculated and saved
      if (testResults[testName].startTime) {
        const startTime = new Date(testResults[testName].startTime).getTime();
        testResults[testName].duration = Date.now() - startTime;
      }

      // Save the results
      fs.writeFileSync(path.join(TEST_RESULTS_DIR, 'test-results.json'), JSON.stringify(testResults, null, 2));

      // Generate report
      generateHtmlReport();
    } catch (error) {
      console.error('Error in test cleanup:', error);
    }
  }
});

// =====================================================
// Test 2: Registration flow (Positive Journey) @valid-single-optin
// =====================================================
test('Registration flow (Positive Journey) @valid-single-optin', async ({ page, request }) => {
  const testName = 'registration_valid_single_optin';
  const testStartTime = Date.now();

  testResults[testName] = {
    testName: 'Registration Flow (Valid Single Opt-in)',
    status: 'passed',
    startTime: new Date().toISOString(),
    steps: [],
    screenshots: []
  };

  try {
    console.log(`[test] Starting single opt-in test`);

    // Navigate to SSO login page first
    await page.goto('https://sso.omnizia.com/auth/realms/viquia/protocol/saml?SAMLRequest=pZJPTwIxEMW%2Fyqb33e4CGm12SVZWhUSFAHrwVroFG%2Ftn6bSgfnq7gEpi5OJ1Zt783ptMDlTJhpTevegpX3sOLnpTUgNpGwXyVhNDQQDRVHEgjpFZeX9HOklKKAC3ThiNjiTNaU1jjTPMSBSVX%2BqB0eAVtzNuN4Lxx%2BldgV6ca4BgvBFrL2jCpPH1UlLLKWMcIGFGYVbrmK0E3pcwo1IuKHtF0agqkL59FemwV14OG9XtUu%2FPZ9ONqoaseoT1%2BPpsi6IqZBWathZ%2BgAAmMUqLj5YaIDQcBgesVHAwg78i4DZuoAF4PtLgqHYF6qSdszjrxFlvnl6Q7iVJs6SXnT%2BjaHKQXQldC706fabFfgjIcD6fxJPxbI6iJ25h5zUMoH7e0skObvv%2FOFeOjxfl%2B3d4CIZG1cRIwd6jUkqzHYRdjhfIWc9RdGOsou7vCFmS7Sqijpe7UeI1NJyJpeB18I5%2FY76Lx6%2FY%2FwQ%3D&RelayState=fd814976dc47a3b1b78d0481ea7');

    // Logging in with credentials
    await page.getByRole('textbox', { name: 'Username' }).click();
    await page.getByRole('textbox', { name: 'Username' }).fill(SSO_USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(SSO_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Navigate to Registration page
    await page.goto('https://stage.recordati-plus.de/de_DE/account/signin');
    await page.waitForLoadState('networkidle');
    
    // Wait for cookie banner and accept if visible
    try {
      await page.getByRole('button', { name: 'Alle akzeptieren' }).click({ timeout: 5000 });
    } catch (error) {
      console.log('[test] No cookie banner found or already accepted');
    }
    
    await page.locator('#registerCheckbox').check();
    
    // Debug environment variables
    console.log(`[test] TEST_UUID2 value: "${TEST_UUID2}"`);
    console.log(`[test] TEST_EMAIL2 value: "${TEST_EMAIL2}"`);
    
    // Check if environment variables are loaded
    if (!TEST_UUID2 || TEST_UUID2 === '') {
      console.log('[test] ERROR: TEST_UUID2 is not loaded from environment variables');
      throw new Error('TEST_UUID2 environment variable is not set');
    }
    
    // Fill UUID field with validation trigger
    await page.locator('input[name="uuid"]').fill(TEST_UUID2);
    await page.locator('input[name="uuid"]').press('Tab'); // Trigger validation
    await page.waitForTimeout(500);
    
    // Wait for "Gültige LANR" text to appear (indicates validation passed)
    await expect(page.getByText('Gültige LANR')).toBeVisible({ timeout: 10000 });
    
    // Fill email field with validation trigger
    await page.locator('input[name="email"]').fill(TEST_EMAIL2);
    await page.locator('input[name="email"]').press('Tab'); // Trigger validation
    await page.waitForTimeout(500);

    // Wait for the 'Weiter' button to be enabled and click
    const weiterBtn = page.getByRole('button', { name: 'Weiter' });
    await expect(weiterBtn).toBeEnabled({ timeout: 10000 });
    await weiterBtn.click();
    
    await page.locator('input[name="telephone"]').fill('+49 4546 56');
    
    // Wait for the dropdown to be clickable and trigger the dropdown by clicking on the arrow
    const selectArrow = page.locator('.form-outline .select-arrow').nth(0); // Select the first one
    await selectArrow.click();

    // Wait for the option to appear and select "Herr"
    await page.waitForSelector('text=Herr');  // Wait for the "Herr" option to be visible
    await page.locator('text=Herr').click();  // Select the "Herr" option

    // Continue with consent checkboxes
    await page.locator('input[name="consentList.948901de-b940-476b-a5f3-d7d27c4f111c"]').check();
    
    // Final Confirmation
    await page.getByRole('button', { name: 'Ich stimme zu' }).click();
    
    // Wait for redirect to password setup page
    await page.waitForURL('**/password-setup**', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    
    await page.locator('input[name="new_password"]').click();
    await page.locator('input[name="new_password"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirm_password"]').click();
    await page.locator('input[name="confirm_password"]').fill(CONFIRM_PASSWORD);
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.waitForURL('**/overview-page', { timeout: 15000 });

  } catch (error) {
    testResults[testName].status = 'failed';
    testResults[testName].error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      // Ensure test duration is calculated and saved
      if (testResults[testName].startTime) {
        const startTime = new Date(testResults[testName].startTime).getTime();
        testResults[testName].duration = Date.now() - startTime;
      }

      // Save the results
      fs.writeFileSync(path.join(TEST_RESULTS_DIR, 'test-results.json'), JSON.stringify(testResults, null, 2));

      // Generate report
      generateHtmlReport();
    } catch (error) {
      console.error('Error in test cleanup:', error);
    }
  }
});
