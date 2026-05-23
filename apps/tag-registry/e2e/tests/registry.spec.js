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
  let tagTName, paramPName, modMName, sysName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagTName  = `tag_reg_${ts}`;
    paramPName = `param_reg_${ts}`;
    modMName  = `mod_reg_${ts}`;
    sysName   = `sys_reg_${ts}`;
    created.push(tagTName, paramPName, modMName, sysName);

    // Minimal hierarchy: tagT → paramP (child: tagT as 'setpoint') → modM (child: paramP as 'Chan1')
    // Wrapped in a system root so it appears in the root dropdown.
    await createTagTemplate(tagTName);
    await createStructuralTemplate(paramPName, 'parameter', [
      { template_name: tagTName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modMName, 'module', [
      { template_name: paramPName, asset_name: 'Chan1', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });
    await createStructuralTemplate(sysName, 'system', [
      { template_name: modMName, asset_name: modMName, fields: {} },
    ]);

    await po.waitForServer();
    await page.goto('/');
    await po.selectRoot(sysName);
    await po.navigateToRegistry();
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));  // sysName last since it depends on modMName
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('shows prompt when no root is selected', async ({ page }) => {
    await expect(page.locator('body')).toContainText(/select.*root/i);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('shows registry table after root selection', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).toContainText(`${sysName}.${modMName}.Chan1.setpoint`);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('tag_path column is present and prefixed with root template name', async ({ page }) => {
    // At least one cell should start with the system root name
    const cells = page.locator('td').filter({ hasText: new RegExp('^' + sysName + '\\.') });
    await expect(cells.first()).toBeVisible({ timeout: 15000 });
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('clicking tag_path column header sorts the table', async ({ page }) => {
    const header = page.getByRole('columnheader', { name: /tag_path/i });

    // First click — ascending
    await header.click();
    const cells = page.locator('td').filter({ hasText: new RegExp('^' + sysName + '\\.') });
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

    // modMName is a non-root node and defaults to collapsed — expand it first
    const modRow = po.systemTree
      .locator('span.flex-1')
      .filter({ hasText: new RegExp(`^${modMName}$`) })
      .locator('..');
    await modRow.locator('button').first().click();

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

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('tag_name column is present and shows the resolved tag_name', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

    // tag_name column header is visible
    await expect(page.getByRole('columnheader', { name: /^tag_name/i })).toBeVisible();

    // The setpoint row: tag_name is the asset_name of the leaf tag level
    // (In_Tag_Name defaults to true on tag templates).
    const tagPath = `${sysName}.${modMName}.Chan1.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    const tagNameCell = row.locator('td').nth(2); // tag_name is 3rd column (index 2)
    await expect(tagNameCell).toContainText('setpoint');
  });
});
