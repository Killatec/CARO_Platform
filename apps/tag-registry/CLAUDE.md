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
- **Flat templates folder:** All templates live directly in `templates/` — no subdirectories. `batchSave` writes `{template_name}.json` at the root of `TEMPLATES_DIR`. Do not create or reference subdirectories.
- **Shared module:** `apps/tag-registry/shared/` is environment-agnostic — no `fs`, no Express, no DOM. Pure functions only.
- **Env files — two layers:** The server loads env in two layers via `loadEnv()` from `@caro/server/env`: `apps/tag-registry/server/.env` (app-local) loads first and wins on a conflict; the monorepo root `.env` loads second, filling in only whatever the app-local file (or a value already injected into `process.env` by a parent process, e.g. e2e's `globalSetup`) left unset. Project identity and cross-app-must-agree settings (`PROJECT_ROOT`, `POSTGRES_*`, `TIMESCALE_*`) live at root; this app's own settings (`PORT`, `TEMPLATES_DIR`, `VALIDATE_*`) live in the app-local file. Never pass `override: true` when loading either — that would make the root file authoritative over per-app settings, the opposite of the intended precedence.

## Test Suite

Run from each subdirectory — there is no root-level vitest config:

cd apps/tag-registry/shared && npx vitest run
cd apps/tag-registry/server && npx vitest run
cd apps/tag-registry/client && npx vitest run
cd apps/tag-registry/e2e && npm run test:chromium

Current baseline: 534 unit (shared 241, client 173, server 120) + 92 E2E (Chromium) = 626 tests, 0 failures.
Note: Firefox and WebKit projects are not passing on this machine (pre-existing environment issue — browsers not installed). Chromium is the reliable baseline.
If a run produces a different total, investigate before reporting done.
