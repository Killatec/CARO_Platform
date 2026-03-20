import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Drag and Drop', () => {
  const created = [];
  let po;
  let tagTName, modMName;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);

    const ts = Date.now();
    tagTName = `tag_dd_${ts}`;
    modMName = `mod_dd_${ts}`;
    created.push(tagTName, modMName);

    await createTagTemplate(tagTName);
    await createStructuralTemplate(modMName, 'module'); // no children initially

    await page.goto('/');
    await po.selectRoot(modMName);
  });

  test.afterEach(async ({ page }) => {
    const localPo = createPageObjects(page);
    try {
      if (await localPo.saveButton.isVisible({ timeout: 2000 })) {
        await localPo.discardAndWait();
      }
    } catch { /* ignore */ }
    await deleteTemplates(created.splice(0));
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('dragging a tag template onto a module node adds it as a child', async ({ page }) => {
    await po.expandTemplateFolder('tag');

    const tagLeaf = po.templatesTree.getByText(tagTName, { exact: true });
    const modNode = po.systemTree.getByText(modMName, { exact: false }).first();

    await tagLeaf.dragTo(modNode);

    await expect(po.systemTree).toContainText(tagTName);
    await expect(po.saveButton).toBeVisible();
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('dropped child appears in Fields Panel on click', async ({ page }) => {
    await po.expandTemplateFolder('tag');

    const tagLeaf = po.templatesTree.getByText(tagTName, { exact: true });
    const modNode = po.systemTree.getByText(modMName, { exact: false }).first();
    await tagLeaf.dragTo(modNode);

    await expect(po.systemTree).toContainText(tagTName);

    await po.clickSystemTreeNode(tagTName);
    await expect(
      po.fieldsPanel.locator('input[disabled]').first()
    ).toHaveValue(tagTName);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('dragging onto a tag node is not accepted (tag nodes are not valid drop targets)', async ({ page }) => {
    const tagT2Name = `tag_dd2_${Date.now()}`;
    created.push(tagT2Name);
    await createTagTemplate(tagT2Name);

    // First add tagT to modM via drag so it appears in the system tree
    await po.expandTemplateFolder('tag');
    const tagLeaf = po.templatesTree.getByText(tagTName, { exact: true });
    const modNode = po.systemTree.getByText(modMName, { exact: false }).first();
    await tagLeaf.dragTo(modNode);
    await expect(po.systemTree).toContainText(tagTName);

    // Now try to drag tagT2 onto the tagT node in the system tree.
    // tagTName is already visible from the first drag — no reload needed.
    const tagLeaf2 = po.templatesTree.getByText(tagT2Name, { exact: true });

    // Wait for the dropped node to appear in the system tree
    const tagNodeInTree = po.systemTree
      .getByText(tagTName, { exact: true })
      .first();
    await tagNodeInTree.waitFor({ state: 'visible', timeout: 5000 });

    // Attempt the drag — expect it to have no effect since tag
    // nodes are not valid drop targets
    await tagLeaf2.dragTo(tagNodeInTree, { timeout: 5000 })
      .catch(() => {
        // dragTo may time out if the target rejects the drop —
        // that is acceptable for this test
      });

    // Assert tagT2 was NOT added as a child of tagTName
    await expect(po.systemTree).not.toContainText(tagT2Name);
  });
});
