import fs from "fs-extra";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import PDFDocument from "pdfkit";
import path from "path";
import jpeg from "jpeg-js";

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
    devDir: string;
    prodDir: string;
    diffDir: string;
    reportPath: string;
}

interface RawImage {
    width: number;
    height: number;
    data: Buffer;
}

interface ScreenshotPair {
    name: string;
    dev: string;
    prod: string;
    diff: string;
}

interface Result extends ScreenshotPair {
    diffPixels: number;
}

const config: Config = {
    devDir: "screenshots/dev",
    prodDir: "screenshots/prod",
    diffDir: "screenshots/diff",
    reportPath: computedReportPath ?? "test-results/result-report.pdf",
};

fs.ensureDirSync(config.diffDir);
fs.ensureDirSync("test-results");

function readImage(filePath: string): RawImage {
    const ext = path.extname(filePath).toLowerCase();
    const buf = fs.readFileSync(filePath);

    if (ext === ".png") {
        const png = PNG.sync.read(buf) as unknown as PNG;
        return { width: png.width, height: png.height, data: Buffer.from(png.data) };
    }

    if (ext === ".jpg" || ext === ".jpeg") {
        const jpg = jpeg.decode(buf, { useTArray: true });

        const anyJpg = jpg as unknown as { width: number; height: number; data: Buffer };

        if (anyJpg.data.length === anyJpg.width * anyJpg.height * 4) {
            return { width: anyJpg.width, height: anyJpg.height, data: Buffer.from(anyJpg.data) };
        }

        const rgba = Buffer.alloc(anyJpg.width * anyJpg.height * 4);
        for (let i = 0; i < anyJpg.width * anyJpg.height; i++) {
            rgba[i * 4 + 0] = anyJpg.data[i * 3 + 0];
            rgba[i * 4 + 1] = anyJpg.data[i * 3 + 1];
            rgba[i * 4 + 2] = anyJpg.data[i * 3 + 2];
            rgba[i * 4 + 3] = 255;
        }
        return { width: anyJpg.width, height: anyJpg.height, data: rgba };
    }

    throw new Error(`Unsupported image format: ${filePath}`);
}

function padImage(img: RawImage, targetWidth: number, targetHeight: number): RawImage {
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
    const devFiles = fs.readdirSync(config.devDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
    return devFiles
        .map((file) => ({
            name: file.replace(/\.(png|jpg|jpeg)$/i, ""),
            dev: path.join(config.devDir, file),
            prod: path.join(config.prodDir, file),
            diff: path.join(config.diffDir, file.replace(/\.(png|jpg|jpeg)$/i, "_diff.png")),
        }))
        .filter((pair) => fs.existsSync(pair.prod));
}

function compareScreenshots(devPath: string, prodPath: string, diffPath: string): number {
    let devImg = readImage(devPath);
    let prodImg = readImage(prodPath);
    const width = Math.max(devImg.width, prodImg.width);
    const height = Math.max(devImg.height, prodImg.height);

    devImg = padImage(devImg, width, height);
    prodImg = padImage(prodImg, width, height);

    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(devImg.data, prodImg.data, diff.data, width, height, { threshold: 0.1 });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    return diffPixels;
}

async function generatePDFReport(results: Result[]): Promise<void> {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(fs.createWriteStream(config.reportPath));

    for (const r of results) {
        doc.addPage();
        doc.fontSize(14).text(`URL: ${r.name}`);
        doc.moveDown();
        doc
            .fontSize(12)
            .text(`Match: ${r.diffPixels === 0 ? "✅ Yes" : `❌ No (${r.diffPixels} pixels differ)`}`);
        doc.moveDown();
        const y = doc.y;
        const leftX = doc.page.margins.left;
        const rightX = doc.page.width - doc.page.margins.right - 250;
        doc.image(r.dev, leftX, y, { width: 250 });
        doc.image(r.prod, rightX, y, { width: 250 });
        doc.y = y + 260;
        if (r.diffPixels > 0) {
            doc.moveDown();
            doc.image(r.diff, undefined, undefined, { width: 250 });
        }
        doc.moveDown();
    }

    doc.end();
    console.log(`PDF report generated: ${config.reportPath}`);
}

async function main(): Promise<void> {
    const pairs = getScreenshotPairs();
    const results: Result[] = [];

    for (const pair of pairs) {
        const diffPixels = compareScreenshots(pair.dev, pair.prod, pair.diff);
        results.push({ ...pair, diffPixels });
        console.log(`${pair.name}: ${diffPixels === 0 ? "Match" : `Diff (${diffPixels} pixels)`}`);
    }

    await generatePDFReport(results);
}

void main();
