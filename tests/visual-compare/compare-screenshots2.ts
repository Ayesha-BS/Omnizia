import fs from "fs-extra";
import pixelmatch from "pixelmatch";
import { PNG, PNGWithMetadata } from "pngjs";
import PDFDocument from "pdfkit";
import path from "path";
import jpeg from "jpeg-js";
import { chromium, Browser, Page } from 'playwright';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  devDir: string;
  prodDir: string;
  diffDir: string;
  reportPath: string;
  stageUrl: string;
  prodUrl: string;
  loginEmail: string;
  loginPassword: string;
  ssoUsername: string;
  ssoPassword: string;
}

interface ImageData {
  width: number;
  height: number;
  data: Buffer;
}

interface ScreenshotPair {
  name: string;
  dev: string;
  prod: string;
  diff: string;
  diffPixels?: number;
}

const config: Config = {
  devDir: "screenshots/dev",
  prodDir: "screenshots/prod",
  diffDir: "screenshots/diff",
  reportPath: "reports/result-report.pdf",
  stageUrl: process.env.STAGE_URL || '',
  prodUrl: process.env.PROD_URL || '',
  loginEmail: process.env.LOGIN_EMAIL || '',
  loginPassword: process.env.LOGIN_PASSWORD || '',
  ssoUsername: process.env.SSO_USERNAME || '',
  ssoPassword: process.env.SSO_PASSWORD || ''
};

// Validate required environment variables
const requiredVars = ['STAGE_URL', 'PROD_URL', 'LOGIN_EMAIL', 'LOGIN_PASSWORD', 'SSO_USERNAME', 'SSO_PASSWORD'];
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Error: ${varName} environment variable is not set`);
    process.exit(1);
  }
}

// Ensure directories exist
fs.ensureDirSync(config.diffDir);
fs.ensureDirSync("reports");

// Helper to read PNG or JPG as {width, height, data}
function readImage(filePath: string): ImageData {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  
  if (ext === ".png") {
    return PNG.sync.read(buf);
  } else if (ext === ".jpg" || ext === ".jpeg") {
    const jpg = jpeg.decode(buf, { useTArray: true });
    // Convert JPEG (no alpha) to RGBA
    if (jpg.data.length === jpg.width * jpg.height * 4) {
      return { width: jpg.width, height: jpg.height, data: jpg.data as Buffer };
    } else {
      // Add alpha channel if missing
      const rgba = Buffer.alloc(jpg.width * jpg.height * 4);
      for (let i = 0; i < jpg.width * jpg.height; i++) {
        rgba[i * 4 + 0] = jpg.data[i * 3 + 0];
        rgba[i * 4 + 1] = jpg.data[i * 3 + 1];
        rgba[i * 4 + 2] = jpg.data[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      }
      return { width: jpg.width, height: jpg.height, data: rgba };
    }
  } else {
    throw new Error(`Unsupported image format: ${filePath}`);
  }
}

// Pad image to target size (white background)
function padImage(img: ImageData, targetWidth: number, targetHeight: number): ImageData {
  if (img.width === targetWidth && img.height === targetHeight) return img;
  
  const padded = Buffer.alloc(targetWidth * targetHeight * 4, 255);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const srcIdx = (y * img.width + x) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      img.data.copy(padded, dstIdx, srcIdx, srcIdx + 4);
    }
  }
  return { width: targetWidth, height: targetHeight, data: padded };
}

function getScreenshotPairs(): ScreenshotPair[] {
  const devFiles = fs.readdirSync(config.devDir).filter((f: string) => /\.(png|jpg|jpeg)$/i.test(f));
  return devFiles.map((file: string) => ({
    name: file.replace(/\.(png|jpg|jpeg)$/i, ""),
    dev: path.join(config.devDir, file),
    prod: path.join(config.prodDir, file),
    diff: path.join(config.diffDir, file.replace(/\.(png|jpg|jpeg)$/i, "_diff.png"))
  })).filter((pair: ScreenshotPair) => fs.existsSync(pair.prod));
}

function compareScreenshots(devPath: string, prodPath: string, diffPath: string): number {
  let devImg = readImage(devPath);
  let prodImg = readImage(prodPath);
  const width = Math.max(devImg.width, prodImg.width);
  const height = Math.max(devImg.height, prodImg.height);

  devImg = padImage(devImg, width, height);
  prodImg = padImage(prodImg, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    devImg.data as Uint8Array | Uint8ClampedArray,
    prodImg.data as Uint8Array | Uint8ClampedArray,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );
  
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return diffPixels;
}

async function generatePDFReport(results: (ScreenshotPair & { diffPixels: number })[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(config.reportPath);
    
    doc.pipe(stream);
    
    stream.on('finish', () => {
      console.log(`PDF report generated: ${config.reportPath}`);
      resolve();
    });
    
    stream.on('error', (error) => {
      reject(error);
    });

    for (const r of results) {
      doc.addPage();
      doc.fontSize(14).text(`URL: ${r.name}`);
      doc.moveDown();
      doc.fontSize(12).text(`Match: ${r.diffPixels === 0 ? "✅ Yes" : `❌ No (${r.diffPixels} pixels differ)`}`);
      doc.moveDown();
      doc.image(r.dev, 50, doc.y, { width: 250 });
      doc.image(r.prod, 330, doc.y, { width: 250 });
      doc.moveDown(10);
      
      if (r.diffPixels > 0) {
        doc.moveDown();
        doc.image(r.diff, 50, doc.y, { width: 250 });
      }
      doc.moveDown();
    }
    
    doc.end();
  });
}

async function login(page: Page): Promise<void> {
  console.log('Logging in...');
  
  // Navigate to the login page
  await page.goto(`${config.stageUrl}/login`);
  
  // Fill in the login form
  await page.fill('input[type="email"]', config.loginEmail);
  await page.fill('input[type="password"]', config.loginPassword);
  
  // Click the login button
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]')
  ]);
  
  // Handle SSO if needed
  try {
    await page.waitForSelector('input[name="username"]', { timeout: 3000 });
    await page.fill('input[name="username"]', config.ssoUsername);
    await page.fill('input[name="password"]', config.ssoPassword);
    
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"]')
    ]);
  } catch (error) {
    console.log('No SSO login required or SSO login form not found');
  }
  
  console.log('Successfully logged in');
}

async function takeScreenshots(page: Page, url: string, outputPath: string): Promise<void> {
  console.log(`Taking screenshot of ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: outputPath, fullPage: true });
}

