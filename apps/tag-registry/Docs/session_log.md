# Session Log

## 2026-03-23 — Spec regeneration: v1.15/v1.18/v1.13/v1.0 → v1.16/v1.19/v1.14/v1.1

**Changes made:**
- Created tag_registry_spec_v1_16.md — applied deltas 1–17; updated tag_path definition, §9.1, §10.2 (template_name dot rule), §10.8 (EMPTY_BRANCH note), §12 (full Phase 2 diff UI detail), §14.1 (removed partial unique index), §16.1 (save bar editor-only + Update DB dirty), §16.9 (Phase 2 registry fetch), §16.10 (History page), §18 Phase Split table
- Created tag_registry_bootstrap_v1_19.md — added @caro/db package, db/ folder structure, Phase 2 routes and services, client utils and pages, §4.1 resolveRegistry rootName note, §4.13 PG* vars, §4.16 @caro/db detail, §4.17 apply transaction, §8.5 Phase 2 RegistryPage, §8.8 HistoryPage, §8.9 MetaModalBody, nodemon note, htmlFor/id notes, collapse toggle fix
- Created tag_registry_api_spec_v1_14.md — §2.5 identity note, §2.6 PG* vars replacing DATABASE_URL, §5.1 full GET /registry spec, §5.2 client-side diff note, §5.3 full POST /apply spec, §6.1–6.2 revision endpoints, §7 INVALID_TEMPLATE_NAME + VALIDATION_ERROR note
- Created tag_registry_test_spec_v1_1.md — §1 overview updated, §3.6 History navigation added, §4.7 tag_path prefix note, §4.8 four Phase 2 E2E spec sections, §4.9 four Phase 2 unit test sections, §5.13 inline helpers, §5.14 DB rows not cleaned up, §9.4 Phase 2 baseline (294 unit + 186 E2E runs), §10 unit test tables updated
- Deleted old versioned files (v1_15, v1_18, v1_13, v1_0)
- Cleared spec_delta.md — all 17 deltas applied
- Updated HANDOFF.md — new versions, Phase 2 complete, updated test counts, gotcha 9+10 added

**Spec deltas added:** no — this session applied all pending deltas to the spec documents
**Tests affected:** none — no code changes
**Docs that may need updating:** none — this session WAS the doc update
**Deferred / follow-up:** none

## 2026-03-22 — Phase 2 registry diff feature + db infrastructure

**Changes made:**
- Root dropdown disabled while dirty: added `disabled` prop to `@caro/ui` Dropdown; wired `isDirty` → disabled in AppShell.jsx with native tooltip; un-skipped save-cancel.spec.js test 4
- registry.spec.js test 5 rewritten: uses UI-based dot-in-asset-name to trigger INVALID_ASSET_NAME client-side (server rejected INVALID_REFERENCE approach)
- fields-panel.spec.js test 8 added: asserts asset name dirty color (orange) — expected to fail (known bug marker)
- Fixed asset name dirty color bug in FieldsPanel.jsx: passed `isDirtyField` prop to Asset Name FieldTableRow
- Appended Session Discipline section to apps/tag-registry/CLAUDE.md
- resolveRegistry.js: replaced hardcoded `'root.'` prefix with `rootName + '.'`; updated 4 unit test assertions and E2E tests 2/3/4
- Created db/postgres/migrations/001_create_tag_registry.sql and 002_create_registry_revisions.sql
- Created db/postgres/seeds/dev_seed.sql
- Created db/postgres/README.md
- Created db/timescale/ with README.md and .gitkeep
- Created db/postgres/scripts/setup_dev_db.ps1 (PowerShell, ASCII-only, UTF-8 no BOM)
- Created db/postgres/scripts/reset_dev_db.ps1
- Created packages/db/ workspace package (@caro/db): pool.js (lazy singleton), query.js, migrations.js, index.js, README.md, package.json
- Integrated @caro/db into tag-registry server: added dependency, added DB connectivity check in index.js start()
- Phase 2 registry diff feature:
  - server/src/services/registryService.js: `getActiveRegistry()` with DISTINCT ON query
  - server/src/routes/registry.js: GET /api/v1/registry
  - server/src/app.js: registered /api/v1/registry route
  - client/src/api/registry.js: `fetchRegistry()`
  - client/src/utils/diffRegistry.js: `diffRegistry(proposed, dbTags)` with added/modified/unchanged/retired statuses
  - client/src/pages/RegistryPage.jsx: diff useEffect, summary counts line, DB error warning banner, TODO placeholder
  - client/src/components/registry/RegistryTable.jsx: optional `rows` prop with diffStatus row coloring

**Spec deltas added:** yes — see spec_delta.md (items 6 through 10)
**Tests affected:** save-cancel.spec.js (test 4 un-skipped), registry.spec.js (test 5 rewritten, tests 2-4 updated), fields-panel.spec.js (test 8 added); resolveRegistry.test.js (4 assertions updated)
**Docs that may need updating:** API Spec v1.13 (Phase 2 GET /api/v1/registry), Functional Spec v1.15 (registry diff workflow), Bootstrap v1.18 (db/ folder structure, @caro/db package)
**Deferred / follow-up:** "Apply to DB" button and apply workflow; server-side resolveRegistry; registry_revisions increment logic; auth
