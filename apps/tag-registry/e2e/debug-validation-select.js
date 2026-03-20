import { chromium } from '@playwright/test';
import { createStructuralTemplate, deleteTemplate } from './helpers/api.js';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

page.on('console', msg => console.log(`[APP ${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

// Intercept all API calls to see what fires after selectOption
page.on('request', req => {
  if (req.url().includes('/api/')) {
    console.log(`[REQ] ${req.method()} ${req.url()}`);
  }
});
page.on('response', res => {
  if (res.url().includes('/api/')) {
    console.log(`[RES] ${res.status()} ${res.url()}`);
  }
});

const name = `param_debug_${Date.now()}`;
console.log(`Creating: ${name}`);
await createStructuralTemplate(name, 'parameter', [], {});
console.log('Created');

await page.goto('about:blank');
await page.goto('http://10.0.0.184:5173');
await page.waitForTimeout(2000);

const select = page.locator('select').first();
const options = await select.locator('option').allTextContents();
console.log('Options:', options);

console.log('--- Selecting ---');
await select.selectOption({ value: name });
await page.waitForTimeout(3000);

const body = await page.locator('body').innerText();
console.log('Tree has name:', body.includes(name));

await deleteTemplate(name);
await browser.close();
