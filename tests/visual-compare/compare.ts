import fs from "fs-extra";
import path from "path";
import { chromium, Page, BrowserContext } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG, PNGWithMetadata } from "pngjs";

type Environment = 'dev' | 'prod' | 'both';

interface Config {
  devBase: string;
  prodBase: string;
  csvFile: string;
  screenshotDir: string;
  diffDir: string;
  reportPath: string;
  testRunDir: string;
}

interface ScreenshotResult {
  url: string;
  devPath?: string;
  prodPath?: string;
  diffPath?: string;
  isDifferent: boolean;
  diffPixels: number;
  environment: Environment;
  error?: string;
}

const contextDir = './auth-session';

let cookieAccepted = false;
let isGatedLogin = false;

// Use a single test results directory for all test runs
const testRunDir = `./test-results`;
// Clear previous test results
if (fs.existsSync(testRunDir)) {
  fs.removeSync(testRunDir);
}
// Ensure the directory exists
fs.ensureDirSync(testRunDir);

const config: Config = {
  devBase: "https://stage.recordati-plus.de",
  prodBase: "https://recordati-plus.de",
  csvFile: "Data/visual-compare-url.csv",
  screenshotDir: `${testRunDir}/screenshots`,
  diffDir: `${testRunDir}/diff`,
  reportPath: `${testRunDir}/report.html`,
  testRunDir: testRunDir
};

function getEnvironment(url: string): 'dev' | 'prod' | 'both' {
  const isDev = url.includes('stage.') || url.includes('dev.');
  const isProd = url.includes('recordati-plus.de') && !isDev;
  
  if (isDev && isProd) return 'both';
  return isDev ? 'dev' : 'prod';
}

async function readUrlsFromCSV(filePath: string): Promise<Array<{url: string, environment: 'dev' | 'prod' | 'both'}>> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length <= 1) {
      console.log('No URLs found in CSV file');
      return [];
    }
    
    // Skip header row and process each line
    return lines.slice(1).map(line => {
      // Get the source URL (first column in CSV)
      const url = line.split(',')[0].trim();
      return {
        url: url,
        environment: 'both' as const
      };
    });
  } catch (error) {
    console.error('Error reading CSV file:', error);
    return [];
  }
}

async function ensureLoggedIn(page: Page): Promise<void> {
  try {
    // Check for cookie banner
    const cookieSelectors = [
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Akzeptieren")',
      '.cookie-consent-accept-all',
      '#onetrust-accept-btn-handler'
    ];
    
    for (const selector of cookieSelectors) {
      try {
        const button = page.locator(selector);
        if (await button.isVisible({ timeout: 5000 })) {
          await button.click();
          await page.waitForTimeout(1000); // Wait for cookie banner to disappear
          break;
        }
      } catch (e) {
        // Ignore timeout errors
      }
    }
    
    // Check if we're already logged in by looking for user profile elements
    const loggedInSelectors = [
      '.user-profile',
      '.user-menu',
      'a[href*="logout"]',
      'a[href*="account"]'
    ];
    
    for (const selector of loggedInSelectors) {
      if (await page.$(selector) !== null) {
        console.log('Already logged in');
        return;
      }
    }
    
    // If we get here, we need to log in
    console.log('Attempting to log in...');
    
    // Try to find and click login button
    const loginSelectors = [
      'button:has-text("Login")',
      'a:has-text("Login")',
      '.login-button',
      '#login-button'
    ];
    
    let loginClicked = false;
    for (const selector of loginSelectors) {
      try {
        const loginButton = page.locator(selector);
        if (await loginButton.isVisible({ timeout: 5000 })) {
          await loginButton.click();
          loginClicked = true;
          break;
        }
      } catch (e) {
        // Ignore timeout errors
      }
    }
    
    if (!loginClicked) {
      console.log('No login button found, assuming already logged in');
      return;
    }
    
    // Wait for login form to appear
    await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 10000 });
    
    // Fill in credentials
    const email = process.env.LOGIN_EMAIL || '';
    const password = process.env.LOGIN_PASSWORD || '';
    
    if (!email || !password) {
      throw new Error('Login credentials not found in environment variables');
    }
    
    await page.fill('input[type="email"], input[type="text"]', email);
    await page.fill('input[type="password"]', password);
    
    // Submit the form
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"], input[type="submit"]')
    ]);
    
    console.log('Login successful');
  } catch (error) {
    console.error('Error logging in:', error);
  }
}

