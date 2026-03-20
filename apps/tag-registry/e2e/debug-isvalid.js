import { chromium } from "@playwright/test";
import { createTagTemplate, createStructuralTemplate, deleteTemplate } from "./helpers/api.js";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

page.on("console", msg => {
  // Only log errors and warnings from the app
  if (["error", "warn"].includes(msg.type())) {
    console.log(`[APP ${msg.type()}] ${msg.text()}`);
  }
});

// Create the same hierarchy as save-cancel beforeEach
const ts = Date.now();
const tName = `tag_sc_${ts}`;
const pName = `param_sc_${ts}`;

await createTagTemplate(tName, "f64", false, {
  eng_min: { field_type: "Numeric", default: 0 },
});
await createStructuralTemplate(pName, "parameter", [
  { template_name: tName, asset_name: "monitor", fields: {} },
]);

console.log("Templates created:", tName, pName);

await page.goto("about:blank");
await page.goto("http://10.0.0.184:5173");
await page.waitForTimeout(1500);

// Select pName as root
const select = page.locator("select").first();
const options = await select.locator("option").allTextContents();
console.log("Options:", options.filter(o => o.includes("sc_")));

await select.selectOption({ value: pName });
await page.waitForTimeout(2000);

// Check body for validation panel messages
const body = await page.locator("body").innerText();
console.log("--- BODY ---");
console.log(body);

// Check if Save-related buttons exist
const saveBtn = page.getByRole("button", { name: "Save" });
const saveExists = await saveBtn.isVisible().catch(() => false);
console.log("Save button visible:", saveExists);

if (saveExists) {
  const isDisabled = await saveBtn.isDisabled();
  console.log("Save button disabled:", isDisabled);
}

// Now make a small edit to make isDirty=true
await page.waitForTimeout(500);
// Click the pName template in TemplatesTree
const templatesTree = page.locator(".select-none")
  .filter({ hasText: "All Templates" }).first();
await templatesTree.getByText(tName, { exact: true }).click();
await page.waitForTimeout(1000);

const body2 = await page.locator("body").innerText();
console.log("--- BODY AFTER CLICK ---");
console.log(body2.slice(0, 2000));

const saveExists2 = await saveBtn.isVisible().catch(() => false);
console.log("Save button visible after edit:", saveExists2);
if (saveExists2) {
  const isDisabled2 = await saveBtn.isDisabled();
  console.log("Save button disabled after edit:", isDisabled2);
}

await deleteTemplate(pName);
await deleteTemplate(tName);
await browser.close();
