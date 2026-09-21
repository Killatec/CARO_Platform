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
 * Expands a node's row if it's currently collapsed (▶). No-ops if already
 * expanded — expand state persists across reloads via useTreeExpandStore's
 * localStorage backing, so a blind click can toggle an already-open node shut.
 */
async function ensureExpanded(systemTree, name) {
  const row = getNodeRow(systemTree, name);
  const btn = row.locator('button').first();
  if (await btn.count() === 0) return;
  const label = (await btn.textContent()).trim();
  if (label === '▶') await btn.click();
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
    await createStructuralTemplate(root, 'system', [childRef(c1), childRef(c2), childRef(c3)]);

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
    await createStructuralTemplate(root, 'system', [childRef(c1), childRef(c2), childRef(c3)]);

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
    await createStructuralTemplate(root, 'system', [childRef(c1), childRef(c2)]);

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
  test('cross-parent drag reparents the child as a sibling under the new parent', async ({ page }) => {
    const ts = Date.now();
    const [cc1, p1, p2, root] = [
      `cc1_cp_${ts}`, `p1_cp_${ts}`, `p2_cp_${ts}`, `root_cp_${ts}`,
    ];
    created.push(cc1, p1, p2, root);

    // root → [p1 → [cc1], p2]
    await createStructuralTemplate(cc1, 'parameter');
    await createStructuralTemplate(p2, 'parameter');
    await createStructuralTemplate(p1, 'parameter', [childRef(cc1)]);
    await createStructuralTemplate(root, 'system', [childRef(p1), childRef(p2)]);

    await po.selectRoot(root);

    // p1 is a non-root node and defaults to collapsed; expand it to reveal cc1.
    const p1Row = getNodeRow(po.systemTree, p1);
    await p1Row.locator('button').first().click();

    // cc1 is visible nested under p1
    await expect(po.systemTree).toContainText(cc1);

    // Cross-parent drag: cc1 (parent=p1) → top zone of p2 (parent=root).
    // cc1 should reparent to root, landing as a sibling before p2.
    const cc1Row = getNodeRow(po.systemTree, cc1);
    const p2Row  = getNodeRow(po.systemTree, p2);

    await cc1Row.dragTo(p2Row, {
      targetPosition: { x: 50, y: 3 },
    });

    // cc1 is no longer nested under p1 — it now sits at root level, before p2.
    const treeText1 = await po.systemTree.textContent();
    expect(treeText1.indexOf(p1)).toBeLessThan(treeText1.indexOf(cc1));
    expect(treeText1.indexOf(cc1)).toBeLessThan(treeText1.indexOf(p2));

    // Dirty state — both p1 (lost a child) and root (gained one) changed.
    await expect(po.saveButton).toBeVisible();

    // Save and reload; the reparent must persist.
    await saveAndConfirm(po);
    await po.selectRoot(root);

    const treeText2 = await po.systemTree.textContent();
    expect(treeText2.indexOf(p1)).toBeLessThan(treeText2.indexOf(cc1));
    expect(treeText2.indexOf(cc1)).toBeLessThan(treeText2.indexOf(p2));
  });

  // ── Test 4a ──────────────────────────────────────────────────────────────
  test('body-dropping a node onto a sibling nests it as that sibling\'s child', async ({ page }) => {
    const ts = Date.now();
    const [cc1, p1, p2, root] = [
      `cc1_sib_${ts}`, `p1_sib_${ts}`, `p2_sib_${ts}`, `root_sib_${ts}`,
    ];
    created.push(cc1, p1, p2, root);

    // root → [p1 -> [cc1], p2]  (p1 and p2 are SIBLINGS under root)
    await createStructuralTemplate(cc1, 'parameter');
    await createStructuralTemplate(p2, 'parameter');
    await createStructuralTemplate(p1, 'parameter', [childRef(cc1)]);
    await createStructuralTemplate(root, 'system', [childRef(p1), childRef(p2)]);

    await po.selectRoot(root);

    // Body-drop p1 (a sibling of p2 under root) onto p2's own body — this
    // must nest p1 as a new child of p2, not merely reorder it among root's
    // children. Reproduces the case where a sibling was previously
    // impossible to use as a body-drop nesting target at all.
    const p1Row = getNodeRow(po.systemTree, p1);
    const p2Row = getNodeRow(po.systemTree, p2);
    const p2Box = await p2Row.boundingBox();

    await p1Row.dragTo(p2Row, {
      targetPosition: { x: Math.floor(p2Box.width / 2), y: Math.floor(p2Box.height / 2) },
    });

    // p2 must now be expandable and show p1 nested beneath it.
    await ensureExpanded(po.systemTree, p2);
    await expect(po.systemTree).toContainText(p1);

    const treeText = await po.systemTree.textContent();
    expect(treeText.indexOf(p2)).toBeLessThan(treeText.indexOf(p1));

    await expect(po.saveButton).toBeVisible();

    await saveAndConfirm(po);
    await po.selectRoot(root);
    await ensureExpanded(po.systemTree, p2);
    await expect(po.systemTree).toContainText(p1);
  });

  // ── Test 4c ──────────────────────────────────────────────────────────────
  test('body-dropping a child onto its own current parent is a no-op', async ({ page }) => {
    const ts = Date.now();
    const [cc1, cc2, p1, root] = [
      `cc1_np_${ts}`, `cc2_np_${ts}`, `p1_np_${ts}`, `root_np_${ts}`,
    ];
    created.push(cc1, cc2, p1, root);

    // root → [p1 → [cc1, cc2]]
    await createStructuralTemplate(cc1, 'parameter');
    await createStructuralTemplate(cc2, 'parameter');
    await createStructuralTemplate(p1, 'parameter', [childRef(cc1), childRef(cc2)]);
    await createStructuralTemplate(root, 'system', [childRef(p1)]);

    await po.selectRoot(root);

    const p1Row = getNodeRow(po.systemTree, p1);
    await p1Row.locator('button').first().click();
    await expect(po.systemTree).toContainText(cc1);

    // Drag cc1 onto the BODY (dead center) of p1 — its own current parent.
    // cc1 is already p1's child, so this must not do anything.
    const cc1Row = getNodeRow(po.systemTree, cc1);
    const p1Box = await p1Row.boundingBox();

    await cc1Row.dragTo(p1Row, {
      targetPosition: { x: Math.floor(p1Box.width / 2), y: Math.floor(p1Box.height / 2) },
    });

    // No dirty state — the drop must be a no-op.
    await expect(po.saveButton).not.toBeVisible();

    // cc1 and cc2 are still both children of p1, in their original order.
    const treeText = await po.systemTree.textContent();
    expect(treeText.indexOf(p1)).toBeLessThan(treeText.indexOf(cc1));
    expect(treeText.indexOf(cc1)).toBeLessThan(treeText.indexOf(cc2));
  });

  // ── Test 4b ──────────────────────────────────────────────────────────────
  test('reparenting onto own descendant is rejected (cycle prevention)', async ({ page }) => {
    const ts = Date.now();
    const [gc1, p1, root] = [
      `gc1_cyc_${ts}`, `p1_cyc_${ts}`, `root_cyc_${ts}`,
    ];
    created.push(gc1, p1, root);

    // root → [p1 → [gc1]]
    await createStructuralTemplate(gc1, 'parameter');
    await createStructuralTemplate(p1, 'parameter', [childRef(gc1)]);
    await createStructuralTemplate(root, 'system', [childRef(p1)]);

    await po.selectRoot(root);

    // Expand p1 to reveal gc1.
    const p1Row = getNodeRow(po.systemTree, p1);
    await p1Row.locator('button').first().click();
    await expect(po.systemTree).toContainText(gc1);

    // Attempt to drop p1 onto its own child gc1 (body zone) — this would make
    // p1 a child of gc1 while gc1 remains a child of p1, a cycle.
    const gc1Row = getNodeRow(po.systemTree, gc1);
    const gc1Box = await gc1Row.boundingBox();

    await p1Row.dragTo(gc1Row, {
      targetPosition: { x: Math.floor(gc1Box.width / 2), y: Math.floor(gc1Box.height / 2) },
    }).catch(() => { /* drop may time out when the browser rejects it */ });

    // Tree must be unchanged: gc1 still nested under p1.
    const treeText = await po.systemTree.textContent();
    expect(treeText.indexOf(p1)).toBeLessThan(treeText.indexOf(gc1));

    // No dirty state — the drop must have been rejected before it mutated anything.
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
    await createStructuralTemplate(root, 'system', [childRef(c1), childRef(c2), childRef(c3)]);

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
