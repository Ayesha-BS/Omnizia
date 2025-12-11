import { generatePDFReport } from './pdf-report-generator.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    const testResultsPath = path.join(__dirname, '../test-results/test-results.json');
    const pdfOutputPath = path.join(__dirname, '../test-results/test-report.pdf');
    
    console.log('Generating PDF report...');
    await generatePDFReport(testResultsPath, pdfOutputPath);
    console.log(`PDF report generated at: ${pdfOutputPath}`);
  } catch (error) {
    console.error('Error generating PDF report:', error);
    process.exit(1);
  }
}

main();
