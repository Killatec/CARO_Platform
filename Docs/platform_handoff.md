# CARO_Platform — Platform Handoff
**Updated:** 2026-09-22 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

---

## Apps

| App | API Port | UI Port | Status |
|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete |
| MQTT Simulator | 3002 | 5174 | Active development |
| CARO HMI | 3003 | 5175 | Phase A Steps 1–12 complete. Server core + client shell + demo pages + full trends read + live tail + tag picker. HmiTagSource publishes 7 Trend_Info observability tags every 250ms. TrendSnapshotScheduler guarantees ≥1 DB row/tag/minute. **Trends API v0.9:** `GET /api/v1/trends/tile` — dispatches on `bucketS` across raw + four CAGs; watermark-aware fall-through; aggregate response includes `bucketSMs`, `committedThroughTs`, per-series `min`/`max`; three-case post-pass; future-bucket nulling (buckets past `committedThroughTs` nulled server-side via `nowMs` from `DbPipeline` watermark); `MAX_BUCKET_S=14746` exported from `@caro/db` and enforced at the route via `INVALID_BUCKET_S`; N≤8 cap; optional gzip. **Trend WS channel (Step 11):** SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA messages on shared WS connection; per-client outbox; TREND_FLUSH_HZ=4 Hz flush cadence; synthetic-on-flush events; `setTrendDeltaListener` wires TelemetryIntake to WsServer outbox. **`@caro/trend-chart` package (Step 11 + unified-tile refactor + unified-viewport arc + Step 12):** `useLiveSubscription` (ring buffer TREND_RING_CAPACITY=20 + bucket accumulator for aggregate; raw buffer trimmed to 2×viewportSpanMs; `drainBuffers` clears accumulator/raw/HWM, NOT ring), unified `mergeTrendData` (live-wins-on-coverage, no `isTailing` param), terminal-cache rule (non-terminal tiles held in `activeTilesRef`, never enter LRU — eliminates Gap B), `dispatchModeAction` live-exit drain only (no eviction on live-entry). **Tag Picker (Step 12):** gear icon in Legend `<thead><th>` opens modal; flat alphabetical trendable-tag list (left pane) + Trending list (right pane); click-to-stage, × to unstage, search filter, 16-tag stage cap; OK commits to `setTagIds`. **Over-range UX (2026-05-13):** no-clamp wheel-zoom (`clampLowerBound` enforces `from >= 1n` only; span-centering clamp dropped); unified `gatedFetchTile` wrapper in `useTrendData` (all four fetch sites delegate through it; `CLIENT_OVER_RANGE`/`CLIENT_PRE_EPOCH` sentinels); `placeholderData` (`n=2`) rendered behind a single collapsed `<TrendChart>` branch; "Range too wide. Zoom in or pick a smaller preset." renders inline on the right side of the cursor row via `CursorDisplay`'s `rangeExceededMessage` prop (`lineHeight: 16px` pinned, no reflow); pre-epoch tile filter in `tilesForViewport`. LOCF cutoff removed (814ms planning regression eliminated); watermark memoized (30s TTL); raw path unified (UNION ALL). **Audit remediation pass (2026-05-15 → 2026-05-17):** all items from the May 2026 trend-viewer audit landed. Key architectural change: **M1 metadata-as-return-value** — `getTrendTile()` returns `Promise<{ tile, meta }>` with per-segment `source`/`rangeStartMs`/`rangeEndMs`/`rowCount`/`dbElapsedMs` in `meta.segments[]` (subsumes the deleted `__test_lastUsedSources` singleton); structured `[db] getTrendTile` summary log gated by `TIMESCALE_LOG_TILE_QUERIES=1` reads from `meta`. Operational hardening: F5 per-tag trend-outbox cap (`MAX_TREND_OUTBOX_PER_TAG=500`, drop-oldest + batched warn); TG-7 `commitAndDrain` bug fix (in-place array reset + explicit `setTail(null)`); TG-1 EXPLAIN-based regression test guarding bounded-prev chunk pruning. R3 consolidated the two near-duplicate gapfill+locf SQL templates into a single `buildGapfillSql(opts)` builder with byte-equivalence snapshot test. R1 extracted `dropSeamDuplicates` / `nullFutureBuckets` as pure helpers. Test coverage: 815 @caro/trend-chart, 67 @caro/hmi-context, 156 @caro/db, 301 server, 33 client. **2026-06-02:** `POST /api/v1/commands` — module-type-agnostic command send; `CmdController.sendCommand()` dispatches MQTT (fire + CMD_ACK await, 1s timeout, `pendingVoid` map) and HMI (RESET only); `useCommandSender` hook in `@caro/hmi-context`; `PoleCommandsBox` buttons on Pole demo page. Null-LKV write guard removed from `NumericSet`/`BooleanSet` — null quality no longer blocks setpoint writes. **Multi-system UI selection (2026-09-22):** `GET /api/v1/config` → `{ projectRoot: string \| null }` (server, no `databaseName`, no auth check); `@caro/hmi-context` fetches it alongside `/tags` on mount (single `tagMapLoaded` flip via `Promise.all`), exposes it via `useProjectRoot()`, and gained `scopedStorage.ts` (`scopedKey`/`useScopedKey`, `caro.<projectRoot>.<name>` keys, `unknown`-namespace fallback on a null root); `@caro/trend-chart` session persistence gained a `storageScope` param (`TrendChartContainer` prop, default `'default'`) so a trend-viewer session never leaks between systems; client gained `hmi-definitions/registry.ts` (explicit static map of `PROJECT_ROOT` → dynamic `import()`, confirmed per-system code-splitting) and a `Narya1` page tree (System Overview from `shared/` boxes + the two Dev pages, reused directly from `demo/pages/`); `Shell.tsx` resolves `validIds`/initial-id from the loaded tree at runtime (moved out of module scope) via `useProjectRoot()` → registry → dynamic import — an unregistered or null root renders NavTree's existing empty state, never a silent fallback to `demo`; `Header.tsx` badge shows `projectRoot`. Test coverage refreshed: 801 @caro/trend-chart, 80 @caro/hmi-context, 156 @caro/db, 286 server, 45 client. |

