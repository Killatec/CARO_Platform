# Spec Delta — Pending Updates to Word Documents

Changes made during implementation that diverge from or are
not covered by the current spec docs. Clear each item after
the corresponding Word document has been updated.

---

## Phase 1.x — App Fixes and Discoveries

### 1. nodemon must not watch templates/ directory

**Target:** Bootstrap v1.18 — dev scripts / server setup section

`server/package.json` dev script was changed from:
  nodemon --ext js,json --watch src --watch ../templates src/index.js
To:
  nodemon --ext js,json --watch src src/index.js

Watching the templates directory caused nodemon to restart the
server on every template file write or delete. This breaks any
tooling or test runner that creates/deletes template files
programmatically. The templates directory must never be in the
nodemon watch list.

### 2. AssetTree collapse toggle bug fixed

**Target:** Bootstrap v1.18 — § 4.11 or § 8.2 (AssetTree behaviour)

The expand/collapse toggle handler in AssetTree.jsx used:
  setExpandedNodes(prev => ({ ...prev, [ownPath]: !prev[ownPath] }))

This treated `undefined` (the initial state for expanded nodes)
as falsy — so the first click set the value to `true` (still
expanded), requiring two clicks to collapse a node for the first
time.

Fix applied:
  setExpandedNodes(prev => ({ ...prev, [ownPath]: prev[ownPath] !== false ? false : true }))

Or equivalently:
  prev[ownPath] === false → expand (set undefined or true)
  prev[ownPath] !== false → collapse (set false)

