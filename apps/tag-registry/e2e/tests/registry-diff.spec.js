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

async function getTemplate(name) {
  const res = await fetch(`${API_BASE}/templates/${name}`);
  const json = await res.json();
  return json.data; // { template, hash }
}

// ── Suite ────────────────────────────────────────────────────────────────────

test.describe('Registry Diff Display', () => {
  const created = [];
  let po;
  let tagName, paramName, modName;

  // Setup: minimal hierarchy with one tag that has a field
  // (tag with eng_min field → parameter with instance override → module)
  // New timestamp-based names ensure tag_paths are unique per run
  // and never appear in the DB before the test applies them.
  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagName   = `tag_diff_${ts}`;
    paramName = `param_diff_${ts}`;
    modName   = `mod_diff_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName, 'f64', false, {
      eng_min: { field_type: 'Numeric', default: 0 },
    });
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: { eng_min: 5 } },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'Chan1', fields: {} },
    ]);

    await po.selectRoot(modName);
    await po.navigateToRegistry();
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  // Tag paths are unique per test run so the DB never has them yet.
  // All rows should appear as 'added' (green) on first visit.
  test('shows all tags as added when not yet applied to database', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Summary line should show at least 1 added and zero modified/retired
    await expect(page.getByText(/\+\d+ added/)).toBeVisible();
    await expect(page.getByText(/modified/)).not.toBeVisible();
    await expect(page.getByText(/retired/)).not.toBeVisible();

    // Every data row should have the green added background
    const dataRows = page.locator('tbody tr');
    const count = await dataRows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(dataRows.nth(i)).toHaveClass(/bg-green-500/);
    }
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('shows all rows as unchanged after applying registry', async ({ page }) => {
    // Apply the registry so DB matches the resolved hierarchy
    await applyRegistryApi(modName, 'registry-diff test: initial apply');

    // Reload the store and navigate to registry
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Summary should show unchanged count only, no added/modified/retired
    await expect(page.getByText(/unchanged/)).toBeVisible();
    await expect(page.getByText(/\+\d+ added/)).not.toBeVisible();
    await expect(page.getByText(/modified/)).not.toBeVisible();
    await expect(page.getByText(/retired/)).not.toBeVisible();

    // No data row should have a colored background
    const dataRows = page.locator('tbody tr');
    const count = await dataRows.count();
    for (let i = 0; i < count; i++) {
      await expect(dataRows.nth(i)).not.toHaveClass(/bg-green-500/);
      await expect(dataRows.nth(i)).not.toHaveClass(/bg-red-500/);
    }
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('shows new child as added (green) after registry was applied', async ({ page }) => {
    // Apply current state
    await applyRegistryApi(modName, 'registry-diff test: before add');

    // Add a second tag instance to the parameter (monitor channel)
    const { template: paramTemplate, hash: paramHash } = await getTemplate(paramName);
    await batchSave([{
      template_name: paramName,
      original_hash: paramHash,
      template: {
        ...paramTemplate,
        children: [
          ...paramTemplate.children,
          { template_name: tagName, asset_name: 'monitor', fields: { eng_min: 0 } },
        ],
      },
    }], [], true);

    // Reload and navigate to registry
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Summary should show +1 added
    await expect(page.getByText('+1 added')).toBeVisible();

    // The new tag row should be green
    const monitorPath = `${modName}.Chan1.monitor`;
    const newRow = page.locator('tr').filter({ hasText: monitorPath });
    await expect(newRow).toHaveClass(/bg-green-500/);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('shows removed tag as retired (red) after registry was applied', async ({ page }) => {
    // Apply current state (setpoint is now in DB)
    await applyRegistryApi(modName, 'registry-diff test: before remove');

    // Remove all children from the parameter so the tag disappears from hierarchy
    const { template: paramTemplate, hash: paramHash } = await getTemplate(paramName);
    await batchSave([{
      template_name: paramName,
      original_hash: paramHash,
      template: { ...paramTemplate, children: [] },
    }], [], true);

    // Reload and navigate to registry
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Summary should show -1 retired
    await expect(page.getByText('-1 retired')).toBeVisible();

    // The retired row should be red
    const retiredPath = `${modName}.Chan1.setpoint`;
    const retiredRow = page.locator('tr').filter({ hasText: retiredPath });
    await expect(retiredRow).toHaveClass(/bg-red-500/);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('shows modified row with cell-level highlight when field value changes', async ({ page }) => {
    // Apply current state (eng_min=5 in DB)
    await applyRegistryApi(modName, 'registry-diff test: before modify');

    // Change the instance override: eng_min from 5 to 99
    const { template: paramTemplate, hash: paramHash } = await getTemplate(paramName);
    await batchSave([{
      template_name: paramName,
      original_hash: paramHash,
      template: {
        ...paramTemplate,
        children: [
          { template_name: tagName, asset_name: 'setpoint', fields: { eng_min: 99 } },
        ],
      },
    }], [], true);

    // Reload and navigate to registry
    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Summary should show ~1 modified
    await expect(page.getByText('~1 modified')).toBeVisible();

    // The modified row should NOT have a full-row amber background
    const tagPath = `${modName}.Chan1.setpoint`;
    const modRow = page.locator('tr').filter({ hasText: tagPath });
    await expect(modRow).not.toHaveClass(/bg-amber-500/);

    // But at least one cell in that row should have amber cell highlight
    const amberCell = modRow.locator('td[class*="amber"]').first();
    await expect(amberCell).toBeVisible();
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('tag_id column shows new for added rows and numeric id for unchanged rows', async ({ page }) => {
    // Apply so the existing tag gets a tag_id in the DB
    await applyRegistryApi(modName, 'registry-diff test: tag_id check');

    // Add a second child so there is one unchanged (has id) + one added (shows "new")
    const { template: paramTemplate, hash: paramHash } = await getTemplate(paramName);
    await batchSave([{
      template_name: paramName,
      original_hash: paramHash,
      template: {
        ...paramTemplate,
        children: [
          ...paramTemplate.children,
          { template_name: tagName, asset_name: 'monitor', fields: { eng_min: 0 } },
        ],
      },
    }], [], true);

    await po.selectRoot(modName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // The added row should show 'new' in its first cell (tag_id column)
    const monitorRow = page.locator('tr').filter({ hasText: `${modName}.Chan1.monitor` });
    const addedTagIdCell = monitorRow.locator('td').first();
    await expect(addedTagIdCell).toContainText('new');

    // The unchanged row should show a numeric tag_id
    const setpointRow = page.locator('tr').filter({ hasText: `${modName}.Chan1.setpoint` });
    const existingTagIdCell = setpointRow.locator('td').first();
    const idText = await existingTagIdCell.textContent();
    expect(parseInt(idText?.trim() ?? '', 10)).toBeGreaterThan(0);
  });
});
