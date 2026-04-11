import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
  applyRegistryApi,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Module Type — end-to-end', () => {
  const created = [];
  let po;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);
    await po.waitForServer();
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('module template without Module_Type shows validation error', async ({ page }) => {
    const ts = Date.now();
    const tagName = `tag_mt1_${ts}`;
    const modName = `mod_mt1_${ts}`;
    created.push(tagName, modName);

    await createTagTemplate(tagName);
    // Module template with NO Module_Type field
    await createStructuralTemplate(modName, 'module', [
      { template_name: tagName, asset_name: 'ch', fields: {} },
    ]);

    await po.selectRoot(modName);

    // Validation panel should show Module_Type-related error
    await expect(po.validationPanel).toContainText('Module_Type');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('module template with Module_Type field passes validation', async ({ page }) => {
    const ts = Date.now();
    const tagName = `tag_mt2_${ts}`;
    const modName = `mod_mt2_${ts}`;
    created.push(tagName, modName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(modName, 'module', [
      { template_name: tagName, asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });

    await po.selectRoot(modName);

    // Validation panel should NOT contain Module_Type error
    await expect(po.validationPanel).not.toContainText('Module_Type');
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('Module_Type field renders as a dropdown in FieldsPanel template mode', async ({ page }) => {
    const ts = Date.now();
    const tagName = `tag_mt3_${ts}`;
    const modName = `mod_mt3_${ts}`;
    created.push(tagName, modName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(modName, 'module', [
      { template_name: tagName, asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });

    // Reload so the templates tree includes the newly-created templates
    await page.goto('/');
    await po.waitForTreeReady();

    await po.expandTemplateFolder('module');
    await po.clickTemplateLeaf(modName);

    // Module_Type row should contain a <select> element, not a text input
    const mtRow = po.fieldsPanel.locator('tr').filter({ hasText: 'Module_Type' });
    await expect(mtRow).toBeVisible();
    const select = mtRow.locator('select');
    await expect(select).toBeVisible();

    // Dropdown should contain HMI and MQTT options
    const options = await select.locator('option').allTextContents();
    expect(options.some(o => o.includes('HMI'))).toBe(true);
    expect(options.some(o => o.includes('MQTT'))).toBe(true);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('changing Module_Type dropdown value marks template dirty and saves', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_mt4_${ts}`;
    const paramName = `param_mt4_${ts}`;
    const modName   = `mod_mt4_${ts}`;
    created.push(tagName, paramName, modName);

    // Full valid hierarchy: module → parameter → tag.
    // Tag template must have data_type / is_setpoint / Trends inside fields so
    // validateTemplate passes.  Module must have Module_Type so the isModule
    // check passes.  All three are required for isValid=true (which enables
    // the save button, whose disabled prop is !isValid).
    await createTagTemplate(tagName, 'f32', false, {
      data_type:   { field_type: 'TagType',  default: 'f32'   },
      is_setpoint: { field_type: 'Boolean',  default: false   },
      Trends:      { field_type: 'Boolean',  default: false   },
    });
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'ch', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });

    // Reload so the templates tree includes the newly-created templates
    await page.goto('/');
    await po.waitForTreeReady();

    await po.expandTemplateFolder('module');
    await po.clickTemplateLeaf(modName);

    const mtRow = po.fieldsPanel.locator('tr').filter({ hasText: 'Module_Type' });
    const select = mtRow.locator('select');

    // Change from HMI to MQTT
    await select.selectOption('MQTT');

    // Save button should appear enabled (dirty state + isValid)
    await expect(po.saveButton).toBeVisible({ timeout: 3000 });
    await po.saveAndWait();

    // Reload and verify the change persisted
    await page.goto('/');
    await po.expandTemplateFolder('module');
    await po.clickTemplateLeaf(modName);

    const mtRow2 = po.fieldsPanel.locator('tr').filter({ hasText: 'Module_Type' });
    const select2 = mtRow2.locator('select');
    await expect(select2).toHaveValue('MQTT');
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('registry table shows module and module_type columns after apply', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_mt5_${ts}`;
    const paramName = `param_mt5_${ts}`;
    const modName   = `mod_mt5_${ts}`;
    created.push(tagName, paramName, modName);

    // Full valid hierarchy required so RegistryPage's isValid guard passes.
    // Tag template must declare data_type / is_setpoint / Trends inside fields
    // (not at top level) for validateTemplate to accept it.
    await createTagTemplate(tagName, 'f32', false, {
      data_type:   { field_type: 'TagType',  default: 'f32'   },
      is_setpoint: { field_type: 'Boolean',  default: false   },
      Trends:      { field_type: 'Boolean',  default: false   },
    });
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'ch', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'MQTT' } });

    // Apply registry via API to populate DB
    await applyRegistryApi(modName, 'E2E module_type test');

    // Load UI and navigate to Registry page
    await po.selectRoot(modName);
    await po.navigateToRegistry();

    // Wait for table to render
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

    // Verify column headers exist
    const moduleHeader = page.getByRole('columnheader', { name: /^module$/i });
    const moduleTypeHeader = page.getByRole('columnheader', { name: /module_type/i });
    await expect(moduleHeader).toBeVisible();
    await expect(moduleTypeHeader).toBeVisible();

    // Verify the row contains the module name and module_type display name
    const row = page.locator('td').filter({ hasText: modName });
    await expect(row.first()).toBeVisible();

    // Module_type column should show the display name for MQTT
    await expect(page.locator('table')).toContainText('MQTT');
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('AddFieldModal offers ModuleType as a field type option', async ({ page }) => {
    const ts = Date.now();
    const modName = `mod_mt6_${ts}`;
    created.push(modName);

    await createStructuralTemplate(modName, 'module', []);

    // Reload so the templates tree includes the newly-created template
    await page.goto('/');
    await po.waitForTreeReady();

    await po.expandTemplateFolder('module');
    await po.clickTemplateLeaf(modName);

    await po.fieldsPanel.getByRole('button', { name: 'New' }).click();
    const dialog = page.locator('.shadow-xl').first();
    await expect(dialog).toBeVisible();

    // The type dropdown should include ModuleType
    const typeSelect = dialog.locator('select').first();
    const options = await typeSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('ModuleType'))).toBe(true);
  });
});
