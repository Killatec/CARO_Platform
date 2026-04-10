import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
  batchSave,
  applyRegistryApi,
  getTemplate,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

// ── Suite ────────────────────────────────────────────────────────────────────

test.describe('Meta Modal', () => {
  const created = [];
  let po;
  let tagName, paramName, modName;

  // Setup: hierarchy with two tag children so tests can open View on
  // different rows without modifying state between assertions.
  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagName   = `tag_meta_${ts}`;
    paramName = `param_meta_${ts}`;
    modName   = `mod_meta_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName, 'f32', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });
    // Two children so tests can switch between rows
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: { eng_min: 5 } },
      { template_name: tagName, asset_name: 'monitor',  fields: { eng_min: 0 } },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'Chan1', fields: {} },
    ]);

    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // Modal locator helper — scoped to the shadow-xl overlay containing the tag path
  function metaModal(page, tagPath) {
    return page.locator('.shadow-xl').filter({ hasText: tagPath }).first();
  }

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('clicking View on a registry row opens meta modal with tag_path as title', async ({ page }) => {
    const tagPath = `${modName}.Chan1.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    await row.getByRole('button', { name: 'View' }).click();

    // Modal is visible and contains the tag_path as its title
    await expect(metaModal(page, tagPath)).toBeVisible({ timeout: 5000 });
    await expect(metaModal(page, tagPath)).toContainText(tagPath);

    // At least one level card is shown with type and name labels
    await expect(metaModal(page, tagPath)).toContainText(/Level \d+/);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('meta modal closes when Close button is clicked', async ({ page }) => {
    const tagPath = `${modName}.Chan1.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    await row.getByRole('button', { name: 'View' }).click();
    await expect(metaModal(page, tagPath)).toBeVisible({ timeout: 5000 });

    await metaModal(page, tagPath).getByRole('button', { name: 'Close' }).click();
    await expect(metaModal(page, tagPath)).not.toBeVisible();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // Apply first so the DB has the current meta, then change a field value
  // so that the row shows as modified and the modal includes diff highlights.
  test('modified row meta modal shows diff legend when meta field value differs', async ({ page }) => {
    // Apply registry so DB meta has eng_min=5 for setpoint
    await applyRegistryApi(modName, 'meta-modal test: apply before modify');

    // Change setpoint eng_min to 99 (differs from DB value of 5)
    const { template: paramTemplate, hash: paramHash } = await getTemplate(paramName);
    await batchSave([{
      template_name: paramName,
      original_hash: paramHash,
      template: {
        ...paramTemplate,
        children: [
          { template_name: tagName, asset_name: 'setpoint', fields: { eng_min: 99 } },
          { template_name: tagName, asset_name: 'monitor',  fields: { eng_min: 0 } },
        ],
      },
    }], [], true);

    // Reload store to pick up modified template
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Open View modal on the modified row
    const tagPath = `${modName}.Chan1.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    await row.getByRole('button', { name: 'View' }).click();

    const modal = metaModal(page, tagPath);
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Diff legend should be present (shows "changed", "added", "removed" indicators)
    await expect(modal).toContainText(/changed/i);
    await expect(modal).toContainText(/added/i);
    await expect(modal).toContainText(/removed/i);

    // At least one field value should have amber highlighting (the changed eng_min)
    const amberValue = modal.locator('[class*="amber"]').first();
    await expect(amberValue).toBeVisible();
  });
});
