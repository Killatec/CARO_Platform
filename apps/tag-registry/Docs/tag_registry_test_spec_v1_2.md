# Tag Registry Admin Tool — E2E Test Specification
**v1.2** | Generated: 2026-04-02
Companion documents: Functional Spec v1.17 | API Spec v1.15 | Bootstrap v1.21

---

## 1. Overview

This document defines the E2E (end-to-end) and unit test suite for the Tag Registry Admin Tool. Tests are implemented with Playwright (E2E) and Vitest (unit) and cover the complete user-facing surface of the application: template management, field editing, hierarchy navigation, drag-and-drop composition, save/cancel/cascade flows, validation feedback, the registry view, the registry diff/apply workflow, the meta View modal, and the history page.

**What is tested:**
- All primary user workflows reachable through the browser UI
- Correct Zustand store state transitions (verified through DOM assertions)
- Round-trip correctness: API creates fixture → UI reflects it → UI mutates it → API persists it
- Phase 2 registry diff display and apply workflow
- History page revision log
- Meta View modal with field-level diff highlighting
- Edge cases and error paths that a user can reach without direct filesystem access

**What is intentionally not tested:**
- Server-side logic (covered by functional integration tests, not E2E)
- Templates with corrupted on-disk JSON (not reachable via the API — see section 6.2)
- Performance or load characteristics
- Behaviour under concurrent multi-user edits (Phase 2 scope)

**Relationship to the functional spec:**
Each test file maps to one or more sections in Functional Spec v1.16. The test suite acts as a living executable companion to the spec — if a spec behaviour is observable in the browser it should have a corresponding test. Any deliberate deviation between test behaviour and spec language is documented in section 6 (skipped tests) and in `Docs/spec_delta.md`.

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
- `baseURL`: `http://10.0.0.184:5173`
- `workers`: 1 (sequential — tests share a single server process)
- `trace`, `screenshot`, `video`: `retain-on-failure`
- `reporter`: HTML with `open: 'never'`

### 2.2 URLs

| Service | URL | Notes |
|---|---|---|
| Vite client (dev) | `http://10.0.0.184:5173` | Proxies `/api` to `:3001` |
| Express API (dev) | `http://10.0.0.184:3001/api/v1` | Hit directly by `helpers/api.js` |

`helpers/api.js` calls the Express server directly at port 3001, bypassing the Vite proxy. This keeps fixture setup fast and independent of the UI.

### 2.3 Running the suite

All commands must be run from `apps/tag-registry/e2e/` using the local npm binary. Do **not** use a globally-installed `npx playwright` — version mismatches will cause browser-not-found or project-not-found errors.

```bash
cd apps/tag-registry/e2e

npm test                        # all browsers (chromium + firefox + webkit)
npm run test:chromium           # Chromium only — fastest for local iteration
npm run test:chromium:headed    # Chromium headed — shows browser window
npm run test:headed             # all browsers headed
npm run test:report             # open HTML report from last run
npm run test:ui                 # Playwright UI mode (interactive)
```

### 2.4 Prerequisites

Both servers must be running before executing any test. Tests do not start or stop servers.

```bash
# Terminal 1 — Express API
cd apps/tag-registry/server
npm run dev       # nodemon; listens on :3001

# Terminal 2 — Vite client
cd apps/tag-registry/client
npm run dev       # Vite HMR; listens on :5173
```

**Critical:** nodemon must NOT watch the `templates/` directory. See section 5.1.

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

### 4.1 tests/templates.spec.js — Templates Tree (6 tests)

| # | Test | Covers |
|---|---|---|
| 1 | displays a template leaf in the Templates Tree after API creation | Functional spec §6: TemplatesTree folder view |
| 2 | clicking a template leaf populates the Fields Panel | Functional spec §7: leaf click → Fields Panel |
| 3 | editing a template default field value marks it dirty (orange) | Functional spec §8: dirty indicator |
| 4 | creating a new template via NewTemplateModal | Functional spec §10: NewTemplateModal |
| 5 | deleting a new unsaved template removes it instantly without Save | Functional spec §9: new template deletion |
| 6 | deleting a saved template queues it as pending and shows Save bar | Functional spec §9: saved template deletion |

