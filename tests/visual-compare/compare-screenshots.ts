import fs from "fs-extra";
import pixelmatch from "pixelmatch";
import { PNG, PNGWithMetadata } from "pngjs";
import PDFDocument from "pdfkit";
import path from "path";
import jpeg from "jpeg-js";

interface ImageData {
  width: number;
  height: number;
  data: Buffer;
}

interface CompareResult {
  name: string;
  devPath: string;
  prodPath: string;
  diffPath: string;
  isDifferent: boolean;
  diffPixels: number;
}

const config = {
  devDir: "screenshots/dev",
  prodDir: "screenshots/prod",
  diffDir: "screenshots/diff",
  reportPath: "reports/result-report.pdf"
};

fs.ensureDirSync(config.diffDir);
fs.ensureDirSync("reports");

// Helper to read PNG or JPG as {width, height, data}
function readImage(filePath: string): ImageData {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  
  if (ext === '.png') {
    const png = PNG.sync.read(buffer);
    return {
      width: png.width,
      height: png.height,
      data: png.data
    };
  } else if (ext === '.jpg' || ext === '.jpeg') {
    const jpegData = jpeg.decode(buffer, { useTArray: true });
    return {
      width: jpegData.width,
      height: jpegData.height,
      data: Buffer.from(jpegData.data)
    };
  }
  throw new Error(`Unsupported image format: ${ext}`);
}

// Pad image to target size (white background)
function padImage(img: ImageData, targetWidth: number, targetHeight: number): ImageData {
  if (img.width === targetWidth && img.height === targetHeight) {
    return img;
  }

  const result = {
    width: targetWidth,
    height: targetHeight,
    data: Buffer.alloc(targetWidth * targetHeight * 4, 255) // Fill with white
  };

  // Copy original image data to the center
  const offsetX = Math.floor((targetWidth - img.width) / 2);
  const offsetY = Math.floor((targetHeight - img.height) / 2);

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const srcIdx = (y * img.width + x) * 4;
      const destIdx = ((y + offsetY) * targetWidth + (x + offsetX)) * 4;
      
      result.data[destIdx] = img.data[srcIdx];         // R
      result.data[destIdx + 1] = img.data[srcIdx + 1]; // G
      result.data[destIdx + 2] = img.data[srcIdx + 2]; // B
      result.data[destIdx + 3] = img.data[srcIdx + 3]; // A
    }
  }
  
  return result;
}

function getScreenshotPairs(): Array<{name: string, devPath: string, prodPath: string, diffPath: string}> {
  const devFiles = new Set(fs.readdirSync(config.devDir));
  const prodFiles = new Set(fs.readdirSync(config.prodDir));
  
  const commonFiles = [...devFiles].filter(file => prodFiles.has(file));
  
  return commonFiles.map(file => ({
    name: path.basename(file, path.extname(file)),
    devPath: path.join(config.devDir, file),
    prodPath: path.join(config.prodDir, file),
    diffPath: path.join(config.diffDir, `diff-${file}`)
  }));
}

function compareScreenshots(devPath: string, prodPath: string, diffPath: string): Promise<{isDifferent: boolean, diffPixels: number}> {
  return new Promise((resolve) => {
    try {
      const img1 = readImage(devPath);
      const img2 = readImage(prodPath);
      
      // Use the larger dimensions for both images
      const maxWidth = Math.max(img1.width, img2.width);
      const maxHeight = Math.max(img1.height, img2.height);
      
      const padded1 = padImage(img1, maxWidth, maxHeight);
      const padded2 = padImage(img2, maxWidth, maxHeight);
      
      const diff = new PNG({ width: maxWidth, height: maxHeight });
      
      const diffPixels = pixelmatch(
        padded1.data, 
        padded2.data, 
        diff.data, 
        maxWidth, 
        maxHeight, 
        { threshold: 0.1 }
      );
      
      const isDifferent = diffPixels > 0;
      
      if (isDifferent) {
        fs.writeFileSync(diffPath, PNG.sync.write(diff));
      }
      
      resolve({ isDifferent, diffPixels });
    } catch (error) {
      console.error(`Error comparing ${devPath} and ${prodPath}:`, error);
      resolve({ isDifferent: true, diffPixels: Infinity });
    }
  });
}

async function generatePDFReport(results: CompareResult[]): Promise<void> {
  const doc = new PDFDocument();
  const stream = fs.createWriteStream(config.reportPath);
  doc.pipe(stream);
  
  doc.fontSize(20).text('Screenshot Comparison Report', { align: 'center' } as any);
  doc.moveDown();
  
  const now = new Date();
  doc.fontSize(12).text(`Generated on: ${now.toLocaleString()}`, { align: 'center' } as any);
  doc.moveDown(2);
  
  // Summary
  const differentCount = results.filter(r => r.isDifferent).length;
  doc.fontSize(16).text('Summary', { underline: true } as any);
  doc.fontSize(12).text(`Total comparisons: ${results.length}`);
  doc.text(`Differences found: ${differentCount} (${(differentCount / results.length * 100).toFixed(1)}%)`);
  doc.moveDown(2);
  
  // Detailed results
  doc.fontSize(16).text('Detailed Results', { underline: true } as any);
  doc.moveDown(1);
  
  results.forEach((result, index) => {
    doc.fontSize(14).text(`${index + 1}. ${result.name}`, { underline: true } as any);
    doc.fontSize(12).text(`Status: ${result.isDifferent ? 'DIFFERENT' : 'IDENTICAL'}`);
    
    if (result.isDifferent) {
      doc.text(`Different pixels: ${result.diffPixels}`);
      
      // Add images side by side
      const imageWidth = 200;
      const imageHeight = 150;
      const startX = 50;
      
      try {
        // Dev image
        doc.image(result.devPath, startX, doc.y + 10, { width: imageWidth, height: imageHeight });
        doc.text('Dev', startX, doc.y + imageHeight + 5);
        
        // Prod image
        doc.image(result.prodPath, startX + imageWidth + 20, doc.y - imageHeight - 15, { width: imageWidth, height: imageHeight });
        doc.text('Prod', startX + imageWidth + 20, doc.y + 5);
        
        // Diff image
        doc.image(result.diffPath, startX + (imageWidth + 20) * 2, doc.y - imageHeight - 15, { width: imageWidth, height: imageHeight });
        doc.text('Difference', startX + (imageWidth + 20) * 2, doc.y + 5);
      } catch (error) {
        doc.text('Error loading images for comparison');
      }
    }
    
    doc.moveDown(2);
  });
  
  doc.end();
  
  return new Promise<void>((resolve, reject) => {
    stream.on('finish', () => {
      console.log(`Report generated at: ${path.resolve(config.reportPath)}`);
      resolve();
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  try {
    const pairs = getScreenshotPairs();
    console.log(`Found ${pairs.length} screenshot pairs to compare`);
    
    const results: CompareResult[] = [];
    
    for (const pair of pairs) {
      console.log(`Comparing ${pair.name}...`);
      const { isDifferent, diffPixels } = await compareScreenshots(
        pair.devPath,
        pair.prodPath,
        pair.diffPath
      );
      
      results.push({
        name: pair.name,
        devPath: pair.devPath,
        prodPath: pair.prodPath,
        diffPath: pair.diffPath,
        isDifferent,
        diffPixels
      });
    }
    
    await generatePDFReport(results);
    console.log('Comparison complete');
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main();