async function main(): Promise<void> {
  let browser: Browser | null = null;
  
  try {
    // Launch browser
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Login first
    await login(page);
    
    // Get the list of URLs to compare
    const pairs = getScreenshotPairs();
    const results = [];
    
    // Create necessary directories
    fs.ensureDirSync(config.devDir);
    fs.ensureDirSync(config.prodDir);
    fs.ensureDirSync(config.diffDir);
    
    // Take screenshots and compare
    for (const pair of pairs) {
      console.log(`Processing: ${pair.name}`);
      
      // Take screenshot of stage
      const stageUrl = new URL(pair.name, config.stageUrl).toString();
      const stageScreenshot = path.join(config.devDir, `${pair.name.replace(/[^a-z0-9]/gi, '_')}.png`);
      await takeScreenshots(page, stageUrl, stageScreenshot);
      
      // Take screenshot of prod
      const prodUrl = new URL(pair.name, config.prodUrl).toString();
      const prodScreenshot = path.join(config.prodDir, `${pair.name.replace(/[^a-z0-9]/gi, '_')}.png`);
      await takeScreenshots(page, prodUrl, prodScreenshot);
      
      // Compare screenshots
      const diffPixels = compareScreenshots(stageScreenshot, prodScreenshot, pair.diff);
      const result = { ...pair, diffPixels };
      results.push(result);
      
      console.log(`${pair.name}: ${diffPixels === 0 ? "Match" : `Diff (${diffPixels} pixels)`}`);
    }
    
    // Generate PDF report
    await generatePDFReport(results);
    
  } catch (error: any) {
    console.error('Error in main:', error);
    process.exit(1);
  } finally {
    // Close the browser
    if (browser) {
      await browser.close();
    }
  }
}

// Run the main function
main().catch((error: Error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
