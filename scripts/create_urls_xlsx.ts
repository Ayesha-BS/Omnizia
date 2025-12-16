import fs from 'fs-extra';
import XLSX from 'xlsx';

async function main() {
    await fs.ensureDir('Data');

    const rows = [
        { url: '/de_DE/overview-page' },
        { url: '/de_DE/account/signin' },
        { url: '/product/12345' },
    ];

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    const outPath = 'Data/urls.xlsx';
    XLSX.writeFile(workbook, outPath);
    console.log('Wrote', outPath);
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
