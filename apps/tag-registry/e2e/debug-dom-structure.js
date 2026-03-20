import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('about:blank');
await page.goto('http://10.0.0.184:5173');
await page.waitForTimeout(1000);

const select = page.locator('select').first();
await select.selectOption({ value: 'Plant1_System_A' });
await page.waitForTimeout(1500);

// Get the outer HTML of the element that contains "SYSTEM TREE" text
// and walk up several levels to find the right container
const systemTreeHeader = page.getByText('System Tree', { exact: true });
const count = await systemTreeHeader.count();
console.log(`"System Tree" text nodes found: ${count}`);

// Walk up 1, 2, 3, 4 levels and report className + first 200 chars of text
for (let levels = 1; levels <= 5; levels++) {
  let loc = systemTreeHeader;
  for (let i = 0; i < levels; i++) loc = loc.locator('..');
  const cls = await loc.getAttribute('class').catch(() => '(no class)');
  const txt = (await loc.innerText().catch(() => '')).slice(0, 150).replace(/\n/g, ' | ');
  console.log(`Up ${levels}: class="${cls}" | text="${txt}"`);
}

await browser.close();