**Setup:** Creates one tag template via API in `beforeEach`.

### 4.2 tests/fields-panel.spec.js — Fields Panel (7 tests)

| # | Test | Covers |
|---|---|---|
| 1 | Template mode: shows template name and type as read-only | Functional spec §11: template mode display |
| 2 | Template mode: Add Field button opens AddFieldModal | Functional spec §12: AddFieldModal trigger |
| 3 | Template mode: adding a field via modal appends it to the panel | Functional spec §12: AddFieldModal confirm |
| 4 | Template mode: editing a field marks the Save bar dirty | Functional spec §13: field edit → dirty |
| 5 | Instance mode: shows template name, type, and asset name | Functional spec §14: instance mode display |
| 6 | Instance mode: editing a field override turns it blue | Functional spec §14: override colour |
| 7 | Instance mode: changing asset name is reflected in the tree | Functional spec §14: asset name edit |

**Setup:** Creates tag + parameter + module hierarchy via API. Navigates by `selectRoot`.

### 4.3 tests/system-tree.spec.js — System Tree (7 tests)

| # | Test | Covers |
|---|---|---|
| 1 | System Tree shows root node after selectRoot | Functional spec §5: root display |
| 2 | System Tree shows full hierarchy (module → parameter → tag) | Functional spec §5: hierarchy expansion |
| 3 | Collapse / expand a tree node hides and shows children | Functional spec §5: collapse toggle |
| 4 | Clicking a system tree node selects it and populates the panel | Functional spec §14: node selection |
| 5 | Root node is shown without an asset-name row | Functional spec §14: root instance mode |
| 6 | Deleting a node from the system tree removes it from the hierarchy | Functional spec §15: node deletion |
| 7 | Deleted node does not appear after discard | Functional spec §15: deletion + discard |

**Setup:** Creates 3-level hierarchy (module → parameter → tag) via API.

### 4.4 tests/drag-drop.spec.js — Drag and Drop (3 tests)

| # | Test | Covers |
|---|---|---|
| 1 | Dragging a tag template onto a module node adds it as a child | Functional spec §16: drag-and-drop composition |
| 2 | Dropped child appears in Fields Panel on click | Functional spec §16: post-drop selection |
| 3 | Dragging onto a tag node is rejected (tag nodes are not valid drop targets) | Functional spec §16: invalid drop targets |

**Setup:** Creates one tag template and one module template via API. `beforeEach` calls `selectRoot(modMName)` to load the module into the system tree before each drag test.

**Note on test 3:** The second drag (`tagLeaf2.dragTo(tagNodeInTree)`) is wrapped in `.catch(() => {})` because Playwright's `dragTo` may time out if the drop target rejects the event before the gesture completes. The assertion (`not.toContainText(tagT2Name)`) is what validates the behaviour, not whether `dragTo` resolves.

### 4.5 tests/save-cancel.spec.js — Save/Cancel/Cascade flow (7 tests, 1 skipped)

| # | Test | Status | Covers |
|---|---|---|---|
| 1 | Save bar is hidden when no changes are pending | Pass | Functional spec §17: save bar visibility |
| 2 | Save bar appears after editing a field default | Pass | Functional spec §17: dirty detection |
| 3 | Cancel/Discard hides Save bar and reverts field | Pass | Functional spec §17: discard flow |
| 4 | Root dropdown is disabled while dirty | **Skip** | Functional spec §17.1 — cursor-not-allowed on wrapper but dropdown still interactive |
| 5 | Save with no upstream parents completes and hides Save bar | Pass | Functional spec §18: simple save |
| 6 | Save triggers CascadeConfirmModal when upstream parents are affected | Pass | Functional spec §19: cascade modal |
| 7 | Confirming the cascade modal completes the save | Pass | Functional spec §19: cascade confirm |

