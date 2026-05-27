# CARO_Platform — Trending Reference

**From tag change to hypertable row — the HMI historian end-to-end.**
**Version:** 1.2 — 2026-05-19
*v1.2: Renamed from `CARO_Trending_Reference.md` to `hmi_trend_viewer_reference.md` (naming convention alignment). No content changes.*
*v1.1: T004 chunk policy reflected (1h chunks, compress_after=10min); §15.1 removed (read endpoint shipped); cross-ref to trend viewer spec/handoff for the read path.*
*Internal technical reference.*

---

## 1. Overview

This document describes the HMI trending subsystem: how tag values are identified as historian-eligible, how they travel from `TelemetryIntake` into the `DbPipeline` queue, how that queue is flushed asynchronously into the TimescaleDB hypertable, how bad quality is represented on the way through, and how the operator sees the health of the whole chain on the System Overview page.

It complements two sibling docs:

- `CARO_Telemetry_Path_Reference.md` covers the live path (telemetry → LKV → WebSocket → UI). This doc picks up where that one lists "DB pipeline" as stage 5 and fully expands it.
- `CARO_DB_Spec.md` §9 describes the database surfaces formally. This doc is the operational narrative.

### 1.1 End-to-End Summary

| # | Stage | Module | What happens |
|---|-------|--------|--------------|
| 1 | Ingest | `telemetry-intake.ts` | For each module tick, every tag whose value changed AND is trendable (non-array) is collected into a `DbWriteEntry` with the module-level timestamp. |
| 2 | Quality sentinel | `telemetry-intake.ts` | Watchdog stall → enqueue a sentinel with `value = null` for every trendable tag in the module. |
| 3 | Enqueue | `db-pipeline.ts` | Entry appended to in-memory queue. If queue at capacity, oldest entry dropped; `droppedPkgsTotal` increments. |
| 4 | Flush tick | `db-pipeline.ts` | Every `TIMESCALE_DB_TICK_MS` (default 500 ms): peek up to `TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH`, call `writer.write()`, consume on success. |
| 5 | Coerce | `timescale-writer.ts` | `bool → 1.0/0.0`, `number → number` (non-finite → null), `string → null + one-time warn`. |
| 6 | Insert | `@caro/db.writeTagSamples` | Bulk insert via `unnest($1,$2,$3)` — one round-trip regardless of row count. |
| 7 | Hypertable | `tag_samples` | Rows land in the current 1 h chunk; compression at 10 min age; retention at 14 d. |
| 8 | Observability | `hmi-tag-source.ts` | Seven `Trend_Info` tags updated every HMI publish tick and rendered by the `TrendStatusBox` widget. |

### 1.2 Design Principles

The system is built on four rules:

- **Change-of-Value, not polling.** The historian only sees values that actually moved. Flatlines occupy zero storage.
- **`null` means bad quality.** Every `null` in `tag_samples.value` is a deliberate discontinuity sentinel, not a missing number. Readers MUST NOT interpolate across it.
- **Soft-fail on historian.** If TimescaleDB is unreachable at boot, HMI starts with `NullDbWriter` and keeps serving live data. The observable contract signals the degraded state to the operator; it does not crash the app.
- **Writers throw, pipeline counts.** Any writer failure — including the permanent `NullDbWriter` failure — feeds the `errorCountTotal` counter and holds `Trending = false`. Success paths are silent.

### 1.3 What Counts as "Trending"

A tag is historian-eligible (trendable) iff:

- It has `trend = true` in `tag_registry`, and
- Its `data_type` is NOT an array type.

The set is computed once at boot by `loadTagMap()` and exposed as `trendableTagIds: Set<number>`. `TelemetryIntake` uses this set as the gate for every enqueue. Array-typed tags (packed-bit, multi-value) are excluded at the source — the single-column schema cannot represent them.

### 1.4 Scope & Non-Goals

In scope: write path, storage layout, observability, configuration.

This document covers the write path. The READ side (REST endpoint, continuous aggregates, tile-based queries) is documented in `Docs/hmi_trend_viewer_spec.md` and `Docs/hmi_trend_viewer_handoff.md`.

---

## 2. Stage 1 — Trendable Tag Identification

At HMI boot, `loadTagMap()` partitions the active tag set:

```ts
const { tagMap, moduleTagIds, trendableTagIds } = await loadTagMap(rows);
```

`trendableTagIds` is a `Set<number>`. Only `tag_id` values in this set are ever enqueued. A tag moving from `trend=true` to `trend=false` (or vice versa) in the registry requires an HMI restart to take effect — the set is not reloaded at runtime.

---

## 3. Stage 2 — Enqueue (Telemetry Intake)

`TelemetryIntake.ingest()` receives every module tick, whether from MQTT or from `HmiTagSource`.

### 3.1 Change-of-Value

```ts
for (const { tag_id, value } of message.tags) {
  if (!this.tagMap.has(tag_id)) continue;
  const changed = this.lkv.set(tag_id, value);
  if (changed && this.trendableTagIds.has(tag_id) && !Array.isArray(value)) {
    changedTrendable.push({ tagId: tag_id, value });
  }
}

if (changedTrendable.length > 0) {
  this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: changedTrendable });
}
```

