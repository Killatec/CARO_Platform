# CLAUDE.md — Tag Registry Admin Tool

This file is read automatically by Claude Code at the start of every session.
Follow these instructions before doing anything else.

## 1. Session start reads

Read once at session start:

1. `apps/tag-registry/Docs/tag_registry_handoff.md` — project orientation, current state, known gotchas
2. `apps/tag-registry/Docs/tag_registry_deltas.md` — where the implementation diverges from the specs

App-level specs — read once if your session involves:
- UI behavior, validation rules, or workflow logic → `tag_registry_spec.md`
- API endpoints or request/response shapes → `tag_registry_api_spec.md`
- Component architecture, store behavior, or folder structure → `tag_registry_bootstrap.md`
- Writing or debugging tests → `tag_registry_test_spec.md`

## 2. Spec routing — read only what the task requires

Spec documents and when to use them: see `apps/tag-registry/Docs/tag_registry_handoff.md` §5

Do not read specs you do not need. tag_registry_handoff.md and tag_registry_deltas.md are always sufficient for orientation and planning tasks.

## 3. Hard constraints

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
2. **Do not bump spec version numbers** unless explicitly asked to update a spec document.

## 5. Test suite baseline

Test counts and locations: see `apps/tag-registry/Docs/tag_registry_handoff.md` §6

If a test run produces a different total, investigate before reporting done.