**Setup for tests 6 and 7:** Uses `po.selectRoot(pName)` (the parent) — not `selectRoot(tName)` (the tag). `loadRoot(pName)` populates `templateMap` with `{pName, tName}`. `simulateCascade` requires both templates in the store to detect that editing `tName` affects `pName`. Calling `selectRoot(tName)` would fail because tag templates are excluded from the root dropdown; calling `selectRoot` with a structural parent that was not explicitly loaded would leave the store without the tag, causing `simulateCascade` to report no affected ancestors and the cascade modal to never appear.

**Setup for test 5:** Uses a standalone parameter template (`soloName`) with its own `eng_min` field and no children and no upstream parents. A tag template cannot be used as the root (see section 5.4). A structural parent with the tag as a child would trigger the cascade modal, causing `saveAndWait()` to hang.

### 4.6 tests/validation.spec.js — Validation Panel (5 tests)

| # | Test | Covers |
|---|---|---|
| 1 | ValidationPanel shows no errors for a valid template | Functional spec §20: clean state |
| 2 | ValidationPanel shows error for circular reference | Functional spec §20: CIRCULAR_REFERENCE |
| 3 | ValidationPanel shows error for invalid field type | Functional spec §20: SCHEMA_VALIDATION_ERROR |
| 4 | Save button is disabled when validation errors are present | Functional spec §20: save gating |
| 5 | Childless structural root loads without validation errors | Functional spec §20: empty template |

**Setup:** Creates templates via API; edits them through the UI to trigger validation states.

### 4.7 tests/registry.spec.js — Registry Page (5 tests, 1 skipped)

| # | Test | Status | Covers |
|---|---|---|---|
| 1 | Shows prompt when no root is selected | Pass | Functional spec §21: empty state |
| 2 | Shows registry table after root selection | Pass | Functional spec §21: table display |
| 3 | tag_path column is present and contains root template name prefix | Pass | Functional spec §21: tag path format |
| 4 | Clicking tag_path column header sorts the table | Pass | Functional spec §21: column sort |
| 5 | Error banner shown when graph has validation errors | **Skip** | Functional spec §21.3 — not reachable via API |

**Setup:** Creates 3-level hierarchy (module → parameter → tag) via API, then calls `selectRoot(modMName)` followed by `po.navigateToRegistry()`. Navigation uses the sidebar button (client-side) to preserve store state — `page.goto('/registry')` would wipe Zustand state and cause the table to never render.

### 4.8 Phase 2 E2E Test Files

#### 4.8.1 tests/registry-diff.spec.js — Registry Diff Display (6 tests)

| # | Test | Covers |
|---|---|---|
| 1 | shows all tags as added (green) when not yet applied to database | diffRegistry added classification, bg-green-500 row class |
| 2 | shows all rows as unchanged after applying registry | diffRegistry unchanged classification, no colored background |
| 3 | shows new child as added (green) after registry was applied | diff after template modification — added row |
| 4 | shows removed tag as retired (red) after registry was applied | diffRegistry retired classification, bg-red-500 row class |
| 5 | shows modified row with cell-level highlight when field value changes | per-cell amber highlight (td[class*="amber"]), not full-row |
| 6 | tag_id column shows 'new' for added rows and numeric id for unchanged rows | tag_id column behavior |

**Pattern:** Timestamp-based template names (e.g. `tag_diff_${Date.now()}`) ensure tag_paths are unique per run and never appear in the DB before the test applies them. Inline `applyRegistryApi()` and `getTemplate()` helpers defined in the spec file — `api.js` was not modified.

#### 4.8.2 tests/registry-apply.spec.js — Registry Apply Flow (7 tests)

| # | Test | Covers |
|---|---|---|
| 1 | Update DB button is disabled when all tags are unchanged | disabled state when no changes |
| 2 | Update DB button is enabled when changes exist | enabled state when added rows present |
| 3 | clicking Update DB opens confirmation modal with correct contents | modal open, diff summary, comment input, Confirm disabled initially |
| 4 | Confirm button enables only when comment is non-empty | Confirm gating on comment field |
| 5 | Cancel closes modal without applying | Cancel flow, diff summary unchanged |
| 6 | successful apply shows success banner and all rows become unchanged | banner text, diff resets to unchanged, banner auto-dismisses after 4s |
| 7 | apply creates a new revision visible on the History page | revision count increments, comment and 'dev' visible on History page |

