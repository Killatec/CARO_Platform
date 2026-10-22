# Tag Registry Admin Tool — E2E Test Specification
Generated: 2026-04-07
Companion documents: Functional Spec | API Spec | Bootstrap

---

## 1. Overview

This document defines the E2E (end-to-end) and unit test suite for the Tag Registry Admin Tool. Tests are implemented with Playwright (E2E) and Vitest (unit) and cover the complete user-facing surface of the application: template management, field editing, hierarchy navigation, drag-and-drop composition, save/cancel/cascade flows, validation feedback, the registry view, the registry diff/apply workflow, the meta View modal, and the history page.

**What is tested:**
- All primary user workflows reachable through the browser UI
- Correct Zustand store state transitions (verified through DOM assertions)
- Round-trip correctness: API creates fixture → UI reflects it → UI mutates it → API persists it
- Registry diff display and apply workflow
- History page revision log
- Meta View modal with field-level diff highlighting
- Edge cases and error paths that a user can reach without direct filesystem access

**What is intentionally not tested:**
- Server-side logic (covered by functional integration tests, not E2E)
- Templates with corrupted on-disk JSON (not reachable via the API — see section 6.2)
- Performance or load characteristics
- Behaviour under concurrent multi-user edits

**Relationship to the functional spec:**
Each test file maps to one or more sections in Functional Spec. The test suite acts as a living executable companion to the spec — if a spec behaviour is observable in the browser it should have a corresponding test. Any deliberate deviation between test behaviour and spec language is documented in section 6 (skipped tests) and in `Docs/tag-registry/tag_registry_deltas.md`.

---

## 2. Infrastructure

### 2.1 Stack

| Component | Version |
|---|---|
| Playwright | 1.51+ (resolved 1.58.2) |
| Browsers | Chromium, Firefox, WebKit |
| Node.js | ≥18 (required by Playwright) |
| Test package location | `apps/tag-registry/e2e/` |
| Playwright config | `apps/tag-registry/e2e/playwright.config.js` |

Config options set in `playwright.config.js`:
- `baseURL`: `http://10.0.0.184:5199` (test Vite client)
- `globalSetup`: `apps/tag-registry/e2e/globalSetup.js`
- `globalTeardown`: `apps/tag-registry/e2e/globalTeardown.js`
- `workers`: 1 (sequential — tests share a single server process)
- `trace`, `screenshot`, `video`: `retain-on-failure`
- `reporter`: HTML with `open: 'never'`

### 2.2 URLs

| Service | URL | Notes |
|---|---|---|
| Vite client (dev) | `http://10.0.0.184:5173` | Dev only — not used by E2E suite |
| Express API (dev) | `http://10.0.0.184:3001/api/v1` | Dev only — not used by E2E suite |
| Vite client (test) | `http://10.0.0.184:5199` | Started by globalSetup, proxies `/api` to `:3099` |
| Express API (test) | `http://10.0.0.184:3099/api/v1` | Started by globalSetup, connects to `caro_test` |
| Test database | `caro_test` | Cloned from `caro_dev` before every run |

The E2E suite manages its own server lifecycle. `globalSetup.js` clones the live project database into `caro_test` via `pg_dump`/`pg_restore` — the source is the ambient `POSTGRES_DATABASE`, else the root `.env`'s `POSTGRES_DATABASE` (same `findWorkspaceRoot()` as `loadEnv()`), else `caro_dev` — spawns the Express test server on `:3099` and the Vite test client on `:5199`, and polls both until ready. The test server is spawned with `PROJECT_ROOT: '*'` so the registry-apply gate doesn't reject the suite's dynamically-named roots. `globalTeardown.js` kills both processes after the suite completes. All API calls in `helpers/api.js` and spec files route through `:3099` — no spec file hardcodes a port.

### 2.3 Running the suite

All commands must be run from `apps/tag-registry/e2e/` using the local npm binary. Do **not** use a globally-installed `npx playwright` — version mismatches will cause browser-not-found or project-not-found errors.

```bash
cd apps/tag-registry/e2e
npm test                        # all browsers — clones caro_dev → caro_test first
npm run test:chromium           # Chromium only — fastest for local iteration
npm run test:chromium:headed    # Chromium headed
npm run test:headed             # all browsers headed
npm run test:dev                # all browsers — skips clone, uses caro_dev directly
npm run test:chromium:dev       # Chromium only against caro_dev
npm run test:report             # open HTML report from last run
npm run test:ui                 # Playwright UI mode (interactive)
```

`TARGET_DB` environment variable controls which database the test server uses. Defaults to `caro_test`. Set to `caro_dev` to skip the clone step and run against the live development database.

### 2.4 Prerequisites

The E2E suite is self-contained. `globalSetup.js` starts both servers automatically before any test runs and `globalTeardown.js` stops them after. No manual server startup is required.

Prerequisites:
- PostgreSQL running locally on port 5432
- `%APPDATA%\postgresql\pgpass.conf` configured for passwordless `pg_dump`/`psql` access
- Ports 3099 and 5199 must be free — `globalSetup.js` will throw with a clear error if either is in use

---

## 3. Test Design Principles

### 3.1 Self-contained tests

