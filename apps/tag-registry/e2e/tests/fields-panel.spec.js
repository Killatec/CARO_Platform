import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Fields Panel', () => {
  const created = [];
  let po;
  let tName, sName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    tName = `tag_fp_${Date.now()}`;
    sName = `param_fp_${Date.now()}`;
    created.push(tName, sName);

    // T: tag template with a numeric field
    await createTagTemplate(tName, 'f64', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });

    // S: structural template with T as a child
    await createStructuralTemplate(sName, 'parameter', [
      { template_name: tName, asset_name: 'mon_channel', fields: {} },
    ]);

    await po.waitForServer();
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('template mode: shows template name and type as read-only', async () => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    // Template Name and Template Type are rendered as disabled <input> elements —
    // their values are NOT in innerText, so check .toHaveValue() instead.
    await expect(po.fieldsPanel.locator('input[disabled]').first()).toHaveValue(tName);
    await expect(po.fieldsPanel.locator('input[disabled]').nth(1)).toHaveValue('tag');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('template mode: Add Field button opens AddFieldModal', async ({ page }) => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    await po.fieldsPanel.getByRole('button', { name: 'New' }).click();

    await expect(page.locator('.shadow-xl').first()).toBeVisible();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('template mode: adding a field via AddFieldModal appends it to the panel', async ({ page }) => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    await po.fieldsPanel.getByRole('button', { name: 'New' }).click();

    const dialog = page.locator('.shadow-xl').first();
    // AddFieldModal labels have no htmlFor — use positional selectors.
    // First text input = Field Name.
    await dialog.locator('input[type="text"]').first().fill('pressure');
    // Select Numeric — this resets default to 0 automatically, no need to fill it.
    await dialog.locator('select').first().selectOption('Numeric').catch(() => {});
    await dialog.getByRole('button', { name: /confirm/i }).click();

    await expect(po.fieldsPanel).toContainText('pressure');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('template mode: trash icon on field row removes the field', async () => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    await expect(po.fieldsPanel).toContainText('eng_min');

    // Click the trash button on the eng_min row
    const fieldRow = po.fieldsPanel.locator('tr').filter({ hasText: 'eng_min' });
    await fieldRow.getByRole('button').click();

    await expect(po.fieldsPanel).not.toContainText('eng_min');
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('instance mode: clicking a system tree node shows asset name input', async () => {
    await po.selectRoot(sName);
    await po.clickSystemTreeNode('mon_channel');

    // The asset name row should have a text input containing the asset_name value
    const assetNameInput = po.fieldsPanel
      .locator('tr')
      .filter({ hasText: 'Asset Name' })
      .locator('input');
    await expect(assetNameInput).toHaveValue('mon_channel');
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('instance mode: editing asset name does not clear the panel on each keystroke', async ({ page }) => {
    await po.selectRoot(sName);
    await po.clickSystemTreeNode('mon_channel');

    const assetNameInput = po.fieldsPanel
      .locator('tr')
      .filter({ hasText: 'Asset Name' })
      .locator('input');

    // Type character by character and assert the panel stays visible
    await assetNameInput.clear();
    for (const char of 'chan') {
      await assetNameInput.type(char);
      await expect(po.fieldsPanel).toBeVisible();
    }
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  test('instance mode: override value shown in blue, dirty override shown in orange', async () => {
    await po.selectRoot(sName);
    await po.clickSystemTreeNode('mon_channel');

    // eng_min is inherited (not overridden) — input should carry a gray class
    const fieldRow = po.fieldsPanel.locator('tr').filter({ hasText: 'eng_min' });
    const input = fieldRow.locator('input');
    await expect(input).toHaveClass(/gray/);

    // Type a new override value
    await input.clear();
    await input.fill('99');

    // Input should now carry an orange class (dirty override)
    await expect(input).toHaveClass(/orange/);
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────
  test('Instance mode: editing asset name turns it orange', async () => {
    await po.selectRoot(sName);
    await po.clickSystemTreeNode('mon_channel');

    const assetNameInput = po.fieldsPanel
      .locator('tr')
      .filter({ hasText: 'Asset Name' })
      .locator('input');

    // Initially the asset name is clean — should carry a gray class
    await expect(assetNameInput).toHaveClass(/gray/);

    // Rename the asset
    await assetNameInput.clear();
    await assetNameInput.fill('renamed_param');

    // Input should now carry an orange class (dirty)
    await expect(assetNameInput).toHaveClass(/orange/);
  });
});
