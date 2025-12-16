import xlsx from "xlsx";
import fs from 'fs';

try {
    const candidates = ['input_urls.xlsx', 'input-urls.xlsx', 'Data/urls.xlsx', 'Data/input_urls.xlsx'];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error(`Excel file not found. Tried: ${candidates.join(', ')}`);
    const workbook = xlsx.readFile(found);
    const sheetName = workbook.SheetNames[0] as string;
    const worksheet = workbook.Sheets[sheetName];

    const data = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    console.log("Excel file contents:");
    console.log("Sheet name:", sheetName);
    console.log("Number of rows:", data.length);
    console.log("\nColumn names:", Object.keys(data[0] || {}));
    console.log("\nFirst few rows:");
    console.log(data.slice(0, 3));
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error reading Excel file:", message);
}
