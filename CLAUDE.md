# CLAUDE.md — CARO_Platform

## Session Start

1. Always read `Docs/platform_handoff.md` first — it is the platform constitution.
2. Read the relevant app anchor file next:
   - Tag Registry → `apps/tag-registry/CLAUDE.md`
   - MQTT Simulator → `apps/mqtt-simulator/CLAUDE.md`
   - HMI → `apps/caro-hmi/CLAUDE.md`
3. Read platform specs only if the session requires them:
   - DB schema or queries → `Docs/CARO_DB_Spec.md`
   - MQTT message handling → `Docs/CARO_MQTT_Spec.md`
4. Check `Docs/platform_todo.md` — know what is and isn't built before starting.

Do not read specs you do not need. The handoff and delta files are always sufficient for orientation and planning.

---

## Delta File Discipline

Delta files are quick-note trackers for spec divergences that occur during implementation.

- **During a task:** If you implement something that diverges from a spec, add a one-line entry to the relevant delta file immediately. Use the narrowest scope that applies:
  - `Docs/platform_deltas.md` — cross-app changes.
  - `Docs/{app}_deltas.md` — app-level changes (e.g. `hmi_deltas.md`, `tag_registry_deltas.md`, `mqtt_simulator_deltas.md`).
  - `Docs/hmi_trend_viewer_deltas.md` — HMI trend viewer changes (REST endpoint, SnapshotEmitter, CAG migrations, `packages/trend-chart/`). Keeps trend churn out of the general HMI delta file.

  Do not update handoff, bootstrap, or spec docs mid-task.
- **At session end (when explicitly prompted):** Propagate each delta entry to its target doc (spec, handoff, or bootstrap), then delete the entry. The delta file should be empty or near-empty after propagation.
- Delta files are NOT changelogs, NOT TODO lists, NOT implementation notes. One line per divergence, nothing more.

---

## TODO File Discipline

`Docs/platform_todo.md` is the single source of truth for unbuilt but specified features.

- Check it at session start so you know what is and isn't implemented.
- When a TODO item is completed, remove it from the file.
- Do not add design questions or unresolved decisions to the TODO — those belong in the relevant spec's `## Open Questions` section.
- Do not add implementation notes or changelogs to the TODO — those belong in delta files.

---

## Platform Hard Rules

These apply to every app and package in the monorepo:

- **TypeScript:** All code is TypeScript. `tsc --noEmit` must stay clean in every package and app. No JavaScript source files remain.
- **No raw SQL in apps:** All PostgreSQL access via named functions from `@caro/db` only. No direct `pg` imports in any app.
- **No DATABASE_URL:** Use the five `POSTGRES_*` env vars for the main Postgres and the five `TIMESCALE_*` env vars for the historian Postgres, both consumed by `@caro/db`. Never reference `DATABASE_URL`.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error: { code, message } }`. Services throw `Error` with `.code`; never set HTTP status directly.
- **Shared packages first:** Check `packages/ui/` before writing new UI components. Check `packages/server/` before writing new middleware. Do not duplicate what already exists.
- **Reuse before writing:** Before adding a helper, check whether a dependency already in the tree does the job, then check `packages/`. Prefer one call to a library over a hand-rolled equivalent — a helper that duplicates library behaviour drifts from it, and the divergence surfaces far from its cause. When a wrapper is unavoidable, keep it to the part that has no off-the-shelf answer, and say in review why nothing existing sufficed.
- **Style reference:** `apps/tag-registry/` is the convention baseline for all apps — folder structure, component style, error shapes, API patterns.
- **Env files — two layers:** Every server loads env via `loadEnv()` from `@caro/server/env`: its own `server/.env` (app-local) loads first and wins on a conflict; the monorepo root `.env` loads second, filling in only whatever the app-local file (or a value a parent process already injected into `process.env`, e.g. e2e's `globalSetup`) left unset. Project identity and cross-app-must-agree settings (`PROJECT_ROOT`, `POSTGRES_*`, `TIMESCALE_*`) live at root; each app's own settings (`PORT`, `HMI_PORT`, `TEMPLATES_DIR`, `VALIDATE_*`, etc.) live in its own `server/.env`. Never pass `override: true` to `loadEnv()` or any `dotenv.config()` call — that would make the root file authoritative over per-app settings, the opposite of the intended precedence.
- **One change at a time:** Propose with pros/cons before implementing. Do not make multiple unrelated changes in one step.

---

## Session End Checklist

Run this at the end of every session that changed code or behavior:

0. Confirm all delta files were updated during the session — add any missing entries now.
1. Run the full test suite for every affected package — do not close the session with failing tests.
2. When explicitly prompted by the user:
   a. Propagate delta entries to their target docs (spec, handoff, bootstrap).
   b. Remove completed TODO items from `Docs/platform_todo.md`.
   c. Clear propagated delta entries.
3. Commit on `dev` with a clear message.