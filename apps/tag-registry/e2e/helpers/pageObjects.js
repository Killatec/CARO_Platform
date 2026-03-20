/**
 * Page object factory for the Tag Registry UI.
 *
 * All locators are lazy Playwright Locator objects — they do not resolve until
 * an action or assertion is called on them. Locators are anchored to their
 * panel container where possible to avoid cross-panel text collisions.
 *
 * Panel container strategy (no data-testid exists):
 *   systemTree      — parent of the "System Tree" header div (AssetTree root)
 *   templatesTree   — the .select-none root div that contains "All Templates"
 *   fieldsPanel     — parent of the "Properties" header div (FieldsPanel root)
 *   validationPanel — first div whose direct text contains "Validation"
 *
 * Modal container strategy (Modal primitive has no role="dialog"):
 *   Use .shadow-xl filtered by title text to locate modal boxes.
 */
export function createPageObjects(page) {
  // ── Panel containers ─────────────────────────────────────────────────────
  const systemTree    = page.locator('[data-testid="system-tree"]');
  const templatesTree = page.locator('[data-testid="templates-tree"]');
  const fieldsPanel   = page.locator('[data-testid="fields-panel"]');
  const validationPanel = page.locator('div').filter({ hasText: /^Validation/ }).first();

  // ── Top-bar controls ─────────────────────────────────────────────────────
  const rootDropdown     = page.locator('select').first();
  const saveButton       = page.locator('[data-testid="save-button"]');
  const cancelButton     = page.locator('[data-testid="cancel-button"]');
  const seeChangesButton = page.locator('[data-testid="see-changes-button"]');

  // ── Modals ───────────────────────────────────────────────────────────────
  // Modal primitive renders via createPortal with no role="dialog".
  // Locate modal boxes by their .shadow-xl class + distinguishing title text.
  const cascadeModal        = page.locator('.shadow-xl').filter({ hasText: /cascade|confirm/i }).first();
  const cascadePreviewModal = page.locator('.shadow-xl').filter({ hasText: /preview|changed/i }).first();

  // ── Action helpers ────────────────────────────────────────────────────────
  return {
    // Locators
    rootDropdown,
    saveButton,
    cancelButton,
    seeChangesButton,
    validationPanel,
    systemTree,
    templatesTree,
    fieldsPanel,
    cascadeModal,
    cascadePreviewModal,

    // Polls GET /api/v1/templates until a 200 response is received.
    // Guards against nodemon restart windows between tests.
    async waitForServer() {
      const API = 'http://10.0.0.184:3001/api/v1/templates';
      for (let i = 0; i < 20; i++) {
        try {
          const res = await fetch(API);
          if (res.ok) return;
        } catch { /* server not up yet */ }
        await page.waitForTimeout(500);
      }
      throw new Error('Server did not become ready within 10s');
    },

    /**
     * Navigates to '/' (to ensure fresh template list), waits for the named
     * option to appear in the root dropdown, selects it, and waits for the
     * system tree to show the root node.
     */
    async selectRoot(name) {
      await this.waitForServer();          // guard against nodemon restart window
      await page.goto('about:blank');
      await page.goto('/');
      await rootDropdown.waitFor({ state: 'visible', timeout: 5000 });

      // Poll until the target option appears in the dropdown.
      // If listTemplates() raced with a prior afterEach delete, the
      // option may be absent on first mount. One reload is enough to
      // re-fetch the now-settled template list.
      let optionFound = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const options = await rootDropdown.locator('option').allTextContents();
        console.log(`[selectRoot] attempt ${attempt + 1}, looking for "${name}", options:`, options);
        optionFound = options.some(o => o.includes(name));
        if (optionFound) break;

        // Option not present yet — reload to re-trigger listTemplates()
        console.log(`[selectRoot] option not found, reloading...`);
        await page.reload();
        await rootDropdown.waitFor({ state: 'visible', timeout: 5000 });
      }

      if (!optionFound) {
        throw new Error(`[selectRoot] option "${name}" never appeared in dropdown after 2 attempts`);
      }

      await rootDropdown.selectOption({ value: name });
      await systemTree.getByText(name, { exact: false })
        .waitFor({ state: 'visible', timeout: 15000 });
    },

    /**
     * Clicks a template leaf in the Templates Tree by name and waits for the
     * Fields Panel table to populate. The folder containing the leaf must
     * already be expanded; call expandTemplateFolder(type) first if needed.
     *
     * Note: the template name appears as an <input value=""> in the FieldsPanel,
     * not as visible text, so we wait for the table element instead.
     */
    async clickTemplateLeaf(name) {
      await templatesTree.getByText(name, { exact: true }).click();
      // Wait for the first input in the panel (Template Name disabled input) —
      // more reliable than waiting for <table> since it appears in all content modes.
      await fieldsPanel.locator('input').first().waitFor({ state: 'visible' });
    },

    /**
     * Clicks a node in the System Tree by display name (asset_name or
     * template_name) and waits for the Fields Panel to populate.
     */
    async clickSystemTreeNode(name) {
      await systemTree.getByText(name, { exact: true }).click();
      await fieldsPanel.locator('input').first().waitFor({ state: 'visible' });
    },

    /**
     * Expands a template type folder in the Templates Tree if it is currently
     * collapsed. Pass the template_type string, e.g. 'tag', 'parameter'.
     *
     * Uses span.font-medium to precisely target folder label spans (leaf name
     * spans use font-semibold or font-normal, never font-medium).
     */
    async expandTemplateFolder(type) {
      try {
        const folderLabel = templatesTree
          .locator('span.font-medium')
          .filter({ hasText: new RegExp(`^${type}$`) })
          .first();
        await folderLabel.waitFor({ state: 'visible', timeout: 5000 });
        const folderHeader = folderLabel.locator('..');
        const toggleBtn = folderHeader.getByRole('button').first();
        // textContent with short timeout so we fail fast if element not found
        const label = await toggleBtn.textContent({ timeout: 3000 });
        if (!label || label.includes('▶')) {
          await folderHeader.click();
          await page.waitForTimeout(200);
        }
      } catch {
        // folder not found or already expanded — safe to ignore
      }
    },

    /**
     * Waits for the TemplatesTree to finish loading (not in error/loading state).
     * If the initial load shows an error (e.g. server JSON race after file deletes),
     * reloads the page once and waits again.
     */
    async waitForTreeReady() {
      try {
        await templatesTree.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        await page.reload();
        await templatesTree.waitFor({ state: 'visible', timeout: 5000 });
      }
    },

    /**
     * Navigates to the Registry page via the Sidebar button (client-side,
     * no page reload — preserves Zustand store state).
     */
    async navigateToRegistry() {
      await page.getByRole('button', { name: /registry/i }).click();
      await page.waitForTimeout(300);
    },

    /**
     * Navigates to the Editor page via the Sidebar button (client-side,
     * no page reload — preserves Zustand store state).
     */
    async navigateToEditor() {
      await page.getByRole('button', { name: /editor/i }).click();
      await page.waitForTimeout(300);
    },

    /**
     * Clicks Save and waits for the Save button to disappear (dirty state cleared).
     */
    async saveAndWait() {
      await saveButton.click();
      await saveButton.waitFor({ state: 'hidden' });
    },

    /**
     * Clicks Cancel/Discard and waits for the Save button to disappear.
     */
    async discardAndWait() {
      await cancelButton.click();
      await saveButton.waitFor({ state: 'hidden' });
    },
  };
}
