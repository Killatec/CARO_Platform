import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

// Log all console messages from the app
page.on('console', msg => console.log('[APP]', msg.text()));

await page.goto('about:blank');
await page.goto('http://10.0.0.184:5173');
await page.waitForTimeout(2000);

const select = page.locator('select').first();
await select.waitFor({ state: 'visible' });

console.log('--- Selecting Plant1_System_A programmatically ---');
const before = Date.now();
await select.selectOption({ value: 'Plant1_System_A' });
console.log(`selectOption() returned after ${Date.now() - before}ms`);

// Wait and check if tree updates
await page.waitForTimeout(500);
const bodyText1 = await page.locator('body').innerText();
const hasTree = bodyText1.includes('Plant1_System_A') &&
                bodyText1.includes('RFPowerModule');
console.log(`Tree rendered after 500ms: ${hasTree}`);

if (!hasTree) {
  await page.waitForTimeout(3000);
  const bodyText2 = await page.locator('body').innerText();
  const hasTree2 = bodyText2.includes('RFPowerModule');
  console.log(`Tree rendered after 3500ms total: ${hasTree2}`);
  if (hasTree2) {
    console.log('--- BODY EXCERPT ---');
    console.log(bodyText2.slice(0, 1000));
  }
}

await browser.close();
