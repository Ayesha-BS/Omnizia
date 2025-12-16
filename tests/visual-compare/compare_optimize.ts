import fs from 'fs-extra';
import XLSX from 'xlsx';
import { chromium, Page } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

// CLI arg helpers: --report=path or --group=name
const argv = process.argv.slice(2);
function getArgValue(prefix: string): string | undefined {
    const a = argv.find((p) => p.startsWith(prefix));
    return a ? a.slice(prefix.length) : undefined;
}
const reportArg = getArgValue('--report=');
const groupArg = getArgValue('--group=');
const _timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const computedReportPath = reportArg ?? (groupArg ? `test-results/${groupArg}-${_timestamp}.pdf` : undefined);

interface Config {
    stageBase: string;
    prodBase: string;
    excelFile: string;
    screenshotDir: string;
    reportPath: string;
}

interface ScreenshotPaths {
    stage: string;
    prod: string;
    diff: string;
}

interface ComparisonResult {
    url: string;
    match: boolean;
    diffPixels: number;
    stagePath: string;
    prodPath: string;
    diffPath: string;
    duration: number;
}

interface Summary {
    totalUrls: number;
    avgDuration: number;
    totalDuration: number;
    startTime: number;
    endTime: number;
}

interface ImageDimensions {
    width: number;
    height: number;
}

const contextDir = './auth-session';

let cookieAccepted = false;
let isGatedLogin = false;

const config: Config = {
    stageBase: 'https://stage.recordati-plus.de',
    prodBase: 'https://recordati-plus.de',
    excelFile: 'urls.xlsx',
    screenshotDir: 'screenshots',
    reportPath: computedReportPath ?? 'test-results/result-2.pdf',
};

function getEnvironment(url: string): string {
    if (url.includes('localhost')) return 'local';
    if (url.includes('dev.')) return 'Dev';
    if (url.includes('stage.')) return 'Stage';
    return 'Prod';
}