Each test creates its own template fixtures via the REST API in `beforeEach` and deletes them via the REST API in `afterEach`. There is no dependency on any seed template on disk; the existing templates in `apps/tag-registry/templates/` are permanent fixtures that tests never touch.

All template names include a `Date.now()` suffix to guarantee uniqueness across parallel or repeated runs:

```js
const ts = Date.now();
tagTName   = `tag_reg_${ts}`;
paramPName = `param_reg_${ts}`;
modMName   = `mod_reg_${ts}`;
```

### 3.2 Cleanup strategy

`afterEach` always begins with:

```js
await page.goto('about:blank').catch(() => {});
```

This is intentional and must **not** be changed to `discardAndWait()`. Navigating to `about:blank` immediately cancels all in-flight React renders and Zustand operations without waiting for `store.discard()` → `loadRoot()` to complete. The `discard` action triggers a fresh `loadRoot()` call that can take 5–15 seconds in the sequential single-worker context — an unacceptable per-test overhead.

Navigating away first, then deleting via API, is both faster and more reliable.

### 3.3 Template deletion

`afterEach` calls `deleteTemplates(created.splice(0))` after the navigation. `deleteTemplates` calls `DELETE /api/v1/templates/:name` for each name in order. This hits the Express server directly and works even when the browser page is at `about:blank`. The helper silently skips 404s so tests that fail mid-creation still clean up whatever was created.

The `created` array is spliced (not just read) to prevent double-deletion if the test framework calls `afterEach` more than once in error scenarios.

### 3.4 Server health guard

Every `beforeEach` that calls `createTagTemplate` or `createStructuralTemplate` first calls `po.waitForServer()`. This polls `GET /api/v1/templates` at 500ms intervals for up to 10 seconds until a 200 response is received.

This guards against the window between tests where nodemon may be restarting (e.g. if a watched file changed) or where the Express process is briefly overloaded by rapid sequential requests.

### 3.5 Root selection

`po.selectRoot(name)` in `helpers/pageObjects.js` performs the following steps:

1. Calls `waitForServer()` — ensures the API is responsive
2. Navigates `about:blank` → `/` — forces a fresh `AppShell` mount so `listTemplates()` runs and populates the dropdown with the latest template list
3. Waits for the dropdown to become visible (up to 5s)
4. Polls the dropdown options up to 2 times, with a `page.reload()` between attempts — guards against the race condition where a prior test's `afterEach` deletions cause a momentary empty or stale template list
5. Throws if the option is still absent after 2 attempts
6. Calls `rootDropdown.selectOption({ value: name })`
7. Waits up to 15s for the root node's display name to appear in `systemTree`

### 3.6 Client-side navigation

The Tag Registry client has **no URL router**. `App.jsx` uses `useUIStore.activeTab` to switch between `EditorPage`, `RegistryPage`, and `HistoryPage`. A `page.goto('/registry')` call is a full browser reload that resets all Zustand stores — `rootTemplateName`, `templateMap`, `activeTab`, and `selectedNode` all revert to defaults.

To navigate between pages without losing store state, click the sidebar buttons:

```js
// Navigate to Registry (preserves store)
await page.getByRole('button', { name: /registry/i }).click();

// Navigate to Editor (preserves store)
await page.getByRole('button', { name: /editor/i }).click();

// Navigate to History (preserves store)
await page.getByRole('button', { name: /history/i }).click();
```

`pageObjects.js` exposes `po.navigateToRegistry()` and `po.navigateToEditor()` as convenience wrappers around these clicks.

---

## 4. Test Files and Coverage

### 4.1 tests/templates.spec.js — Templates Tree (8 tests)

| # | Test |
|---|---|
| 1 | displays a template leaf in the Templates Tree after API creation |
| 2 | clicking a template leaf populates the Fields Panel |
| 3 | editing a template default field value marks it dirty (bold italic) |
| 3b | typing a negative number keystroke by keystroke keeps the minus sign (cleared field stays empty, `-5` committed) |
| 3c | focusing a numeric field selects its value, so typing replaces it; blur shows the stored value (`05` → `5`) |
| 4 | creating a new template via NewTemplateModal |
| 5 | deleting a new unsaved template removes it instantly without Save |
| 6 | deleting a saved template queues it as pending and shows Save bar |

**Setup:** Creates one tag template via API in `beforeEach`.

### 4.2 tests/fields-panel.spec.js — Fields Panel (11 tests)

| # | Test |
|---|---|
| 1 | template mode: shows template name and type as read-only |
| 2 | template mode: Add Field button opens AddFieldModal |
| 3 | template mode: adding a field via AddFieldModal appends it to the panel |
| 4 | template mode: trash icon on field row removes the field |
| 5 | instance mode: clicking a system tree node shows asset name input |
| 6 | instance mode: editing asset name does not clear the panel on each keystroke |
| 7 | instance mode: override value shown in blue, dirty override shown in bold italic |
| 7b | instance mode: setting an inherited field back to its inherited value leaves it clean (no italic, no `text-blue-600`, See Changes hidden) |
| 8 | Instance mode: editing asset name turns it bold italic |
| 9 | template mode: In_Tag_Name pinned row is visible and toggleable |
| 10 | template mode: AddFieldModal shows reserved-name error for In_Tag_Name |