`this.lkv.set()` returns `true` only when the value actually differs from the previous LKV entry (bumping the generation counter). Flatlined tags produce no enqueue. The array-type guard is defense in depth — the resolved-tag validator already excludes arrays from `trendableTagIds`, but direct DB registry edits could bypass that, so the intake path double-checks.

The enqueued entry's timestamp is the module-level timestamp carried in the MQTT frame, NOT `Date.now()` at ingest. This preserves the device's notion of time and lets downstream analytics reason about device clock behavior.

### 3.2 FAULT Status Pass-Through

When a module publishes a frame with `status: 'FAULT'`:

```ts
if (message.status === 'FAULT') {
  for (const tagId of this.moduleTagIds.get(moduleId) ?? []) {
    this.lkv.set(tagId, null);
  }
  // No early return: tag values carried in a FAULT frame are real telemetry
  // and must flow to the historian via the COV loop below.
}
```

The LKV is nulled — live widgets render `---` — but the COV loop still runs against the incoming `tags[]`. **FAULT frames that still carry real sensor values WILL trend those values.** This is intentional: a FAULT status is a module-level annotation, not a statement about individual sensor quality.

### 3.3 Watchdog Stall Null Sentinel

When the watchdog detects a module stall (no frames for `watchdogTimeoutMs`), a synthetic sentinel entry is enqueued on transition:

```ts
private enqueueWatchdogStallSentinel(moduleKey: string): void {
  const allTagIds = this.moduleTagIds.get(moduleKey)!;
  const trendingTagIds = allTagIds.filter(id => this.trendableTagIds.has(id));
  if (trendingTagIds.length === 0) return;
  this.dbPipeline.enqueue({
    moduleTs: Date.now(),
    tags: trendingTagIds.map(tagId => ({ tagId, value: null })),
  });
}
```

This writes one row per trendable tag in the stalled module with `value = NULL`. Readers see a hard discontinuity exactly when comms were lost. The sentinel fires **once per stall transition** — not every watchdog tick — because the timed-out flag latches.

**Note:** the sentinel uses `Date.now()` (HMI clock) because by definition the module is no longer publishing and has no current timestamp.

---

## 4. Stage 3 — DbPipeline

The `DbPipeline` owns the asynchronous queue and the flush tick. It is writer-agnostic — it composes any object implementing the `DbWriter` interface.

### 4.1 DbWriter Interface

```ts
export interface DbWriter {
  /** Persist a batch. Throw on failure. The pipeline only re-tries entries that
   *  were never successfully written — writers are NOT required to be idempotent. */
  write(entries: DbWriteEntry[]): Promise<void>;
  /** Short name for logs, e.g. "timescale" or "null". */
  readonly name: string;
}

export interface DbWriteEntry {
  moduleTs: number;
  tags: { tagId: number; value: number | boolean | string | null }[];
}
```

**Contract:** writers either persist all entries in a call or throw. They are not required to be idempotent because the pipeline's peek-then-consume ensures unsuccessful entries are not consumed and will be retried on the next tick.

### 4.2 Queue Discipline

The queue is a plain in-memory array of `DbWriteEntry`. Capacity is bounded by `TIMESCALE_DB_QUEUE_MAX` (default 5000). When `enqueue()` would exceed capacity, the **oldest** entry is discarded and `droppedPkgsTotal` is incremented. New data is prioritized over old backlog — a stalled writer should not silently drift the clock backward.

`droppedPkgsTotal` (and `errorCountTotal`) saturate at 9999 so the `Int 16` observability tags never wrap.

### 4.3 Flush Tick Cadence

Every `TIMESCALE_DB_TICK_MS` milliseconds (default 500), `flushOnce()` runs. At 500 ms and a 500-entry batch cap, the pipeline sustains up to 1000 entries/sec worth of distinct module ticks across all modules — well above the expected steady-state COV rate.

### 4.4 Peek-Then-Consume + inFlight Guard

`flushOnce()` follows this pattern:

1. If a previous `flushOnce()` is still awaiting `writer.write()`, return immediately (`inFlight` guard). Prevents overlapping writes when flushes run long.
2. Snapshot `queueDepth` from `queue.length` — this is the **pre-peek** value the widget shows.
3. `peek` up to `maxEntriesPerFlush` entries (slice; do NOT remove from queue).
4. `await writer.write(peeked)`.
5. On success, splice peeked entries out of the queue; `rowsWrittenTotal += rowsPersisted`; `historianHealthy = true`.
6. On throw, leave queue intact; `errorCountTotal++` (clipped); `historianHealthy = false`.
7. Whether success, failure, or idle, run `evaluateTrendingMetrics()`.

Peek-then-consume is why writers don't have to be idempotent — retried entries were never consumed the first time.

**Why pre-peek queue depth?** Because flushes are async, new entries can land in the queue during `await writer.write()`. Sampling `queue.length` after the splice would double-count entries that arrived during the flush. Sampling before the peek shows "how many entries did this tick face," which is the operator-useful metric.

