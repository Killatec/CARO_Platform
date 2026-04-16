# CLAUDE.md — Tag Registry Admin Tool

## Session Start Reads

At session start, read in order:
1. `Docs/tag_registry_handoff.md` — current state, key decisions, gotchas
2. `Docs/tag_registry_deltas.md` — open spec divergences

Read these only if the session requires them:
- UI behavior, validation, or workflow → `Docs/tag_registry_spec.md`
- API endpoints or request/response shapes → `Docs/tag_registry_api_spec.md`
- Component architecture, store behavior, folder structure → `Docs/tag_registry_bootstrap.md`
- Writing or debugging tests → `Docs/tag_registry_test_spec.md`

## App Hard Constraints

- **No URL router:** Never use `page.goto('/registry')` in tests or navigation logic. Use sidebar button clicks only.
- **No mkdir -p in batchSave:** Subdirectories under `templates/` must exist before saving a new template of that type.
- **Shared module:** `apps/tag-registry/shared/` is environment-agnostic — no `fs`, no Express, no DOM. Pure functions only.
- **Env file:** `apps/tag-registry/server/.env` is the authoritative env file. The monorepo root `.env` is never loaded by the server process.

## Test Suite

Run from each subdirectory — there is no root-level vitest config:

cd apps/tag-registry/shared && npx vitest run
cd apps/tag-registry/server && npx vitest run
cd apps/tag-registry/client && npx vitest run
cd apps/tag-registry/e2e && npm run test:chromium

Current baseline: 364 unit (shared 142, client 134, server 88) + 79 E2E (Chromium) = 443 tests, 0 failures.
Note: Firefox and WebKit projects are not passing on this machine (pre-existing environment issue — browsers not installed). Chromium is the reliable baseline.
If a run produces a different total, investigate before reporting done.