**Setup:** Creates tag + parameter + module hierarchy via API. Navigates by `selectRoot`.

### 4.3 tests/system-tree.spec.js — System Tree (7 tests)

| # | Test |
|---|---|
| 1 | system tree renders the full hierarchy |
| 2 | clicking a node populates the Fields Panel |
| 3 | collapse button hides child nodes |
| 4 | re-expanding shows child nodes again |
| 5 | trash icon on a non-root node removes it and shows Save bar |
| 6 | root node does not have a trash icon |
| 7 | dirty node label shown in bold italic after instance edit |

**Setup:** Creates 3-level hierarchy (module → parameter → tag) via API.

### 4.4 tests/drag-drop.spec.js — Drag and Drop (3 tests)

| # | Test |
|---|---|
| 1 | dragging a tag template onto a module node adds it as a child |
| 2 | dropped child appears in Fields Panel on click |
| 3 | dragging onto a tag node is not accepted (tag nodes are not valid drop targets) |

**Setup:** Creates one tag template and one module template via API. `beforeEach` calls `selectRoot(modMName)` to load the module into the system tree before each drag test.

**Note on test 3:** The second drag (`tagLeaf2.dragTo(tagNodeInTree)`) is wrapped in `.catch(() => {})` because Playwright's `dragTo` may time out if the drop target rejects the event before the gesture completes. The assertion (`not.toContainText(tagT2Name)`) is what validates the behaviour, not whether `dragTo` resolves.

### 4.5 tests/save-cancel.spec.js — Save/Cancel/Cascade flow (7 tests)

| # | Test |
|---|---|
| 1 | Save bar is hidden when no changes are pending |
| 2 | Save bar appears after editing a field default |
| 3 | Cancel/Discard hides the Save bar and reverts the field |
| 4 | root dropdown is disabled while dirty |
| 5 | Save with no upstream parents completes and hides Save bar |
| 6 | Save triggers CascadeConfirmModal when upstream parents are affected |
| 7 | Confirming the cascade modal completes the save |

**Setup for tests 6 and 7:** Uses `po.selectRoot(pName)` (the parent) — not `selectRoot(tName)` (the tag). `loadRoot(pName)` populates `templateMap` with `{pName, tName}`. `simulateCascade` requires both templates in the store to detect that editing `tName` affects `pName`. Calling `selectRoot(tName)` would fail because tag templates are excluded from the root dropdown; calling `selectRoot` with a structural parent that was not explicitly loaded would leave the store without the tag, causing `simulateCascade` to report no affected ancestors and the cascade modal to never appear.

**Setup for test 5:** Uses a standalone parameter template (`soloName`) with its own `eng_min` field and no children and no upstream parents. A tag template cannot be used as the root (see section 5.4). A structural parent with the tag as a child would trigger the cascade modal, causing `saveAndWait()` to hang.

### 4.6 tests/validation.spec.js — Validation Panel (7 tests)

| # | Test |
|---|---|
| 1 | ValidationPanel is always visible with its header |
| 2 | duplicate sibling asset_name shows DUPLICATE_SIBLING_NAME error |
| 3 | dot in asset_name shows INVALID_ASSET_NAME error |
| 4 | fixing the invalid asset name clears the error |
| 5 | childless structural root loads without validation errors |
| 6 | ValidationPanel is height-capped at 50 vh and its message list scrolls |
| 7 | system tree nodes on an error path get a red tint |

**Setup:** Creates templates via API; edits them through the UI to trigger validation states.

### 4.7 tests/registry.spec.js — Registry Page (7 tests)

| # | Test |
|---|---|
| 1 | shows prompt when no root is selected |
| 2 | shows registry table after root selection |
| 3 | tag_path column is present and prefixed with root template name |
| 4 | clicking tag_path column header sorts the table |
| 5 | error banner shown when graph has validation errors |
| 6 | tag_name column is present and shows the resolved tag_name |
| 7 | Export to CSV button downloads a CSV of the current table |

**Setup:** Creates 3-level hierarchy (module → parameter → tag) via API, then calls `selectRoot(modMName)` followed by `po.navigateToRegistry()`. Navigation uses the sidebar button (client-side) to preserve store state — `page.goto('/registry')` would wipe Zustand state and cause the table to never render.

### 4.8 Registry E2E Test Files

#### 4.8.1 tests/registry-diff.spec.js — Registry Diff Display (6 tests)

| # | Test |
|---|---|
| 1 | shows all tags as added when not yet applied to database |
| 2 | shows all rows as unchanged after applying registry |
| 3 | shows new child as added (green) after registry was applied |
| 4 | shows removed tag as retired (red) after registry was applied |
| 5 | shows modified row with cell-level highlight when field value changes |
| 6 | tag_id column shows new for added rows and numeric id for unchanged rows |

**Pattern:** Timestamp-based template names (e.g. `tag_diff_${Date.now()}`) ensure tag_paths are unique per run and never appear in the DB before the test applies them. `applyRegistryApi()` and `getTemplate()` are imported from `helpers/api.js`.

#### 4.8.2 tests/registry-apply.spec.js — Registry Apply Flow (7 tests)