### 4.5 Counters

| Counter | Semantic | Clip |
|---------|----------|------|
| `rowsWrittenTotal` | Lifetime rows persisted (sum of `entry.tags.length` across successful writes). | None — grows unbounded. |
| `droppedPkgsTotal` | Lifetime entries evicted from the queue due to overflow. | 9999 |
| `errorCountTotal` | Lifetime `writer.write()` throws. | 9999 |
| `queueDepth` (tick-held) | Pre-peek queue length at each flush tick. | 5000 (queueMax) |
| `queueLength` (live) | Current `queue.length` at the moment of the getter call. Used for tests/debug, NOT the observability tag. | 5000 |
| `lastFlushMs` | Wall-clock duration of the most recent flush, rounded. | n/a |
| `historianHealthy` | `true` iff last flush did not throw. | n/a |
| `trending` (tick-held) | `historianHealthy && writer.name !== 'null' && rowsWrittenDeltaThisTick > 0`. | n/a |
| `rowsPerSec` (tick-held) | `(rowsWrittenTotal - rowsWrittenAtLastTick) / (tickMs/1000)`. | n/a |

### 4.6 `evaluateTrendingMetrics()`

Runs at the end of every flush attempt (success, failure, idle) but is skipped when `flushOnce()` returns early due to the `inFlight` guard. The rationale is important:

- `rowsPerSec` is computed at flush cadence (500 ms), not at the HMI publish cadence (250 ms). Sampling faster than the flush rate produced a 0/4800 sawtooth on the widget. Tick-held evaluation yields a clean rate.
- `trending` is similarly tick-held. Earlier live-sampled versions flashed through post-flush zero-depth windows. The current design holds the last evaluation for the full tick interval.
- "Drop immediately" semantics: `trending` has no hysteresis. A single error tick → `trending = false` for that tick.

### 4.7 Boot Log

On `dbPipeline.start()`:

```
[DbPipeline] started: tickMs=500, queueMax=5000, maxEntriesPerFlush=500, writer=timescale
```

(`writer=null` when running against the null fallback.)

---

## 5. Stage 4 — Writer Implementations

### 5.1 TimescaleDbWriter

The production writer. Coerces heterogeneous values into the `DOUBLE PRECISION` column:

```ts
private _coerce(v: number | boolean | string | null): number | null {
  if (v === null)            return null;
  if (typeof v === 'boolean') return v ? 1.0 : 0.0;
  if (typeof v === 'number')  return Number.isFinite(v) ? v : null;
  // string — not historian-eligible; drop as quality gap
  if (!this._strDropLogged) {
    this._strDropLogged = true;
    console.warn('[TimescaleDbWriter] dropping string tag value — check tag type vs historian eligibility');
  }
  return null;
}
```

Coercion rules:

| Input | Stored | Notes |
|-------|--------|-------|
| `null` | `NULL` | Bad quality passthrough. |
| `true` / `false` | `1.0` / `0.0` | Bools are trendable and round-trip through numeric storage. |
| Finite number | Same | Includes negative, zero, decimals. |
| `NaN`, `±Inf` | `NULL` | Treated as quality gaps, not stored as-is. |
| String | `NULL` | String-typed tags should not be marked trendable; the single per-instance warn-once log flags any bypass. |

The string case is defensive — strings should be gated out at `trendableTagIds` construction — but the warning exists because a misconfigured registry entry can slip through.

### 5.2 NullDbWriter

```ts
export class NullDbWriter implements DbWriter {
  readonly name = 'null';
  async write(_entries: DbWriteEntry[]): Promise<void> {
    throw new Error('No historian configured; NullDbWriter cannot persist data');
  }
}
```

`NullDbWriter` always throws. This is deliberate — by routing the degraded state through the same error path as a real writer failure, the observability tags reflect reality: `Error_Count` climbs every tick, `Trending = false`, `Queue_Depth` grows until `droppedPkgsTotal` also climbs. Silent sinking would have hidden the misconfiguration.

---

## 6. Stage 5 — TimescaleDB Storage

### 6.1 Schema

`db/timescale/migrations/T001_create_tag_samples.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS tag_samples (
  ts      TIMESTAMPTZ       NOT NULL,
  tag_id  INTEGER           NOT NULL,
  value   DOUBLE PRECISION           -- nullable: NULL == bad quality
);
```

**Three columns, on purpose:**

- `ts TIMESTAMPTZ` — the module-level timestamp, stored with timezone. The writer converts from epoch milliseconds via `to_timestamp(t/1000.0)`.
- `tag_id INTEGER` — FK-shape-but-not-enforced reference to `tag_registry.tag_id`. No FK constraint on purpose: enforcing it would require Timescale to dereference a foreign database on every insert, which we can't do cheaply, and because the registry is the owner of tag identity, referential drift is detected at query time via join, not at insert time.
- `value DOUBLE PRECISION` (nullable) — one column for all tag types. Bools encoded as 1.0/0.0 by the writer. Strings dropped. Arrays never reach this stage. `NULL` means bad quality.

