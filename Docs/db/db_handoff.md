# @caro/db — Package Handoff
**Updated:** 2026-10-18 | **Path:** `packages/db/` | **Name:** `@caro/db`

---

## Exports

**Infrastructure:**

| Function | Purpose |
|---|---|
| `query(text, params)` | Execute a query against the pool |
| `withTransaction(fn)` | Run `fn(client)` inside BEGIN/COMMIT/ROLLBACK |
| `runMigrations()` | Apply pending migration files in order |
| `ping()` | Health check — `SELECT 1`, throws on failure |

**Tag registry:**

| Function | Purpose |
|---|---|
| `getActiveTags()` | Latest non-retired row per `tag_id` |
| `getRevisionTags(rev)` | All tag rows for a given revision; `null` if none |
| `applyRegistryRevision(added, modified, retired, comment)` | Write registry diff in SERIALIZABLE transaction |
| `getRevisions()` | All `registry_revisions` rows, DESC |
| `getTagTypes()` / `getModuleTypes()` | `tag_types` / `module_types` lookup rows, by id |

**HMI setpoints (migrations 016, 018):**

| Function | Purpose |
|---|---|
| `upsertPendingSetpoints(entries)` | Upsert `pending_setpoint_values` rows (called on CMD_ACK `accepted=true`; nothing reads the table yet) |
| `upsertCommandedSetpoints(entries)` | Upsert `commanded_setpoints` rows `{ tag_id, value (null = unpopulated, stored as SQL NULL), ack_status: 'accepted' \| 'timeout', set_by? }`. Omitted `set_by` is written as NULL. A repeated tag_id keeps the last entry. |
| `getCommandedSetpointsByTagIds(tagIds)` | Read `commanded_setpoints` rows (with `ack_status`, `set_by`, `set_at`); a missing tag_id means unpopulated. Read by the HMI's post-CONFIRM Set push. |

One-off bulk load: `scripts/import-rf1-sets.js --sets <RF1_Sets.json> [--apply]` writes RF_Control's legacy setpoint file into `commanded_setpoints` through `scripts/data/rf1-sets-map.json` (dry run without `--apply`; aborts on any unmapped key or type mismatch).

**TimescaleDB (historian):**

| Export | Purpose |
|---|---|
| `timescalePool`, `pingTimescale`, `runTimescaleMigrations` | Historian pool, health check, migrations |
| `writeTagSamples` | Batch write to `tag_samples` (used by the HMI `TimescaleDbWriter`) |
| `getTimescaleDatabaseSizeBytes` | `pg_database_size()` for `TimescaleSizeMonitor` |
| `getTrendTile(tagIds, startTime, endTime, bucketCount, nowMs?)` | The single trend read entry point. Derives `bucketS` internally, dispatches on it across raw + four CAGs, applies watermark-aware fall-through, and nulls aggregate buckets whose `bucketStartMs > BigInt(nowMs ?? Date.now())`. Returns `Promise<{ tile, meta }>` — `tile` is a discriminated-union `TrendTile`. |
| `getTrendExtent()` | Hypertable-wide `{ oldestMs: bigint\|null, newestMs: bigint\|null }` |
| `MAX_BUCKET_S` | `14746` — canonical span-cap constant. Mirrored in `packages/trend-chart/src/level.ts` with a cross-reference comment, to avoid pulling pg-runtime into the browser bundle. |
| `deriveBucketSMs`, `dispatchShape`, `SAMPLE_RATE_HZ` | Pure helpers behind `getTrendTile`'s bucket derivation and window-size shape dispatch; exported for tests (`@caro/trend-chart` keeps its own browser-side `deriveBucketSMs` in `level.ts`) |
| `__test_watermarkOverride`, `__test_clearWatermarkCache` | Test-only hooks for the memoized watermark lookup |

Integration test helpers at `packages/db/__tests__/helpers/trends-test-range.ts` (sandbox window 1970–1999, `resetTestRange`/`resetTestRangeExpectClean`/`writeTestSamples`/`refreshTestCagg`). Tests use `.ts` extensions; `vitest.config.js` include pattern is `*.test.{js,ts}`. Design and query detail: `Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md` §4–§6 and `Docs/db/DB_Config_Usage_And_Perf.md`.

> **Note:** `getActiveTags()` returns the flat tag rows that HMI needs directly. `resolveRegistry()` in `apps/tag-registry/shared/` is a Tag Registry Admin Tool concern — it builds the template/asset tree structure used for registry editing. HMI does not need it.

---

## Rules

- Apps import named functions only. No `pool`, no `query` for ad-hoc SQL, no `pg` imports in app code.
- New queries go in this package. Never in app code.
- Pool is a lazy singleton — constructed on first call, after whatever env-loading the app has done by then (`loadEnv()` from `@caro/server/env` in all three server apps). Any new module-scope `process.env` read added to this package would not get this same protection — see `Docs/hmi/trend-viewer/hmi_trend_viewer_handoff.md`'s note on `TIMESCALE_LOG_TILE_QUERIES` for why that matters (this package is reached transitively by any `import ... from '@caro/db'`, including re-exports).
- `withTransaction()` releases the client in all cases (commit, rollback, rollback failure).