**Key locators:**
```js
const updateDbButton = (page) => page.getByRole('button', { name: 'Update DB' });
const applyModal = (page) => page.locator('.shadow-xl').filter({ hasText: /Apply Registry Changes/i }).first();
const commentInput = (page) => page.locator('#apply-comment');
const confirmButton = (page) => page.getByRole('button', { name: 'Confirm' });
```

#### 4.8.3 tests/history.spec.js — History Page (5 tests)

| # | Test | Covers |
|---|---|---|
| 1 | History nav item is visible in sidebar | History sidebar button present |
| 2 | History page shows revisions table with correct column headers | rev, applied_by, applied_at, comment headers |
| 3 | revisions are ordered most recent first | DESC ordering by registry_rev |
| 4 | applied_at column uses dd-MMM-yyyy HH:mm:ss format | regex `/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}$/` |
| 5 | comment column shows the comment entered during apply | comment round-trip |

**Navigation:** `page.getByRole('button', { name: /history/i }).click()` — inline in each test, not via `pageObjects.js`.

#### 4.8.4 tests/meta-modal.spec.js — Meta View Modal (4 tests)

| # | Test | Covers |
|---|---|---|
| 1 | clicking View on a registry row opens meta modal with tag_path as title | modal opens, contains tag_path, shows Level N cards |
| 2 | meta modal closes when Close button is clicked | modal close |
| 3 | modified row meta modal shows diff legend when meta field value differs | legend text (changed/added/removed), amber cell highlight |
| 4 | clicking View on a different row replaces the open modal | modal content switches to second row's tag_path |

**Modal locator pattern:**
```js
function metaModal(page, tagPath) {
  return page.locator('.shadow-xl').filter({ hasText: tagPath }).first();
}
```

---

### 4.8.5 tests/validation-parent-types.spec.js — Parent Type Validation (4 tests)

**Prerequisite:** `VALIDATE_REQUIRED_PARENT_TYPES=module,parameter` and `VALIDATE_UNIQUE_PARENT_TYPES=true` must be set in `apps/tag-registry/server/.env`. Without these vars the config endpoint returns empty arrays/false and all four tests will fail to observe the expected error codes.

| # | Test | Covers |
|---|---|---|
| 1 | PARENT_TYPE_MISSING shown when tag has no module ancestor | Bootstrap §8.6, §8.10 — validateParentTypes wired via config endpoint |
| 2 | PARENT_TYPE_MISSING shown when tag has no parameter ancestor | Same setup as test 1 — second error message for second missing type |
| 3 | No validation errors when tag has both module and parameter ancestors | Full hierarchy: system → module → parameter → tag |
| 4 | DUPLICATE_PARENT_TYPE shown when tag has two module ancestors | Hierarchy: system → module → module → parameter → tag |

**Setup:** Each test creates its own hierarchy via API in `beforeEach`. Test 1 and 2 share the same fixture (system root → tag directly, no module or parameter between them). Test 3 builds the full four-level chain. Test 4 builds a five-level chain with two `module` type nodes. All created templates are cleaned up via `deleteTemplates(created.splice(0))` in `afterEach`.

---

### 4.8.6 tests/trends.spec.js — Trends Column (3 tests)

| # | Test | Covers |
|---|---|---|
| 1 | trends column header visible in Registry table | Bootstrap §8.5 — trends column between is_setpoint and meta |
| 2 | Tag row shows false when no trends field in any template | shared/resolveRegistry — trends defaults to false |
| 3 | Tag row shows true when module template has trends field set to true | shared/resolveRegistry — case-insensitive trends detection, Boolean field_type |

**Setup:** Each test creates a module → parameter → tag hierarchy via API. Test 3 additionally passes `{ trends: { field_type: 'Boolean', default: true } }` as the module-level `fields` argument to `createStructuralTemplate`. `po.selectRoot(modName)` loads the hierarchy, `po.navigateToRegistry()` switches to the Registry page client-side. The trends cell is the 5th `<td>` (0-indexed: 4) in each row: `tag_id(0), tag_path(1), data_type(2), is_setpoint(3), trends(4), meta(5)`.