---

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL and TimescaleDB access. Exports: `pool`, `query`, `withTransaction`, `ping`, `runMigrations`, `getActiveTags`, `applyRegistryRevision`, `getTagTypes`, `getModuleTypes`, `getRevisions` (main Postgres); `timescalePool`, `pingTimescale`, `runTimescaleMigrations`, `writeTagSamples`, `getTimescaleDatabaseSizeBytes`, `getTrendTile`, `getTrendExtent`, `MAX_BUCKET_S` (TimescaleDB). `getTrendTile(tagIds, startTime, endTime, bucketCount, nowMs?)` is the single trend read entry point — derives `bucketS` internally, dispatches on it across raw + four CAGs, applies watermark-aware fall-through, and nulls aggregate buckets whose `bucketStartMs > BigInt(nowMs ?? Date.now())`; returns a discriminated-union `TrendTile`. `getTrendExtent()` returns hypertable-wide `{ oldestMs: bigint|null, newestMs: bigint|null }`. `MAX_BUCKET_S = 14746` is the canonical span-cap constant (mirrored in `packages/trend-chart/src/level.ts` with a cross-reference comment to avoid pulling pg-runtime into the browser bundle). Integration test helpers at `packages/db/__tests__/helpers/trends-test-range.ts` (sandbox window 1970–1999, `resetTestRange`/`resetTestRangeExpectClean`/`writeTestSamples`/`refreshTestCagg`). Tests use `.ts` extensions; `vitest.config.js` include pattern is `*.test.{js,ts}`. |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`). Modal primitive accepts optional `outerStyle` / `headerStyle` / `bodyStyle` inline-style props (CSSProperties) for consumers that prefer inline-style chrome over the default Tailwind className approach. |
| `@caro/server` | `packages/server/` | Shared Express middleware — `asyncWrap`, `errorHandler` — plus `./env`: `loadEnv()` (two-layer app-local/root env loading) and `findWorkspaceRoot()` (monorepo-root discovery by walking up for a `package.json` with a `"workspaces"` key). |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) |
| `@caro/hmi-context` | `packages/hmi-context/` | HMI React context (tagMap, tagPathIndex, live-value subscriptions, `projectRoot`), hooks (useLiveValue, useTagWriter, useTagMap, useTagSubtree, useResolveAssetPath, useCommandSender, useProjectRoot, useScopedKey), MockHmiProvider. `TagDef` carries `tag_name: string|null`, `format: string|null`, and `trendable: boolean` plumbed from tag_registry. `useCommandSender` returns `{ send(moduleId, cmdStr), isPending(moduleId, cmdStr), error(moduleId, cmdStr) }` — calls `POST /api/v1/commands`; module-type agnostic. `MockHmiProvider` accepts optional `onSendCommand` prop and a `projectRoot` prop (default `'test'`). `useLiveValue`/`subscribeLiveValue` accept `tagId: number \| undefined` — `undefined` (an asset path that legitimately doesn't resolve) is a non-event: no subscriber registered, no wire traffic, returns `{ value: null }`. `getLiveValue`'s signature is unchanged; the `undefined` guard lives in `useLiveValue`'s `useState` initializer. **`projectRoot` (2026-09-22):** `HmiContextProvider` fetches `GET /api/v1/config` in parallel with `/tags` on mount — one `Promise.all`, one `tagMapLoaded` flip; a `/config` failure follows the same catch-and-continue as a `/tags` failure (`projectRoot = null`, app still renders). `useProjectRoot()` reads it off context. `scopedStorage.ts` exports pure `scopedKey(projectRoot, name)` and `useScopedKey(name)`, building `caro.<projectRoot>.<name>` localStorage keys with an `unknown`-namespace fallback on a null root (chosen over disabling persistence, so a transient `/config` gap doesn't cost a user their restored session state). |
| `@caro/trend-chart` | `packages/trend-chart/` | Trend chart UI package. Geometry + cache: `level.ts` (alignedTilesInRange, tilesForViewport — tile-grid left-anchor, explicit `tileSpanMs`, variable 2–4 visible tiles covering full viewport, `MAX_VISIBLE_TILES=16` defense-in-depth cap, `startTime < 0n` pre-epoch filter; bucketCount=500/visibleTilesPerWindow=2/overfetchPerSide=1; `bucketSMs === 0n` guard; `MAX_BUCKET_S=14746` and derived `MAX_VIEWPORT_SPAN_MS`), `tileCache.ts` (LRU keyed by tagId+startTime+endTime+bucketCount, 50 MB cap), `colorAssign.ts` (schemeTableau10 ×2). Hooks: `useTrendData` (tile-aligned fetch pipeline driven by `modeViewport` + explicit `bucketSMs`; ⌈N/8⌉ fan-out, stale-generation guard; terminal-cache rule: non-terminal tiles held in `activeTilesRef`, never cached (eliminates Gap B); unified `gatedFetchTile` useCallback with `CLIENT_OVER_RANGE` / `CLIENT_PRE_EPOCH` sentinels; `committedThroughTs` field; `invalidateNonTerminalTiles` callback; 2s live heartbeat), `useTrendMode` (three-state fixed/live-trailing/live-fixed mode reducer + hook; `clampLowerBound` enforces `from >= 1n` only — span passes through unchanged on `zoom`/`pan`; `MAX_VIEWPORT_SPAN_MS` cap applied only inside `endPickerCommitted`; `liveClicked` enters live-trailing; `tick` dispatched by container on TREND_DELTA receipt), `useZoomState` (render-time non-zoom resolution derivation, sticky `gestureBucketSMs` only during `lastIntent='zoom'`; exports `computeDragZoomViewport`), `useLiveSubscription` (SUBSCRIBE_TREND/UNSUBSCRIBE_TREND lifecycle; ring buffer per tag TREND_RING_CAPACITY=20 + bucket accumulator for aggregate mode; raw buffer per tag trimmed to 2×viewportSpanMs; `drainBuffers` clears accumulator/raw/HWM but NOT ring; boolean coercion in `toNumericValue`), `mergeTrendData` (Step 11: unified coverage rule — live wins on its range, null included; aggregate clips to liveEndIndex, raw drops ts≥minLiveTs entries; no isTailing parameter). Render: `uplotConfig.ts` (always-band 2-series shape; `posToVal` for cursor-time display; bucketSMsKey dep for coverage-check effect), `bandsFromTrendData.ts`. Components: `TrendChartContainer` (stateful wiring; `dispatchModeAction` wrapper — drains buffers on live-exit, no eviction; single render branch via `(uxRangeExceeded || uxRangeTooNarrow || tagIds.length === 0) ? placeholderData : mergedData`; `commitTagIds` is the sole `tagIds` mutation entry point — calls `invalidateNonTerminalTiles()` before `setTagIds()` (modal OK + legend remove both use it); `lastChartDataRef` bridges data across transitions; stable refs updated during render; passes `bucketSMs`/`lastFetchMs` to `TrendChart` — no `cursorTsMs` state; owns `isPickerOpen` state + `<TagPickerModal>` sibling), `TrendChart` (accepts `rangeExceeded`, `bucketSMs`, `lastFetchMs` props; forwards bucket/fetch to `Legend`; `Legend` rendered unconditionally — `tagIds=[]` still shows Signals header + gear; `containerRef` div always carries `style={{ height }}` to preserve plot-area footprint when uPlot is absent; imperative `setScale` effect re-runs when over-range), `CursorDisplay` (range-message-only bar above footer; `rangeMessage` prop renders "Range too wide / too narrow" in red; `lineHeight: 16px` pinned; cursor row is now in `Legend`), `SpanPresets`, `EndPicker`, `SpanIndicator` (footer span only), `BucketFetchIndicator` (legend-strip bucket+fetch), `SpanBucketIndicator` (kept for backward-compat), `Legend` (cursor row + value header + 5-col `<table>` with `<thead><th colSpan={5}>` Signals header + gear button; all labels unified at 12px/#374151/monospace/lineHeight 16px), `TagPickerModal` (Step 12: content-sized modal; flat alphabetical trendable-tag list left pane + Trending right pane; pane width = max(MIN_PANE_PX, longest tag_name × FONT_WIDTH_PX + PANE_PADDING_PX); 16-tag stage cap; inline-style chrome via @caro/ui Modal outerStyle/headerStyle/bodyStyle). `uplotConfig.ts` constants: `Y_AXIS_SIZE_PX=60` (fixed axis width), `Y_AXIS_LABEL_SIZE_PX=16` (label area always reserved; label=`' '` when unit absent). `axisInteractions.ts` exports 9 pure pan/zoom helpers. **Session persistence (post-Phase A):** `sessionPersistence.ts` stores tagIds, Y-scale overrides, selectedTagId, sizeMs, mode, and toMs in localStorage under `caro.<storageScope>.trend-viewer.session.${persistKey}`; restores on mount with trendable-set filtering and live-fixed→live-trailing reconciliation when now ≥ savedToMs. Opt-in via the `persistKey` prop on `TrendChartContainer`. **`storageScope` (2026-09-22):** `loadSession`/`saveSession`/`clearSession` take a leading `scope` param; `useSessionPersistence` and `TrendChartContainer` (prop, default `'default'`) thread it through so a session never leaks between systems. The package stays platform-ignorant — it takes the scope string as given and never resolves `PROJECT_ROOT` itself; `apps/caro-hmi/client` passes `storageScope={useProjectRoot() ?? 'unknown'}`. Consumed by `apps/caro-hmi/client`. See `Docs/hmi_trend_viewer_handoff.md` for full file map. |
| `@caro/widgets` | `packages/widgets/` | HMI widget components (NumericMon, NumericSet, BooleanMon, BooleanSet, AnalogIn, Timer). Timer is a Set/Mon/Done composite widget. `SpectrumChart` — generic `number[]`-tag uPlot line chart (bin-index X axis, no frequency mapping); fixed explicit size (default 640×320, controlled `width`/`height` props, no `ResizeObserver`); `yMin`/`yMax` props (default 0–1000, fixed range — no `eng_min`/`eng_max` to derive one from); drag-to-zoom on both axes via a custom `setSelect` hook + ref-backed scale `range` functions (mirrors `@caro/trend-chart`'s pattern; native `cursor.drag.setScale` disabled), double-click resets to full range. Adds `uplot` as a direct dependency plus a `src/css.d.ts` ambient `*.css` module declaration. Live data flows through the existing generic LKV/WS/`useLiveValue` pipeline — no server-side work needed. |
| `@caro/tag-registry-shared` | `apps/tag-registry/shared/` | Tag Registry shared validation, types, and utilities. Exports: `validateTemplate`, `validateGraph`, `validateResolvedTags`, `resolveRegistry`, `simulateCascade`, `applyFieldCascade`, `validateParentTypes`, `getModuleNames`, `packedBit`/`setPackedBit`, `ModuleStatus`/`ModuleStatusLabels`. |

**Build-then-consume packages — `dist/` is gitignored.** `@caro/server`, `@caro/db`, `@caro/tag-registry-shared` (and others) resolve at runtime via their `dist/` output (`main`/`exports` point there), not their `src/`. Pulling changes to one of these packages without running its `build` script gets you a missing export or a missing constant at **runtime**, not a compile error — e.g. `@caro/server`'s `./env` subpath export and `@caro/tag-registry-shared`'s `PROJECT_ROOT_MISMATCH` error code were both added in the multi-project work above and require `npm run build` in that package before any app sees them.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, React Context (@caro/hmi-context) |
| Backend | Node.js + Express |
| Database | PostgreSQL via `@caro/db` |
| Messaging | Mosquitto v5 — TCP 1883, WS 8080 |
| Language | TypeScript — all packages and all apps. No JavaScript source files remain. |
| Packages | npm workspaces |

---

## Platform Rules

- **No raw SQL in apps.** All PostgreSQL access via named functions from `@caro/db` only. No direct `pg` imports in any app.
- **No DATABASE_URL.** Use five `POSTGRES_*` env vars for main Postgres and five `TIMESCALE_*` env vars for historian Postgres; both consumed by `@caro/db`. Never reference `DATABASE_URL`.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error: { code, message } }`. Services throw `Error` with `.code`; never set HTTP status directly.
- **Env files — two layers:** every server loads env via `loadEnv()` from `@caro/server/env`: its own `server/.env` (app-local) loads first and wins on a conflict; the monorepo root `.env` loads second, filling in only what's still unset (or what a parent process already injected into `process.env`, e.g. e2e's `globalSetup`). Project identity and cross-app-must-agree settings (`PROJECT_ROOT`, `POSTGRES_*`, `TIMESCALE_*`) live at root; each app's own settings live in its own `server/.env`. Never pass `override: true`.
- **Language:** TypeScript is required for all shared packages (`packages/*`) and all apps. All new code must be TypeScript.
- **Style reference:** `apps/tag-registry/` is the convention baseline for all apps.
- **TagDef field consumption:** Consume `TagDef.{unit, eng_min, eng_max, format, tag_name, trendable}` directly. Never walk `meta` for these fields — `resolveRegistry` applies type-aware gating (e.g., suppressing unit/eng_min/eng_max on Booleans). Use `meta` only for structural data (e.g., `module_id`). This applies everywhere: `loadTagMap`, `resolveFormat`, any widget/hook reading tag metadata.