---

## Migrations

Files in `db/postgres/migrations/`. Applied in filename order. Tracked in `schema_migrations` table. Each migration runs inside a transaction.

- Never edit an existing migration file.
- New behavior = new file with next sequential prefix.
- Applied: `001`–`004`, `006`–`018` (005 skipped — do not reuse)
- `007` — create `tag_types` lookup table; migrate `tag_registry.data_type` to FK
- `008` — revert `tag_registry.data_type` FK back to string (`tag_types.type_name`)
- `009` — remove unused tag types; rename `f64` → `f32`
- `010` — create `module_types` standalone lookup table
- `011` — add nullable `module` and `module_type` columns to `tag_registry`
- `012` — add `i16` (Int 16) to `tag_types`
- `013` — add nullable display columns `unit`, `format`, `eng_min`, `eng_max` to `tag_registry`
- `014` — add `string`, `f32[]`, `i16[]` to `tag_types`
- `015` — add `tag_name` column to `tag_registry`
- `016` — create `pending_setpoint_values`
- `017` — add `i32` (Int 32) to `tag_types`
- `018` — create `commanded_setpoints` (seeded once from `pending_setpoint_values`)

### TimescaleDB migrations

Separate container on port 5433, started via `docker-compose.timescale.yml` at the repo root (setup: `Docs/db/hmi_timescale_setup.md`). Development database: `caro_timescale`. Migrations in `db/timescale/migrations/` (`T00N_` prefix). The HMI server calls `pingTimescale()` → `runTimescaleMigrations()` at startup (soft-fail — falls back to `NullDbWriter` if unreachable).

- `T001_create_tag_samples.sql` — `tag_samples` hypertable: DOUBLE PRECISION value, `compress_segmentby = tag_id`, `compress_orderby = ts DESC`, retain 14 days.
- `T004_tighten_compression_policy.sql` — 1h chunks, `compress_after = 10 min`, `schedule_interval = 5 min`. Incompatible with existing 12h chunks — a `TRUNCATE tag_samples` wipe is required before first startup on any environment that ran under T001 settings.
- `T006_replace_1s_cagg.sql`, `T007_create_10s_cagg.sql`, `T008_create_1min_cagg.sql`, `T009_create_10min_cagg.sql` — four CAGs: `tag_samples_1s_cagg` (1s buckets, 14d retention), `tag_samples_10s_cagg` (10s, 90d), `tag_samples_1min_cagg` (1min, 1y), `tag_samples_10min_cagg` (10min, indefinite). All materialize `last`, `null_count`, `min`, `max` from `tag_samples` (flat topology — each CAG reads raw directly). The 10min CAG uses `start_offset = 1 hour` (vs 15 min on the other three) to satisfy TimescaleDB's 2×bucket_width refresh-window rule.

---

## Environment Variables

Set in the monorepo root `.env` and loaded by each app's `loadEnv()` (two layers — see `Docs/README.md` § Platform Rules). Both pools read `process.env` lazily on first use, so they see whatever the app loaded. Never use `DATABASE_URL`.

| Variable | Default | Required |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | No |
| `POSTGRES_PORT` | `5432` | No |
| `POSTGRES_DATABASE` | `caro_dev` | No |
| `POSTGRES_USER` | `postgres` | No |
| `POSTGRES_PASSWORD` | — | **Yes** |
| `TIMESCALE_HOST` | `localhost` | No |
| `TIMESCALE_PORT` | `5433` | No |
| `TIMESCALE_DATABASE` | `caro_timescale` | No |
| `TIMESCALE_USER` | `postgres` (the Docker setup uses `caro`) | No |
| `TIMESCALE_PASSWORD` | — | **Yes** |
| `TIMESCALE_LOG_TILE_QUERIES` | unset | No — `1` logs a `[db] getTrendTile` summary per tile |

---

## Current State

Stable. In use by all three apps: Tag Registry and MQTT Simulator (main Postgres), CARO HMI (main Postgres + TimescaleDB).

Tests: `cd packages/db && npm test` — 156 passing (2026-09-22). Includes `query.test.js` (`withTransaction()` happy path and all four failure paths) and the TimescaleDB integration suite under `__tests__/timescale/`, which needs a running historian. Perf scripts: `npm run perf:*` (see `package.json`); results in `Docs/db/perf-history/`.

---

## Key Documents

| Document | Path |
|---|---|
| DB Spec | `Docs/db/CARO_DB_Spec.md` |
| Historian config & perf | `Docs/db/DB_Config_Usage_And_Perf.md` |
| TimescaleDB setup | `Docs/db/hmi_timescale_setup.md` |
| Platform Spec Delta | `Docs/platform/platform_deltas.md` |
