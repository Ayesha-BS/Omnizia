import fs from 'fs-extra';
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { chromium, Page, BrowserContext } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG, type PNGWithMetadata } from 'pngjs';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the PDFDocument interface with all required methods
interface PDFDocumentType {
  pipe(stream: NodeJS.WritableStream): void;
  text(text: string, x?: number, y?: number, options?: any): this;
  fontSize(size: number): this;
  font(src: string, family?: string, size?: number): this;
  moveDown(y?: number): this;
  image(src: any, x?: number, y?: number, options?: any): this;
  fillColor(color: string): this;
  addPage(options?: any): this;
  end(callback?: () => void): void;
  x: number;
  y: number;
  page: {
    width: number;
    height: number;
    margins: { top: number; bottom: number; left: number; right: number };
  };
  [key: string]: any;
}

type ExtendedPDFDocument = PDFDocumentType;

const contextDir = './auth-session';

let cookieAccepted: boolean = false;
let isGatedLogin: boolean = false;

interface Config {
  devBase: string;
  prodBase: string;
  excelFile: string;
  screenshotDir: string;
  reportPath: string;
}

interface ScreenshotPaths {
  dev: string;
  prod: string;
  diff: string;
}

interface ComparisonResult {
  url: string;
  match: boolean;
  diffPixels: number;
  devPath: string;
  prodPath: string;
  diffPath: string;
  duration: number;
}

interface Summary {
  totalUrls: number;
  avgDuration: number;
  totalDuration: number;
  startTime: number;
  endTime?: number;
}

const config: Config = {
  devBase: "http://localhost:3000",
  prodBase: "https://recordati-plus.de",
  excelFile: "urls.xlsx",
  screenshotDir: "screenshots",
  reportPath: "reports/result-2.pdf"
};

function getEnvironment(url: string): string {
  if (url.includes("localhost")) return "local";
  if (url.includes("dev.")) return "Dev";
  if (url.includes("stage.")) return "Stage";
  return "Prod";
}

async function readUrlsFromExcel(filePath: string): Promise<string[]> {
  try {
    const fileContent = await readFile(filePath, 'utf-8');
    return fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('http'));
  } catch (error) {
    console.error('Error reading file:', error);
    return [];
  }
}

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(`${config.devBase}/de_DE/overview-page`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("sso.omnizia.com")) {
    console.log("🔑 Login required. Please complete login in the opened browser...");
    await page.waitForURL(url => url.toString().startsWith(config.devBase), { timeout: 120000 });
    console.log("✅ Login successful.");
  } else {
    console.log("✅ Already logged in.");
  }
}

async function ensureLoggedInAndNavigate(page: Page): Promise<void> {
  await page.goto(`${config.devBase}/de_DE/account/signin`, {waitUntil: "domcontentloaded"});
  if (page.url().includes("/account/signin")) {
    console.log("🔑 DEV Login required. Please complete login in the opened browser...");
    await page.waitForURL(url => url.toString().startsWith(config.devBase) && !url.toString().includes("/account/signin"), {timeout: 120000});
    console.log("✅ DEV Login successful.");
  } else {
    console.log("✅ DEV Already logged in.");
  }
  await page.goto(`${config.prodBase}/de_DE/account/signin`, {waitUntil: "domcontentloaded"});
  if (page.url().includes("/account/signin")) {
    console.log("🔑 PROD Login required. Please complete login in the opened browser...");
    await page.waitForURL(url => url.toString().startsWith(config.prodBase) && !url.toString().includes("/account/signin"), {timeout: 120000});
    console.log("✅ PROD Login successful.");
  } else {
    console.log("✅ PROD Already logged in.");
  }
  isGatedLogin = true;
}

