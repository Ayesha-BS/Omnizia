// loginAndSaveSession.ts
import { chromium } from 'playwright';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration from environment variables
const config = {
  stageUrl: process.env.STAGE_URL || 'https://stage.recordati-plus.de',
  prodUrl: process.env.PROD_URL || 'https://recordati-plus.de',
  loginEmail: process.env.LOGIN_EMAIL || '',
  loginPassword: process.env.LOGIN_PASSWORD || '',
  ssoUsername: process.env.SSO_USERNAME || '',
  ssoPassword: process.env.SSO_PASSWORD || ''
};

// Validate required environment variables
const requiredVars = ['LOGIN_EMAIL', 'LOGIN_PASSWORD', 'SSO_USERNAME', 'SSO_PASSWORD'];
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Error: ${varName} environment variable is not set`);
    process.exit(1);
  }
}

async function loginAndSaveSession(environment: 'stage' | 'prod' = 'stage'): Promise<void> {
  const contextDir = `./auth-session-${environment}`; // Separate session for each environment
  const baseUrl = environment === 'stage' ? config.stageUrl : config.prodUrl;
  
  console.log(`Starting ${environment} environment login...`);
  
  const browser = await chromium.launchPersistentContext(contextDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    ignoreHTTPSErrors: true
  });

  try {
    const page = await browser.newPage();
    
    // Navigate to the login page
    await page.goto(`${baseUrl}/de_DE/login`);
    
    // Fill in the login form
    await page.fill('input[type="email"]', config.loginEmail);
    await page.fill('input[type="password"]', config.loginPassword);
    
    // Click the login button
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"]')
    ]);
    
    // Handle SSO if needed
    try {
      await page.waitForSelector('input[name="username"]', { timeout: 5000 });
      await page.fill('input[name="username"]', config.ssoUsername);
      await page.fill('input[name="password"]', config.ssoPassword);
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
      ]);
    } catch (error) {
      console.log('No SSO login required or SSO login form not found');
    }
    
    // Wait for the dashboard to load
    await page.waitForSelector('body', { timeout: 30000 });
    
    console.log(`Successfully logged in to ${environment} environment!`);
    console.log('Session has been saved. You can close the browser window.');
    
    // Keep the browser open for manual inspection
    await new Promise(() => {});
    
  } catch (error) {
    console.error(`Error during ${environment} login:`, error);
    throw error;
  } finally {
    // Note: We're not closing the browser here to keep the session alive
    // The browser will be closed when the process is terminated
  }
}

// Run the login for both environments
async function main() {
  try {
    // Uncomment the environment you want to log in to
    // await loginAndSaveSession('stage');
    await loginAndSaveSession('prod');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

// Run the function
loginAndSaveSession().catch(console.error);