No per-row quality enum, no per-row source ID, no soft-delete column. Every piece of context (tag name, type, unit, scale) is resolved at read time via the `@caro/db` registry surface.

### 6.2 Hypertable Configuration

```sql
SELECT create_hypertable(
  'tag_samples',
  'ts',
  chunk_time_interval => INTERVAL '1 hour',
  if_not_exists       => TRUE
);
```

1-hour chunks are the unit of compression and retention. With a 10 Hz worst-case COV rate across 360 trendable tags a chunk reaches ~1.3 GB uncompressed before the compression policy fires at 10-minute age. Originally 12-hour chunks; tightened to 1-hour in T004 after perf testing identified an I/O amplification cliff on uncompressed chunks above ~1 GB.

### 6.3 Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_tag_samples_tagid_ts
  ON tag_samples (tag_id, ts DESC);
```

The primary read pattern is "fetch recent history for tag X." A composite index on `(tag_id, ts DESC)` gives O(log n) seek and sequential scan within the tag's partition. Timescale automatically propagates the index to new chunks.

### 6.4 Compression

```sql
ALTER TABLE tag_samples
  SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tag_id',
    timescaledb.compress_orderby   = 'ts DESC'
  );

-- T004 overrides the initial 12h policy:
SELECT add_compression_policy('tag_samples', INTERVAL '10 minutes', if_not_exists => TRUE,
  schedule_interval => INTERVAL '5 minutes');
```

- `segmentby = 'tag_id'` ensures per-tag scans on compressed chunks stay efficient — each tag becomes one compressed row group.
- `orderby = 'ts DESC'` means the most recent samples within a segment are first — matches the dominant read direction.
- Policy fires at 10 min age (T004) and runs every 5 min schedule interval. Compression ratio is ~15× in practice (1278 MB uncompressed per 1 h chunk → ~82 MB compressed). The tight age threshold caps uncompressed footprint at ~1 h 15 min of data, well within typical PostgreSQL cache. Range queries on compressed data stay fast; random point lookups by timestamp incur a small decompression overhead.

### 6.5 Retention

```sql
SELECT add_retention_policy('tag_samples', INTERVAL '14 days', if_not_exists => TRUE);
```

Chunks older than 14 days are dropped wholesale. This is the hard disk bound — without retention the table grows unbounded. 14 days is a product decision driven by the storage budget (§13). Shorter retention for higher-rate data, or separate hypertables per sample rate class, are possible future refinements.

### 6.6 Write Path

`packages/db/samples.ts`:

```ts
export async function writeTagSamples(rows: TagSampleRow[]): Promise<void> {
  if (rows.length === 0) return;

  const tsArr:  bigint[]          = rows.map(r => BigInt(r.ts));
  const tagArr: number[]          = rows.map(r => r.tagId);
  const valArr: (number | null)[] = rows.map(r => r.value);

  await timescalePool.query(
    `INSERT INTO tag_samples (ts, tag_id, value)
     SELECT to_timestamp(t / 1000.0), tid, v
     FROM unnest($1::bigint[], $2::int[], $3::double precision[]) AS s(t, tid, v)`,
    [tsArr, tagArr, valArr]
  );
}
```

Three design choices worth naming:

- **`unnest` parallel arrays, not a values-list.** One round-trip regardless of batch size, no SQL string length concerns, no per-row parameter binding overhead.
- **`BigInt(r.ts)`.** Epoch milliseconds exceed safe `int4`; `bigint` is required.
- **`to_timestamp(t/1000.0)`.** Lets the client send an unambiguous numeric epoch and lets Postgres do the date math.

---

## 7. Observability — `Trend_Info` Tags

Seven tags under `CARO_1.HMI.Trend_Info.*` expose the health of the pipeline to the operator. They are updated every HMI publish tick (250 ms) by `HmiTagSource.updateTrendInfoTags()`.

| Tag | Type | Unit | Source | Notes |
|-----|------|------|--------|-------|
| `Trend_Info.Trending` | Boolean | — | `dbPipeline.trending` | Tick-held. `true` iff historian writer is non-null AND last flush succeeded AND rows were written in the latest tick window. |
| `Trend_Info.Queue_Depth` | Int 16 | — | `dbPipeline.queueDepth` | Pre-peek snapshot from the last flush tick. |
| `Trend_Info.Rows_Per_Sec` | Float 32 | `#/s` | `dbPipeline.rowsPerSec` | Tick-held. `(rowsWrittenTotal - prev) / (tickMs/1000)`. |
| `Trend_Info.Flush_ms` | Float 32 | `ms` | `dbPipeline.lastFlushMs` | Wall-clock duration of last flush. Includes I/O wait — does not represent CPU time. |
| `Trend_Info.Dropped_Pkgs` | Int 16 | — | `dbPipeline.droppedPkgsTotal` | Lifetime count, clipped at 9999. Queue-overflow evictions. |
| `Trend_Info.Error_Count` | Int 16 | — | `dbPipeline.errorCountTotal` | Lifetime count, clipped at 9999. `writer.write()` throws. |
| `Trend_Info.DB_Size` | Float 32 | `GB` | `TimescaleSizeMonitor.sizeGB` | Polled at `TIMESCALE_SIZE_POLL_MS` (default 30 s) via `pg_database_size(current_database())`. Publishes `null` until the first successful poll completes (boot window); thereafter holds the most recent value across transient poll failures. |

