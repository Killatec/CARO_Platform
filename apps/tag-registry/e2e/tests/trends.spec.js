/**
 * Registry Table — trends column
 *
 * Covers the `trends` boolean column added to the RegistryTable in Phase 2.
 * `trends` is derived client-side by resolveRegistry(): true if any level in
 * the resolved meta chain has a field keyed "trends" (case-insensitive) with
 * the boolean value `true`; false otherwise.
 *
 * Each test creates its own template hierarchy, navigates to the Registry page
 * via sidebar button (preserving Zustand store), and asserts on the rendered
 * RegistryTable. No database apply is required — the proposed (in-memory)
 * registry is sufficient to observe the trends column.
 *
 * Column order in RegistryTable: tag_id(0), tag_path(1), data_type(2),
 * is_setpoint(3), trends(4), meta(5). The trends cell is td.nth(4).
 */
import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Registry Table — trends column', () => {
  const created = [];
  let po;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);
    await po.waitForServer();
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  // The RegistryTable must render a "trends" column header.
  test('trends column header is visible in Registry table', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_tr1_${ts}`;
    const paramName = `param_tr1_${ts}`;
    const modName   = `mod_tr1_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ]);

    await po.selectRoot(modName);
    await po.navigateToRegistry();

    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('columnheader', { name: /^trends/i })).toBeVisible();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  // When no level in the hierarchy has a trends field, the tag row shows 'false'.
  test('trends is false when no hierarchy level has a trends field', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_tr2_${ts}`;
    const paramName = `param_tr2_${ts}`;
    const modName   = `mod_tr2_${ts}`;
    created.push(tagName, paramName, modName);

    // No trends field on any template
    await createTagTemplate(tagName, 'f64', false, {});
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ]);

    await po.selectRoot(modName);
    await po.navigateToRegistry();

    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    const tagPath = `${modName}.chan.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    // trends is the 5th td (0-indexed: 4) in column order:
    // tag_id(0), tag_path(1), data_type(2), is_setpoint(3), trends(4), meta(5)
    const trendsCell = row.locator('td').nth(4);
    await expect(trendsCell).toContainText('false');
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // When the module level has a trends field set to true (boolean), the tag
  // row shows 'true' in the trends column. The module's resolved fields are
  // included in the meta chain and checked by resolveRegistry().
  test('trends is true when a hierarchy level has trends field set to true', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_tr3_${ts}`;
    const paramName = `param_tr3_${ts}`;
    const modName   = `mod_tr3_${ts}`;
    created.push(tagName, paramName, modName);

    await createTagTemplate(tagName, 'f64', false, {});
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    // Module template carries a trends field with default: true
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ], { trends: { field_type: 'Boolean', default: true } });

    await po.selectRoot(modName);
    await po.navigateToRegistry();

    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    const tagPath = `${modName}.chan.setpoint`;
    const row = page.locator('tr').filter({ hasText: tagPath });
    // trends is the 5th td (0-indexed: 4)
    const trendsCell = row.locator('td').nth(4);
    await expect(trendsCell).toContainText('true');
  });
});
