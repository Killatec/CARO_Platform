import { test, expect } from '@playwright/test';
import {
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function childRef(name) {
  return { template_name: name, asset_name: name, fields: {} };
}

/**
 * Returns the draggable row div for a node whose display name is `name`.
 * Navigates: span.flex-1 (text span) → parent div (the row div with draggable attr).
 */
function getNodeRow(systemTree, name) {
  return systemTree
    .locator('span.flex-1')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('..');
}

/**
 * Clicks Save and waits for the save bar to disappear, confirming a cascade
 * modal if one appears first (e.g. when upstream parents are affected).
 */
async function saveAndConfirm(po) {
  await po.saveButton.click();
  try {
    await po.cascadeModal.waitFor({ state: 'visible', timeout: 2000 });
    await po.cascadeModal.getByRole('button', { name: /confirm/i }).click();
    await po.cascadeModal.waitFor({ state: 'hidden', timeout: 5000 });
  } catch {
    // No cascade modal — direct save path; just wait for save bar to clear.
  }
  await po.saveButton.waitFor({ state: 'hidden', timeout: 10000 });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Tree Reorder', () => {
  const created = [];
  let po;

  test.beforeEach(async ({ page }) => {
    po = createPageObjects(page);
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

  // ── Test 1 ───────────────────────────────────────────────────────────────
  test('reorder down: drag child 0 to after child 2, save, reload, order persists', async ({ page }) => {
    const ts = Date.now();
    const [c1, c2, c3, root] = [
      `c1_ro_${ts}`, `c2_ro_${ts}`, `c3_ro_${ts}`, `root_ro_${ts}`,
    ];
    created.push(c1, c2, c3, root);

    await createStructuralTemplate(c1, 'parameter');
    await createStructuralTemplate(c2, 'parameter');
    await createStructuralTemplate(c3, 'parameter');
    await createStructuralTemplate(root, 'parameter', [childRef(c1), childRef(c2), childRef(c3)]);

    await po.selectRoot(root);

    // Drag c1 to the bottom zone of c3 (insert after c3)
    const c1Row = getNodeRow(po.systemTree, c1);
    const c3Row = getNodeRow(po.systemTree, c3);
    const c3Box = await c3Row.boundingBox();

    await c1Row.dragTo(c3Row, {
      targetPosition: { x: Math.floor(c3Box.width / 2), y: c3Box.height - 3 },
    });

    // Verify immediate re-order: c2 → c3 → c1
    const treeText1 = await po.systemTree.textContent();
    expect(treeText1.indexOf(c2)).toBeLessThan(treeText1.indexOf(c3));
    expect(treeText1.indexOf(c3)).toBeLessThan(treeText1.indexOf(c1));

    // Save and reload
    await saveAndConfirm(po);
    await po.selectRoot(root);

    // Verify order persisted after reload
    const treeText2 = await po.systemTree.textContent();
    expect(treeText2.indexOf(c2)).toBeLessThan(treeText2.indexOf(c3));
    expect(treeText2.indexOf(c3)).toBeLessThan(treeText2.indexOf(c1));
  });

  // ── Test 2 ───────────────────────────────────────────────────────────────
  test('reorder up: drag last child to position 0, save, reload, order persists', async ({ page }) => {
    const ts = Date.now();
    const [c1, c2, c3, root] = [
      `c1_ru_${ts}`, `c2_ru_${ts}`, `c3_ru_${ts}`, `root_ru_${ts}`,
    ];
    created.push(c1, c2, c3, root);

    await createStructuralTemplate(c1, 'parameter');
    await createStructuralTemplate(c2, 'parameter');
    await createStructuralTemplate(c3, 'parameter');
    await createStructuralTemplate(root, 'parameter', [childRef(c1), childRef(c2), childRef(c3)]);

    await po.selectRoot(root);

    // Drag c3 to the top zone of c1 (insert before c1)
    const c3Row = getNodeRow(po.systemTree, c3);
    const c1Row = getNodeRow(po.systemTree, c1);

    await c3Row.dragTo(c1Row, {
      targetPosition: { x: 50, y: 3 },
    });

    // Verify immediate re-order: c3 → c1 → c2
    const treeText1 = await po.systemTree.textContent();
    expect(treeText1.indexOf(c3)).toBeLessThan(treeText1.indexOf(c1));
    expect(treeText1.indexOf(c1)).toBeLessThan(treeText1.indexOf(c2));

    // Save and reload
    await saveAndConfirm(po);
    await po.selectRoot(root);

    // Verify order persisted after reload
    const treeText2 = await po.systemTree.textContent();
    expect(treeText2.indexOf(c3)).toBeLessThan(treeText2.indexOf(c1));
    expect(treeText2.indexOf(c1)).toBeLessThan(treeText2.indexOf(c2));
  });

  // ── Test 3 ───────────────────────────────────────────────────────────────
  test('template panel drop into top zone inserts at position, not appended', async ({ page }) => {
    const ts = Date.now();
    const [c1, c2, c3, root] = [
      `c1_tp_${ts}`, `c2_tp_${ts}`, `c3_tp_${ts}`, `root_tp_${ts}`,
    ];
    created.push(c1, c2, c3, root);

    // Root has c1 and c2; c3 is an independent template not yet in the tree
    await createStructuralTemplate(c1, 'parameter');
    await createStructuralTemplate(c2, 'parameter');
    await createStructuralTemplate(c3, 'parameter');
    await createStructuralTemplate(root, 'parameter', [childRef(c1), childRef(c2)]);

    await po.selectRoot(root);
    await po.expandTemplateFolder('parameter');

    // Drag c3 from the templates panel into the top zone of the c2 row
    // (should insert c3 at index 1, between c1 and c2, not append at index 2)
    const c3Leaf = po.templatesTree.getByText(c3, { exact: true });
    const c2Row  = getNodeRow(po.systemTree, c2);
    const c2Box  = await c2Row.boundingBox();

    await c3Leaf.dragTo(c2Row, {
      targetPosition: { x: Math.floor(c2Box.width / 2), y: 3 },
    });

    // Verify order: c1 → c3 → c2
    const treeText = await po.systemTree.textContent();
    expect(treeText.indexOf(c1)).toBeLessThan(treeText.indexOf(c3));
    expect(treeText.indexOf(c3)).toBeLessThan(treeText.indexOf(c2));
  });

  // ── Test 4 ───────────────────────────────────────────────────────────────
  test('cross-parent drag is rejected: child stays under original parent', async ({ page }) => {
    const ts = Date.now();
    const [cc1, p1, p2, root] = [
      `cc1_cp_${ts}`, `p1_cp_${ts}`, `p2_cp_${ts}`, `root_cp_${ts}`,
    ];
    created.push(cc1, p1, p2, root);

    // root → [p1 → [cc1], p2]
    await createStructuralTemplate(cc1, 'parameter');
    await createStructuralTemplate(p2, 'parameter');
    await createStructuralTemplate(p1, 'parameter', [childRef(cc1)]);
    await createStructuralTemplate(root, 'parameter', [childRef(p1), childRef(p2)]);

    await po.selectRoot(root);

    // cc1 is visible nested under p1
    await expect(po.systemTree).toContainText(cc1);

    // Attempt cross-parent drag: cc1 (parent=p1) → top zone of p2 (parent=root)
    // The drop should be silently rejected (different parentTemplateName)
    const cc1Row = getNodeRow(po.systemTree, cc1);
    const p2Row  = getNodeRow(po.systemTree, p2);

    await cc1Row.dragTo(p2Row, {
      targetPosition: { x: 50, y: 3 },
    }).catch(() => { /* drop may time out when browser rejects it */ });

    // Tree must be unchanged: cc1 still nested under p1, before p2 in DOM order
    const treeText = await po.systemTree.textContent();
    expect(treeText.indexOf(p1)).toBeLessThan(treeText.indexOf(cc1));
    expect(treeText.indexOf(cc1)).toBeLessThan(treeText.indexOf(p2));

    // No dirty state — save bar must not appear
    await expect(po.saveButton).not.toBeVisible();
  });

  // ── Test 5 ───────────────────────────────────────────────────────────────
  test('"See what\'s changed" modal shows Children Reordered section after reorder', async ({ page }) => {
    const ts = Date.now();
    const [c1, c2, c3, root] = [
      `c1_mc_${ts}`, `c2_mc_${ts}`, `c3_mc_${ts}`, `root_mc_${ts}`,
    ];
    created.push(c1, c2, c3, root);

    await createStructuralTemplate(c1, 'parameter');
    await createStructuralTemplate(c2, 'parameter');
    await createStructuralTemplate(c3, 'parameter');
    await createStructuralTemplate(root, 'parameter', [childRef(c1), childRef(c2), childRef(c3)]);

    await po.selectRoot(root);

    // Drag c1 to after c3
    const c1Row = getNodeRow(po.systemTree, c1);
    const c3Row = getNodeRow(po.systemTree, c3);
    const c3Box = await c3Row.boundingBox();

    await c1Row.dragTo(c3Row, {
      targetPosition: { x: Math.floor(c3Box.width / 2), y: c3Box.height - 3 },
    });

    // Save bar must be visible (template is now dirty)
    await expect(po.saveButton).toBeVisible();

    // Open the "See what's changed" preview modal
    await po.seeChangesButton.click();

    // Modal must show the "Children Reordered" section with the parent template name
    await expect(po.cascadePreviewModal).toBeVisible();
    await expect(po.cascadePreviewModal).toContainText('Children Reordered');
    await expect(po.cascadePreviewModal).toContainText(root);

    // Close the modal so afterEach can cleanly discard pending changes
    await po.cascadePreviewModal.getByRole('button', { name: /close/i }).click();
    await expect(po.cascadePreviewModal).not.toBeVisible();
  });
});
