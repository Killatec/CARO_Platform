/**
 * Validation Panel — parent type rules
 *
 * PREREQUISITE: `apps/tag-registry/server/.env` must contain:
 *   VALIDATE_REQUIRED_PARENT_TYPES=module,parameter
 *   VALIDATE_UNIQUE_PARENT_TYPES=true
 *
 * These env vars cause AppShell to fetch /api/v1/config on mount, which
 * populates useUIStore.validationConfig. useValidation.js reads that config
 * and passes it to validateParentTypes(). Without both vars set, tests 1, 2,
 * and 4 will fail to observe the expected error codes.
 */
import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Validation Panel — parent type rules', () => {
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
  // System root → tag directly (no module ancestor).
  // With VALIDATE_REQUIRED_PARENT_TYPES=module,parameter the tag's ancestor
  // chain ['system','tag'] is missing 'module' → PARENT_TYPE_MISSING error.
  test('PARENT_TYPE_MISSING shown when tag has no module ancestor', async ({ page }) => {
    const ts = Date.now();
    const tagName  = `tag_vpt1_${ts}`;
    const rootName = `sys_vpt1_${ts}`;
    created.push(tagName, rootName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(rootName, 'system', [
      { template_name: tagName, asset_name: 'direct_tag', fields: {} },
    ]);

    await po.selectRoot(rootName);

    await expect(po.validationPanel).toContainText('PARENT_TYPE_MISSING');
    await expect(po.validationPanel).toContainText('"module"');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  // Same hierarchy as test 1. The same validation run also reports a missing
  // 'parameter' ancestor — two separate PARENT_TYPE_MISSING messages are shown.
  test('PARENT_TYPE_MISSING shown when tag has no parameter ancestor', async ({ page }) => {
    const ts = Date.now();
    const tagName  = `tag_vpt2_${ts}`;
    const rootName = `sys_vpt2_${ts}`;
    created.push(tagName, rootName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(rootName, 'system', [
      { template_name: tagName, asset_name: 'direct_tag', fields: {} },
    ]);

    await po.selectRoot(rootName);

    await expect(po.validationPanel).toContainText('PARENT_TYPE_MISSING');
    await expect(po.validationPanel).toContainText('"parameter"');
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // Full hierarchy: system → module → parameter → tag.
  // Ancestor chain for the tag: ['system','module','parameter','tag'] — both
  // required types present, no duplicates → ValidationPanel must be clean.
  test('no validation errors when tag has both module and parameter ancestors', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_vpt3_${ts}`;
    const paramName = `param_vpt3_${ts}`;
    const modName   = `mod_vpt3_${ts}`;
    const rootName  = `sys_vpt3_${ts}`;
    created.push(tagName, paramName, modName, rootName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    await createStructuralTemplate(modName, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ]);
    await createStructuralTemplate(rootName, 'system', [
      { template_name: modName, asset_name: 'unit', fields: {} },
    ]);

    await po.selectRoot(rootName);

    await expect(po.validationPanel).not.toContainText('PARENT_TYPE_MISSING');
    await expect(po.validationPanel).not.toContainText('DUPLICATE_PARENT_TYPE');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  // Hierarchy: system → mod1 → mod2 → parameter → tag.
  // Ancestor chain for the tag: ['system','module','module','parameter','tag']
  // 'module' appears twice with VALIDATE_UNIQUE_PARENT_TYPES=true → DUPLICATE_PARENT_TYPE.
  test('DUPLICATE_PARENT_TYPE shown when tag has two module ancestors', async ({ page }) => {
    const ts = Date.now();
    const tagName   = `tag_vpt4_${ts}`;
    const paramName = `param_vpt4_${ts}`;
    const mod2Name  = `mod2_vpt4_${ts}`;
    const mod1Name  = `mod1_vpt4_${ts}`;
    const rootName  = `sys_vpt4_${ts}`;
    created.push(tagName, paramName, mod2Name, mod1Name, rootName);

    await createTagTemplate(tagName);
    await createStructuralTemplate(paramName, 'parameter', [
      { template_name: tagName, asset_name: 'setpoint', fields: {} },
    ]);
    // Inner module: mod2 → parameter → tag
    await createStructuralTemplate(mod2Name, 'module', [
      { template_name: paramName, asset_name: 'chan', fields: {} },
    ]);
    // Outer module: mod1 → mod2 (two 'module' levels in the ancestor chain)
    await createStructuralTemplate(mod1Name, 'module', [
      { template_name: mod2Name, asset_name: 'inner_mod', fields: {} },
    ]);
    await createStructuralTemplate(rootName, 'system', [
      { template_name: mod1Name, asset_name: 'unit', fields: {} },
    ]);

    await po.selectRoot(rootName);

    await expect(po.validationPanel).toContainText('DUPLICATE_PARENT_TYPE');
  });
});