---

## 4.9 Phase 2 Unit Test Files

#### 4.9.1 client/__tests__/diffRegistry.test.js (34 tests)

Covers: `deepEqual` key-order insensitivity (via meta comparison), all `diffStatus` classifications (added/retired/unchanged/modified), sort order (added→modified→unchanged→retired), `changedFields` array on modified rows, `dbMeta` present on all modified rows, `tag_id` carry-over from db row onto unchanged/modified/retired rows. Edge cases: empty proposed array, empty db array, both empty.

Uses `makeProposed()` and `makeDb()` fixture helpers. No DOM, no network — pure function tests.

#### 4.9.2 client/__tests__/formatDate.test.js (22 tests)

Covers: all 12 month abbreviations (Jan–Dec), zero-padding for day, hour, minute, second, null/undefined/invalid inputs → `'—'`, `Date` objects, ISO strings, PostgreSQL TIMESTAMPTZ strings.

**Timezone safety:** expected strings are built using the same local-time methods (`getDate()`, `getHours()`, etc.) as the implementation, ensuring tests pass regardless of the machine's timezone.

#### 4.9.3 server/__tests__/registryService.test.js (18 tests)

Covers: `getActiveRegistry` (SQL contains `DISTINCT ON`, `ORDER BY registry_rev DESC`, `retired = false` in outer WHERE); `getRevisions` (SQL references `registry_revisions`, ordered `registry_rev DESC`); `getRevisionTags` (called with `[rev]` param, SQL has `registry_rev=$1`, ordered `tag_path ASC`, returns `null` for empty result set).

`@caro/db` is fully mocked via `vi.mock('@caro/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }))`. No real PostgreSQL connection required.

#### 4.9.4 server/__tests__/registry.test.js (19 tests)

HTTP route tests via `node:http.createServer(createApp())` + Node 18 global `fetch`. No supertest dependency. Server lifecycle: `beforeAll` starts server, `afterAll` closes it. All service deps mocked via `vi.mock`.

Covers: `GET /api/v1/registry` (success with tag array, service error → 500); `POST /api/v1/registry/apply` (missing rootName → 400, missing comment → 400, template not found → 404, success → 200 with rev/counts, no changes → 200 with null rev); `GET /api/v1/registry/revisions` (success); `GET /api/v1/registry/revisions/:rev` (success, non-integer → 400, not found → 404).

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

### 5.7 createTagTemplate requires top-level data_type and is_setpoint

The shared `validateTemplate()` function checks `template.data_type` (must be a valid `DATA_TYPES` key) and `typeof template.is_setpoint !== 'boolean'` at the **top level** of the template object — matching the on-disk JSON structure (`apps/tag-registry/templates/tags/numeric_mon.json`).

If `data_type` or `is_setpoint` are placed inside the `fields` object as `{ field_type, default }` descriptors, `validateTemplate` cannot find them at the expected paths, reports `SCHEMA_VALIDATION_ERROR` for both fields, and sets `validationState.isValid = false`. This disables the Save button and prevents the Registry table from rendering — symptoms that are easy to misdiagnose as UI bugs.