async function readUrlsFromExcel(filePath: string): Promise<string[]> {
    const candidates = [filePath, 'Data/urls.xlsx', 'Data/input_urls.xlsx', 'Data/input-urls.xlsx', 'input_urls.xlsx', 'input-urls.xlsx'];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error(`Excel file not found. Tried: ${candidates.join(', ')}`);
    const workbook = XLSX.readFile(found);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    if (!data.length) throw new Error('Excel file is empty');
    const firstColumnName = Object.keys(data[0])[0] as string;

    return data
        .map((row): string | null => {
            const fullUrl = row[firstColumnName];
            if (!fullUrl) return null;

            try {
                const url = new URL(String(fullUrl));
                return url.pathname;
            } catch {
                const cleanUrl = String(fullUrl).trim();
                return cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`;
            }
        })
        .filter((v): v is string => Boolean(v));
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await page.goto(`${config.stageBase}/de_DE/overview-page`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('sso.omnizia.com')) {
        console.log('🔑 Login required. Please complete login in the opened browser...');
        await page.waitForURL((url) => url.toString().startsWith(config.stageBase), { timeout: 120000 });
        console.log('✅ Login successful.');
    } else {
        console.log('✅ Already logged in.');
    }
}

async function ensureLoggedInAndNavigate(page: Page): Promise<void> {
    await page.goto(`${config.stageBase}/de_DE/account/signin`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/account/signin')) {
        console.log('🔑 STAGE Login required. Please complete login in the opened browser...');
        await page.waitForURL(
            (url) => url.toString().startsWith(config.stageBase) && !url.toString().includes('/account/signin'),
            { timeout: 120000 },
        );
        console.log('✅ STAGE Login successful.');
    } else {
        console.log('✅ STAGE Already logged in.');
    }

    await page.goto(`${config.prodBase}/de_DE/account/signin`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/account/signin')) {
        console.log('🔑 PROD Login required. Please complete login in the opened browser...');
        await page.waitForURL(
            (url) => url.toString().startsWith(config.prodBase) && !url.toString().includes('/account/signin'),
            { timeout: 120000 },
        );
        console.log('✅ PROD Login successful.');
    } else {
        console.log('✅ PROD Already logged in.');
    }
    isGatedLogin = true;
}

async function captureScreenshot(page: Page, url: string, outputPath: string): Promise<void> {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    if (!cookieAccepted) {
        try {
            const cookieButton = page.locator('button.cky-btn-accept[aria-label="Alle akzeptieren"]').first();
            if (await cookieButton.isVisible()) {
                await cookieButton.click();
                await page.waitForTimeout(500);
                cookieAccepted = true;
            }
        } catch {
            // ignore
        }
    }

    await page.addStyleTag({
        content: `
      .app_container.theme { position: static !important; height: auto !important; }
      .layout { position: relative !important; height: auto !important; }
      .theme .content { position: static !important; display: block !important; }
    `,
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: 'jpeg',
        quality: 100,
    });
}

function padImage(img: PNG, targetWidth: number, targetHeight: number): PNG {
    if (img.width === targetWidth && img.height === targetHeight) return img;
    const padded = new PNG({ width: targetWidth, height: targetHeight, fill: true });
    padded.data.fill(255);
    PNG.bitblt(img, padded, 0, 0, img.width, img.height, 0, 0);
    return padded;
}

async function compareScreenshots(
    img1Path: string,
    img2Path: string,
    diffPath: string,
): Promise<{ numDiffPixels: number; diffJpgPath: string }> {
    const img1Buffer = await sharp(img1Path).png().toBuffer();
    const img2Buffer = await sharp(img2Path).png().toBuffer();
    let img1: PNG = PNG.sync.read(img1Buffer) as unknown as PNG;
    let img2: PNG = PNG.sync.read(img2Buffer) as unknown as PNG;

    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);
    img1 = padImage(img1, width, height);
    img2 = padImage(img2, width, height);

    const diff = new PNG({ width, height });
    const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });

    const diffJpgPath = diffPath.replace(/\.png$/, '.jpg');
    const diffPngBuffer = PNG.sync.write(diff);
    await sharp(diffPngBuffer).jpeg({ quality: 100 }).toFile(diffJpgPath);

    return { numDiffPixels, diffJpgPath };
}

async function generatePDFReport(
    results: ComparisonResult[],
    summary: Summary,
    startTime: number,
    endTime: number,
): Promise<void> {
    const doc = new PDFDocument({
        autoFirstPage: false,
        margins: { top: 20, bottom: 20, left: 50, right: 50 },
    });
    const writeStream = fs.createWriteStream(config.reportPath);
    doc.pipe(writeStream);

    doc.addPage();
    doc.fontSize(24).text('Visual Comparison Report', undefined, undefined, { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(16).text(' 🚀 Performance Summary', undefined, undefined, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total URLs processed: ${summary.totalUrls}`);
    doc.text(`Start time: ${startTime} - End time: ${endTime}`);
    doc.text(`Average task duration: ${summary.avgDuration.toFixed(2)}s`);
    doc.text(`Total execution time: ${summary.totalDuration.toFixed(2)}s`);
    doc.text(`Total time: ${(summary.totalDuration / 60).toFixed(2)} min / ${(summary.totalDuration / 3600).toFixed(2)} hr`);
    doc.moveDown(1);
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, undefined, undefined, { align: 'center' });

    async function calculateDimensions(imgPath: string, imgWidth: number, imageMaxheight: number): Promise<ImageDimensions> {
        if (fs.existsSync(imgPath)) {
            const meta = await sharp(imgPath).metadata();
            const metaWidth = meta.width ?? 0;
            const metaHeight = meta.height ?? 0;
            if (!metaWidth || !metaHeight) return { width: 0, height: 0 };

            let finalWidth = imgWidth;
            let finalHeight = (metaHeight * imgWidth) / metaWidth;
            if (finalHeight > imageMaxheight) {
                finalHeight = imageMaxheight;
                finalWidth = (metaWidth * finalHeight) / metaHeight;
            }
            return { width: finalWidth, height: finalHeight };
        }
        return { width: 0, height: 0 };
    }

    async function drawImageWithLabel(
        imgPath: string,
        label: string,
        x: number,
        y: number,
        imgWidth: number,
        imageMaxheight: number,
    ): Promise<number> {
        if (fs.existsSync(imgPath)) {
            const resizedPath = imgPath.replace(/\.jpg$/, `_resized.jpg`);
            const meta = await sharp(imgPath).metadata();
            const metaWidth = meta.width ?? 0;
            const metaHeight = meta.height ?? 0;
            if (!metaWidth || !metaHeight) return 0;

            let finalWidth = imgWidth;
            let finalHeight = (metaHeight * imgWidth) / metaWidth;
            if (finalHeight > imageMaxheight) {
                finalHeight = imageMaxheight;
                finalWidth = (metaWidth * finalHeight) / metaHeight;
            }

            await sharp(imgPath)
                .resize({ width: Math.round(finalWidth), height: Math.round(finalHeight), fit: 'inside' })
                .jpeg({ quality: 80 })
                .toFile(resizedPath);

            doc.fontSize(10).text(label, x, y, { width: finalWidth, align: 'center' });
            doc.image(resizedPath, x, y + 15, { width: finalWidth });
            fs.unlinkSync(resizedPath);
            return finalHeight;
        }
        return 0;
    }

    for (const result of results) {
        doc.addPage();
        doc.fontSize(16).text(`URL: ${result.url}`, undefined, undefined, { underline: true });
        doc.moveDown();

        const imgWidth = 180;
        const imgGap = 30;
        const pageWidth = doc.page.width;
        const totalWidth = imgWidth * 3 + imgGap * 2;
        const startX = (pageWidth - totalWidth) / 2;
        const y = doc.y;
        const imageMaxheight = 580;

        const stageDims = await calculateDimensions(result.stagePath, imgWidth, imageMaxheight);
        const prodDims = await calculateDimensions(result.prodPath, imgWidth, imageMaxheight);
        const diffDims = await calculateDimensions(result.diffPath, imgWidth, imageMaxheight);

        const stageHeight = stageDims.height
            ? await drawImageWithLabel(result.stagePath, getEnvironment(config.stageBase), startX, y, imgWidth, imageMaxheight)
            : 0;
        const prodHeight = prodDims.height
            ? await drawImageWithLabel(result.prodPath, getEnvironment(config.prodBase), startX + imgWidth + imgGap, y, imgWidth, imageMaxheight)
            : 0;
        const diffHeight = diffDims.height
            ? await drawImageWithLabel(result.diffPath, 'Compare', startX + (imgWidth + imgGap) * 2, y, imgWidth, imageMaxheight)
            : 0;

        const maxImgHeight = Math.max(stageHeight, prodHeight, diffHeight);
        const descY = y + maxImgHeight + 45;

        doc.x = doc.page.margins.left;
        doc.y = descY;
        doc.moveDown();
        doc.fontSize(14).text(
            `Match: ${result.match ? '✅ No visual difference' : `❌ ${result.diffPixels} pixels differ`}`,
            undefined,
            undefined,
            { align: 'left', width: pageWidth - doc.page.margins.left - doc.page.margins.right },
        );
        if (!result.match) {
            doc.moveDown();
            doc
                .fontSize(12)
                .fillColor('red')
                .text('Differences highlighted in the DIFF image above. Red/pink areas show where the screenshots differ.',
                    undefined,
                    undefined,
                    {
                        align: 'left',
                        width: pageWidth - doc.page.margins.left - doc.page.margins.right,
                    },
                );
            doc.fillColor('black');
        }
    }

    doc.end();
    await new Promise<void>((resolve) => writeStream.on('finish', () => resolve()));
    console.log(`📄 PDF report generated: ${config.reportPath}`);
}

async function runWithConcurrencyLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
    const results: Array<Promise<T>> = [];
    const executing: Array<Promise<T>> = [];
    for (const task of tasks) {
        const p = task().then((result) => {
            const idx = executing.indexOf(p);
            if (idx >= 0) executing.splice(idx, 1);
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

        ['stage', 'prod', 'diff'].forEach((dir) => {
            fs.emptyDirSync(`${config.screenshotDir}/${dir}`);
            fs.ensureDirSync(`${config.screenshotDir}/${dir}`);
        });
        fs.emptyDirSync('test-results');
        fs.ensureDirSync('test-results');

        const urls = await readUrlsFromExcel(config.excelFile);
        if (!urls.length) {
            console.log('No URLs to process. Exiting.');
            return;
        }

        const browser = await chromium.launchPersistentContext(contextDir, {
            headless: false,
            args: ['--disable-blink-features=AutomationControlled'],
            viewport: null,
        });

        const page = await browser.newPage();
        await ensureLoggedIn(page);
        if (!isGatedLogin) await ensureLoggedInAndNavigate(page);
        await page.close();

        const concurrency = 5;

        const tasks: Array<() => Promise<ComparisonResult | null>> = urls.map((urlPath) => async () => {
            const taskStartTime = Date.now();
            const cleanName = urlPath.replace(/\W+/g, '_');
            const paths: ScreenshotPaths = {
                stage: `${config.screenshotDir}/stage/${cleanName}.jpg`,
                prod: `${config.screenshotDir}/prod/${cleanName}.jpg`,
                diff: `${config.screenshotDir}/diff/${cleanName}_diff.png`,
            };

            for (let attempt = 1; attempt <= 3; attempt++) {
                const tab = await browser.newPage();
                try {
                    await captureScreenshot(tab, `${config.stageBase}${urlPath}`, paths.stage);
                    await captureScreenshot(tab, `${config.prodBase}${urlPath}`, paths.prod);
                    const { numDiffPixels, diffJpgPath } = await compareScreenshots(paths.stage, paths.prod, paths.diff);
                    await tab.close();

                    const taskDuration = (Date.now() - taskStartTime) / 1000;
                    return {
                        url: urlPath,
                        match: numDiffPixels === 0,
                        diffPixels: numDiffPixels,
                        stagePath: paths.stage,
                        prodPath: paths.prod,
                        diffPath: diffJpgPath,
                        duration: taskDuration,
                    };
                } catch {
                    await tab.close();
                    if (attempt === 3) return null;
                }
            }
            return null;
        });

        const results = (await runWithConcurrencyLimit(tasks, concurrency)).filter(
            (r): r is ComparisonResult => Boolean(r),
        );
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
                endTime: Date.now(),
            },
            startTime,
            Date.now(),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('❌ Process failed:', message);
        process.exit(1);
    }
}

void main();
