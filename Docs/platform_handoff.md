# CARO_Platform — Platform Handoff
**Updated:** 2026-05-05 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

---

## Apps

| App | API Port | UI Port | Status |
|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete |
| MQTT Simulator | 3002 | 5174 | Active development |
| CARO HMI | 3003 | 5175 | Phase A Steps 1–10 complete. Server core + client shell + demo pages + full trends read path + interactive trend chart with mode state machine and time-range UI. HmiTagSource publishes 7 Trend_Info observability tags (Trending, Queue_Depth, Rows_Per_Sec, Flush_ms, Dropped_Pkgs, Error_Count, DB_Size) every 250ms via DbPipeline (peek-then-consume, 500ms tick); NullDbWriter fallback at boot; TimescaleSizeMonitor every 30s. TrendSnapshotScheduler guarantees ≥1 DB row/tag/minute via piggyback or force-write. **Trends API v0.8 (min/max bands):** `GET /api/v1/trends/tile` — v0.5+ wire contract (`tag_ids`, `start_time`, `end_time`, `bucket_count`); dispatches on derived `bucketS` (internal float seconds) across raw + four CAGs (1s/10s/1min/10min) all with `null_count`/`min`/`max` columns; watermark-aware fall-through with recursive descent (`source: 'mixed'` on stitch); aggregate response includes `bucketSMs` (integer milliseconds) and per-series `min`/`max` arrays alongside `value`; three-case post-pass: mixed-null → null, empty-bucket → collapse to LOCF'd last × 3, normal → `last`/`bucket_min`/`bucket_max`; raw responses carry no `min`/`max`; N≤8 cap enforced; optional gzip via `HMI_TRENDS_GZIP`. `GET /api/v1/trends/extent` — hypertable-wide min/max ts. `GET /api/v1/tags/trendable` — trendable tag list. Dev perf test page at `#dev-trends-perf` sweeps all 9 CAG dispatch zones with client-observed latency. **`@caro/trend-chart` package** ships: `TrendChartContainer` (stateful wiring layer: mode + zoom + fetch + footer components), `TrendChart` (uPlot canvas wrapper, stepped interpolation, per-trace Y-scales, X-scale preservation across rebuilds), `SpanPresets` (8-preset strip: 1m/5m/15m/1h/4h/24h/7d/14d), `EndPicker` (End datetime picker + Live/Go Live button), `SpanBucketIndicator`, `Legend` (vertical right column); hooks `useTrendData`, `useTrendMode` (tailing/fixed state machine, liveClicked is sole fixed→tailing path), `useZoomState`; `axisInteractions.ts` (pure pan/zoom helpers); cache/geometry primitives (`level.ts`, `tileCache.ts`, `colorAssign.ts`). Dev test page at `/dev/trend-chart-test`. LOCF cutoff query (`MAX(ts)`) removed — was paying 814ms planning per CAG request; LOCF now unbounded (dead-tag detection deferred, see handoff TODO). Watermark lookups memoized with 30s TTL + in-flight dedup — cold `cagg_watermark()` catalog queries were paying 130–300ms per tile in boundary-crossing batches; memoization collapses the batch to one catalog round-trip. Raw path unified into a single SQL query (UNION ALL with `is_in_window` discriminant; one connection per tile, was 2). Boundary-crossing CAG latency dropped from 1000–1500ms to <100ms via combined LOCF-cutoff removal and watermark memoization. Test coverage: 445 @caro/trend-chart, 109 @caro/db, 236 server (unit + integration + E2E), 33 client. Next: Step 11 — Live tail (WS bucket accumulator). |

