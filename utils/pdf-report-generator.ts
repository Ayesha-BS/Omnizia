import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  suiteName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string | { message: string };
  screenshots?: string[];
  steps?: string[];
  browser?: string;
  urlDetails?: {
    from_url: string;
    to_url: string;
    status: string;
    details?: string[];
  };
}

interface TestReport {
  title: string;
  date: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  testResults: TestResult[];
}

export class PDFReportGenerator {
  private doc: PDFDocument;
  private outputPath: string;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    this.doc = new PDFDocument({ margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  }

  generateReport(testReport: TestReport): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Pipe the PDF to a file
        const stream = fs.createWriteStream(this.outputPath);
        this.doc.pipe(stream);

        // Add content to the PDF
        this.addHeader(testReport);
        this.addSummary(testReport);
        this.addTestDetails(testReport.testResults);

        // Finalize the PDF
        this.doc.end();

        stream.on('finish', () => {
          console.log(`PDF report generated: ${this.outputPath}`);
          resolve();
        });

        stream.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private addHeader(report: TestReport): void {
    // Title
    this.doc.fontSize(24).font('Helvetica-Bold').text('Test Execution Report', this.doc.x, this.doc.y, { align: 'center' });
    this.doc.moveDown();

    // Date and time
    this.doc.fontSize(12).font('Helvetica').text(`Date: ${report.date}`, this.doc.x, this.doc.y, { align: 'center' });
    this.doc.text(`Total Duration: ${(report.totalDuration / 1000).toFixed(2)} seconds`, this.doc.x, this.doc.y, { align: 'center' });
    this.doc.moveDown();

    // Separator line
    this.doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, this.doc.y).lineTo(545, this.doc.y).stroke();
    this.doc.moveDown();
  }

  private addSummary(report: TestReport): void {
    this.doc.fontSize(16).font('Helvetica-Bold').text('Test Summary');
    this.doc.moveDown();

    const summaryData: Array<[string, string, { color: string } | undefined]> = [
      ['Total Tests', report.totalTests.toString(), undefined],
      ['Passed', report.passed.toString(), { color: '#4CAF50' }],
      ['Failed', report.failed.toString(), { color: '#F44336' }],
      ['Skipped', report.skipped.toString(), { color: '#FF9800' }],
      ['Success Rate', `${((report.passed / report.totalTests) * 100).toFixed(2)}%`, undefined]
    ];

    // Create summary table
    let yPosition = this.doc.y;
    summaryData.forEach(([label, value, options]) => {
      this.doc.fontSize(12).font('Helvetica').text(label, 50, yPosition);
      if (options && options.color) {
        this.doc.fillColor(options.color);
      }
      this.doc.font('Helvetica-Bold').text(value, 200, yPosition);
      this.doc.fillColor('black');
      yPosition += 20;
    });

    this.doc.moveDown();
    this.doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, this.doc.y).lineTo(545, this.doc.y).stroke();
    this.doc.moveDown();
  }

  private addTestDetails(testResults: TestResult[]): void {
    this.doc.fontSize(16).font('Helvetica-Bold').text('Test Details');
    this.doc.moveDown();

    testResults.forEach((test, index) => {
      // Test name and status only
      const testName = test.suiteName || `Test ${index + 1}`;
      this.doc.fontSize(12).font('Helvetica-Bold').text(`${index + 1}. ${testName}`);
      
      // Status with color
      const statusColor = test.status === 'passed' ? '#4CAF50' : test.status === 'failed' ? '#F44336' : '#FF9800';
      this.doc.fillColor(statusColor).font('Helvetica').text(`Status: ${test.status ? test.status.toUpperCase() : 'UNKNOWN'}`);
      this.doc.fillColor('black');

      // Show URL redirection details if available
      if (test.urlDetails) {
        this.doc.font('Helvetica-Bold').text('URL Redirection:');
        this.doc.font('Helvetica').text(`From: ${test.urlDetails.from_url}`);
        this.doc.font('Helvetica').text(`To: ${test.urlDetails.to_url}`);
        this.doc.font('Helvetica').text(`Status: ${test.urlDetails.status}`);
        if (test.urlDetails.details) {
          this.doc.font('Helvetica-Bold').text('URL Details:');
          test.urlDetails.details.forEach((detail: string, index: number) => {
            this.doc.moveDown();
            if (detail.includes('passed:')) {
              this.doc.fillColor('#4CAF50');
              this.doc.font('Helvetica').text(`${index + 1}. ${detail}`, 70, this.doc.y);
              this.doc.fillColor('black');
            } else if (detail.includes('failed:')) {
              this.doc.fillColor('#F44336');
              this.doc.font('Helvetica').text(`${index + 1}. ${detail}`, 70, this.doc.y);
              this.doc.fillColor('black');
            } else {
              this.doc.font('Helvetica').text(`${index + 1}. ${detail}`, 70, this.doc.y);
            }
            this.doc.moveDown();
          });
        }
        this.doc.moveDown();
      }

      // Add separator between tests
      if (index < testResults.length - 1) {
        this.doc.moveDown();
        this.doc.strokeColor('#eeeeee').lineWidth(0.5).moveTo(50, this.doc.y).lineTo(545, this.doc.y).stroke();
        this.doc.moveDown();
      }
    });
  }
}

