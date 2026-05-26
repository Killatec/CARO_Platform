# CARO_Platform — Platform Handoff
**Updated:** 2026-05-26 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

---

## Apps

| App | API Port | UI Port | Status |
|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete |
| MQTT Simulator | 3002 | 5174 | Active development |
| CARO HMI | 3003 | 5175 | Phase A Steps 1–11 complete. Server core + client shell + demo pages + full trends read + live tail. HmiTagSource publishes 7 Trend_Info observability tags every 250ms. TrendSnapshotScheduler guarantees ≥1 DB row/tag/minute. **Trends API v0.9:** `GET /api/v1/trends/tile` — dispatches on `bucketS` across raw + four CAGs; watermark-aware fall-through; aggregate response includes `bucketSMs`, `committedThroughTs`, per-series `min`/`max`; three-case post-pass; future-bucket nulling (buckets past `committedThroughTs` nulled server-side via `nowMs` from `DbPipeline` watermark); `MAX_BUCKET_S=14746` exported from `@caro/db` and enforced at the route via `INVALID_BUCKET_S`; N≤8 cap; optional gzip. **Trend WS channel (Step 11):** SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA messages on shared WS connection; per-client outbox; TREND_FLUSH_HZ=4 Hz flush cadence; synthetic-on-flush events; `setTrendDeltaListener` wires TelemetryIntake to WsServer outbox. **`@caro/trend-chart` package (Step 11 + unified-tile refactor + unified-viewport arc):** `useLiveSubscription` (ring buffer TREND_RING_CAPACITY=20 + bucket accumulator for aggregate; raw buffer trimmed to 2×viewportSpanMs; `drainBuffers` clears accumulator/raw/HWM, NOT ring), unified `mergeTrendData` (live-wins-on-coverage, no `isTailing` param), terminal-cache rule (non-terminal tiles held in `activeTilesRef`, never enter LRU — eliminates Gap B), `dispatchModeAction` live-exit drain only (no eviction on live-entry). **Over-range UX (2026-05-13):** no-clamp wheel-zoom (`clampLowerBound` enforces `from >= 1n` only; span-centering clamp dropped); unified `gatedFetchTile` wrapper in `useTrendData` (all four fetch sites delegate through it; `CLIENT_OVER_RANGE`/`CLIENT_PRE_EPOCH` sentinels); `placeholderData` (`n=2`) rendered behind a single collapsed `<TrendChart>` branch; "Range too wide. Zoom in or pick a smaller preset." renders inline on the right side of the cursor row via `CursorDisplay`'s `rangeExceededMessage` prop (`lineHeight: 16px` pinned, no reflow); pre-epoch tile filter in `tilesForViewport`. LOCF cutoff removed (814ms planning regression eliminated); watermark memoized (30s TTL); raw path unified (UNION ALL). **Audit remediation pass (2026-05-15 → 2026-05-17):** all items from the May 2026 trend-viewer audit landed. Key architectural change: **M1 metadata-as-return-value** — `getTrendTile()` returns `Promise<{ tile, meta }>` with per-segment `source`/`rangeStartMs`/`rangeEndMs`/`rowCount`/`dbElapsedMs` in `meta.segments[]` (subsumes the deleted `__test_lastUsedSources` singleton); structured `[db] getTrendTile` summary log gated by `TIMESCALE_LOG_TILE_QUERIES=1` reads from `meta`. Operational hardening: F5 per-tag trend-outbox cap (`MAX_TREND_OUTBOX_PER_TAG=500`, drop-oldest + batched warn); TG-7 `commitAndDrain` bug fix (in-place array reset + explicit `setTail(null)`); TG-1 EXPLAIN-based regression test guarding bounded-prev chunk pruning. R3 consolidated the two near-duplicate gapfill+locf SQL templates into a single `buildGapfillSql(opts)` builder with byte-equivalence snapshot test. R1 extracted `dropSeamDuplicates` / `nullFutureBuckets` as pure helpers. Test coverage: 694 @caro/trend-chart, 67 @caro/hmi-context, 156 @caro/db, 289 server, 33 client. Next: Step 12 — Tag picker drawer. |