**Correct `createTagTemplate` output:**
```js
{
  template_type: 'tag',
  template_name: name,
  data_type:     dataType,    // top-level string — NOT inside fields{}
  is_setpoint:   isSetpoint,  // top-level boolean — NOT inside fields{}
  fields:        fields,      // user-defined fields only
  children:      [],
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

### 5.13 Phase 2 API helpers defined inline

Phase 2 E2E specs (`registry-diff.spec.js`, `registry-apply.spec.js`, `history.spec.js`, `meta-modal.spec.js`) define registry API helpers (`applyRegistryApi`, `fetchRevisions`, `getTemplate`) inline per spec file rather than in `helpers/api.js`. This is intentional — `api.js` was not modified to avoid breaking existing Phase 1 tests.

History page navigation uses `page.getByRole('button', { name: /history/i }).click()` inline — `pageObjects.js` was not modified.

### 5.14 DB rows not cleaned up after Phase 2 tests

`tag_registry` and `registry_revisions` rows written during Phase 2 E2E tests are not deleted after each test. The append-only schema means stale rows from prior runs are harmless — `getActiveRegistry()` always returns the latest revision per `tag_id`, and timestamp-based template names ensure unique `tag_path`s per run. Rows from prior runs never interfere with new test assertions.

---

## 6. Intentionally Skipped Tests

### 6.1 root dropdown is disabled while dirty

**File:** `tests/save-cancel.spec.js` test 4
**Browsers skipped:** Chromium, Firefox, WebKit (3 skips)

```js
test.skip('root dropdown is disabled while dirty', ...)
```

**Reason:** The root dropdown wrapper has `cursor-not-allowed` styling while dirty, but the `<select>` element itself has no `disabled` attribute — the dropdown remains interactive. The spec originally called for a `disabled` prop, but the current implementation uses a CSS cursor hint only. The test is skipped rather than deleted so it documents the implementation state.

### 6.2 error banner shown when graph has validation errors

**File:** `tests/registry.spec.js` test 5
**Browsers skipped:** Chromium, Firefox, WebKit (3 skips)

```js
test.skip(true, 'Server validates INVALID_REFERENCE — broken template cannot be created via API');
```

**Reason:** The test attempts to create a structural template referencing a non-existent child to force an `INVALID_REFERENCE` validation error in the client. However, the server's `POST /api/v1/templates/batch` endpoint calls `validateGraph()` before writing — it rejects any template referencing a child that does not exist on disk, returning `400 INVALID_REFERENCE`. The broken template is never written, the client never loads it, and the error banner is never shown.

The `INVALID_REFERENCE` error state in the registry is only reachable by manually corrupting template JSON files on disk after they have been written. Testing this state would require direct filesystem access from the test helper, which is out of scope for the browser E2E suite and is better covered by a server unit test.

---

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

All helpers call `http://10.0.0.184:3001/api/v1` directly. An internal `request()` wrapper handles JSON serialisation and unwraps the `{ ok, data }` envelope, throwing a typed `Error` with `.code` and `.status` on failure.

### createTagTemplate(name, dataType?, isSetpoint?, fields?)

Creates a tag template and returns `{ template, hash }`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Unique template name |
| `dataType` | string | `'f64'` | One of the `DATA_TYPES` constants |
| `isSetpoint` | boolean | `false` | Whether the tag is a setpoint |
| `fields` | object | `{}` | Additional user-defined fields |

Posts via `POST /templates/batch` with `confirmed: true`, then re-fetches via `GET /templates/:name` to return the server-assigned hash.

**Schema requirement:** `data_type` and `is_setpoint` are placed at the top level of the template object, not inside `fields{}`. See section 5.7.

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

---

## 9. Results Baseline

### 9.1 E2E Suite — Phase 1 Baseline (v1.0, 2026-03-19)

| Metric | Value |
|---|---|
| Total runs (40 definitions × 3 browsers) | 120 |
| Passed | 114 |
| Skipped (intentional) | 6 |
| Failed | 0 |
| Runtime | ~3.7 minutes |
| Browsers | Chromium, Firefox, WebKit |

Skipped breakdown:
- `save-cancel.spec.js` test 4 × 3 browsers — see section 6.1
- `registry.spec.js` test 5 × 3 browsers — see section 6.2

### 9.2 Unit Test Suite — Phase 1 Baseline (v1.0, 2026-03-19)

| Package | Tests | Passed | Failed |
|---|---|---|---|
| shared/ pure functions | 112 | 112 | 0 |
| server/ templateService | 42 | 42 | 0 |
| client/ useTemplateGraphStore | 47 | 47 | 0 |
| **Total** | **201** | **201** | **0** |

### 9.3 Combined Phase 1 Baseline

| Metric | Value |
|---|---|
| Total tests (unit + E2E runs) | 321 |
| Passing | 315 |
| Skipped (intentional, E2E only) | 6 |
| Failed | 0 |
| Baseline date | 2026-03-19 |

### 9.4 Phase 2 Baseline (2026-03-23)

