# CLAUDE.md — Tag Registry Admin Tool

This file is read automatically by Claude Code at the start of every session.
Follow these instructions before doing anything else.

## 1. Mandatory pre-task reads

Always read these two files before starting any task, regardless of scope:

1. `apps/tag-registry/Docs/HANDOFF.md` — project orientation, current state, known gotchas
2. `apps/tag-registry/Docs/spec_delta.md` — where the implementation diverges from the specs

## 2. Spec routing — read only what the task requires

| Reach for this when... | Document |
|---|---|
| UI behavior, validation rules, workflow logic, data model | `Docs/tag_registry_spec_v1_17.md` |
| Endpoint contracts, request/response shapes, error codes | `Docs/tag_registry_api_spec_v1_15.md` |
| Component architecture, store behavior, folder structure, seed data | `Docs/tag_registry_bootstrap_v1_21.md` |
| Writing or debugging tests, selector strategy, E2E gotchas | `Docs/tag_registry_test_spec_v1_2.md` |
| Migrations, HMI table schema, audit_log, any PostgreSQL schema question | `Docs/CARO_DB_Spec_v1_3.md` |

Do not read specs you do not need. HANDOFF.md and spec_delta.md are always sufficient for orientation and planning tasks.

## 3. Hard constraints

- **Language:** JavaScript only — no TypeScript anywhere.
- **Database URL:** Never use `DATABASE_URL`. Use the five `PG*` env vars consumed by `@caro/db`.
- **Env file:** `apps/tag-registry/server/.env` is the authoritative env file for the server. The monorepo root `.env` is never loaded by the server process.
- **No mkdir -p in batchSave:** Subdirectories under `templates/` must exist before saving a new template of that type.
- **No URL router:** Never use `page.goto('/registry')` or similar in tests or navigation logic. Use sidebar button clicks to navigate between pages.
- **Shared module:** `apps/tag-registry/shared/` is environment-agnostic — no `fs`, no Express, no DOM. Pure functions only.

## 4. Session discipline

After every task that changes code or behavior:

1. **Run the full test suite** for every affected package before reporting done:
   - `cd apps/tag-registry/shared && npm test`
   - `cd apps/tag-registry/server && npm test`
   - `cd apps/tag-registry/client && npm test`
2. **Update spec_delta.md** if the implementation diverges from any spec document. Use the next available delta number. Never delete old entries.
3. **Update HANDOFF.md section 6** if test counts change. Verify the header total matches the sum of all rows.
4. **Do not bump spec version numbers** unless explicitly asked to update a spec document.

## 5. Test suite baseline

Current passing totals — update HANDOFF.md section 6 if these change:

| Package | Tests |
|---|---|
| shared/ pure functions | 125 |
| server/ templateService | 42 |
| server/ registryService | 19 |
| server/ registry routes | 17 |
| server/ config route | 11 |
| client/ useTemplateGraphStore | 47 |
| client/ diffRegistry | 34 |
| client/ formatDate | 22 |
| client/ (other) | 9 |
| db/ | 6 |
| Phase 1 E2E (7 files × 3 browsers) | 120 runs |
| Phase 2 E2E (4 files × 3 browsers) | 66 runs |
| Phase 3 E2E (2 files × 3 browsers) | 21 runs |
| **Grand total** | **533** |

If a test run produces a different total, investigate before reporting done.