---

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL and TimescaleDB access. Exports: `pool`, `query`, `withTransaction`, `ping`, `runMigrations`, `getActiveTags`, `applyRegistryRevision`, `getTagTypes`, `getModuleTypes`, `getRevisions` (main Postgres); `timescalePool`, `pingTimescale`, `runTimescaleMigrations`, `writeTagSamples`, `getTimescaleDatabaseSizeBytes`, `getTrendTile`, `getTrendExtent`, `MAX_BUCKET_S` (TimescaleDB). `getTrendTile(tagIds, startTime, endTime, bucketCount, nowMs?)` is the single trend read entry point — derives `bucketS` internally, dispatches on it across raw + four CAGs, applies watermark-aware fall-through, and nulls aggregate buckets whose `bucketStartMs > BigInt(nowMs ?? Date.now())`; returns a discriminated-union `TrendTile`. `getTrendExtent()` returns hypertable-wide `{ oldestMs: bigint|null, newestMs: bigint|null }`. `MAX_BUCKET_S = 14746` is the canonical span-cap constant (mirrored in `packages/trend-chart/src/level.ts` with a cross-reference comment to avoid pulling pg-runtime into the browser bundle). Integration test helpers at `packages/db/__tests__/helpers/trends-test-range.ts` (sandbox window 1970–1999, `resetTestRange`/`resetTestRangeExpectClean`/`writeTestSamples`/`refreshTestCagg`). Tests use `.ts` extensions; `vitest.config.js` include pattern is `*.test.{js,ts}`. |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`) |
| `@caro/server` | `packages/server/` | Shared Express middleware — asyncWrap, errorHandler |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) |
| `@caro/hmi-context` | `packages/hmi-context/` | HMI React context (tagMap, tagPathIndex, live-value subscriptions), hooks (useLiveValue, useTagWriter, useTagMap, useTagSubtree, useResolveAssetPath), MockHmiProvider. `TagDef` carries `tag_name: string|null` and `format: string|null` plumbed from tag_registry. |
| `@caro/trend-chart` | `packages/trend-chart/` | Trend chart UI package. Geometry + cache: `level.ts` (alignedTilesInRange, tilesForViewport — tile-grid left-anchor, explicit `tileSpanMs`, variable 2–4 visible tiles covering full viewport, `MAX_VISIBLE_TILES=16` defense-in-depth cap, `startTime < 0n` pre-epoch filter; bucketCount=500/visibleTilesPerWindow=2/overfetchPerSide=1; `bucketSMs === 0n` guard; `MAX_BUCKET_S=14746` and derived `MAX_VIEWPORT_SPAN_MS`), `tileCache.ts` (LRU keyed by tagId+startTime+endTime+bucketCount, 50 MB cap), `colorAssign.ts` (schemeTableau10 ×2). Hooks: `useTrendData` (tile-aligned fetch pipeline driven by `modeViewport` + explicit `bucketSMs`; ⌈N/8⌉ fan-out, stale-generation guard; terminal-cache rule: non-terminal tiles held in `activeTilesRef`, never cached (eliminates Gap B); unified `gatedFetchTile` useCallback with `CLIENT_OVER_RANGE` / `CLIENT_PRE_EPOCH` sentinels; `committedThroughTs` field; `invalidateNonTerminalTiles` callback; 2s live heartbeat), `useTrendMode` (three-state fixed/live-trailing/live-fixed mode reducer + hook; `clampLowerBound` enforces `from >= 1n` only — span passes through unchanged on `zoom`/`pan`; `MAX_VIEWPORT_SPAN_MS` cap applied only inside `endPickerCommitted`; `liveClicked` enters live-trailing; `tick` dispatched by container on TREND_DELTA receipt), `useZoomState` (render-time non-zoom resolution derivation, sticky `gestureBucketSMs` only during `lastIntent='zoom'`; exports `computeDragZoomViewport`), `useLiveSubscription` (SUBSCRIBE_TREND/UNSUBSCRIBE_TREND lifecycle; ring buffer per tag TREND_RING_CAPACITY=20 + bucket accumulator for aggregate mode; raw buffer per tag trimmed to 2×viewportSpanMs; `drainBuffers` clears accumulator/raw/HWM but NOT ring; boolean coercion in `toNumericValue`), `mergeTrendData` (Step 11: unified coverage rule — live wins on its range, null included; aggregate clips to liveEndIndex, raw drops ts≥minLiveTs entries; no isTailing parameter). Render: `uplotConfig.ts` (always-band 2-series shape; `posToVal` for cursor-time display; bucketSMsKey dep for coverage-check effect), `bandsFromTrendData.ts`. Components: `TrendChartContainer` (stateful wiring; `dispatchModeAction` wrapper — drains buffers on live-exit, no eviction; single render branch via `(uxRangeExceeded || uxRangeTooNarrow) ? placeholderData : mergedData`; `lastChartDataRef` bridges data across transitions; stable refs updated during render; passes `bucketSMs`/`lastFetchMs` to `TrendChart` — no `cursorTsMs` state), `TrendChart` (accepts `rangeExceeded`, `bucketSMs`, `lastFetchMs` props; forwards bucket/fetch to `Legend`; imperative `setScale` effect re-runs when over-range), `CursorDisplay` (range-message-only bar above footer; `rangeMessage` prop renders "Range too wide / too narrow" in red; `lineHeight: 16px` pinned; cursor row is now in `Legend`), `SpanPresets`, `EndPicker`, `SpanIndicator` (footer span only), `BucketFetchIndicator` (legend-strip bucket+fetch), `SpanBucketIndicator` (kept for backward-compat), `Legend` (cursor row + value header + 5-col table + BucketFetchIndicator; all labels unified at 12px/#374151/monospace/lineHeight 16px). `uplotConfig.ts` constants: `Y_AXIS_SIZE_PX=60` (fixed axis width), `Y_AXIS_LABEL_SIZE_PX=16` (label area always reserved; label=`' '` when unit absent). `axisInteractions.ts` exports 9 pure pan/zoom helpers. Consumed by `apps/caro-hmi/client`. See `Docs/hmi_trend_viewer_handoff.md` for full file map. |
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
- **TagDef field consumption:** Consume `TagDef.{unit, eng_min, eng_max, format, tag_name}` directly. Never walk `meta` for these fields — `resolveRegistry` applies type-aware gating (e.g., suppressing unit/eng_min/eng_max on Booleans). Use `meta` only for structural data (e.g., `module_id`). This applies everywhere: `loadTagMap`, `resolveFormat`, any widget/hook reading tag metadata.

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

**Main PostgreSQL (port 5432):** Migrations in `db/postgres/migrations/` — never edit existing, add new only. Applied: `001` `002` `003` `004` `006` `007` `008` `009` `010` `011` `012` `013` `014` `015`. All three servers call `runMigrations()` from `@caro/db` at startup. Advisory lock `pg_advisory_lock(1)` prevents concurrent migration races. Startup sequence: `ping()` → `runMigrations()` → app init. Either step failing causes `process.exit(1)`.

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

**Next priority — Step 12: Tag picker.** Steps 1–11 + unified-tile refactor + unified-viewport arc are complete. Step 11 (live tail) and subsequent refactors delivered: dedicated trend WS channel (SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA), `useLiveSubscription` (ring buffer TREND_RING_CAPACITY=20 + bucket accumulator + raw buffer; `drainBuffers` on live-exit), unified `mergeTrendData` (live-wins-on-coverage), terminal-cache rule (Gap B fix), server-side future-bucket nulling in `getTrendTile`, `dispatchModeAction` live-exit drain only, `tilesForViewport` explicit-`tileSpanMs` left-anchor coverage (blank-tile-on-zoom-out fix), render-time `currentBucketSMs` derivation in `useZoomState` (storm fix) — 694 `@caro/trend-chart` + 67 `@caro/hmi-context` + 156 `@caro/db` tests. Step 12 wires the tag picker drawer (tree + search + multi-select commit + trendable filter). See `Docs/hmi_trend_viewer_handoff.md` for full subsystem detail. Full TODO list in `Docs/platform_todo.md`.

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
