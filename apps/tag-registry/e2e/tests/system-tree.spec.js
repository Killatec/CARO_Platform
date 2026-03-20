import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('System Tree', () => {
  const created = [];
  let po;
  let tagTName, paramPName, modMName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagTName  = `tag_st_${ts}`;
    paramPName = `param_st_${ts}`;
    modMName  = `mod_st_${ts}`;
    created.push(tagTName, paramPName, modMName);

    // 3-level hierarchy: tagT → paramP (child: tagT as 'monitor') → modM (child: paramP as 'Channel1')
    await createTagTemplate(tagTName);
    await createStructuralTemplate(paramPName, 'parameter', [
      { template_name: tagTName, asset_name: 'monitor', fields: {} },
    ]);
    await createStructuralTemplate(modMName, 'module', [
      { template_name: paramPName, asset_name: 'Channel1', fields: {} },
    ]);

    await page.goto('/');
    await po.selectRoot(modMName);
  });

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('system tree renders the full hierarchy', async () => {
    await expect(po.systemTree).toContainText('Channel1');
    await expect(po.systemTree).toContainText('monitor');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('clicking a node populates the Fields Panel', async () => {
    await po.clickSystemTreeNode('Channel1');
    await expect(po.fieldsPanel).toBeVisible();
    // 'Channel1' is the asset_name — it appears as an input value, not text content.
    await expect(
      po.fieldsPanel.locator('tr').filter({ hasText: 'Asset Name' }).locator('input')
    ).toHaveValue('Channel1');
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('collapse button hides child nodes', async ({ page }) => {
    // Target Channel1's expand toggle by its exact text span → parent row div →
    // button whose accessible name is the collapse arrow (▼ or ▶).
    const channel1Toggle = po.systemTree
      .getByText('Channel1', { exact: true })
      .locator('..') // node row div
      .getByRole('button', { name: /[▼▶]/ });
    await channel1Toggle.click();
    await page.waitForTimeout(300);

    await expect(po.systemTree).not.toContainText('monitor');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('re-expanding shows child nodes again', async ({ page }) => {
    const channel1Toggle = po.systemTree
      .getByText('Channel1', { exact: true })
      .locator('..') // node row div
      .getByRole('button', { name: /[▼▶]/ });

    // Collapse
    await channel1Toggle.click();
    await page.waitForTimeout(300);
    await expect(po.systemTree).not.toContainText('monitor');

    // Re-expand
    await channel1Toggle.click();
    await page.waitForTimeout(300);
    await expect(po.systemTree).toContainText('monitor');
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('trash icon on a non-root node removes it and shows Save bar', async () => {
    // Channel1 is the first direct child — its trash button (title="Remove child instance")
    // is the first such button in the system tree. Click it directly.
    await po.systemTree.getByTitle('Remove child instance').first().click();

    await expect(po.systemTree).not.toContainText('Channel1');
    await expect(po.saveButton).toBeVisible();
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('root node does not have a trash icon', async () => {
    // Root nodes have no parentTemplateName so no trash button (title="Remove child instance")
    // is rendered. Target the root node row via its name span and assert no trash button.
    const rootNodeRow = po.systemTree
      .locator('span.flex-1', { hasText: modMName })
      .locator('..'); // node row div
    await expect(rootNodeRow.getByTitle('Remove child instance')).toHaveCount(0);
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  test('dirty node label shown in orange after instance edit', async () => {
    await po.clickSystemTreeNode('Channel1');

    // Edit the asset name input
    const assetNameInput = po.fieldsPanel
      .locator('tr')
      .filter({ hasText: 'Asset Name' })
      .locator('input');
    await assetNameInput.clear();
    await assetNameInput.fill('Channel1_renamed');

    // The Channel1 node label in the system tree should now carry an orange class.
    // Target the span directly with an anchored regex to avoid matching ancestor
    // [data-tree-node] containers that contain 'Channel1_renamed' in their subtree.
    const nodeLabel = po.systemTree
      .locator('span.flex-1')
      .filter({ hasText: /^Channel1_renamed$/ })
      .first();
    await expect(nodeLabel).toHaveClass(/orange/);
  });
});