### 7.1 Sampling Cadence Rules

The HMI publish tick (250 ms) samples metrics that are produced at different cadences:

- `Trending` and `Rows_Per_Sec` are **tick-held** (updated at flush cadence, 500 ms). Sampling them faster than the flush cadence would produce visible noise because they are natively defined over a flush interval, not a publish interval.
- `Queue_Depth` is **tick-held pre-peek**. Live sampling during a flush would include entries arriving during the `await writer.write()` window — not a meaningful number.
- `Flush_ms`, `Dropped_Pkgs`, `Error_Count` are simple latched-last-value getters and safe to sample at any rate.
- `DB_Size` is polled independently every 30 s by `TimescaleSizeMonitor`. Reading it from the HMI publish tick just reads the cached value; the actual Postgres query is off the hot path.

### 7.2 TrendStatusBox Widget

`apps/caro-hmi/ui/.../TrendStatusBox.tsx` renders the seven tags on the System Overview page as a single STATUS_BOX module. One `BooleanMon` row (Trending) and six `NumericMon` rows. Value subscriptions use the contiguous-segment dot notation `HMI.Trend_Info.<Name>`. Styling follows the `HmiStatusBox` convention (`STATUS_BOX` frame, `MODULE_TITLE` header, `WIDGET_STACK` body).

### 7.3 TimescaleSizeMonitor

Separate class because database size is an expensive query that should NEVER run on the flush tick:

```ts
private async poll(): Promise<void> {
  try {
    this._sizeBytes = await getTimescaleDatabaseSizeBytes();
    this._lastSuccessMs = Date.now();
  } catch (err) {
    // Hold previous value on error; suppress repeated logs to once per hour.
    const now = Date.now();
    if (now - this._lastWarnMs > 3_600_000) {
      console.warn('[TimescaleSizeMonitor] poll failed:', (err as Error).message);
      this._lastWarnMs = now;
    }
  }
}
```

Key properties:

- **Only instantiated on the TimescaleDbWriter path.** The null-writer boot does not create the monitor.
- **Poll cadence `TIMESCALE_SIZE_POLL_MS` (default 30 000 ms).** `pg_database_size()` is a stat-call sum over the DB's file tree — 10-50 ms on a warm DB. Polling at 30 s is effectively free.
- **Returns `null` until the first successful poll.** `sizeBytes` and `sizeGB` both return `null` while `_lastSuccessMs === 0`. Consumers (telemetry channel, widgets) can distinguish "no reading yet" from a true zero; `Trend_Info.DB_Size` publishes `null` on server restart instead of a misleading 0 GB.
- **Holds last value on error.** The widget shows the last successful reading; stale-but-useful is better than flashing zeros.
- **Log throttle one per hour.** Prevents log spam during extended outages.

The underlying query is in `packages/db/stats.ts`:

```ts
export async function getTimescaleDatabaseSizeBytes(): Promise<bigint> {
  const result = await timescalePool.query(
    'SELECT pg_database_size(current_database())::TEXT AS size'
  );
  return BigInt((result.rows[0] as { size: string }).size);
}
```

The explicit `::TEXT` cast is required because `node-pg` stringifies `bigint` returns by default; casting server-side and parsing to `BigInt` in JS makes the type path unambiguous.

---

## 8. Bad Quality Semantics

One row in the schema, one rule: `value IS NULL` means "bad quality." Every `NULL` in `tag_samples.value` is put there by a deliberate producer. Sources of `NULL`:

- **Watchdog stall sentinel.** `TelemetryIntake` enqueues one row per trendable tag with `value = null` at the moment a module transitions to timed-out.
- **FAULT with non-finite number.** `TimescaleDbWriter._coerce()` maps `NaN` and `±Inf` to `NULL`.
- **String value on a trendable tag.** Misconfiguration guard at the writer; produces one `NULL` row and a one-time warn.

Sources that do NOT produce `NULL`:

- Normal FAULT frames with real sensor values — those values flow through unchanged.
- Flatlined tags — they produce zero rows (COV filter).
- Historian unreachable — no rows produced at all; degraded state is signaled via `Error_Count` and `Trending`.

**Readers MUST treat `NULL` as a discontinuity.** Interpolating across a `NULL` sample would hide real quality gaps and misrepresent device behavior. This is a hard contract, not a convention.

---

## 9. Migrations

### 9.1 Migration System

`packages/db/timescaleMigrations.ts` is the Timescale-specific migration runner. It mirrors the main-Postgres runner in structure but:

- Reads from `db/timescale/migrations/` (not `db/postgres/migrations/`).
- Uses advisory lock ID **2** (main Postgres reserves ID 1).
- Maintains its own `schema_migrations` table in the Timescale database.