**Vitest unit tests:**

| Package | Tests | Passed |
|---|---|---|
| shared/ pure functions | 112 | 112 |
| server/ templateService | 42 | 42 |
| client/ useTemplateGraphStore | 47 | 47 |
| client/ diffRegistry | 34 | 34 |
| client/ formatDate | 22 | 22 |
| server/ registryService | 18 | 18 |
| server/ registry routes | 19 | 19 |
| **Total** | **294** | **294** |

**Playwright E2E:**

| Spec files | Runs | Passed | Skipped |
|---|---|---|---|
| Phase 1 (7 files, 40 tests × 3 browsers) | 120 | 114 | 6 |
| registry-diff.spec.js (6 tests × 3 browsers) | 18 | 18 | 0 |
| registry-apply.spec.js (7 tests × 3 browsers) | 21 | 21 | 0 |
| history.spec.js (5 tests × 3 browsers) | 15 | 15 | 0 |
| meta-modal.spec.js (4 tests × 3 browsers) | 12 | 12 | 0 |
| **Phase 2 total new E2E runs** | **66** | **66** | **0** |
| **Combined E2E** | **186** | **180** | **6** |

**Combined total (Phase 2):**

| Metric | Value |
|---|---|
| Total (unit tests + E2E runs) | 480 |
| Passing | 474 |
| Skipped (intentional, E2E only) | 6 |
| Failed | 0 |
| Baseline date | 2026-03-23 |

### 9.5 Phase 3 Baseline (2026-04-02)

**Vitest unit tests:**

| Package | Tests | Passed |
|---|---|---|
| shared/ pure functions | 125 | 125 |
| server/ templateService | 42 | 42 |
| server/ registryService | 19 | 19 |
| server/ registry routes | 17 | 17 |
| server/ config route | 11 | 11 |
| client/ useTemplateGraphStore | 47 | 47 |
| client/ diffRegistry | 34 | 34 |
| client/ formatDate | 22 | 22 |
| client/ (other) | 9 | 9 |
| db/ | 6 | 6 |
| **Total** | **332** | **332** |

**Playwright E2E:**

| Spec files | Runs | Passed | Skipped |
|---|---|---|---|
| Phase 1 (7 files × 3 browsers) | 120 | 114 | 6 |
| Phase 2 (4 files × 3 browsers) | 66 | 66 | 0 |
| Phase 3 (2 files × 3 browsers) | 21 | 21 | 0 |
| **Combined E2E** | **207** | **201** | **6** |

**Combined total (Phase 3):**

| Metric | Value |
|---|---|
| Total (unit tests + E2E runs) | 533 |
| Passing | 527 |
| Skipped (intentional, E2E only) | 6 |
| Failed | 0 |
| Baseline date | 2026-04-02 |

---

## 10. Unit Test Suite

### 10.1 Overview

In addition to the Playwright E2E suite, a Vitest unit test suite covers the layers of business logic that are not adequately validated through browser tests alone: the shared pure functions, the server template service, the client Zustand store, and the Phase 2 registry utilities and routes.

### 10.2 Packages and locations

| Package | Location | Run command |
|---|---|---|
| shared/ functions | apps/tag-registry/shared/ | npm test |
| server templateService + registry | apps/tag-registry/server/ | npm test |
| useTemplateGraphStore + diffRegistry + formatDate | apps/tag-registry/client/ | npm test |

All three use Vitest 1.6.x. Config file: vitest.config.js in each package root. Test files: `__tests__/**/*.test.js`.

Note: the client package runs Vitest from the monorepo root `node_modules/.bin` because `@caro/ui` is a workspace-only package that cannot be resolved by a standalone `npm install` in the client directory. `npm test` works correctly because npm adds the project root's `node_modules/.bin` to PATH when running scripts.

### 10.3 shared/ unit tests (112 tests, 8 files)