async function ensureLoggedInAndNavigate(page: Page, url: string): Promise<boolean> {
  try {
    // Convert relative URL to full URL if needed
    const fullUrl = url.startsWith('http') ? url : `${config.devBase}${url}`;
    
    console.log(`Navigating to: ${fullUrl}`);
    await page.goto(fullUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000 // 60 seconds timeout
    });
    
    // Check if we're on a login page
    const isLoginPage = await page.$('input[type="email"], input[type="password"]') !== null;
    
    if (isLoginPage) {
      console.log('Login form detected, attempting to log in...');
      await ensureLoggedIn(page);
      // After login, try navigating again
      await page.goto(fullUrl, { waitUntil: 'networkidle' });
    }
    
    return true;
  } catch (error) {
    console.error(`Error navigating to ${url}:`, error);
    return false;
  }
}

async function captureScreenshot(page: Page, url: string, outputPath: string): Promise<boolean> {
  try {
    // Ensure the directory exists
    fs.ensureDirSync(path.dirname(outputPath));
    
    // Take full page screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: true,
      animations: 'disabled',
      timeout: 30000 // 30 seconds timeout for screenshot
    });
    
    return true;
  } catch (error) {
    console.error(`Error capturing screenshot for ${url}:`, error);
    return false;
  }
}

function padImage(img: PNGWithMetadata, targetWidth: number, targetHeight: number): PNG {
  const padded = new PNG({ width: targetWidth, height: targetHeight, fill: true });
  
  // Calculate the position to center the original image
  const x = Math.floor((targetWidth - img.width) / 2);
  const y = Math.floor((targetHeight - img.height) / 2);
  
  // Copy the original image to the center of the padded image
  for (let i = 0; i < img.height; i++) {
    for (let j = 0; j < img.width; j++) {
      const idx = (i * img.width + j) << 2;
      const newIdx = ((i + y) * targetWidth + (j + x)) << 2;
      
      padded.data[newIdx] = img.data[idx];
      padded.data[newIdx + 1] = img.data[idx + 1];
      padded.data[newIdx + 2] = img.data[idx + 2];
      padded.data[newIdx + 3] = img.data[idx + 3];
    }
  }
  
  return padded;
}

async function compareScreenshots(devPath: string, prodPath: string, diffPath: string): Promise<{isDifferent: boolean, diffPixels: number}> {
  try {
    // Read images
    const img1 = PNG.sync.read(fs.readFileSync(devPath));
    const img2 = PNG.sync.read(fs.readFileSync(prodPath));
    
    // Ensure images have the same dimensions
    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);
    
    // Create diff image
    const diff = new PNG({width, height});
    
    // Compare images
    const diffPixels = pixelmatch(
      img1.data, 
      img2.data, 
      diff.data, 
      width, 
      height, 
      { threshold: 0.1 }
    );
    
    // Save diff image
    fs.ensureDirSync(path.dirname(diffPath));
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    
    return {
      isDifferent: diffPixels > 0,
      diffPixels
    };
  } catch (error) {
    console.error('Error comparing screenshots:', error);
    return {
      isDifferent: true,
      diffPixels: 0
    }
  }
}