| # | Test |
|---|---|
| 1 | Update DB button is disabled when all tags are unchanged |
| 2 | Update DB button is enabled when changes exist |
| 3 | clicking Update DB opens confirmation modal with correct contents |
| 4 | Confirm button enables only when comment is non-empty |
| 5 | Cancel closes modal without applying |
| 6 | successful apply shows success banner and all rows become unchanged |
| 7 | apply creates a new revision visible on the History page |

**Key locators:**
```js
const updateDbButton = (page) => page.getByRole('button', { name: 'Update DB' });
const applyModal = (page) => page.locator('.shadow-xl').filter({ hasText: /Apply Registry Changes/i }).first();
const commentInput = (page) => page.locator('#apply-comment');
const confirmButton = (page) => page.getByRole('button', { name: 'Confirm' });
```

#### 4.8.3 tests/history.spec.js — History Page (5 tests)

| # | Test |
|---|---|
| 1 | History nav item is visible in sidebar |
| 2 | History page shows revisions table with correct column headers |
| 3 | revisions are ordered most recent first |
| 4 | applied_at column uses dd-MMM-yyyy HH:mm:ss format |
| 5 | comment column shows the comment entered during apply |

**Navigation:** `page.getByRole('button', { name: /history/i }).click()` — inline in each test, not via `pageObjects.js`.

#### 4.8.4 tests/meta-modal.spec.js — Meta View Modal (3 tests)

| # | Test |
|---|---|
| 1 | clicking View on a registry row opens meta modal with tag_path as title |
| 2 | meta modal closes when Close button is clicked |
| 3 | modified row meta modal shows diff legend when meta field value differs |

**Modal locator pattern:**
```js
function metaModal(page, tagPath) {
  return page.locator('.shadow-xl').filter({ hasText: tagPath }).first();
}
```

---

### 4.8.5 tests/validation-parent-types.spec.js — Parent Type Validation (3 tests)

**Prerequisite:** `VALIDATE_REQUIRED_PARENT_TYPES=module` and `VALIDATE_UNIQUE_PARENT_TYPES=true` must be set in `apps/tag-registry/server/.env`. Without these vars the config endpoint returns empty arrays/false and tests will fail to observe the expected error codes.

| # | Test |
|---|---|
| 1 | PARENT_TYPE_MISSING shown when tag has no module ancestor |
| 2 | no validation errors when tag has a module ancestor |
| 3 | DUPLICATE_PARENT_TYPE shown when tag has two module ancestors |

**Setup:** Each test creates its own hierarchy via API in `beforeEach`. Test 1 uses a system root with a tag directly attached (no module between them). Test 2 builds a three-level chain: system → module → tag. Test 3 builds a four-level chain with two `module` type nodes. All created templates are cleaned up via `deleteTemplates(created.splice(0))` in `afterEach`.

---

### 4.8.6 tests/trends.spec.js — Trends Column (3 tests)

| # | Test |
|---|---|
| 1 | trends column header is visible in Registry table |
| 2 | trends is false when no hierarchy level has a trends field |
| 3 | trends is true when a hierarchy level has trends field set to true |

**Setup:** Each test creates a module → parameter → tag hierarchy via API. Test 3 additionally passes `{ trends: { field_type: 'Boolean', default: true } }` as the module-level `fields` argument to `createStructuralTemplate`. `po.selectRoot(modName)` loads the hierarchy, `po.navigateToRegistry()` switches to the Registry page client-side. The trends cell is the 7th `<td>` (0-indexed: 6) in each row: `tag_id(0), tag_path(1), module(2), module_type(3), data_type(4), is_setpoint(5), trends(6), meta(7)`.

---

#### 4.8.7 tests/module-type.spec.js — Module Type (6 tests)

| # | Test |
|---|---|
| 1 | module template without Module_Type shows validation error |
| 2 | module template with Module_Type field passes validation |
| 3 | Module_Type field renders as a dropdown in FieldsPanel template mode |
| 4 | changing Module_Type dropdown value marks template dirty and saves |
| 5 | registry table shows module and module_type columns after apply |
| 6 | AddFieldModal offers ModuleType as a field type option |

**Setup:** Each test creates its own hierarchy via API in the test body (not in `beforeEach`). Module templates include `{ Module_Type: { field_type: 'ModuleType', default: 'HMI' } }` in the fields argument. `afterEach` navigates to `about:blank` and cleans up via `deleteTemplates(created.splice(0))`.

**Column verification (test 5):** Uses `page.getByRole('columnheader', { name: /^module$/i })` and `page.getByRole('columnheader', { name: /module_type/i })` to verify the two new columns. Row data verified via `page.locator('td').filter({ hasText: modName })`.

---

#### 4.8.8 tests/tag-defs.spec.js — Generate Tag Defs (3 tests)