// Function to generate PDF from JSON test results
export async function generatePDFReport(jsonResultsPath: string, outputPath: string): Promise<void> {
  try {
    // Read the JSON test results
    const jsonContent = fs.readFileSync(jsonResultsPath, 'utf8');
    const testData = JSON.parse(jsonContent);

    // Transform the data to our format
    const testReport: TestReport = {
      title: 'Playwright Test Report',
      date: new Date().toLocaleString(),
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      totalDuration: 0,
      testResults: []
    };

    // Process each test from the JSON structure
    console.log('JSON data keys:', Object.keys(testData));
    console.log('Suites array length:', testData.suites?.length || 0);
    
    if (testData.suites) {
      testData.suites.forEach((suite: any, suiteIndex: number) => {
        console.log(`Processing suite ${suiteIndex + 1}: ${suite.title}`);
        if (suite.specs) {
          suite.specs.forEach((spec: any, specIndex: number) => {
            console.log(`Processing spec ${specIndex + 1}: ${spec.title}`);
            if (spec.tests) {
              spec.tests.forEach((test: any, testIndex: number) => {
                console.log(`Processing test ${testIndex + 1}: ${test.title || 'Unknown Test'}`);
                testReport.totalTests++;
        
        const result = test.results?.[0];
        if (result) {
          testReport.totalDuration += result.duration || 0;
        }

        // Extract URL redirection details from test output
        let urlDetails = undefined;
        if (spec.title && spec.title.includes('Redirect validation')) {
          const output = result?.stdout || [];
          // Only get PASS and FAIL lines, not Testing: lines to avoid duplicates
          const urlLines = output.filter((line: any) => 
            line.text.includes('PASS:') || 
            line.text.includes('FAIL:')
          );
          
          if (urlLines.length > 0) {
            const passedUrls = urlLines.filter((line: any) => line.text.includes('PASS:'));
            const failedUrls = urlLines.filter((line: any) => line.text.includes('FAIL:'));
            
            // Create simple URL format: "passed: from URL to to URL"
            const urlDetailsList = urlLines.map((line: any) => {
              const text = line.text.trim();
              if (text.includes('PASS:')) {
                // Handle both formats: "PASS: Redirected correctly to URL" and "PASS: from -> to"
                const redirectedMatch = text.match(/PASS:\s*Redirected correctly to\s*(.+)/);
                const arrowMatch = text.match(/PASS:\s*(.+?)\s*->\s*(.+)/);
                if (redirectedMatch) {
                  return `passed: redirected correctly to ${redirectedMatch[1].trim()}`;
                } else if (arrowMatch) {
                  return `passed: ${arrowMatch[1].trim()} to ${arrowMatch[2].trim()}`;
                }
              } else if (text.includes('FAIL:')) {
                const match = text.match(/FAIL:\s*(.+?)\s*->\s*(.+?)\s*\(Expected:\s*(.+)/);
                if (match) {
                  return `failed: ${match[1].trim()} to ${match[2].trim()} (expected: ${match[3].trim()})`;
                }
              }
              return text;
            });
            
            urlDetails = {
              from_url: 'Multiple URLs tested',
              to_url: `Passed: ${passedUrls.length}, Failed: ${failedUrls.length}`,
              status: result?.status || 'skipped',
              details: urlDetailsList
            };
          }
        }

        const testResult: TestResult = {
          suiteName: `${spec.title || 'Unknown Spec'} > ${test.title || 'Unknown Test'}`,
          status: result?.status || 'skipped',
          duration: result?.duration || 0,
          error: result?.errors?.[0]?.message || undefined,
          steps: [],
          screenshots: (result?.attachments?.filter((a: any) => a.name === 'screenshot').map((a: any) => a.path) || []),
          urlDetails: urlDetails
        };

        if (testResult.status === 'passed') testReport.passed++;
        else if (testResult.status === 'failed') testReport.failed++;
        else testReport.skipped++;

        testReport.testResults.push(testResult);
              });
            }
          });
        }
      });
    }

    // Generate the PDF
    console.log('Final test report:', {
      totalTests: testReport.totalTests,
      passed: testReport.passed,
      failed: testReport.failed,
      skipped: testReport.skipped,
      testResultsCount: testReport.testResults.length
    });
    
    const generator = new PDFReportGenerator(outputPath);
    await generator.generateReport(testReport);

    console.log('PDF report generated successfully!');
  } catch (error) {
    console.error('Error generating PDF report:', error);
    throw error;
  }
}
