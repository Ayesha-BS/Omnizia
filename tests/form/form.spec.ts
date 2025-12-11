// form.spec.ts
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';

// Get the current directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import * as dotenv from 'dotenv';
dotenv.config();

test.setTimeout(300_000); // 5 minutes per test

test('form test', async ({ page }) => {
  // Use consistent test results directory
  const testResultsDir = path.join(__dirname, '../../test-results/form');
  
  // Ensure directory exists and is empty
  if (fs.existsSync(testResultsDir)) {
    fsExtra.emptyDirSync(testResultsDir);
  } else {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }

  let screenshotCounter = 1;

  await page.goto('https://recordati-plus.de/de_DE/recordati-article/automation-test-page');

  await expect(page.getByRole('region', { name: 'Wir verwenden Cookies - für' }).locator('div').first()).toBeVisible();
  await page.screenshot({ path: path.join(testResultsDir, `${screenshotCounter++}_cookie_banner.png`), fullPage: true });

  await expect(page.getByRole('button', { name: 'Alle akzeptieren' })).toBeVisible();
  await page.screenshot({ path: path.join(testResultsDir, `${screenshotCounter++}_accept_button.png`), fullPage: true });

  await page.getByRole('button', { name: 'Alle akzeptieren' }).click();
  await page.locator('.react-select__indicator').first().click();
  await page.getByRole('option', { name: 'Herr' }).click();
  await page.getByRole('textbox', { name: 'Vorname' }).click();
  await page.getByRole('textbox', { name: 'Vorname' }).fill('Umme');
  await page.getByRole('textbox', { name: 'Nachname' }).click();
  await page.getByRole('textbox', { name: 'Nachname' }).fill('Ayesha');
  await page.getByRole('textbox', { name: 'E-Mail Adresse' }).click();
  await page.getByRole('textbox', { name: 'E-Mail Adresse' }).fill('umme.ayesha@brainstation-23.com');
  await page.locator('.react-select__indicator.react-select__dropdown-indicator.css-1xc3v61-indicatorContainer').first().click();
  await page.getByText('Klinik', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Praxis / Klinik / Ambulanz:' }).click();
  await page.getByRole('textbox', { name: 'Praxis / Klinik / Ambulanz:' }).fill('test praxis');
  await page.getByRole('textbox', { name: 'Straße & Nr. (Praxis / Klinik' }).click();
  await page.getByRole('textbox', { name: 'Straße & Nr. (Praxis / Klinik' }).fill('test street');
  await page.getByRole('textbox', { name: 'Postleitzahl (Praxis / Klinik' }).click();
  await page.getByRole('textbox', { name: 'Postleitzahl (Praxis / Klinik' }).fill('test pos');
  await page.getByRole('textbox', { name: 'Stadt (Praxis / Klinik /' }).click();
  await page.getByRole('textbox', { name: 'Stadt (Praxis / Klinik /' }).fill('test stadt');
  await page.getByRole('checkbox', { name: 'It is a long established fact' }).check();
  await page.locator('form div').filter({ hasText: 'Contrary to popular belief,' }).nth(2).click();
  await page.getByRole('button', { name: 'Bestellung absenden' }).click();

  await page.locator('[id="__next"]').getByRole('button').filter({ hasText: /^$/ }).click();

  console.log(`✓ Test completed. Screenshots saved to: ${testResultsDir}`);
});