### 9.2 Flow

```
1. SELECT pg_advisory_lock(2)
2. CREATE TABLE IF NOT EXISTS schema_migrations (filename PK, applied_at DEFAULT NOW())
3. For each .sql file in db/timescale/migrations/ (filename sort):
   a. Check schema_migrations — skip if already applied.
   b. BEGIN
   c. Execute file contents.
   d. INSERT INTO schema_migrations (filename) VALUES (file)
   e. COMMIT (or ROLLBACK on error, then throw)
4. SELECT pg_advisory_unlock(2)
```

### 9.3 Idempotency

Every statement in `T001_create_tag_samples.sql` is idempotent by construction:

- `CREATE EXTENSION IF NOT EXISTS`
- `CREATE TABLE IF NOT EXISTS`
- `create_hypertable(..., if_not_exists => TRUE)`
- `CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ... SET (...)` — setting the same compression options twice is a no-op.
- `add_compression_policy(..., if_not_exists => TRUE)`
- `add_retention_policy(..., if_not_exists => TRUE)`

Belt-and-suspenders: even without `schema_migrations` tracking, running the migration twice is safe.

### 9.4 Advisory Lock Rationale

Multiple HMI processes started simultaneously (e.g. rolling restart) would otherwise race on migration. The advisory lock serializes: the second process blocks on step 1, wakes up after the first is done, and sees all migrations already in `schema_migrations`.

---

## 10. Boot & Shutdown Sequence

### 10.1 Startup Order

From `apps/caro-hmi/server/src/index.ts`:

1. `ping()` — main Postgres reachable? Fail → `process.exit(1)`.
2. `runMigrations()` — main Postgres migrations. Fail → `process.exit(1)`.
3. `getActiveTags()` → `loadTagMap()` — build `tagMap`, `moduleTagIds`, `trendableTagIds`.
4. **Writer selection:**
   ```ts
   let dbWriter: DbWriter = new NullDbWriter();
   let sizeMonitor: TimescaleSizeMonitor | undefined;
   try {
     await pingTimescale();
     try {
       await runTimescaleMigrations();
       dbWriter = new TimescaleDbWriter();
       sizeMonitor = new TimescaleSizeMonitor();
       sizeMonitor.start();
     } catch (err) {
       // migration failed — stay on NullDbWriter
     }
   } catch (err) {
     // timescale unreachable — stay on NullDbWriter
   }
   const dbPipeline = new DbPipeline(dbWriter);
   ```
5. `TelemetryIntake` constructed with `dbPipeline`. Watchdog started.
6. `HmiTagSource` constructed with `dbPipeline` + `sizeMonitor`. Publish timer started.
7. MQTT bridge, CmdController, ResetBus, HTTP, WS.
8. `dbPipeline.start()` — begins flush tick.
9. `mqttBridge.start()` — soft-fail (dev convenience; REST+WS still serve from LKV).
10. HTTP listen.

**Critical detail:** `dbPipeline` is always wired — either to `TimescaleDbWriter` (happy path) or to `NullDbWriter` (degraded path). Application code never branches on whether trending "works"; the pipeline absorbs the variance.

### 10.2 Degraded Boot Behavior

When Timescale is unreachable at boot:

```
[hmi] timescale unreachable, starting with null historian writer; reason=<message>
[DbPipeline] started: tickMs=500, queueMax=5000, maxEntriesPerFlush=500, writer=null
```

Expected operator-visible state:

- `Trend_Info.Trending` = `false`
- `Trend_Info.Error_Count` climbs at 2 Hz (one per flush tick) up to 9999.
- `Trend_Info.Queue_Depth` grows until it hits 5000, then `Dropped_Pkgs` climbs.
- `Trend_Info.Rows_Per_Sec` = 0.
- `Trend_Info.DB_Size` = 0 (size monitor not created on degraded boot).

**Current limitation:** this state is terminal until HMI restart. Periodic reconnect (NullDbWriter → TimescaleDbWriter without restart) is an open TODO.

### 10.3 Shutdown Order

```ts
const shutdown = async (signal: string): Promise<void> => {
  hmiTags.stopPublishing();
  intake.stopWatchdog();
  trendSnapshotScheduler.stop();
  if (sizeMonitor) await sizeMonitor.stop();
  await dbPipeline.stop();
  await mqttBridge.stop().catch(() => {});
  wsServer.stop();
  httpServer.close(() => process.exit(0));
};
```

Key point: `dbPipeline.stop()` awaits the current in-flight flush before clearing its timer. No partial writes are orphaned, and no in-memory queue entries are persisted — anything still in the queue at shutdown is lost. A bounded grace window is intentional: unbounded drain could hang indefinitely if the historian is slow, and the 14-day retention policy means a few seconds of lost trending is acceptable.

---

## 11. Environment Configuration

### 11.1 Main Postgres (tag registry, migrations, live queries)

Consumed by `packages/db/pool.ts`:

| Var | Default | Notes |
|-----|---------|-------|
| `POSTGRES_HOST` | `localhost` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DATABASE` | `caro_dev` | |
| `POSTGRES_USER` | `postgres` | |
| `POSTGRES_PASSWORD` | (required) | Startup warns if unset; connections will fail. |

### 11.2 TimescaleDB (historian)

Consumed by `packages/db/timescalePool.ts`:

| Var | Default | Notes |
|-----|---------|-------|
| `TIMESCALE_HOST` | `localhost` | |
| `TIMESCALE_PORT` | `5433` | Non-5432 default to coexist with main Postgres on the same host in dev. |
| `TIMESCALE_DATABASE` | `caro_timescale` | |
| `TIMESCALE_USER` | `postgres` | |
| `TIMESCALE_PASSWORD` | (required) | Startup warns if unset. |

### 11.3 Pipeline Tuning

Consumed by `DbPipeline` constructor:

| Var | Default | Notes |
|-----|---------|-------|
| `TIMESCALE_DB_TICK_MS` | `500` | Flush cadence. Also drives `Rows_Per_Sec` and `Trending` evaluation. |
| `TIMESCALE_DB_QUEUE_MAX` | `5000` | Max in-memory queue size. Oldest-first eviction on overflow. |
| `TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH` | `500` | Batch cap per flush tick. |

### 11.4 Size Monitor

Consumed by `TimescaleSizeMonitor`:

| Var | Default | Notes |
|-----|---------|-------|
| `TIMESCALE_SIZE_POLL_MS` | `30000` | `pg_database_size()` poll cadence. |

### 11.5 Rules of the Road

- `DATABASE_URL` is **never** used anywhere in CARO_Platform. Any PR adding it should be rejected.
- Each app reads its own `server/.env`. The root `.env` is for shared dev-convenience (e.g. `docker-compose.timescale.yml` variable substitution) and is never loaded by an app process.
- Changing a tuning var requires HMI restart to take effect — no runtime reconfig.

---

## 12. Development Setup

### 12.1 docker-compose.timescale.yml

```yaml
services:
  timescale:
    image: timescale/timescaledb:latest-pg16
    container_name: caro-timescale
    restart: unless-stopped
    environment:
      POSTGRES_USER:     ${TIMESCALE_USER:-caro}
      POSTGRES_PASSWORD: ${TIMESCALE_PASSWORD:-caro}
      POSTGRES_DB:       ${TIMESCALE_DATABASE:-caro_historian}
    ports:
      - "${TIMESCALE_HOST_PORT:-5433}:5432"
    volumes:
      - ${TIMESCALE_DATA_DIR:-./timescale-data}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${TIMESCALE_USER:-caro} -d ${TIMESCALE_DATABASE:-caro_historian}"]
      interval: 5s
      timeout: 5s
      retries: 10