async function captureScreenshot(page: Page, url: string, outputPath: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  if (!cookieAccepted) {
    try {
      const cookieButton = page.locator('button.cky-btn-accept[aria-label="Alle akzeptieren"]').first();
      if (await cookieButton.isVisible()) {
        await cookieButton.click();
        await page.waitForTimeout(500);
      }
    } catch {}
  }
  await page.addStyleTag({
    content: `
      .app_container.theme { position: static !important; height: auto !important; }
      .layout { position: relative !important; height: auto !important; }
      .theme .content { position: static !important; display: block !important; }
    `
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);
  await page.screenshot({ 
    path: outputPath, 
    fullPage: true, 
    type: 'jpeg', 
    quality: 100
  });
}

function padImage(img: PNGWithMetadata, targetWidth: number, targetHeight: number): PNGWithMetadata {
  if (img.width === targetWidth && img.height === targetHeight) return img;
  
  const padded = new PNG({ width: targetWidth, height: targetHeight }) as PNGWithMetadata;
  
  if (!padded.data) {
    throw new Error('Failed to create PNG buffer');
  }
  
  // Fill with white background
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = (targetWidth * y + x) << 2;
      padded.data[idx] = 255;     // R
      padded.data[idx + 1] = 255; // G
      padded.data[idx + 2] = 255; // B
      padded.data[idx + 3] = 255; // A
    }
  }

  if (!img.data) {
    throw new Error('Source image has no data');
  }

  // Copy original image onto the padded one
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const srcIdx = (img.width * y + x) << 2;
      const dstIdx = (targetWidth * y + x) << 2;
      
      if (x < targetWidth && y < targetHeight) {
        padded.data[dstIdx] = img.data[srcIdx];
        padded.data[dstIdx + 1] = img.data[srcIdx + 1];
        padded.data[dstIdx + 2] = img.data[srcIdx + 2];
        padded.data[dstIdx + 3] = img.data[srcIdx + 3];
      }
    }
  }
  
  return padded;
}

async function compareScreenshots(
  img1Path: string, 
  img2Path: string, 
  diffPath: string
): Promise<{numDiffPixels: number, diffJpgPath: string}> {
  const img1Buffer = await sharp(img1Path).png().toBuffer();
  const img2Buffer = await sharp(img2Path).png().toBuffer();
  let img1 = PNG.sync.read(img1Buffer) as PNGWithMetadata;
  let img2 = PNG.sync.read(img2Buffer) as PNGWithMetadata;
  const width = Math.max(img1.width || 0, img2.width || 0);
  const height = Math.max(img1.height || 0, img2.height || 0);
  img1 = padImage(img1, width, height);
  img2 = padImage(img2, width, height);
  const diff = new PNG({ width, height }) as PNGWithMetadata;
  
  const numDiffPixels = pixelmatch(
    img1.data as unknown as Uint8Array | Uint8ClampedArray,
    img2.data as unknown as Uint8Array | Uint8ClampedArray,
    diff.data as unknown as Uint8Array | Uint8ClampedArray | null,
    width, 
    height, 
    { threshold: 0.1 }
  );

  const diffJpgPath = diffPath.replace(/\.png$/, '.jpg');
  const diffPngBuffer = PNG.sync.write(diff);
  await sharp(diffPngBuffer)
    .jpeg({ quality: 100 })
    .toFile(diffJpgPath);

  return { numDiffPixels, diffJpgPath };
}

async function drawImageWithLabel(
  doc: ExtendedPDFDocument,
  imgPath: string, 
  label: string, 
  x: number, 
  y: number, 
  imgWidth: number, 
  imageMaxheight: number
): Promise<number> {
  if (await readFile(imgPath).then(() => true).catch(() => false)) {
    const resizedPath = imgPath.replace(/\.jpg$/, `_resized.jpg`);
    const meta = await sharp(imgPath).metadata();
    let finalWidth = imgWidth;
    let finalHeight = (meta.height! * imgWidth) / meta.width!;
    if (finalHeight > imageMaxheight) {
      finalHeight = imageMaxheight;
      finalWidth = (meta.width! * finalHeight) / meta.height!;
    }
    await sharp(imgPath)
      .resize({ width: Math.round(finalWidth), height: Math.round(finalHeight), fit: 'inside' })
      .jpeg({ quality: 80 })
      .toFile(resizedPath);

    doc.fontSize(10);
    doc.text(label, x, y, {
      width: finalWidth,
      align: 'center' as any // Type assertion for alignment
    });
    doc.image(resizedPath, x, y + 15, { width: finalWidth });
    await fs.remove(resizedPath);
    return finalHeight;
  }
  return 0;
}

