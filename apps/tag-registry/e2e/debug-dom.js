import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://10.0.0.184:5173');
await page.waitForTimeout(2000);

// Select the first available root option (whatever is in the dropdown)
const select = page.locator('select').first();
await select.waitFor({ state: 'visible' });
const options = await select.locator('option').allTextContents();
console.log('Dropdown options:', options);

if (options.length > 1) {
  // Select the second option (first is usually the placeholder)
  await select.selectOption({ index: 1 });
  await page.waitForTimeout(3000);

  // Dump the text content of the entire left panel area
  const bodyText = await page.locator('body').innerText();
  console.log('--- BODY TEXT AFTER ROOT SELECT ---');
  console.log(bodyText.slice(0, 3000));
}

await browser.close();