```

### 12.2 Port Mapping

Host port **5433** → container port 5432. The shift lets a main-Postgres container (or native install) run on the default 5432 on the same host. This is the reason `TIMESCALE_PORT` defaults to 5433 while `POSTGRES_PORT` defaults to 5432.

### 12.3 Data Directory

`TIMESCALE_DATA_DIR` defaults to `./timescale-data` (repo-local) for dev ergonomics. In production or on the testing machine, override to a roomy drive (e.g. `F:\TimescaleDB`). The docker-compose mounts whatever path is set.

### 12.4 Credentials

The compose defaults (`caro/caro/caro_historian`) are dev-only. Production must override all three via a local `.env`. `pg_isready` in the healthcheck uses the same values; overriding only `TIMESCALE_PASSWORD` will leave the healthcheck running as `caro/caro_historian` and succeed deceptively — override the full triplet.

See also `Docs/hmi_timescale_setup.md` for Windows install steps.

---

## 13. Storage Budget Math

Budget: **~57.5 GB** (50% of a 115 GB SSD partition).

Worst case: 360 trendable tags × 10 Hz COV × 14 days.

- **Per-row footprint (uncompressed):** ~32 B (16 B for the row header + 8 B ts + 4 B tag_id + 8 B value, minus nullable optimization).
- **Uncompressed daily:** 360 × 10 × 86 400 × 32 B ≈ **9.6 GB/day**. (Worst case — assumes every tag changes every tick, which is implausible in practice.)
- **With compression (~15× ratio, applied at 10 min age):** roughly 82 MB/hour ≈ 2 GB/day ≈ 28 GB over 14-day retention.
- **14-day worst-case total:** ~28 GB compressed + ~1.5 GB uncompressed rolling window ≈ **29.5 GB**.

Realistic case (10% active COV): ~3 GB total.

Even at pessimistic 100% COV, the 57.5 GB budget is comfortably oversized for the current configuration. Relaxing retention to 30 days would push the worst case to ~60 GB, which approaches the budget ceiling — plan accordingly before extending retention.

---

## 14. File Map

### 14.1 HMI Server

| File | Role |
|------|------|
| `apps/caro-hmi/server/src/index.ts` | Boot: writer selection, pipeline wiring, shutdown. |
| `apps/caro-hmi/server/src/db-pipeline.ts` | `DbWriter` interface, `DbWriteEntry`, `NullDbWriter`, `DbPipeline` class. |
| `apps/caro-hmi/server/src/timescale-writer.ts` | `TimescaleDbWriter` (coercion + bulk insert). |
| `apps/caro-hmi/server/src/timescale-size-monitor.ts` | Size poller for `Trend_Info.DB_Size`. |
| `apps/caro-hmi/server/src/telemetry-intake.ts` | COV enqueue, FAULT pass-through, watchdog sentinel. |
| `apps/caro-hmi/server/src/hmi-tag-source.ts` | `updateTrendInfoTags()` maps pipeline/monitor state to the seven observability tags. |

### 14.2 Shared DB Package

| File | Role |
|------|------|
| `packages/db/timescalePool.ts` | Lazy singleton pool for the Timescale database. |
| `packages/db/samples.ts` | `pingTimescale()`, `writeTagSamples()`. |
| `packages/db/stats.ts` | `getTimescaleDatabaseSizeBytes()`. |
| `packages/db/timescaleMigrations.ts` | Migration runner (advisory lock ID 2). |

### 14.3 Schema

| File | Role |
|------|------|
| `db/timescale/migrations/T001_create_tag_samples.sql` | Hypertable + index + compression + retention. |

### 14.4 UI

| File | Role |
|------|------|
| `apps/caro-hmi/ui/.../TrendStatusBox.tsx` | Seven-row STATUS_BOX widget on the System Overview page. |

### 14.5 Ops

| File | Role |
|------|------|
| `docker-compose.timescale.yml` | Local dev TimescaleDB. |
| `Docs/hmi_timescale_setup.md` | Host-specific install notes (Windows). |
| `Docs/CARO_DB_Spec.md` §9 | Formal database spec (schema, config resolution). |

---

## 15. Known Limitations & Future Work

### 15.1 NullDbWriter is terminal

If Timescale is unreachable at HMI boot, the pipeline runs with `NullDbWriter` until HMI is restarted. A periodic reconnect path (retry `pingTimescale()` every N minutes, swap in `TimescaleDbWriter` on success without restart) is a TODO.

### 15.2 No firmware-level deadband

COV is computed against exact equality in `LkvCache.set()`. A value oscillating between 9.999 and 10.001 produces full-rate traffic. MQTT device firmware should eventually apply per-tag deadbands to filter sensor noise at the source; until then, the historian stores the noise.

### 15.3 No per-tag sample-rate classes

All trendable tags share one hypertable, one retention policy, one compression cadence. Slow-changing setpoints and fast-changing flow rates are treated identically. A future refinement could route different classes to different hypertables or apply different policies per `tag_id` range.

### 15.4 No runtime reconfig

Changing `TIMESCALE_DB_TICK_MS` or any tuning var requires HMI restart. Most operators prefer this — the HMI is not a high-uptime service and restarts are cheap — but a SIGHUP path could be added if needed.

### 15.5 `queueLength` getter is test-only

The public `DbPipeline` surface exposes `queueLength` (live) in addition to `queueDepth` (tick-held). Only tests read `queueLength` today. A future cleanup could make it `internal` or remove it and expose a `flush()` method for test convenience instead.

---

## 16. Glossary

**COV (Change-of-Value).** The policy of only recording a sample when the value actually differs from the previous one. Implemented in `LkvCache.set()` via exact-equality comparison. Saves orders of magnitude of storage versus polling.

**Chunk.** A time-bounded partition of a TimescaleDB hypertable. `tag_samples` uses 1 h chunks (T004). Compression and retention operate at chunk granularity.

**Flush tick.** The `DbPipeline`'s async timer callback. Runs every `TIMESCALE_DB_TICK_MS`, attempts a batch write, updates tick-held metrics.

**inFlight guard.** The check at the top of `flushOnce()` that skips the tick if the previous tick's `writer.write()` is still awaiting. Prevents overlapping writes during slow I/O.

**LKV (Last Known Value).** The in-memory cache of the most recent value per `tag_id`. Produces WebSocket snapshots and drives COV detection.

**Null sentinel.** A row in `tag_samples` with `value = NULL`. Means bad quality / discontinuity. Produced at watchdog stall transitions, at non-finite numeric coercion, and at misconfigured string drops.

**Peek-then-consume.** The flush pattern where entries are sliced from the queue (peek), the write attempted, and only on success are the peeked entries removed from the queue (consume). Ensures failed writes don't lose data and writers don't have to be idempotent.

**Pre-peek snapshot.** `queueDepth` is sampled at the top of `flushOnce()`, before the peek. This is "how many entries did this tick face," not "how many are still queued after the splice" — the operator-useful framing.

**Tick-held.** A metric computed once per flush tick (500 ms) and latched for the full interval. Opposed to live sampling, which can show sub-tick noise.

**Trendable.** A tag with `trend = true` in `tag_registry` AND a non-array `data_type`. Only trendable tags are enqueued to the historian.

**Writer.** An implementation of `DbWriter`. Two exist today: `TimescaleDbWriter` (real) and `NullDbWriter` (fallback). Both throw on failure; the pipeline counts errors.
