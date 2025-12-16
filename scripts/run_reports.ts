import { spawnSync } from 'child_process';
import * as path from 'path';

function run(cmd: string, args: string[], options: any = {}) {
    const full = [cmd].concat(args).join(' ');
    console.log(`> ${full}`);
    const res = spawnSync(full, { stdio: 'inherit', shell: true, ...options });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`${cmd} exited with code ${res.status}`);
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
    try {
        const ts = timestamp();

        // 1) Run visual compare and save to grouped PDF
        const visualReport = `test-results/visual-compare-${ts}.pdf`;
        run('npx', ['tsx', 'tests/visual-compare/compare_optimize.ts', `--report=${visualReport}`]);

        // 2) Run playwright tests for form, redirection, registration
        // This will produce test-results/test-results.json (via playwright config)
        // Playwright reporter configured in playwright.config.cjs to write JSON to test-results/test-results.json
        run('npx', ['playwright', 'test', 'tests/form', 'tests/redirection', 'tests/registration']);

        // 3) Generate combined PDF for these other tests
        const otherReport = `test-results/other-tests-${ts}.pdf`;
        run('npx', ['tsx', 'utils/generate-test-pdf.ts', `--json=test-results/test-results.json`, `--report=${otherReport}`]);

        console.log('All reports generated:');
        console.log(' -', visualReport);
        console.log(' -', otherReport);
    } catch (error) {
        console.error('Error running reports:', error);
        process.exit(1);
    }
}

void main();
