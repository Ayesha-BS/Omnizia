import { generatePDFReport } from './pdf-report-generator.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArgValue(prefix: string): string | undefined {
  const arg = process.argv.slice(2).find((p) => p.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  try {
    const testResultsPathArg = getArgValue('--json=');
    const pdfOutputArg = getArgValue('--report=');

    const testResultsPath = testResultsPathArg
      ? path.isAbsolute(testResultsPathArg)
        ? testResultsPathArg
        : path.join(process.cwd(), testResultsPathArg)
      : path.join(__dirname, '../test-results/test-results.json');

    const pdfOutputPath = pdfOutputArg
      ? path.isAbsolute(pdfOutputArg)
        ? pdfOutputArg
        : path.join(process.cwd(), pdfOutputArg)
      : path.join(__dirname, '../test-results/test-report.pdf');

    console.log('Generating PDF report...');
    console.log(`Using JSON: ${testResultsPath}`);
    console.log(`Output PDF: ${pdfOutputPath}`);
    await generatePDFReport(testResultsPath, pdfOutputPath);
    console.log(`PDF report generated at: ${pdfOutputPath}`);
  } catch (error) {
    console.error('Error generating PDF report:', error);
    process.exit(1);
  }
}

main();
