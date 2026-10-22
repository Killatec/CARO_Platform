import { test, expect } from '@playwright/test';
import {
  createTagTemplate,
  createStructuralTemplate,
  deleteTemplates,
  applyRegistryApi,
} from '../helpers/api.js';
import { createPageObjects } from '../helpers/pageObjects.js';

test.describe('Generate Tag Defs', () => {
  const created = [];
  let po;

  // Creates tag → module (Module_Type) → system, selects the system and opens
  // the Registry page. Returns the system name.
  async function setup(page, moduleType) {
    po = createPageObjects(page);
    const ts = Date.now();
    const tagName = `tag_td_${ts}`;
    const modName = `mod_td_${ts}`;
    const sysName = `sys_td_${ts}`;
    created.push(tagName, modName, sysName);

    await createTagTemplate(tagName, 'f32', true);
    await createStructuralTemplate(modName, 'module', [
      { template_name: tagName, asset_name: 'Gain', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: moduleType } });
    await createStructuralTemplate(sysName, 'system', [
      { template_name: modName, asset_name: 'RF1', fields: {} },
    ]);

    await po.waitForServer();
    await page.goto('/');
    await po.selectRoot(sysName);
    await po.navigateToRegistry();
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });
    return sysName;
  }

  test.afterEach(async ({ page }) => {
    await page.goto('about:blank').catch(() => {});
    await deleteTemplates(created.splice(0));
  });

  test('downloads a timestamped ZIP stamped with the applied registry revision', async ({ page }) => {
    const sysName = await setup(page, 'MQTT');
    // The export requires the saved templates to be what the latest revision applied.
    const { registry_rev } = await applyRegistryApi(sysName, 'e2e: Tag Defs export');

    const button = page.getByRole('button', { name: 'Generate Tag Defs' });
    await expect(button).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button.click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^TagDefs_\d{4}-\d{2}-\d{2}_\d{6}\.zip$/);
    const fs = await import('fs');
    const bytes = fs.readFileSync(await download.path());
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // ZIP local-file-header magic
    await expect(page.getByTestId('tag-defs-error')).toHaveCount(0);

    const { unzipSync, strFromU8 } = await import('fflate');
    const [entry] = Object.values(unzipSync(new Uint8Array(bytes)));
    const file = JSON.parse(strFromU8(entry));
    expect(file.tag_registry_rev).toBe(registry_rev);
    expect(file).not.toHaveProperty('content_hash');
  });

  test('shows an error banner when the saved templates have not been applied', async ({ page }) => {
    await setup(page, 'MQTT');

    await page.getByRole('button', { name: 'Generate Tag Defs' }).click();
    await expect(page.getByTestId('tag-defs-error')).toContainText('apply them first', { timeout: 5000 });
  });

  test('shows an error banner when the system has no MQTT module', async ({ page }) => {
    await setup(page, 'HMI');

    await page.getByRole('button', { name: 'Generate Tag Defs' }).click();
    await expect(page.getByTestId('tag-defs-error')).toContainText('No MQTT module templates', { timeout: 5000 });
  });
});