The spec note in § 8.2 ("Collapse state lifted to AssetTree as
expandedNodes map keyed by ownPath. Default undefined = expanded")
should be supplemented with: "First click on an undefined entry
must collapse the node — do not use !prev[path] as this treats
undefined as falsy."

### 3. data-testid attributes added to key components

**Target:** Bootstrap v1.18 — § 5 UI Architecture or new testability section

The following data-testid attributes were added for stable
test targeting. Any future refactor of these components must
preserve these attributes:

| Attribute | Component | Element |
|---|---|---|
| data-testid="system-tree" | AssetTree.jsx | Outermost div (all return paths) |
| data-testid="templates-tree" | TemplatesTree.jsx | Outermost div (all return paths) |
| data-testid="fields-panel" | FieldsPanel.jsx | Outermost div (all return paths) |
| data-testid="save-bar" | AppShell.jsx | Save bar wrapper div (isDirty only) |
| data-testid="save-button" | AppShell.jsx | Save button |
| data-testid="cancel-button" | AppShell.jsx | Cancel button |
| data-testid="see-changes-button" | AppShell.jsx | See what's changed button |

### 4. htmlFor/id pairs added to modal inputs

**Target:** Bootstrap v1.18 — § component notes for NewTemplateModal
and AddFieldModal

Labels in NewTemplateModal and AddFieldModal previously had no
htmlFor attribute linking them to their inputs. This broke both
accessibility (screen readers) and Playwright's getByLabel()
locator. Fixed by adding matching id/htmlFor pairs:

NewTemplateModal: name input id="new-template-name",
  type input id="new-template-type"
AddFieldModal: name input id="add-field-name",
  type input id="add-field-type",
  default input id="add-field-default"

### 5. EMPTY_BRANCH not implemented in Phase 1 validation

**Target:** Functional Spec v1.15 — § 15.5 (Client-Side Checks)
           Bootstrap v1.18 — § 4.8 (useValidation Hook)

EMPTY_BRANCH is declared in shared/constants.js and listed in
Functional Spec § 15.5 as a client-side validation check. It is
NOT emitted by any Phase 1 validation function (validateGraph,
validateTemplate, or useValidation). The warning is a Phase 2
or future item.

The spec should either:
- Remove EMPTY_BRANCH from the § 15.5 client-side checks list, or
- Add a note: "EMPTY_BRANCH: declared but not yet implemented in
  Phase 1. Reserved for future implementation."

### 6. Root dropdown disabled-while-dirty not implemented

**Target:** Functional Spec v1.15 — § 16.1 (Global Root Selector)

Functional Spec § 16.1 states: "The root dropdown is disabled
while isDirty is true, showing a tooltip: 'Save or discard
changes before switching root.'"

AppShell.jsx does not currently implement this. The Dropdown
component has no disabled prop wired to isDirty. The dropdown
remains interactive while unsaved changes are pending.

The E2E test for this behaviour (save-cancel.spec.js test 4)
is intentionally skipped until this is implemented.

---

## Phase 1.x — Unit Test Findings

### 7. i32_array is accepted by validateTemplate (spec says unsupported)

**Target:** Bootstrap v1.18 — § 4.1 (validateTemplate signature note)
           Functional Spec v1.15 — § 6 (Data Types table)

Bootstrap v1.18 § 4.1 states: "The i32_array type is not supported."
Functional Spec § 6 does not list i32_array in the Data Types table.

However, constants.js includes:
  DATA_TYPES.I32_ARRAY = 'i32_array'

And DATA_TYPE_VALUES = Object.values(DATA_TYPES), which includes
'i32_array'. validateTemplate checks data_type against DATA_TYPE_VALUES,
so 'i32_array' passes validation.

Unit test confirms: validateTemplate({ ..., data_type: 'i32_array' })
returns { valid: true }.

Resolution options (pick one when updating the Word docs):
  A. Remove I32_ARRAY from constants.js DATA_TYPES and add an explicit
     rejection in validateTemplate — makes the code match the spec.
  B. Add i32_array to the Data Types table in Functional Spec § 6 and
     remove the "not supported" note from Bootstrap § 4.1 — makes the
     spec match the code.

Current state: spec says unsupported, code accepts it.

### 8. batchSave does not mkdir -p before writing new templates

**Target:** Bootstrap v1.18 — § 4.4 (Template File I/O)

templateService.batchSave() derives the subdirectory for a new
template from its template_type:
  'tag'       → tags/<name>.json
  'parameter' → parameters/<name>.json
  anything else → modules/<name>.json

It does NOT call mkdir({ recursive: true }) before writing.
If the subdirectory does not exist, the writeFile call throws
ENOENT and the save fails with an unhandled filesystem error
rather than a clean API error.

Observed: in unit tests, the tags/ directory was created by the
test fixture setup. The parameters/ and modules/ directories were
not pre-created — tests that saved parameter or module templates
would have failed without the writeTpl helper creating those dirs.

Fix: in batchSave, before the atomic write sequence, add:
  await fs.mkdir(path.dirname(fullPath), { recursive: true })

This is a latent bug in fresh deployments where only some
subdirectories exist. The seed templates in apps/tag-registry/
templates/ happen to include all four subdirectories, masking
the issue in practice.

**Risk:** Low in current usage (seed dirs always present).
High if a new template_type is introduced or a fresh clone
is used without the seed templates directory structure.

### 9. batchSave graph validation error shape

**Target:** API Spec v1.13 — § 3.4 (Batch Save error responses)

When batchSave rejects due to a graph validation failure
(e.g. INVALID_REFERENCE in proposed template set), the thrown
error has:
  error.code    = 'VALIDATION_ERROR'
  error.details = [ { code: 'INVALID_REFERENCE', message: '...' } ]

The outer code is VALIDATION_ERROR (HTTP 422 via errorHandler),
not INVALID_REFERENCE directly. The API Spec § 7 error table
lists INVALID_REFERENCE as a first-class error code with HTTP 422,
but the actual server response wraps it inside VALIDATION_ERROR
details.

The API Spec should clarify: graph validation errors from
batchSave are returned as VALIDATION_ERROR with the specific
codes (INVALID_REFERENCE, CIRCULAR_REFERENCE) surfaced in the
details array — not as top-level error codes.

---

## Phase 2 — Registry Diff Feature

### 10. GET /api/v1/registry added; RegistryPage shows diff colors

**Date:** 2026-03-22
**Spec:** API Spec v1.13 — Phase 2 registry endpoint (not yet specified in detail)
         Functional Spec v1.15 — Phase 2 registry diff/apply workflow

**Delta:**
- `GET /api/v1/registry` implemented: returns all non-retired rows using
  `DISTINCT ON (tag_id) ORDER BY tag_id, registry_rev DESC`.
- Client `diffRegistry(proposed, dbTags)` pure utility compares tag_path
  keys; each row gets `diffStatus`: added / modified / unchanged / retired.
  Sort order: added → modified → unchanged → retired.
- `RegistryTable` accepts optional `rows` prop with `diffStatus`; colors:
  added=bg-green-500/15, modified=bg-amber-500/15, retired=bg-red-500/15.
- `RegistryTable` has a tag_id column (first), shows "new" for added rows.
- meta column replaced with a "View" link that opens a Modal showing the
  meta array as a structured level-by-level list (leaf to root).
- `RegistryPage` shows a diff summary line (counts per status) and an amber
  warning banner when the DB is unavailable (falls back to undiffed display).
- A TODO placeholder comment marks where the "Apply to DB" button will go.

**Action:** API Spec Phase 2 section should document the GET /api/v1/registry
response shape: `{ ok: true, data: { tags: [...] } }` with the 6 columns
returned (tag_id, registry_rev, tag_path, data_type, is_setpoint, meta).

### 11. POST /api/v1/registry/apply implemented

**Date:** 2026-03-22
**Spec:** API Spec v1.13 — Phase 2 apply workflow (not yet specified)
         Functional Spec v1.15 — Phase 2 registry apply workflow

**Delta:**
- `POST /api/v1/registry/apply` body: `{ rootName, comment }`.
  Server loads the template graph via `loadRoot`, resolves server-side
  via `resolveRegistry`, diffs against DB, writes inside a SERIALIZABLE
  transaction. Returns `{ ok, registry_rev, added, modified, retired }` or
  `{ ok, registry_rev: null, message: 'No changes to apply' }`.
- applied_by is hardcoded to `'dev'` — auth is a Phase 2+ item.
- RegistryPage "Update DB" button + confirmation modal with required comment
  field, loading state, inline error display, and 4-second success banner.
- After a successful apply, the client re-fetches the DB registry and
  re-runs the diff automatically.

**Action:** API Spec should document POST /api/v1/registry/apply request/
response shapes and error codes. applied_by field needs auth design.