---

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL and TimescaleDB access. Exports: `pool`, `query`, `withTransaction`, `ping`, `runMigrations`, `getActiveTags`, `applyRegistryRevision`, `getTagTypes`, `getModuleTypes`, `getRevisions` (main Postgres); `timescalePool`, `pingTimescale`, `runTimescaleMigrations`, `writeTagSamples`, `getTimescaleDatabaseSizeBytes`, `getTrendTile`, `getTrendExtent` (TimescaleDB). `getTrendTile(tagIds, startTime, endTime, bucketCount)` is the single trend read entry point — derives `bucketS` internally, dispatches on it across raw + four CAGs, applies watermark-aware fall-through; returns a discriminated-union `TrendTile`. `getTrendExtent()` returns hypertable-wide `{ oldestMs: bigint|null, newestMs: bigint|null }`. Integration test helpers at `packages/db/__tests__/helpers/trends-test-range.ts` (sandbox window 1970–1999, `resetTestRange`/`resetTestRangeExpectClean`/`writeTestSamples`/`refreshTestCagg`). Tests use `.ts` extensions; `vitest.config.js` include pattern is `*.test.{js,ts}`. |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`) |
| `@caro/server` | `packages/server/` | Shared Express middleware — asyncWrap, errorHandler |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) |
| `@caro/hmi-context` | `packages/hmi-context/` | HMI React context (tagMap, tagPathIndex, live-value subscriptions), hooks (useLiveValue, useTagWriter, useTagMap, useTagSubtree, useResolveAssetPath), MockHmiProvider |
| `@caro/trend-chart` | `packages/trend-chart/` | Trend chart UI package. Geometry + cache: `level.ts` (alignedTilesInRange, tilesForViewport — bucketCount=500/visibleTilesPerWindow=2/overfetchPerSide=1; `bucketSMs === 0n` guard prevents division-by-zero crash), `tileCache.ts` (LRU keyed by tagId+startTime+endTime+bucketCount, 50 MB cap), `colorAssign.ts` (schemeTableau10 ×2). Hooks: `useTrendData` (2-tile visible + 2 prefetch parallelism, ⌈N/8⌉ fan-out, stale-generation guard; `bucketSMs` always integer; `lastFetchMs` exposes wall-clock batch duration), `useTrendMode` (tailing/fixed mode reducer + hook; `liveClicked` is sole fixed→tailing path), `useZoomState` (zoom level state + `computeDragZoomViewport`; `newStart >= 1n` clamp prevents negative timestamps). Render: `uplotConfig.ts` (always-band 2-series shape — 2 series per tag (min + max) + `bands[]`; no `data.type` in rebuild deps; **uPlot `width: 0` on a series skips `_paths` computation, breaking band fill** — min series must have non-zero width), `bandsFromTrendData.ts` (per-tag `{mins, maxs}` extraction; raw path returns same array reference for zero-area band collapse). Components: `TrendChartContainer` (stateful wiring layer), `TrendChart` (uPlot canvas wrapper, stepped interpolation, per-trace Y-scales, X-scale preservation across rebuilds), `SpanPresets` (8-preset strip: 1m/5m/15m/1h/4h/24h/7d/14d), `EndPicker` (End datetime picker + Live/Go Live button), `SpanBucketIndicator` (Span / Bucket Size / Last Fetch footer display), `Legend` (vertical right column; idle-value rule: tailing→last bucket, fixed→--). `axisInteractions.ts` exports 9 pure pan/zoom helpers. Consumed by `apps/caro-hmi/client`. See `Docs/hmi_trend_viewer_handoff.md` for full file map. |
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

**Next priority — Step 11: Live tail.** Steps 1–10 are complete and v0.8 min/max bands are shipped on `feature/trends-min-max-bands` (pending merge to dev). Trends API v0.8 (three-case min/max), always-band render (§8.7 of trend viewer spec), `SpanBucketIndicator` Last Fetch line are all done. Step 11 wires the WebSocket subscription via `@caro/hmi-context`, implements the client-side bucket accumulator (§10.6), and handles per-tag subscription lifecycle (§10.7) and reconnect/backoff (§14.4). See `Docs/hmi_trend_viewer_handoff.md` for full subsystem detail. Full TODO list in `Docs/platform_todo.md`.

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
