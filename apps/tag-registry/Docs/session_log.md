# Session Log

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