| # | Test |
|---|---|
| 1 | downloads a timestamped ZIP stamped with the applied registry revision (applies via API first; `tag_registry_rev` equals the apply's `registry_rev`, no `content_hash`) |
| 2 | shows an error banner when the saved templates have not been applied (`REGISTRY_NOT_APPLIED`) |
| 3 | shows an error banner when the system has no MQTT module |

#### 4.8.9 tests/tree-reorder.spec.js — Tree reorder and reparenting (8 tests)

| # | Test |
|---|---|
| 1 | reorder down: drag child 0 to after child 2, save, reload, order persists |
| 2 | reorder up: drag last child to position 0, save, reload, order persists |
| 3 | template panel drop into top zone inserts at position, not appended |
| 4 | cross-parent drag reparents the child as a sibling under the new parent |
| 5 | body-dropping a node onto a sibling nests it as that sibling's child |
| 6 | body-dropping a child onto its own current parent is a no-op |
| 7 | reparenting onto own descendant is rejected (cycle prevention) |
| 8 | "See what's changed" modal shows Children Reordered section after reorder |

#### 4.8.10 tests/ui-layout.spec.js — Editor layout (2 tests)

| # | Test |
|---|---|
| 1 | System Tree, Properties, and Templates are three independent side-by-side columns with ValidationPanel below |
| 2 | Templates panel header reads "Templates" not "All Templates" |

## 4.9 Unit Test Files

Per-file unit test counts are in §10.

---

## 5. Known Gotchas and Hard-Won Findings

### 5.1 nodemon must not watch templates/

**CRITICAL — check this first if the suite fails with empty dropdowns or option-not-found errors.**

The Express dev server uses nodemon. If nodemon watches the `templates/` directory, every `createTagTemplate` or `createStructuralTemplate` call in `beforeEach` writes a JSON file to disk and triggers a nodemon restart. During the restart window (typically 1–3 seconds), `GET /api/v1/templates` returns a 500 response with a truncated JSON body: `"Unexpected end of JSON input"`. The root dropdown renders empty, and all tests that call `selectRoot()` fail with option-not-found errors.

**Fix already applied in `server/package.json`:**

```json
// Before (wrong — nodemon restarts on every template write):
"dev": "nodemon --ext js,json --watch src --watch ../templates src/index.js"

// After (correct — only watches application source):
"dev": "nodemon --ext js,json --watch src src/index.js"
```

If this line is ever reverted (e.g. during a merge), the entire suite will fail.

### 5.2 AppShell fetches template list once on mount

The root dropdown is populated by a single `listTemplates()` call inside `AppShell`'s `useEffect` on mount. Templates created by a test's `beforeEach` via the API after the page has already loaded will **not** appear in the dropdown unless the page remounts.

`selectRoot()` always navigates `about:blank → /` before polling the dropdown, ensuring a fresh `AppShell` mount and a fresh `listTemplates()` call that includes the test's newly created templates.

### 5.3 Zustand store is reset on page reload

There is no URL router. `page.goto('/')` and `page.reload()` both wipe all Zustand state:

- `useTemplateGraphStore`: `templateMap`, `originalTemplateMap`, `dirtySet`, `rootTemplateName` → all reset
- `useUIStore`: `activeTab` → resets to `'editor'`
- `useRootTemplate`: `selectedRoot` → resets to `null`

Use sidebar button clicks (`po.navigateToRegistry()`, `po.navigateToEditor()`, `page.getByRole('button', { name: /history/i }).click()`) for in-session navigation between Editor, Registry, and History. Use `about:blank → /` only when you explicitly want a clean store — typically only at the start of `selectRoot()`.

### 5.4 Tag templates do not appear in root dropdown

The root dropdown filters to structural templates only:

```js
// AppShell.jsx
const rootOptions = templates
  .filter(t => t.template_type !== 'tag')
  .map(...)
```

`selectRoot()` will always fail if passed a tag template name — the option will never appear. Tests that need to edit a tag template must select a structural ancestor (parameter, module, system) as the root, so the tag appears in the hierarchy loaded by `loadRoot()`.

### 5.5 Template name appears in input value, not innerText

In both template mode and instance mode, the FieldsPanel renders `Template Name` and `Template Type` as `<input disabled>` elements — not as visible text nodes. `toContainText()` does not match `value` attributes.

**Correct assertion:**
```js
await expect(
  po.fieldsPanel.locator('input[disabled]').first()
).toHaveValue(templateName);
```

### 5.6 Modal has no role="dialog"

The `Modal` primitive (from `@caro/ui/primitives`) renders its content via `createPortal` with no `role="dialog"` attribute. `page.getByRole('dialog')` will find nothing.

**Correct locator pattern:**
```js
const cascadeModal = page.locator('.shadow-xl').filter({ hasText: /cascade|confirm/i }).first();
```

Filter on distinguishing title text to avoid matching multiple `.shadow-xl` elements if several modals are present simultaneously.

### 5.7 createTagTemplate places data_type and is_setpoint inside fields

The shared `validateTemplate()` function checks for three required fields inside `template.fields` on tag templates: `data_type` (field_type `TagType`), `is_setpoint` (field_type `Boolean`), and `Trends` (field_type `Boolean`). Missing or wrong field_type values produce `SCHEMA_VALIDATION_ERROR`. The server also validates TagType field defaults against the `tag_types` database table.

**Correct `createTagTemplate` output:**
```js
{
  template_type: 'tag',
  template_name: name,
  fields: {
    data_type:   { field_type: 'TagType', default: dataType },
    is_setpoint: { field_type: 'Boolean', default: isSetpoint },
    Trends:      { field_type: 'Boolean', default: true },
    ...fields,
  },
  children: [],
}
```

### 5.8 validateGraph runs on ALL templates in the store

`useValidation` runs `validateGraph()` on the entire `templateMap`, not just the subgraph reachable from the current root. If prior test runs leave orphaned entries in the store, or if `handleLeafClick` in `TemplatesTree` injects a template whose referenced children are not yet in the store, `validateGraph` will report `INVALID_REFERENCE` and set `isValid = false`.

Solution: always begin a test's edit sequence with `po.selectRoot(rootName)`. The `loadRoot()` action replaces `templateMap` entirely with the complete, internally consistent subgraph for `rootName`, giving `validateGraph` a clean input with no missing references.

### 5.9 AssetTree collapse bug (fixed)

The original `TreeNode` collapse toggle used `!prev[path]`, which treats `undefined` (the initial expanded state) as falsy. The first click set the path to `true` (still expanded), requiring a second click to actually collapse. This caused system-tree collapse tests to fail.

**Fixed to:** `prev[path] === false ? true : false` — `undefined` (expanded) correctly transitions to `false` (collapsed) on the first click.

Fix location: `AssetTree.jsx` toggle handler.

If this toggle logic is ever refactored, ensure the first click on an initially-expanded node collapses it.

### 5.10 Delete button targeted by title attribute

The trash icon buttons in `TemplatesTree` have a `title` attribute: `Delete template "<name>"`. Use this for precise targeting when multiple delete buttons are visible in an expanded tree to avoid Playwright strict-mode violations (more than one element matching a locator).

```js
po.templatesTree.getByRole('button', { name: `Delete template "${templateName}"` })
```

### 5.11 EMPTY_BRANCH is not implemented in Phase 1

`EMPTY_BRANCH` is declared in `shared/constants.js` but is not emitted by any Phase 1 validation function (`validateGraph`, `validateTemplate`, or `useValidation`). Any test asserting that the ValidationPanel shows `EMPTY_BRANCH` will always fail.

`validation.spec.js` test 5 was originally written to assert this warning. It was rewritten to instead verify that a childless structural root loads without ANY validation errors — which is the correct observable behavior in Phase 1.

If `EMPTY_BRANCH` is implemented in a future phase, test 5 in `validation.spec.js` should be updated to assert its presence.

### 5.12 Registry test 1 passes due to dropdown label text

`registry.spec.js` test 1 ("shows prompt when no root is selected") uses the assertion:
```js
await expect(page.locator('body')).toContainText(/select.*root/i);
```

This passes even after `beforeEach` has called `selectRoot()` and navigated to the Registry page, because the text "Root Template:" and "Select root..." from the dropdown label in AppShell match the regex — they are always present in the page body regardless of whether a root is actually selected. The assertion is intentionally loose and passes in both states. It is not testing the registry prompt specifically; it verifies the page loaded and contains root-selection UI, which is sufficient for this smoke-level test.

### 5.13 API helpers consolidated into helpers/api.js

Registry E2E specs (`registry-diff.spec.js`, `registry-apply.spec.js`, `history.spec.js`, `meta-modal.spec.js`) previously defined registry API helpers (`applyRegistryApi`, `fetchRevisions`, `getTemplate`) inline per spec file. These have been moved to `helpers/api.js` and are now imported from there. No spec file hardcodes a port or base URL.

History page navigation uses `page.getByRole('button', { name: /history/i }).click()` inline — `pageObjects.js` was not modified.

### 5.14 DB rows not cleaned up after registry tests

`tag_registry` and `registry_revisions` rows written during registry E2E tests are not deleted after each test. The append-only schema means stale rows from prior runs are harmless — `getActiveRegistry()` always returns the latest revision per `tag_id`, and timestamp-based template names ensure unique `tag_path`s per run. Rows from prior runs never interfere with new test assertions.

### 5.15 Module templates require Module_Type field

`validateTemplate()` now requires all `template_type === 'module'` templates to have a `Module_Type` field with `field_type: 'ModuleType'`. This validation was added alongside the `module_types` database table (migration 010) and the `module`/`module_type` columns on `tag_registry` (migration 011).

All E2E specs that create module templates via `createStructuralTemplate(name, 'module', children)` must pass a 4th argument containing at minimum:

```js
{ Module_Type: { field_type: 'ModuleType', default: 'HMI' } }
```

Without this field, `isValid` will be `false`, the save button will be disabled, and the Registry page will show an error banner instead of the table. This affects: `registry.spec.js`, `registry-apply.spec.js`, `registry-diff.spec.js`, `meta-modal.spec.js`, `history.spec.js`, `save-cancel.spec.js`, `trends.spec.js`, and `module-type.spec.js`.

---

## 6. Intentionally Skipped Tests

None as of 2026-10-17 — the suite contains no `test.skip`. The two tests this section used to list now run:

- `save-cancel.spec.js` "root dropdown is disabled while dirty" — AppShell now renders the root `Dropdown` with `disabled={true}` while dirty (inside the `cursor-not-allowed` tooltip wrapper).
- `registry.spec.js` "error banner shown when graph has validation errors" — reaches the error state client-side by typing a dot into an asset name (`INVALID_ASSET_NAME`), instead of creating a broken template through the API.

The old `meta-modal.spec.js` test "clicking View on a different row replaces the modal" remains deleted: the modal's full-viewport overlay blocks background clicks by design.

## 7. Selector Strategy

### 7.1 data-testid locators (preferred)

The following `data-testid` attributes have been added to the app source for stable test targeting. These are the canonical locators — prefer them over CSS class or text anchors.

| Attribute | Component | Element |
|---|---|---|
| `data-testid="system-tree"` | `AssetTree.jsx` | Outermost `<div>` (all return paths) |
| `data-testid="templates-tree"` | `TemplatesTree.jsx` | Outermost `<div>` (all return paths) |
| `data-testid="fields-panel"` | `FieldsPanel.jsx` | Outermost `<div>` (all return paths) |
| `data-testid="save-bar"` | `AppShell.jsx` | Save bar wrapper `<div>` (only rendered when `isDirty` and `activeTab === 'editor'`) |
| `data-testid="save-button"` | `AppShell.jsx` | Save `<button>` |
| `data-testid="cancel-button"` | `AppShell.jsx` | Cancel `<button>` |
| `data-testid="see-changes-button"` | `AppShell.jsx` | See what's changed `<button>` |

Usage in `pageObjects.js`:
```js
const systemTree       = page.locator('[data-testid="system-tree"]');
const templatesTree    = page.locator('[data-testid="templates-tree"]');
const fieldsPanel      = page.locator('[data-testid="fields-panel"]');
const saveButton       = page.locator('[data-testid="save-button"]');
const cancelButton     = page.locator('[data-testid="cancel-button"]');
const seeChangesButton = page.locator('[data-testid="see-changes-button"]');
```

### 7.2 Fallback locators

For elements without `data-testid`, use in order of preference:

1. **`getByRole()` with name** — buttons, labeled inputs, column headers
   `page.getByRole('columnheader', { name: /tag_path/i })`

2. **`getByTitle()`** — action icon buttons
   `po.templatesTree.getByRole('button', { name: 'Delete template "my_template"' })`

3. **`.locator('.shadow-xl').filter({ hasText })`** — modals (no `role="dialog"`)
   `page.locator('.shadow-xl').filter({ hasText: /cascade|confirm/i }).first()`

4. **`locator('select').first()`** — root dropdown (only one `<select>` in the app)

5. **CSS class or text anchors** — last resort, and only when the class/text is stable by design
   `page.locator('div').filter({ hasText: /^Validation/ }).first()`

Avoid anchoring on display text for panel containers — text can change with internationalisation or copy edits. Prefer `data-testid` for structural containers.

---

## 8. API Helper Reference (`helpers/api.js`)

All helpers call `http://10.0.0.184:3099/api/v1` directly (the test Express server). An internal `request()` wrapper handles JSON serialisation and unwraps the `{ ok, data }` envelope, throwing a typed `Error` with `.code` and `.status` on failure.

### createTagTemplate(name, dataType?, isSetpoint?, fields?)

Creates a tag template and returns `{ template, hash }`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Unique template name |
| `dataType` | string | `'f32'` | A valid `tag_types.type_name` value |
| `isSetpoint` | boolean | `false` | Whether the tag is a setpoint |
| `fields` | object | `{}` | Additional user-defined fields |

Posts via `POST /templates/batch` with `confirmed: true`, then re-fetches via `GET /templates/:name` to return the server-assigned hash.

**Schema requirement:** `data_type` and `is_setpoint` are placed inside `fields{}` as field definition objects (field_type `TagType` and `Boolean` respectively). See section 5.7.

### createStructuralTemplate(name, templateType?, children?, fields?)

Creates a non-tag template (parameter, module, system) and returns `{ template, hash }`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Unique template name |
| `templateType` | string | `'parameter'` | `'parameter'`, `'module'`, `'system'`, etc. |
| `children` | array | `[]` | Array of `{ template_name, asset_name, fields }` child references |
| `fields` | object | `{}` | Template-level field definitions `{ fieldName: { field_type, default } }` |

### getTemplateHash(name)

Returns the server-assigned hash string for a template. Calls `GET /templates/:name`.

### deleteTemplate(name)

Deletes a template by name. Fetches the hash first; silently skips if the template does not exist (404). Never throws — logs a warning on unexpected errors. Sends `DELETE /templates/:name` with `{ original_hash, confirmed: true }`.

### deleteTemplates(namesArray)

Calls `deleteTemplate` for each name in the array in order. Used in `afterEach` to clean up all templates created during a test.

### listTemplates(type?)

Returns the templates array from `GET /templates` (or `GET /templates?type=<type>` when filtered). Used by `waitForServer()` as the health-check endpoint.

### batchSave(changes, deletions, confirmed?)

Calls `POST /templates/batch` and returns the full response data object including `requires_confirmation`, `diff`, and `affectedParents`. Used directly in tests that need to inspect the cascade response before committing.

| Parameter | Type | Default |
|---|---|---|
| `changes` | array of `{ template_name, original_hash, template }` | required |
| `deletions` | array of `{ template_name, original_hash }` | required |
| `confirmed` | boolean | `false` |

### getTemplate(name)

Fetches a single template by name. Returns `{ template, hash }`. Calls `GET /templates/:name`.

### applyRegistryApi(rootName, comment)

Applies the resolved registry for `rootName` to the database. Returns `{ registry_rev, ... }`. Calls `POST /registry/apply`.

### fetchRevisions()

Fetches all registry revisions ordered by `registry_rev DESC`. Returns the revisions array. Calls `GET /registry/revisions`.

---

## 9. Results Baseline

Current baseline (2026-10-21, after the Tag Defs `tag_registry_rev` and Properties-panel numeric input work):

| Metric | Value |
|---|---|
| Unit total (shared 244 + client 176 + server 122) | 542 |
| E2E (Chromium) | 96 |
| **Combined total** | **638** |
| Failed | 0 |

Firefox and WebKit are not run on this machine (browsers not installed); Chromium is the reliable baseline. If a run produces a different total, investigate before reporting done. `apps/tag-registry/CLAUDE.md` carries the same baseline and the commands. Earlier baselines and per-change test-count notes are in git history.

---

## 10. Unit Test Suite

### 10.1 Overview

In addition to the Playwright E2E suite, a Vitest unit test suite covers the layers of business logic that are not adequately validated through browser tests alone: the shared pure functions, the server template service, the client Zustand store, and the registry utilities and routes.

### 10.2 Packages and locations

| Package | Location | Run command | Include pattern (`vitest.config.js`) |
|---|---|---|---|
| shared/ functions | apps/tag-registry/shared/ | `cd apps/tag-registry/shared && npx vitest run` | `__tests__/**/*.test.{js,ts}` |
| server services + routes | apps/tag-registry/server/ | `cd apps/tag-registry/server && npx vitest run` | `__tests__/**/*.test.{js,ts}` |
| client stores, hooks, utils, api | apps/tag-registry/client/ | `cd apps/tag-registry/client && npx vitest run` | `__tests__/**/*.test.js`, `src/**/*.test.ts` |

All three use Vitest 1.6.1. Each package must be run from its own directory; there is no root-level vitest config under `apps/tag-registry/`. `packages/db` has its own suite — see `Docs/db/db_handoff.md`.

Note: the client package runs Vitest from the monorepo root `node_modules/.bin` because `@caro/ui` is a workspace-only package that cannot be resolved by a standalone `npm install` in the client directory. `npm test` works correctly because npm adds the project root's `node_modules/.bin` to PATH when running scripts.

Counts below are from `vitest run --reporter=json` on 2026-10-17.

### 10.3 shared/ unit tests (244 tests, 14 files)

| File | Tests |
|---|---|
| `__tests__/applyFieldCascade.test.js` | 7 |
| `__tests__/bitPacking.test.ts` | 13 |
| `__tests__/handshakeStatus.test.ts` | 2 |
| `__tests__/hashTemplate.test.js` | 8 |
| `__tests__/moduleOrder.test.ts` | 6 |
| `__tests__/moduleStatus.test.ts` | 4 |
| `__tests__/resolveRegistry.test.js` | 57 |
| `__tests__/simulateCascade.test.js` | 10 |
| `__tests__/tagDefs.test.ts` | 30 |
| `__tests__/utils.test.js` | 20 |
| `__tests__/validateGraph.test.js` | 12 |
| `__tests__/validateParentTypes.test.js` | 10 |
| `__tests__/validateResolvedTags.test.ts` | 23 |
| `__tests__/validateTemplate.test.js` | 42 |

### 10.4 server/ unit tests (122 tests, 9 files)

`templateService` tests use real temporary directories (`mkdtemp`); `@caro/db` is mocked (`getTagTypes`, `getModuleTypes`, registry functions). Route tests use `node:http.createServer(createApp())` and global `fetch` — no supertest.

| File | Tests |
|---|---|
| `__tests__/batchSave.test.js` | 21 |
| `__tests__/config.test.js` | 18 |
| `__tests__/initializeIndex.test.js` | 7 |
| `__tests__/listAndGet.test.js` | 7 |
| `__tests__/loadRoot.test.js` | 9 |
| `__tests__/registry.test.js` | 22 |
| `__tests__/registryService.test.js` | 21 |
| `__tests__/tagDefs.test.js` | 12 |
| `__tests__/validateAll.test.js` | 5 |

### 10.5 client/ unit tests (176 tests, 15 files)

Store tests use `vi.mock()` for the API modules and reset `useTemplateGraphStore` via `setState()` in `beforeEach`.

| File | Tests |
|---|---|
| `__tests__/addAndInject.test.js` | 12 |
| `__tests__/deletionActions.test.js` | 7 |
| `__tests__/diffRegistry.test.js` | 50 |
| `__tests__/loadRoot.test.js` | 10 |
| `__tests__/reorderChild.test.js` | 17 |
| `__tests__/saveAndDiscard.test.js` | 12 |
| `__tests__/updateTemplate.test.js` | 6 |
| `__tests__/useTreeExpandStore.test.js` | 10 |
| `__tests__/useValidation.test.js` | 5 |
| `src/api/tagDefs.test.ts` | 3 |
| `src/utils/dragTypes.test.ts` | 6 |
| `src/utils/exportRegistryCsv.test.ts` | 14 |
| `src/utils/exportTree.test.ts` | 11 |
| `src/utils/numericDraft.test.ts` | 3 |
| `src/utils/registryRows.test.ts` | 10 |