async function generateHTMLReport(results: ScreenshotResult[]): Promise<void> {
  const reportPath = config.reportPath;
  const reportDir = path.dirname(reportPath);
  
  // Create necessary directories
  fs.ensureDirSync(reportDir);
  fs.ensureDirSync(config.screenshotDir);
  fs.ensureDirSync(config.diffDir);

  // Generate HTML report
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Visual Comparison Results</title>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .test-case { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
    .test-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .test-title { font-weight: bold; font-size: 1.2em; }
    .status { padding: 3px 8px; border-radius: 3px; color: white; font-weight: bold; }
    .status.passed { background-color: #4CAF50; }
    .status.failed { background-color: #f44336; }
    .status.error { background-color: #ff9800; }
    .comparison { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 15px; }
    .screenshot { flex: 1; min-width: 300px; }
    .screenshot img { max-width: 100%; border: 1px solid #ddd; }
    .screenshot-label { text-align: center; font-weight: bold; margin-top: 5px; }
    .diff-stats { margin: 10px 0; padding: 10px; background: #f8f8f8; border-radius: 4px; }
    .error { color: #d32f2f; background: #ffebee; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Visual Comparison Results</h1>
  <p>Generated on: ${new Date().toLocaleString()}</p>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>Total URLs: ${results.length}</p>
    <p>Passed: ${results.filter(r => !r.error && !r.isDifferent).length}</p>
    <p>Failed: ${results.filter(r => !r.error && r.isDifferent).length}</p>
    <p>Errors: ${results.filter(r => r.error).length}</p>
  </div>

  <h2>Test Results</h2>
  ${results.map((result, index) => {
    const statusClass = result.error ? 'error' : (result.isDifferent ? 'failed' : 'passed');
    const statusText = result.error ? 'ERROR' : (result.isDifferent ? 'FAIL' : 'PASS');
    
    return `
    <div class="test-case">
      <div class="test-header">
        <span class="test-title">${index + 1}. ${result.url}</span>
        <span class="status ${statusClass}">${statusText}</span>
      </div>
      
      ${result.error ? `
        <div class="error">${result.error}</div>
      ` : ''}
      
      ${!result.error && result.isDifferent ? `
        <div class="diff-stats">
          Differences found: <strong>${result.diffPixels}</strong> pixels
        </div>
      ` : ''}
      
      <div class="comparison">
        ${result.devPath ? `
          <div class="screenshot">
            <img src="${path.relative(reportDir, result.devPath).replace(/\\/g, '/')}" alt="Development">
            <div class="screenshot-label">Development</div>
          </div>
        ` : ''}
        
        ${result.prodPath ? `
          <div class="screenshot">
            <img src="${path.relative(reportDir, result.prodPath).replace(/\\/g, '/')}" alt="Production">
            <div class="screenshot-label">Production</div>
          </div>
        ` : ''}
        
        ${result.diffPath && result.isDifferent ? `
          <div class="screenshot">
            <img src="${path.relative(reportDir, result.diffPath).replace(/\\/g, '/')}" alt="Differences">
            <div class="screenshot-label">Differences (${result.diffPixels} pixels)</div>
          </div>
        ` : ''}
      </div>
    </div>`;
  }).join('')}
</body>
</html>`;

  // Write the HTML report
  fs.writeFileSync(reportPath, html);
  console.log(`HTML report generated: ${reportPath}`);
}

async function runWithConcurrencyLimit<T, R>(
  items: T[], 
  limit: number, 
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item)).then(result => {
      results.push(result);
    });
    
    const e: Promise<void> = p.then(() => {
      executing.splice(executing.indexOf(e), 1);
    });
    
    executing.push(e);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  
  await Promise.all(executing);
  return results;
}

async function main(): Promise<void> {
  try {
    // Read URLs from CSV
    const urls = await readUrlsFromCSV(config.csvFile);
    
    if (urls.length === 0) {
      console.error('No URLs found in CSV file');
      process.exit(1);
    }
    
    console.log(`Found ${urls.length} URLs to process`);
    
    // Create necessary directories
    fs.ensureDirSync(config.testRunDir);
    fs.ensureDirSync(config.screenshotDir);
    fs.ensureDirSync(config.diffDir);
    
    // Create a summary file for this test run
    const summaryPath = path.join(config.testRunDir, 'summary.json');
    const testRunInfo = {
      timestamp: new Date().toISOString(),
      totalUrls: urls.length,
      results: [] as Array<{
        url: string;
        status: 'passed' | 'failed' | 'error';
        diffPixels?: number;
        error?: string;
      }>
    };
    
    // Initialize browser with persistent context
    const context = await chromium.launchPersistentContext(contextDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      ignoreHTTPSErrors: true
    });
    
    // Get the browser instance from context
    const browser = context.browser();
    if (!browser) {
      throw new Error('Failed to get browser instance from context');
    }
    
    try {
      const page = await context.newPage();
      
      // Process each URL
      const results: ScreenshotResult[] = [];
      
      for (const { url, environment } of urls) {
        const result: ScreenshotResult = {
          url,
          environment,
          devPath: '',
          prodPath: '',
          diffPath: '',
          isDifferent: false,
          diffPixels: 0
        };
        
        try {
          console.log(`Processing: ${url}`);
          
          // Take dev screenshot if needed
          if (environment === 'dev' || environment === 'both') {
            const devUrl = url.replace(config.prodBase, config.devBase);
            result.devPath = path.join(config.screenshotDir, `dev_${Date.now()}.png`);
            
            // Navigate and take screenshot
            const success = await ensureLoggedInAndNavigate(page, devUrl);
            if (success) {
              await captureScreenshot(page, devUrl, result.devPath);
            } else {
              result.error = 'Failed to navigate to dev URL';
            }
          }
          
          // Take prod screenshot if needed
          if (environment === 'prod' || environment === 'both') {
            const prodUrl = url.replace(config.devBase, config.prodBase);
            result.prodPath = path.join(config.screenshotDir, `prod_${Date.now()}.png`);
            
            // Navigate and take screenshot
            const success = await ensureLoggedInAndNavigate(page, prodUrl);
            if (success) {
              await captureScreenshot(page, prodUrl, result.prodPath);
            } else {
              result.error = result.error 
                ? `${result.error}; Failed to navigate to prod URL` 
                : 'Failed to navigate to prod URL';
            }
          }
          
          // Compare screenshots if both were taken
          if (result.devPath && result.prodPath && 
              fs.existsSync(result.devPath) && 
              fs.existsSync(result.prodPath)) {
            const diffPath = path.join(config.diffDir, `diff-${url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`);
            result.diffPath = diffPath;
            // At this point TypeScript knows both paths are defined
            const comparison = await compareScreenshots(result.devPath, result.prodPath, diffPath);
            result.isDifferent = comparison.isDifferent;
            result.diffPixels = comparison.diffPixels;
          }
// ... (rest of the code remains the same)
          
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          result.error = error instanceof Error ? error.message : String(error);
        }
        
        results.push(result);
      }
      
      // Generate HTML report
      await generateHTMLReport(results);
      
      // Save test run summary
      testRunInfo.results = results.map(r => ({
        url: r.url,
        status: r.error ? 'error' : (r.isDifferent ? 'failed' : 'passed'),
        diffPixels: r.diffPixels,
        error: r.error
      }));
      
      fs.writeFileSync(summaryPath, JSON.stringify(testRunInfo, null, 2));
      
      // Create a latest symlink to this test run
      try {
        const latestLink = './TestResults/latest';
        if (fs.existsSync(latestLink)) {
          fs.unlinkSync(latestLink);
        }
        fs.symlinkSync(path.basename(config.testRunDir), latestLink, 'junction');
      } catch (e) {
        console.warn('Could not create latest symlink:', e);
      }
      
      // Print summary
      const differentCount = results.filter(r => r.isDifferent).length;
      console.log(`\nComparison complete!`);
      console.log(`Total URLs: ${results.length}`);
      console.log(`Different: ${differentCount}`);
      console.log(`Identical: ${results.length - differentCount}`);
      console.log(`\nReport generated at: ${path.resolve(config.reportPath)}`);
      
    } finally {
      // Close the context which will also close the browser
      await context.close();
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
