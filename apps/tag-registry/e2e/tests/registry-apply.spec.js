import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

// ── Inline API helpers (Phase 2, not yet in api.js) ──────────────────────────

const API_BASE = 'http://10.0.0.184:3001/api/v1';

async function applyRegistryApi(rootName, comment) {
  const res = await fetch(`${API_BASE}/registry/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootName, comment }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? 'apply failed');
  return json.data;
}

async function fetchRevisions() {
  const res = await fetch(`${API_BASE}/registry/revisions`);
  const json = await res.json();
  return json.data.revisions;
}

// ── Suite ────────────────────────────────────────────────────────────────────

test.describe('Registry Apply Flow', () => {
  const created = [];
  let po;
  let tagName, paramName, modName;

  // Setup: minimal hierarchy, navigate to registry.
  // New timestamp names mean the tag_paths are not yet in the DB (all added).
  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagName   = `tag_apply_${ts}`;
    paramName = `param_apply_${ts}`;
    modName   = `mod_apply_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
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

  // Locators used across tests
  const updateDbButton = (page) => page.getByRole('button', { name: 'Update DB' });
  const applyModal = (page) => page.locator('.shadow-xl').filter({ hasText: /Apply Registry Changes/i }).first();
  const commentInput = (page) => page.locator('#apply-comment');
  const confirmButton = (page) => page.getByRole('button', { name: 'Confirm' });
  const cancelButton = (page) => page.getByRole('button', { name: 'Cancel' });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('Update DB button is disabled when all tags are unchanged', async ({ page }) => {
    // Apply first so there are no changes
    await applyRegistryApi(modName, 'registry-apply test: no-op check');
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    await expect(updateDbButton(page)).toBeDisabled();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  // beforeEach leaves registry in 'added' state — Update DB should be enabled
  test('Update DB button is enabled when changes exist', async ({ page }) => {
    await expect(updateDbButton(page)).toBeEnabled();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('clicking Update DB opens confirmation modal with correct contents', async ({ page }) => {
    await updateDbButton(page).click();

    await expect(applyModal(page)).toBeVisible({ timeout: 5000 });
    await expect(applyModal(page)).toContainText('Apply Registry Changes');

    // Modal shows the diff summary (at least the added count)
    await expect(applyModal(page)).toContainText(/added/i);

    // Comment input is present and empty
    await expect(commentInput(page)).toBeVisible();
    await expect(commentInput(page)).toHaveValue('');

    // Confirm button is disabled initially (no comment yet)
    await expect(confirmButton(page)).toBeDisabled();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('Confirm button enables only when comment is non-empty', async ({ page }) => {
    await updateDbButton(page).click();
    await expect(applyModal(page)).toBeVisible({ timeout: 5000 });

    // Disabled initially
    await expect(confirmButton(page)).toBeDisabled();

    // Type a comment — Confirm should enable
    await commentInput(page).fill('my comment');
    await expect(confirmButton(page)).toBeEnabled();

    // Clear the comment — Confirm should disable again
    await commentInput(page).clear();
    await expect(confirmButton(page)).toBeDisabled();
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('Cancel closes modal without applying', async ({ page }) => {
    await updateDbButton(page).click();
    await expect(applyModal(page)).toBeVisible({ timeout: 5000 });
    await commentInput(page).fill('should not be applied');

    await cancelButton(page).click();

    // Modal is gone
    await expect(applyModal(page)).not.toBeVisible();

    // Table still shows added rows (no apply happened)
    await expect(page.getByText(/\+\d+ added/)).toBeVisible();
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('successful apply shows success banner and all rows become unchanged', async ({ page }) => {
    await updateDbButton(page).click();
    await expect(applyModal(page)).toBeVisible({ timeout: 5000 });
    await commentInput(page).fill('registry-apply test: successful apply');

    await confirmButton(page).click();

    // Modal closes
    await expect(applyModal(page)).not.toBeVisible({ timeout: 10000 });

    // Success banner appears
    await expect(page.getByText(/Registry updated to revision/i)).toBeVisible({ timeout: 10000 });

    // All rows now show as unchanged
    await expect(page.getByText(/unchanged/)).toBeVisible();
    await expect(page.getByText(/\+\d+ added/)).not.toBeVisible();

    // Success banner auto-dismisses after 4 seconds
    await page.waitForTimeout(5000);
    await expect(page.getByText(/Registry updated to revision/i)).not.toBeVisible();
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  test('apply creates a new revision visible on the History page', async ({ page }) => {
    // Note the current revision count before applying
    const revisionsBefore = await fetchRevisions();
    const countBefore = revisionsBefore.length;

    // Apply via UI
    await updateDbButton(page).click();
    await expect(applyModal(page)).toBeVisible({ timeout: 5000 });
    const comment = `registry-apply history check ${Date.now()}`;
    await commentInput(page).fill(comment);
    await confirmButton(page).click();
    await expect(applyModal(page)).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Registry updated to revision/i)).toBeVisible({ timeout: 10000 });

    // Navigate to History page
    await page.getByRole('button', { name: /history/i }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // A new row should appear with 'dev' as applied_by and our comment
    await expect(page.locator('table')).toContainText(comment);
    await expect(page.locator('table')).toContainText('dev');

    // Total revisions should have incremented
    const revisionsAfter = await fetchRevisions();
    expect(revisionsAfter.length).toBe(countBefore + 1);
  });
});
