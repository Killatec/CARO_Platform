# CARO_Platform — Platform Handoff
**Updated:** 2026-05-13 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

---

## Apps

| App | API Port | UI Port | Status |
|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete |
| MQTT Simulator | 3002 | 5174 | Active development |
| CARO HMI | 3003 | 5175 | Phase A Steps 1–11 complete. Server core + client shell + demo pages + full trends read + live tail. HmiTagSource publishes 7 Trend_Info observability tags every 250ms. TrendSnapshotScheduler guarantees ≥1 DB row/tag/minute. **Trends API v0.9:** `GET /api/v1/trends/tile` — dispatches on `bucketS` across raw + four CAGs; watermark-aware fall-through; aggregate response includes `bucketSMs`, `responseTailTs`, per-series `min`/`max`; three-case post-pass; future-bucket nulling (buckets past `responseTailTs` nulled server-side via optional `nowMs` argument to `getTrendTile`); `MAX_BUCKET_S=14746` exported from `@caro/db` and enforced at the route via `INVALID_BUCKET_S`; N≤8 cap; optional gzip. **Trend WS channel (Step 11):** SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA messages on shared WS connection; per-client outbox; TREND_FLUSH_HZ=4 Hz flush cadence; synthetic-on-flush events; `setTrendDeltaListener` wires TelemetryIntake to WsServer outbox. **`@caro/trend-chart` package (Step 11):** `useLiveSubscription` (ring buffer TREND_RING_CAPACITY=20 + bucket accumulator for aggregate; raw buffer trimmed to 2×viewportSpanMs; `commitAndDrain` returns void), unified `mergeTrendData` (live-wins-on-coverage, no `isTailing` param), `isTailing` skip guard in `useTrendData`, eviction-on-live-entry cache freshness (`evictAll()` on fixed→tailing, eliminates Gap B), `dispatchModeAction` tailing-exit + live-entry cleanup. **Over-range UX (2026-05-13):** no-clamp wheel-zoom (`clampLowerBound` enforces `from >= 1n` only; span-centering clamp dropped); unified `gatedFetchTile` wrapper in `useTrendData` (all four fetch sites delegate through it; `CLIENT_OVER_RANGE`/`CLIENT_PRE_EPOCH` sentinels); `placeholderData` (`n=2`) rendered behind a single collapsed `<TrendChart>` branch; "Range too wide. Zoom in or pick a smaller preset." renders inline on the right side of the cursor row via `CursorDisplay`'s `rangeExceededMessage` prop (`lineHeight: 16px` pinned, no reflow); pre-epoch tile filter in `tilesForViewport` + `ensureCovered`. LOCF cutoff removed (814ms planning regression eliminated); watermark memoized (30s TTL); raw path unified (UNION ALL). Test coverage: 583 @caro/trend-chart, 67 @caro/hmi-context, 115 @caro/db, 256 server, 33 client. Next: Step 12 — Tag picker drawer. |