async function generatePDFReport(
  results: ComparisonResult[], 
  summary: Summary, 
  startTime: number, 
  endTime: number
): Promise<void> {
  // Create PDF document with proper type assertion
  const doc = new (PDFDocument as any)({
    autoFirstPage: false,
    margin: 20 // Set default margin for all sides
  }) as ExtendedPDFDocument;
  
  // Set custom margins
  doc.page.margins = { top: 20, bottom: 20, left: 50, right: 50 };
  
  // Create a write stream for the PDF
  const writeStream = fs.createWriteStream(config.reportPath);
  doc.pipe(writeStream);

  // Cover page
  doc.addPage();
  doc.fontSize(24).text(
    'Visual Comparison Report',
    doc.page.margins.left,
    doc.page.margins.top,
    {
      align: 'center',
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right
    }
  );
  doc.moveDown(1.5);
  doc.fontSize(16).text(
    ' 🚀 Performance Summary',
    doc.page.margins.left,
    undefined, // let the PDF library handle the y position
    {
      align: 'left',
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right
    }
  );
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Total URLs processed: ${summary.totalUrls}`);
  doc.text(`Start time: ${new Date(startTime).toISOString()} - End time: ${new Date(endTime).toISOString()}`);
  
  doc.moveDown(1);
  doc.fontSize(12).text(
    `Generated: ${new Date().toLocaleString()}`,
    doc.page.margins.left,
    undefined,
    {
      align: 'center',
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right
    }
  );

  // Add a line under the header
  doc.moveDown(1);
  doc.strokeColor('#000000').lineWidth(1).moveTo(
    doc.page.margins.left,
    doc.y
  ).lineTo(
    doc.page.width - doc.page.margins.right,
    doc.y
  ).stroke();
  
  // Add page numbers and other footer content
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const currentY = doc.page.height - doc.page.margins.bottom + 10;
    
    // Page number
    doc.fontSize(10).text(
      `Page ${i + 1} of ${pages.count}`,
      doc.page.margins.left,
      currentY,
      {
        align: 'left',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      }
    );
    
    // Timestamp
    doc.fontSize(10).text(
      `Generated: ${new Date().toLocaleString()}`,
      doc.page.margins.left,
      currentY,
      {
        align: 'right',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      }
    );
  }

  for (const result of results) {
    doc.addPage();
    doc.fontSize(16);
    doc.text(
      `URL: ${result.url}`,
      doc.page.margins.left,
      undefined,
      {
        underline: true,
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      }
    );
    doc.moveDown();

    const imgWidth = 180;
    const imgGap = 30;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    const y = doc.y;
    const imageMaxheight = 580;

    const devHeight = await drawImageWithLabel(doc, result.devPath, getEnvironment(config.devBase), startX, y, imgWidth, imageMaxheight);
    const prodHeight = await drawImageWithLabel(doc, result.prodPath, getEnvironment(config.prodBase), startX + imgWidth + imgGap, y, imgWidth, imageMaxheight);
    const diffHeight = await drawImageWithLabel(doc, result.diffPath, 'Compare', startX + (imgWidth + imgGap) * 2, y, imgWidth, imageMaxheight);

    const maxImgHeight = Math.max(devHeight, prodHeight, diffHeight);
    const descY = y + maxImgHeight + 45;

    doc.x = doc.page.margins.left;
    doc.y = descY;
    doc.moveDown();
    doc.fontSize(14).text(
      `Match: ${result.match ? '✅ No visual difference' : `❌ ${result.diffPixels} pixels differ`}`,
      doc.page.margins.left,
      undefined,
      { align: 'left', width: pageWidth }
    );
    if (!result.match) {
      doc.moveDown();
      doc.fontSize(12).fillColor('red').text(
        'Differences highlighted in the DIFF image above. Red/pink areas show where the screenshots differ.',
        doc.page.margins.left,
        undefined,
        { align: 'left', width: pageWidth }
      );
      doc.fillColor('black');
    }
  }

  doc.end();
  
  // Wait for the write stream to finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => {
      console.log(`✅ Report generated: ${config.reportPath}`);
      resolve();
    });
    writeStream.on('error', (error: Error) => {
      console.error('Error writing PDF:', error);
      reject(error);
    });
  });
}

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[], 
  limit: number
): Promise<T[]> {
  const results: Promise<T>[] = [];
  const executing: Promise<T>[] = [];
  
  for (const task of tasks) {
    const p = task().then(result => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });
    results.push(p);
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function main(): Promise<void> {
  try {
    const startTime = Date.now();
    // Create directories if they don't exist
    // Create necessary directories
    await Promise.all([
      ...['dev', 'prod', 'diff'].map(dir => 
        fs.ensureDir(path.join(config.screenshotDir, dir))
      ),
      fs.emptyDir('reports')
    ]);

    const urls = await readUrlsFromExcel(config.excelFile);
    if (!urls.length) {
      console.log('No URLs to process. Exiting.');
      return;
    }

    const browser = await chromium.launchPersistentContext(contextDir, {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: null
    });

    const page = await browser.newPage();
    await ensureLoggedIn(page);
    if (!isGatedLogin) await ensureLoggedInAndNavigate(page);
    await page.close();

    const concurrency = 5;
    const tasks = urls.map(urlPath => async (): Promise<ComparisonResult | null> => {
      const taskStartTime = Date.now();
      const cleanName = urlPath.replace(/\W+/g, '_');
      const paths: ScreenshotPaths = {
        dev: `${config.screenshotDir}/dev/${cleanName}.jpg`,
        prod: `${config.screenshotDir}/prod/${cleanName}.jpg`,
        diff: `${config.screenshotDir}/diff/${cleanName}_diff.jpg` 
      };
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        const tab = await browser.newPage();
        try {
          await captureScreenshot(tab, `${config.devBase}${urlPath}`, paths.dev);
          await captureScreenshot(tab, `${config.prodBase}${urlPath}`, paths.prod);
          const { numDiffPixels, diffJpgPath } = await compareScreenshots(paths.dev, paths.prod, paths.diff);
          await tab.close();
          const taskDuration = (Date.now() - taskStartTime) / 1000;
          return {
            url: urlPath,
            match: numDiffPixels === 0,
            diffPixels: numDiffPixels,
            devPath: paths.dev,
            prodPath: paths.prod,
            diffPath: diffJpgPath,
            duration: taskDuration
          };
        } catch (error) {
          console.error(`Error processing ${urlPath} (attempt ${attempt}):`, error);
          await tab.close();
          if (attempt === 3) return null;
        }
      }
      return null;
    });

    const results = (await runWithConcurrencyLimit(tasks, concurrency)).filter(Boolean) as ComparisonResult[];
    await browser.close();

    const totalDuration = (Date.now() - startTime) / 1000;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    await generatePDFReport(
      results,
      {
        totalUrls: results.length,
        avgDuration,
        totalDuration,
        startTime,
        endTime: Date.now()
      },
      startTime,
      Date.now()
    );

  } catch (error) {
    console.error('❌ Process failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error in main:', error);
  process.exit(1);
});