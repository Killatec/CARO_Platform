import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplate,
  deleteTemplates,
  batchSave,
  getTemplateHash,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Save and Cancel', () => {
  const created = [];
  let po;
  let tName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    tName = `tag_sc_${Date.now()}`;
    created.push(tName);

    await createTagTemplate(tName, 'f64', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });

    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('Save bar is hidden when no changes are pending', async () => {
    await expect(po.saveButton).not.toBeVisible();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('Save bar appears after editing a field default', async () => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('5');

    await expect(po.saveButton).toBeVisible();
    await expect(po.seeChangesButton).toBeVisible();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('Cancel/Discard hides the Save bar and reverts the field', async ({ page }) => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('77');
    await expect(po.saveButton).toBeVisible();

    await po.discardAndWait();
    await expect(po.saveButton).not.toBeVisible();

    // Re-select the template and verify the value was reverted to original
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);
    const revertedInput = po.fieldsPanel.locator('input[type="number"]').first();
    await expect(revertedInput).toHaveValue('0');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('root dropdown is disabled while dirty', async () => {
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('3');

    await expect(po.rootDropdown).toBeDisabled();
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('Save with no upstream parents completes and hides Save bar', async ({ page }) => {
    // Use a standalone parameter template with no children and no upstream parents.
    // Tag templates are excluded from the root dropdown, and editing a tag that IS
    // a child of a structural parent triggers a cascade modal (hanging saveAndWait).
    // A solo parameter with its own eng_min field has nothing to cascade into.
    const soloName = `solo_sc_${Date.now()}`;
    created.push(soloName);
    await createStructuralTemplate(soloName, 'parameter', [], {
      eng_min: { field_type: 'Numeric', default: 0 },
    });

    await po.selectRoot(soloName);
    await po.expandTemplateFolder('parameter');
    await po.clickTemplateLeaf(soloName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('99');

    await po.saveAndWait();
    await expect(po.saveButton).not.toBeVisible();

    // Reload and verify the value was persisted
    await po.selectRoot(soloName);
    await po.expandTemplateFolder('parameter');
    await po.clickTemplateLeaf(soloName);
    await expect(po.fieldsPanel.locator('input[type="number"]').first()).toHaveValue('99');
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('Save triggers CascadeConfirmModal when upstream parents are affected', async ({ page }) => {
    const pName = `param_sc_${Date.now()}`;
    created.push(pName);
    await createStructuralTemplate(pName, 'parameter', [
      { template_name: tName, asset_name: 'mon', fields: {} },
    ]);

    // selectRoot(pName) loads the full hierarchy (pName + tName) into the store
    // so simulateCascade can detect that editing tName affects pName.
    await po.selectRoot(pName);
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('42');

    await po.saveButton.click();

    // Cascade confirm modal should appear
    await expect(po.cascadeModal).toBeVisible();

    // Cancel the modal — save should be aborted
    await po.cascadeModal.getByRole('button', { name: /cancel/i }).click();
    await expect(po.cascadeModal).not.toBeVisible();
    await expect(po.saveButton).toBeVisible();
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  test('Confirming the cascade modal completes the save', async ({ page }) => {
    const pName = `param_sc2_${Date.now()}`;
    created.push(pName);
    await createStructuralTemplate(pName, 'parameter', [
      { template_name: tName, asset_name: 'mon', fields: {} },
    ]);

    // selectRoot(pName) loads the full hierarchy (pName + tName) into the store
    // so simulateCascade can detect that editing tName affects pName.
    await po.selectRoot(pName);
    await po.expandTemplateFolder('tag');
    await po.clickTemplateLeaf(tName);

    const engMinInput = po.fieldsPanel.locator('input[type="number"]').first();
    await engMinInput.clear();
    await engMinInput.fill('55');

    await po.saveButton.click();
    await expect(po.cascadeModal).toBeVisible();

    // Confirm the cascade
    await po.cascadeModal.getByRole('button', { name: /confirm/i }).click();

    await expect(po.cascadeModal).not.toBeVisible();
    await expect(po.saveButton).not.toBeVisible();
  });
});