---

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL and TimescaleDB access. Exports: `pool`, `query`, `withTransaction`, `ping`, `runMigrations`, `getActiveTags`, `applyRegistryRevision`, `getTagTypes`, `getModuleTypes`, `getRevisions` (main Postgres); `timescalePool`, `pingTimescale`, `runTimescaleMigrations`, `writeTagSamples`, `getTimescaleDatabaseSizeBytes`, `getTrendTile`, `getTrendExtent`, `MAX_BUCKET_S` (TimescaleDB). `getTrendTile(tagIds, startTime, endTime, bucketCount, nowMs?)` is the single trend read entry point — derives `bucketS` internally, dispatches on it across raw + four CAGs, applies watermark-aware fall-through, and nulls aggregate buckets whose `bucketStartMs > BigInt(nowMs ?? Date.now())`; returns a discriminated-union `TrendTile`. `getTrendExtent()` returns hypertable-wide `{ oldestMs: bigint|null, newestMs: bigint|null }`. `MAX_BUCKET_S = 14746` is the canonical span-cap constant (mirrored in `packages/trend-chart/src/level.ts` with a cross-reference comment to avoid pulling pg-runtime into the browser bundle). Integration test helpers at `packages/db/__tests__/helpers/trends-test-range.ts` (sandbox window 1970–1999, `resetTestRange`/`resetTestRangeExpectClean`/`writeTestSamples`/`refreshTestCagg`). Tests use `.ts` extensions; `vitest.config.js` include pattern is `*.test.{js,ts}`. |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`) |
| `@caro/server` | `packages/server/` | Shared Express middleware — asyncWrap, errorHandler |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) |
| `@caro/hmi-context` | `packages/hmi-context/` | HMI React context (tagMap, tagPathIndex, live-value subscriptions), hooks (useLiveValue, useTagWriter, useTagMap, useTagSubtree, useResolveAssetPath), MockHmiProvider |
| `@caro/trend-chart` | `packages/trend-chart/` | Trend chart UI package. Geometry + cache: `level.ts` (alignedTilesInRange, tilesForViewport — tile-grid right-anchor, look-ahead prefetch filter, `startTime < 0n` pre-epoch filter; bucketCount=500/visibleTilesPerWindow=2/overfetchPerSide=1; `bucketSMs === 0n` guard; `MAX_BUCKET_S=14746` and derived `MAX_VIEWPORT_SPAN_MS`), `tileCache.ts` (LRU keyed by tagId+startTime+endTime+bucketCount, 50 MB cap), `colorAssign.ts` (schemeTableau10 ×2). Hooks: `useTrendData` (2-tile visible + 2 prefetch parallelism, ⌈N/8⌉ fan-out, stale-generation guard; `isTailing` skip guard suppresses fetches during tailing + unchanged span + non-empty active set; unified `gatedFetchTile` useCallback wraps all 4 fetch sites with `CLIENT_OVER_RANGE` / `CLIENT_PRE_EPOCH` sentinels; `rangeExceeded` state exposed on hook result; `isViewportOverRange` gates `ensureCovered`; `responseTailTs` field; `evictAll` called on fixed→tailing entry), `useTrendMode` (tailing/fixed mode reducer + hook; `clampLowerBound` enforces `from >= 1n` only — span passes through unchanged on `zoom`/`pan`; `MAX_VIEWPORT_SPAN_MS` cap applied only inside `endPickerCommitted`; `liveClicked` is sole fixed→tailing path; `tick` dispatched by container on TREND_DELTA receipt), `useZoomState` (zoom level state + `computeDragZoomViewport`), `useLiveSubscription` (Step 11: SUBSCRIBE_TREND/UNSUBSCRIBE_TREND lifecycle; ring buffer per tag TREND_RING_CAPACITY=20 + bucket accumulator for aggregate mode; raw buffer per tag trimmed to 2×viewportSpanMs; `commitAndDrain` returns void; boolean coercion in `toNumericValue`), `mergeTrendData` (Step 11: unified coverage rule — live wins on its range, null included; aggregate clips to liveEndIndex, raw drops ts≥minLiveTs entries; no isTailing parameter). Render: `uplotConfig.ts` (always-band 2-series shape; `posToVal` for cursor-time display; bucketSMsKey dep for coverage-check effect), `bandsFromTrendData.ts`. Components: `TrendChartContainer` (stateful wiring; `dispatchModeAction` wrapper for tailing-exit + live-entry cleanup; eviction-on-live-entry; single render branch via `chartData = rangeExceeded ? placeholderData : mergedData`; stable refs updated during render), `TrendChart` (accepts `rangeExceeded` prop; imperative `setScale` effect re-runs when over-range so xScale stays aligned with `modeViewport`), `CursorDisplay` (`rangeExceededMessage` prop renders inline "Range too wide" message on the right side of the cursor row; `lineHeight: 16px` pinned), `SpanPresets`, `EndPicker`, `SpanBucketIndicator`, `Legend`. `axisInteractions.ts` exports 9 pure pan/zoom helpers. Consumed by `apps/caro-hmi/client`. See `Docs/hmi_trend_viewer_handoff.md` for full file map. |
| `@caro/widgets` | `packages/widgets/` | HMI widget components (NumericMon, NumericSet, BooleanMon, BooleanSet, AnalogIn, Timer). Timer is a Set/Mon/Done composite widget. |
| `@caro/tag-registry-shared` | `apps/tag-registry/shared/` | Tag Registry shared validation, types, and utilities. Exports: `validateTemplate`, `validateGraph`, `validateResolvedTags`, `resolveRegistry`, `simulateCascade`, `applyFieldCascade`, `validateParentTypes`, `getModuleNames`, `packedBit`/`setPackedBit`, `ModuleStatus`/`ModuleStatusLabels`. |

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
- **Env files:** each app reads its own `server/.env`. Root `.env` is never seen by app processes.
- **Language:** TypeScript is required for all shared packages (`packages/*`) and all apps. All new code must be TypeScript.
- **Style reference:** `apps/tag-registry/` is the convention baseline for all apps.

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

**Main PostgreSQL (port 5432):** Migrations in `db/postgres/migrations/` — never edit existing, add new only. Applied: `001` `002` `003` `004` `006` `007` `008` `009` `010` `011` `012` `013` `014`. All three servers call `runMigrations()` from `@caro/db` at startup. Advisory lock `pg_advisory_lock(1)` prevents concurrent migration races. Startup sequence: `ping()` → `runMigrations()` → app init. Either step failing causes `process.exit(1)`.

HMI tables (`users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log`) specified in DB Spec §4–§10, not yet migrated.

**TimescaleDB (port 5433, separate container):** Started via `docker-compose.timescale.yml` at the repo root. Development database: `caro_timescale`. Migrations in `db/timescale/migrations/` (`T00N_` prefix). HMI server calls `pingTimescale()` → `runTimescaleMigrations()` at startup (soft-fail — falls back to `NullDbWriter` if unreachable). Applied migrations: `T001_create_tag_samples.sql` (tag_samples hypertable: DOUBLE PRECISION value, `compress_segmentby = tag_id`, `compress_orderby = ts DESC`, retain 14 days); `T004_tighten_compression_policy.sql` (1h chunks, `compress_after = 10 min`, `schedule_interval = 5 min`); `T006_create_cag_1s.sql` through `T009_create_cag_10min.sql` — four CAGs: `tag_samples_1s_cagg` (1s buckets, 14d retention), `tag_samples_10s_cagg` (10s, 90d), `tag_samples_1min_cagg` (1min, 1y), `tag_samples_10min_cagg` (10min, indefinite). All CAGs materialize `last`, `null_count`, `min`, `max` from `tag_samples` (flat topology — each CAG reads raw directly). The 10min CAG uses `start_offset = 1 hour` (vs 15 min on the other three) to satisfy TimescaleDB's 2×bucket_width refresh-window rule. Note: T004 is incompatible with existing 12h chunks — a `TRUNCATE tag_samples` wipe is required before first startup on any environment that ran under T001 settings.

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

**Next priority — Step 12: Tag picker.** Steps 1–11 are complete. Step 11 (live tail) shipped across multiple commits (2026-05-11 through 2026-05-13): dedicated trend WS channel (SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA), `useLiveSubscription` hook (ring buffer TREND_RING_CAPACITY=20 + bucket accumulator for aggregate, raw buffer for raw mode, 2×viewportSpanMs trim, `commitAndDrain` returns void), unified `mergeTrendData` (live-wins-on-coverage, no isTailing parameter), `isTailing` tile-fetch suppression, eviction-on-live-entry cache freshness (Gap B fix), server-side future-bucket nulling in `getTrendTile`, `dispatchModeAction` tailing-exit + live-entry cleanup. Over-range UX (2026-05-13): eviction-on-live-entry, no-clamp wheel-zoom (`clampLowerBound` enforces `from >= 1n` only), unified `gatedFetchTile` over-range / pre-epoch gate, `placeholderData` render, and inline "Range too wide" message in `CursorDisplay` — 583 `@caro/trend-chart` + 67 `@caro/hmi-context` + 115 `@caro/db` tests. Step 12 wires the tag picker drawer (tree + search + multi-select commit + trendable filter). See `Docs/hmi_trend_viewer_handoff.md` for full subsystem detail. Full TODO list in `Docs/platform_todo.md`.

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
| HMI Trend Viewer Spec Delta | `hmi_trends_deltas.md` |
| HMI Trends Perf Test Spec | `hmi_trends_perf_test_spec.md` |
| HMI Bootstrap | `hmi_bootstrap.md` |