---

## Branching

| Branch | Rule |
|---|---|
| `main` | Stable releases only |
| `dev` | Integration — all work merges here |
| `feature/*` | One branch per feature, PR into `dev` |

---

## Database

Schema spec: `Docs/CARO_DB_Spec.md`

**Main PostgreSQL (port 5432):** Migrations in `db/postgres/migrations/` — never edit existing, add new only. Applied: `001` `002` `003` `004` `006` `007` `008` `009` `010` `011` `012` `013` `014` `015` `016`. All three servers call `runMigrations()` from `@caro/db` at startup. Advisory lock `pg_advisory_lock(1)` prevents concurrent migration races. Startup sequence: `ping()` → `runMigrations()` → app init. Either step failing causes `process.exit(1)`.

HMI tables: `pending_setpoint_values` migrated (016) — no `set_by` FK to `users` yet (nullable stub; auth not built). `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `system_settings`, `audit_log` remain specified in DB Spec §4–§10, not yet migrated.

**TimescaleDB (port 5433, separate container):** Started via `docker-compose.timescale.yml` at the repo root. Development database: `caro_timescale`. Migrations in `db/timescale/migrations/` (`T00N_` prefix). HMI server calls `pingTimescale()` → `runTimescaleMigrations()` at startup (soft-fail — falls back to `NullDbWriter` if unreachable). Applied migrations: `T001_create_tag_samples.sql` (tag_samples hypertable: DOUBLE PRECISION value, `compress_segmentby = tag_id`, `compress_orderby = ts DESC`, retain 14 days); `T004_tighten_compression_policy.sql` (1h chunks, `compress_after = 10 min`, `schedule_interval = 5 min`); `T006_create_cag_1s.sql` through `T009_create_cag_10min.sql` — four CAGs: `tag_samples_1s_cagg` (1s buckets, 14d retention), `tag_samples_10s_cagg` (10s, 90d), `tag_samples_1min_cagg` (1min, 1y), `tag_samples_10min_cagg` (10min, indefinite). All CAGs materialize `last`, `null_count`, `min`, `max` from `tag_samples` (flat topology — each CAG reads raw directly). The 10min CAG uses `start_offset = 1 hour` (vs 15 min on the other three) to satisfy TimescaleDB's 2×bucket_width refresh-window rule. Note: T004 is incompatible with existing 12h chunks — a `TRUNCATE tag_samples` wipe is required before first startup on any environment that ran under T001 settings.

**Trap: changing `TIMESCALE_DATABASE` and restarting the container does not create a second historian database.** `docker-compose.timescale.yml` substitutes `${TIMESCALE_DATABASE:-caro_timescale}` into `POSTGRES_DB`, and Compose reads the root `.env` for this by its own convention (separate from `loadEnv()` — Compose has no knowledge of the app's env-loading code at all). The Postgres image only runs its `POSTGRES_DB`-creation logic when the data directory is **empty** on container start, and `timescale-data/` (the volume this compose file mounts) is not empty once `caro_timescale` has ever been initialized. So pointing `TIMESCALE_DATABASE` at a new name and restarting silently keeps using the existing database underneath — the new database must be created explicitly, e.g. `CREATE DATABASE <name>;` against the running container, before an app pointed at it will find anything (or fail to connect at all, since it doesn't exist).

---

## Multi-Project Model

CARO_Platform holds one tag registry per **project** — a project is a `PROJECT_ROOT` template name (e.g. `CARO_1`) paired with its own Postgres database and its own TimescaleDB database. **One project is live at a time**; switching projects means editing the root `.env` (`PROJECT_ROOT`, `POSTGRES_DATABASE`, `TIMESCALE_DATABASE`, and any other connection settings that differ) and restarting all three servers. Apps connect to their databases at startup and never change target at runtime — there is no live project-switch.

**`PROJECT_ROOT` lives in the root `.env`** (see Platform Rules → Env files, two layers) and does three things:
- Gates `POST /api/v1/registry/apply` in the tag-registry server: unset/empty refuses every apply, `*` allows any root (used by the e2e suite, which applies dynamically-named roots per test), any other value allows only an exact match. Rejection is `PROJECT_ROOT_MISMATCH`, HTTP 403.
- Surfaces on the Tag Registry client's Registry and History pages as a quiet connection indicator, alongside the configured database name (`GET /api/v1/config` → `databaseName`, `projectRoot`).
- Selects the HMI client's page tree and namespaces its localStorage. The HMI server's own `GET /api/v1/config` serves `projectRoot` only (no `databaseName` — HMI auth is stubbed). `@caro/hmi-context`'s `useProjectRoot()` exposes it; `client/src/hmi-definitions/registry.ts` maps a registered root to a dynamic-imported page tree (unregistered root, including unset, renders the NavTree empty state — no fallback to `demo`); `scopedKey(projectRoot, name)` namespaces localStorage as `caro.<projectRoot>.<name>` (falls back to the `unknown` namespace on a null root). See `Docs/multi_project_runbook.md` §4.

**Why the gate exists:** `applyRegistry()` resolves the subtree under the `rootName` passed to it, then calls `getActiveTags()` — unfiltered across the whole `tag_registry` table — and retires every tag whose `tag_path` is absent from that resolved set. Applying the wrong root against a project's database would retire that project's entire registry; re-applying the correct root afterwards would then reissue every tag_id, because retired paths come back classified as added (see `applyRegistry` in `apps/tag-registry/server/src/services/registryService.ts`). `registry_revisions` has no root column at all, so a database's revision history is already implicitly the history of exactly one root, forever — the gate makes that unstated invariant explicit and enforced instead of leaving it to operator discipline.

**Selecting and authoring any root in the client stays unrestricted** — the root dropdown and template editing are unaffected. Only the apply action is gated, both client-side (Update DB button disabled with an explanatory tooltip naming the configured `PROJECT_ROOT` and the selected root) and server-side (the load-bearing check — the client is the only in-repo caller of `/registry/apply` today, but curl or a future provisioning script would bypass client-side disabling entirely).

**Creating a new project (a second `PROJECT_ROOT`, its databases, and its templates) is a future external script, not a feature of any app.** Not yet built.

---

## Pre-HMI Tasks

### Shared Package TypeScript Migration (required before HMI scaffolding)
Migrate in this order:
1. ✓ `@caro/db` — typed query functions
2. ✓ `@caro/server` — asyncWrap, errorHandler
3. ✓ `@caro/ui` — primitives and tokens
4. ✓ apps/tag-registry — server, client, shared migrated to TypeScript
5. ✓ apps/mqtt-simulator — server and client migrated to TypeScript

Then scaffold new TypeScript packages:
6. ✓ `@caro/hmi-context` — HmiContextProvider, useLiveValue, useTagWriter, useTagMap, useTagSubtree, useResolveAssetPath, MockHmiProvider
7. ✓ `@caro/widgets` — NumericMon, NumericSet, BooleanMon, BooleanSet
8. ✓ `apps/caro-hmi/server` — LKV cache, MQTT bridge, WebSocket server, DB pipeline placeholder, Express shell

---

## Key Documents

| Document | Path |
|---|---|
| Platform Spec Delta | `docs/platform_deltas.md` |
| DB Spec | `docs/CARO_DB_Spec.md` |
| MQTT Spec | `docs/CARO_MQTT_Spec.md` |
| @caro/db Handoff | `Docs/db_handoff.md` |
| Tag Registry Handoff | `Docs/tag_registry_handoff.md` |
| MQTT Simulator Handoff | `Docs/mqtt_simulator_handoff.md` |

---

## Open TODOs

Phase A Steps 1–12 complete (including tag picker). Next priority TBD. See `Docs/platform_todo.md` for the current open items list and `Docs/hmi_trend_viewer_handoff.md` for full trend viewer subsystem detail.

---

## Documentation

All platform and app documentation consolidated to `C:\KillaTec\CARO_Platform\Docs\` as of 2026-04-07.

| Document | File |
|---|---|
| Platform Handoff | `platform_handoff.md` |
| Platform Spec Delta | `platform_deltas.md` |
| DB Spec | `CARO_DB_Spec.md` |
| MQTT Spec | `CARO_MQTT_Spec.md` |
| @caro/db Handoff | `db_handoff.md` |
| Tag Registry Handoff | `tag_registry_handoff.md` |
| Tag Registry Spec Delta | `tag_registry_deltas.md` |
| Tag Registry Functional Spec | `tag_registry_spec.md` |
| Tag Registry API Spec | `tag_registry_api_spec.md` |
| Tag Registry Bootstrap | `tag_registry_bootstrap.md` |
| Tag Registry Test Spec | `tag_registry_test_spec.md` |
| MQTT Simulator Handoff | `mqtt_simulator_handoff.md` |
| MQTT Simulator Spec Delta | `mqtt_simulator_deltas.md` |
| MQTT Simulator Bootstrap | `mqtt_simulator_bootstrap.md` |
| HMI Functional Spec | `hmi_functional_spec.md` |
| HMI API Spec | `hmi_API_spec.md` |
| HMI Widget Spec | `hmi_widget_spec.md` |
| HMI Trend Viewer Spec | `hmi_trend_viewer_spec.md` |
| HMI Trend Viewer Handoff | `hmi_trend_viewer_handoff.md` |
| HMI Trend Viewer Spec Delta | `hmi_trend_viewer_deltas.md` |
| HMI Trends Perf Test Spec | `hmi_trends_perf_test_spec.md` |
| HMI Bootstrap | `hmi_bootstrap.md` |
