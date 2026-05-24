/**
 * Editor UI layout — structural assertions.
 *
 * Tests that are purely about visible geometry and panel labels rather than
 * template-workflow behaviour. No template fixtures are needed — the page
 * structure is observable immediately after load.
 */
import { test, expect } from '@playwright/test';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Editor layout', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  // The editor now uses a 3-column layout: System Tree | Properties | Templates,
  // with the ValidationPanel as a separate bar below all three columns.
  // Each column scrolls independently.
  test('System Tree, Properties, and Templates are three independent side-by-side columns with ValidationPanel below', async ({ page }) => {
    const po = createPageObjects(page);

    // All three column panels must be visible
    await expect(po.systemTree).toBeVisible();
    await expect(po.fieldsPanel).toBeVisible();
    await expect(po.templatesTree).toBeVisible();

    // Get bounding boxes of the data-testid root divs
    const sysBB   = await po.systemTree.boundingBox();
    const propsBB = await po.fieldsPanel.boundingBox();
    const tmplsBB = await po.templatesTree.boundingBox();

    // Left-to-right ordering: System Tree < Properties < Templates
    expect(sysBB.x).toBeLessThan(propsBB.x);
    expect(propsBB.x).toBeLessThan(tmplsBB.x);

    // All three share the same vertical band (within 20 px tolerance)
    expect(Math.abs(sysBB.y - propsBB.y)).toBeLessThan(20);
    expect(Math.abs(sysBB.y - tmplsBB.y)).toBeLessThan(20);

    // ValidationPanel wrapper is positioned below the top of the column band
    const validBB = await po.validationPanel.boundingBox();
    expect(validBB.y).toBeGreaterThan(sysBB.y + 50);

    // Each column container (immediate parent of the data-testid div) scrolls independently.
    // locator('..') resolves to the column wrapper div which carries overflow-y-auto.
    const sysOverflow   = await po.systemTree.locator('..').evaluate(el => getComputedStyle(el).overflowY);
    const propsOverflow = await po.fieldsPanel.locator('..').evaluate(el => getComputedStyle(el).overflowY);
    const tmplsOverflow = await po.templatesTree.locator('..').evaluate(el => getComputedStyle(el).overflowY);

    expect(sysOverflow).toBe('auto');
    expect(propsOverflow).toBe('auto');
    expect(tmplsOverflow).toBe('auto');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  // The Templates panel header was renamed from "All Templates" to "Templates".
  test('Templates panel header reads "Templates" not "All Templates"', async ({ page }) => {
    const po = createPageObjects(page);

    await po.templatesTree.waitFor({ state: 'visible' });

    // Must show the new label
    await expect(po.templatesTree).toContainText('Templates');
    // Must not show the old label
    await expect(po.templatesTree).not.toContainText('All Templates');
  });
});
