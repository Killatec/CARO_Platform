import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  deleteTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Templates Tree', () => {
  const created = [];
  let po;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);
    await po.waitForServer();
    await page.goto('about:blank');
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    // Navigate away to abort any in-flight store operations instead of
    // discardAndWait() which can hang if the server is mid-restart.
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('displays a template leaf in the Templates Tree after API creation', async ({ page }) => {
    const name = `tag_smoke_${Date.now()}`;
    created.push(name);
    await createTagTemplate(name);

    await page.reload();

    // Expand the 'tag' folder — folders start collapsed after reload
    await po.expandTemplateFolder('tag');
    await expect(po.templatesTree).toContainText(name);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('clicking a template leaf populates the Fields Panel', async ({ page }) => {
    const name = `tag_fields_${Date.now()}`;
    created.push(name);
    await createTagTemplate(name, 'f64', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });

    await page.reload();
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(name);

    await expect(po.fieldsPanel).toContainText('eng_min');
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('editing a template default field value marks it dirty (orange)', async ({ page }) => {
    const name = `tag_dirty_${Date.now()}`;
    created.push(name);
    await createTagTemplate(name, 'f64', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });

    await page.reload();
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(name);

    // Edit the eng_min field
    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('42');

    // The label cell for the edited field should carry an orange class
    const engMinLabel = po.fieldsPanel.locator('td').filter({ hasText: /^eng_min$/ }).first();
    await expect(engMinLabel).toHaveClass(/orange/);

    await expect(po.seeChangesButton).toBeVisible();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('creating a new template via NewTemplateModal', async ({ page }) => {
    const name = `tag_new_${Date.now()}`;
    created.push(name); // will be discarded in afterEach; delete is a no-op

    // Click the 'New' button (search whole page — button may be outside .select-none container)
    await page.getByRole('button', { name: 'New' }).first().click();

    // Modal primitive renders without role="dialog"; locate by .shadow-xl + title text.
    // Name field: <Input type="text" placeholder="e.g. RF_Param" />  (first text input)
    // Type field: <input list="new-template-type-options" />         (datalist input)
    const dialog = page.locator('.shadow-xl').filter({ hasText: 'New Template' });
    await dialog.locator('input[type="text"]').first().fill(name);
    await dialog.locator('input[list]').fill('tag');

    // Confirm
    await dialog.getByRole('button', { name: /confirm/i }).click();

    await expect(po.templatesTree).toContainText(name);
    await expect(po.seeChangesButton).toBeVisible();
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('deleting a new unsaved template removes it instantly without Save', async ({ page }) => {
    const name = `tag_del_new_${Date.now()}`;

    // Create via modal (search whole page — button may be outside .select-none container)
    await page.getByRole('button', { name: 'New' }).first().click();
    const dialog = page.locator('.shadow-xl').filter({ hasText: 'New Template' });
    await dialog.locator('input[type="text"]').first().fill(name);
    await dialog.locator('input[list]').fill('tag');
    await dialog.getByRole('button', { name: /confirm/i }).click();

    await expect(po.templatesTree).toContainText(name);

    // Click the trash button on the new leaf — target by title to avoid ambiguity
    await po.expandTemplateFolder('tag');
    await po.templatesTree.getByRole('button', { name: `Delete template "${name}"` }).click();

    await expect(po.templatesTree).not.toContainText(name);
    await expect(po.saveButton).not.toBeVisible();
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('deleting a saved template queues it as pending and shows Save bar', async ({ page }) => {
    const name = `tag_del_saved_${Date.now()}`;
    created.push(name);
    await createTagTemplate(name);

    await page.reload();
    await po.waitForTreeReady();
    await po.expandTemplateFolder('tag');

    // Click the leaf first so handleDeleteClick finds the hash in the store
    // and skips its own loadRoot() call (which can be slow on first access).
    await po.clickTemplateLeaf(name);

    // Target the delete button by its title to avoid strict-mode violation
    // (multiple buttons exist in the tree after expanding)
    await po.templatesTree.getByRole('button', { name: `Delete template "${name}"` }).click();

    await expect(po.saveButton).toBeVisible();
  });
});