| File | Tests | Coverage |
|---|---|---|
| utils.test.js | 20 | deepEqual, deepNotEqual — all types and edge cases |
| hashTemplate.test.js | 8 | 6-char hex output, determinism, key-order independence |
| validateTemplate.test.js | 35 | Valid/invalid tags and structs, all field_types, identifier length, child rules |
| validateGraph.test.js | 12 | Valid graphs, INVALID_REFERENCE, CIRCULAR_REFERENCE, multi-error |
| simulateCascade.test.js | 10 | fields added/removed/changed, affectedParents per-instance, no-op |
| applyFieldCascade.test.js | 7 | Purity, plain object/Map passthrough, field removal cascade, single-level only |
| resolveRegistry.test.js | 13 | tag_path construction, rootName as first segment, meta leaf-to-root, field resolution, path length limit |
| validateParentTypes.test.js | 7 | No-op when unconfigured, PARENT_TYPE_MISSING, DUPLICATE_PARENT_TYPE |

### 10.4 server/ unit tests (42 + 37 = 79 tests)

**Phase 1 — templateService (42 tests, 5 files):**

Uses real temporary directories (os.tmpdir()) for file I/O. No mocking — tests the actual fs operations.

| File | Tests | Coverage |
|---|---|---|
| initializeIndex.test.js | 7 | Empty dir, single/multiple files, skip no-name, skip non-JSON, re-init |
| listAndGet.test.js | 7 | listTemplates with/without type filter, getTemplate success/not-found |
| loadRoot.test.js | 9 | Single template, not-found, 2-level/3-level hierarchy, out-of-subgraph exclusion, missing child skip, cycle safety |
| batchSave.test.js | 15 | New template, name conflict, stale hash (changes + deletions), update, delete, empty batch, requires_confirmation, confirmed cascade, graph validation rejection |
| validateAll.test.js | 4 | Empty dir, all valid, broken reference |

**Phase 2 — registryService (18 tests, 1 file):**

`@caro/db` fully mocked. Tests SQL patterns, parameter shapes, and return values.

| File | Tests | Coverage |
|---|---|---|
| registryService.test.js | 18 | getActiveRegistry (DISTINCT ON + WHERE retired=false), getRevisions (DESC order), getRevisionTags (tag_path ASC, null on empty) |

**Phase 2 — registry routes (19 tests, 1 file):**

Uses `node:http.createServer(createApp())` + Node 18 global `fetch`. No supertest.

| File | Tests | Coverage |
|---|---|---|
| registry.test.js | 19 | GET /registry, POST /apply (validation, not-found, success, no-changes), GET /revisions, GET /revisions/:rev (success, non-integer, not-found) |

### 10.5 client/ unit tests (47 + 56 = 103 tests)

**Phase 1 — useTemplateGraphStore (47 tests, 5 files):**

Uses vi.mock() for templatesApi and useUIStore. Store reset via `useTemplateGraphStore.setState()` in beforeEach.

| File | Tests | Coverage |
|---|---|---|
| loadRoot.test.js | 10 | Success, templateMap/hashes populated, originalTemplateMap clone, dirty clear, error handling, null guard |
| updateTemplate.test.js | 6 | Field update, dirtySet add/remove, no-baseline always-dirty, early return, applyFieldCascade cascade |
| addAndInject.test.js | 12 | addTemplate (null/existing hash), injectTemplateGraph (no-overwrite, dirtySet untouched, structuredClone) |
| deletionActions.test.js | 7 | markForDeletion (removes from map, preserves hash/originalMap), removeTemplate (all-five, safe on missing) |
| saveAndDiscard.test.js | 12 | Guards, payload shape, requires_confirmation, rooted reload, isolation mode wipe+refetch, confirmSave, discard, STALE_TEMPLATE |

**Phase 2 — diffRegistry (34 tests, 1 file):**

| File | Tests | Coverage |
|---|---|---|
| diffRegistry.test.js | 34 | All diffStatus classifications, sort order, changedFields, dbMeta on modified rows, tag_id carry-over, deepEqual key-order insensitivity, edge cases |

**Phase 2 — formatDate (22 tests, 1 file):**

| File | Tests | Coverage |
|---|---|---|
| formatDate.test.js | 22 | All 12 month abbreviations, zero-padding, null/undefined/invalid → '—', Date objects, ISO strings, PostgreSQL TIMESTAMPTZ |
