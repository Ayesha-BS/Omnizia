import { chromium, Browser, BrowserContext, Page } from "playwright";
import xlsx from "xlsx";
import fs from "fs-extra";
import path from "path";
import readline from "readline";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function question(query: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(query, (answer) => resolve(answer));
    });
}

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

interface Tab {
    page: Page;
    busy: boolean;
}

class TabPool {
    private browser: Browser;
    private size: number;
    private tabs: Tab[] = [];
    private isInitialized = false;
    private context: BrowserContext | null = null;

    constructor(browser: Browser, size: number) {
        this.browser = browser;
        this.size = size;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        this.context = await this.browser.newContext();

        for (let i = 0; i < this.size; i++) {
            const page = await this.context.newPage();
            this.tabs.push({ page, busy: false });
        }

        this.isInitialized = true;
    }

    async getTab(): Promise<Tab> {
        await this.initialize();

        while (true) {
            const tab = this.tabs.find((t) => !t.busy);
            if (tab) {
                tab.busy = true;
                return tab;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    releaseTab(tab: Tab): void {
        const tabIndex = this.tabs.findIndex((t) => t.page === tab.page);
        if (tabIndex !== -1) {
            this.tabs[tabIndex].busy = false;
        }
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
    }
}

async function handleLogin(page: Page): Promise<void> {
    console.log("\n⚠️ Login required! Please follow these steps:");
    console.log("1. A browser window will open");
    console.log("2. Please login to your account");
    console.log("3. After login, you will be redirected to the target page");
    console.log("4. Once you have logged in successfully, press Enter in this console");

    await question("Press Enter after you have logged in successfully...");
    await page.waitForTimeout(2000);

    console.log("Login successful! Continuing with link extraction...");
}

async function ensureLogin(tabPool: TabPool): Promise<void> {
    const tab = await tabPool.getTab();
    try {
        await tab.page.goto("https://recordati-plus.de/de_DE/account/signin", { waitUntil: "networkidle" });

        if (tab.page.url().includes("/account/signin")) {
            await handleLogin(tab.page);
        }
    } finally {
        tabPool.releaseTab(tab);
    }
}

interface ExtractedLinks {
    index: number;
    url: string;
    internalLinks: string[];
    externalLinks: string[];
}

async function extractLinks(tabPool: TabPool, url: string, index: number): Promise<ExtractedLinks> {
    const tab = await tabPool.getTab();
    try {
        await tab.page.goto(url, { waitUntil: "networkidle" });

        await tab.page.evaluate(() => {
            const header = document.querySelector(".layout > .header");
            const footer = document.querySelector("footer");
            if (header) header.remove();
            if (footer) footer.remove();
        });

        const links = await tab.page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
            return anchors.map((a) => a.href);
        });

        const baseUrl = new URL(url);
        const internalLinks: string[] = [];
        const externalLinks: string[] = [];

        links.forEach((link) => {
            try {
                const linkUrl = new URL(link);
                if (linkUrl.hostname === baseUrl.hostname) {
                    internalLinks.push(linkUrl.pathname + linkUrl.search + linkUrl.hash);
                } else {
                    externalLinks.push(link);
                }
            } catch {
                // ignore invalid URLs
            }
        });

        return {
            index,
            url,
            internalLinks: [...new Set(internalLinks)],
            externalLinks: [...new Set(externalLinks)],
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${url}:`, message);
        return { index, url, internalLinks: [], externalLinks: [] };
    } finally {
        tabPool.releaseTab(tab);
    }
}

interface OutputRow {
    sourceUrl: string;
    summary: string;
    internalLinks: string;
    externalLinks: string;
}

async function processUrls(urls: string[]): Promise<OutputRow[]> {
    const results: OutputRow[] = [];

    const browser = await chromium.launch({
        headless: false,
        args: ["--start-maximized"],
    });

    const tabPool = new TabPool(browser, 5);

    try {
        await ensureLogin(tabPool);

        const promises = urls.map((u, index) => {
            console.log(`\n${index + 1} - Processing URL: ${u}`);
            return extractLinks(tabPool, u, index);
        });

        const batchResults = await Promise.all(promises);

        for (const result of batchResults) {
            const summary = `Internal Links: ${result.internalLinks.length}, External Links: ${result.externalLinks.length}`;
            console.log(`URL ${result.index + 1} - ${summary}`);

            results.push({
                sourceUrl: result.url,
                summary,
                internalLinks: result.internalLinks.join("\n"),
                externalLinks: result.externalLinks.join("\n"),
            });
        }
    } finally {
        await tabPool.close();
        await browser.close();
    }

    return results;
}

async function main(): Promise<void> {
    try {
        const candidates = ['input_urls.xlsx', 'input-urls.xlsx', 'Data/urls.xlsx', 'Data/input_urls.xlsx'];
        const fsExists = (p: string) => fs.existsSync(p);
        const found = candidates.find(fsExists);
        if (!found) throw new Error(`Excel file not found. Tried: ${candidates.join(', ')}`);
        const workbook = xlsx.readFile(found);
        const sheetName = workbook.SheetNames[0] as string;
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet);

        const urls: string[] = [];
        if (data.length > 0) {
            const firstColumn = Object.keys(data[0])[0] as string;
            urls.push(...data.map((row) => row[firstColumn]).filter((u): u is string => Boolean(u)).map(String));
        }

        if (urls.length === 0) {
            console.error("No URLs found in the input Excel file");
            return;
        }

        console.log(`Found ${urls.length} URLs to process`);

        const results = await processUrls(urls);

        const outputDir = "list_url";
        await fs.ensureDir(outputDir);

        const outputWorkbook = xlsx.utils.book_new();
        const outputWorksheet = xlsx.utils.json_to_sheet(results);

        const wscols = [{ wch: 50 }, { wch: 30 }, { wch: 50 }, { wch: 50 }];
        (outputWorksheet as unknown as { "!cols"?: { wch: number }[] })["!cols"] = wscols;

        xlsx.utils.book_append_sheet(outputWorkbook, outputWorksheet, "Results");

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputFile = path.join(outputDir, `link_results_${timestamp}.xlsx`);
        xlsx.writeFile(outputWorkbook, outputFile);

        console.log(`\nResults saved to: ${outputFile}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error:", message);
    } finally {
        rl.close();
    }
}

void main();
