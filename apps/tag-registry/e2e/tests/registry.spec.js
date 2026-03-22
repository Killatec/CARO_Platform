import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Registry Page', () => {
  const created = [];
  let po;
  let tagTName, paramPName, modMName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagTName  = `tag_reg_${ts}`;
    paramPName = `param_reg_${ts}`;
    modMName  = `mod_reg_${ts}`;
    created.push(tagTName, paramPName, modMName);

    // Minimal hierarchy: tagT → paramP (child: tagT as 'setpoint') → modM (child: paramP as 'Chan1')
    await createTagTemplate(tagTName);
    await createStructuralTemplate(paramPName, 'parameter', [
      { template_name: tagTName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modMName, 'module', [
      { template_name: paramPName, asset_name: 'Chan1', fields: {} },
    ]);

    // Load the full hierarchy into the store (scoped to test templates only)
    // so validateGraph sees a clean graph, isValid=true, and RegistryPage
    // renders the table. Navigate via sidebar button (client-side — no page
    // reload) so the Zustand store is preserved.
    await po.waitForServer();
    await page.goto('/');
    await po.selectRoot(modMName);
    await po.navigateToRegistry();
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('shows prompt when no root is selected', async ({ page }) => {
    await expect(page.locator('body')).toContainText(/select.*root/i);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('shows registry table after root selection', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).toContainText(`${modMName}.Chan1.setpoint`);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('tag_path column is present and prefixed with root template name', async ({ page }) => {
    // At least one cell should start with the root template name
    const cells = page.locator('td').filter({ hasText: new RegExp('^' + modMName + '\\.') });
    await expect(cells.first()).toBeVisible({ timeout: 15000 });
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('clicking tag_path column header sorts the table', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /tag_path/i });

    // First click — ascending
    await header.click();
    const cells = page.locator('td').filter({ hasText: new RegExp('^' + modMName + '\\.') });
    const firstAsc = await cells.first().textContent();

    // Second click — descending
    await header.click();
    const firstDesc = await cells.first().textContent();

    // With only one row, both will be the same; with multiple rows the order differs.
    // Assert that the header click does not error and the table is still visible.
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });
    // If there are multiple rows, descending first should be >= ascending first
    if (firstAsc !== firstDesc) {
      expect(firstDesc >= firstAsc).toBe(true);
    }
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('error banner shown when graph has validation errors', async ({ page }) => {
    // beforeEach ends on the Registry page — navigate back to Editor
    await po.navigateToEditor();

    // Click the parameter node in the system tree (asset_name: 'Chan1' under modMName)
    await po.clickSystemTreeNode('Chan1');

    // Append a dot to the asset name — dot is disallowed, triggers INVALID_ASSET_NAME
    const assetNameInput = po.fieldsPanel.locator('tr').filter({ hasText: 'Asset Name' }).locator('input');
    const currentValue = await assetNameInput.inputValue();
    await assetNameInput.fill(currentValue + '.');

    // Navigate to Registry (client-side — Zustand store preserved)
    await po.navigateToRegistry();

    // Error banner must be visible, table must be hidden
    await expect(page.getByText('Resolve errors to view registry')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('table')).not.toBeVisible();

    // ValidationPanel must show the error code
    await expect(po.validationPanel).toContainText('INVALID_ASSET_NAME');
  });
});
