import { Reporter, TestCase, TestResult, FullResult, FullConfig } from '@playwright/test/reporter';
import { generatePDFReport } from './pdf-report-generator.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PDFReporter implements Reporter {
  private testResults: any[] = [];
  private projectName = '';

  onBegin(config: FullConfig) {
    // Capture project name (browser) when tests start
    // Find the current project being run
    const currentProject = config.projects?.find(project => 
      project.name === 'chromium' || project.name === 'firefox' || project.name === 'webkit'
    );
    this.projectName = currentProject?.name || 'chromium';
    console.log(`PDF Reporter: Captured browser name: ${this.projectName}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Get browser name from the captured project name
    const browserName = this.projectName;
    
    // Extract URL redirection details from test title or result
    let urlDetails = null;
    if (test.title.includes('Redirect validation')) {
      // For redirection tests, try to extract URL details from the test
      // This would need to be passed from the test itself
      urlDetails = {
        from_url: 'URL redirection test',
        to_url: 'See detailed HTML report',
        status: result.status
      };
    }
    
    // Collect test results with browser name and URL details
    this.testResults.push({
      title: test.title,
      file: test.location.file,
      line: test.location.line,
      status: result.status,
      duration: result.duration,
      error: result.error?.message,
      steps: result.steps?.map((step: any) => step.title),
      screenshots: result.attachments?.filter((a: any) => a.name === 'screenshot').map((a: any) => a.path),
      browser: browserName,
      urlDetails: urlDetails
    });
  }

  async onEnd(result: FullResult) {
    try {
      console.log('Generating PDF report...');
      
      // Use the JSON parsing function to generate PDF
      const testResultsPath = path.join(__dirname, '../test-results/test-results.json');
      const pdfOutputPath = path.join(__dirname, '../test-results/test-report.pdf');
      
      console.log(`JSON path: ${testResultsPath}`);
      console.log(`PDF path: ${pdfOutputPath}`);
      
      await generatePDFReport(testResultsPath, pdfOutputPath);
      
      console.log(`PDF report generated at: ${pdfOutputPath}`);
    } catch (error) {
      console.error('Error generating PDF report:', error);
    }
  }
}

export default PDFReporter;
