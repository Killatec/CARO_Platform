import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
  batchSave,
  getTemplateHash,
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

// ── Suite ────────────────────────────────────────────────────────────────────

test.describe('History Page', () => {
  const created = [];
  let po;
  let tagName, paramName, modName;

  // Setup: hierarchy + navigate to History page.
  // Each test applies as needed within the test body.
  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagName   = `tag_hist_${ts}`;
    paramName = `param_hist_${ts}`;
    modName   = `mod_hist_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'Chan1', fields: {} },
    ]);

    await po.waitForServer();
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('History nav item is visible in sidebar', async ({ page }) => {
    await expect(page.getByRole('button', { name: /history/i })).toBeVisible();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('History page shows revisions table with correct column headers', async ({ page }) => {
    // Apply at least once so the table has a row
    await applyRegistryApi(modName, 'history test: column header check');

    await page.getByRole('button', { name: /history/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    await expect(page.getByRole('columnheader', { name: /^rev$/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /applied_by/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /applied_at/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /comment/i })).toBeVisible();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // Apply twice — second apply must appear as the first (top) row.
  test('revisions are ordered most recent first', async ({ page }) => {
    // First apply
    await applyRegistryApi(modName, 'history test: first apply');

    // Modify a template to create a second meaningful apply
    const tagHash = await getTemplateHash(tagName);
    const tagRes = await fetch(`${API_BASE}/templates/${tagName}`);
    const { template: tagTemplate } = (await tagRes.json()).data;
    await batchSave([{
      template_name: tagName,
      original_hash: tagHash,
      template: { ...tagTemplate, is_setpoint: true },
    }], [], true);

    // Second apply
    const comment2 = `history test: second apply ${Date.now()}`;
    const result2 = await applyRegistryApi(modName, comment2);

    await page.getByRole('button', { name: /history/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // The top row should be the highest revision number
    const firstRevCell = page.locator('tbody tr').first().locator('td').first();
    const firstRevText = await firstRevCell.textContent();
    expect(parseInt(firstRevText?.trim() ?? '', 10)).toBe(result2.registry_rev);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('applied_at column uses dd-MMM-yyyy HH:mm:ss format', async ({ page }) => {
    await applyRegistryApi(modName, 'history test: date format check');

    await page.getByRole('button', { name: /history/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Find the applied_at cell in the first data row (3rd column: rev, applied_by, applied_at)
    const firstRow = page.locator('tbody tr').first();
    const appliedAtCell = firstRow.locator('td').nth(2);
    const cellText = await appliedAtCell.textContent();

    // Should match dd-MMM-yyyy HH:mm:ss
    expect(cellText?.trim()).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('comment column shows the comment entered during apply', async ({ page }) => {
    const uniqueComment = `E2E history comment ${Date.now()}`;
    const result = await applyRegistryApi(modName, uniqueComment);

    await page.getByRole('button', { name: /history/i }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Find the row with our revision number and confirm the comment
    const revRow = page.locator('tbody tr').filter({ hasText: String(result.registry_rev) });
    await expect(revRow).toContainText(uniqueComment);
  });
});
