import timescalePool from './pool.js';

const LOG_TILE_QUERIES = process.env.TIMESCALE_LOG_TILE_QUERIES === '1';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RawTrendSeries {
  tagId: number;
  ts: bigint[];
  value: (number | null)[];
  /** Most recent sample in [startTime - 5 min, startTime) per §5.5 bounded-prev contract. */
  prev?: { ts: bigint; value: number | null };
}

export interface AggregateTrendSeries {
  tagId: number;
  value: (number | null)[];
  min:   (number | null)[];
  max:   (number | null)[];
}

export interface RawTrendTile {
  source: 'raw';
  startTime: bigint;
  endTime: bigint;
  series: RawTrendSeries[];
}

/**
 * startTime is the start of the FIRST bucket in the served grid, which may be
 * earlier than the requested startTime when the range is not bucket-aligned.
 * endTime is the end of the LAST bucket. n is the actual row count — equals
 * bucketCount for aligned requests, bucketCount+1 for unaligned.
 * source is 'mixed' when watermark fall-through stitched portions from multiple
 * sources (§4.3). Raw-as-aggregate fall-through also yields 'mixed'.
 * bucketSMs is always an integer — derived as Math.round(spanMs / bucketCount).
 */
export interface AggregateTrendTile {
  source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'mixed';
  startTime: bigint;
  endTime: bigint;
  bucketSMs: number;
  n: number;
  series: AggregateTrendSeries[];
}

export type TrendTile = RawTrendTile | AggregateTrendTile;

// ── Helpers ────────────────────────────────────────────────────────────────────


function codeError(message: string, code: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  return err;
}

// ── Source types and fallthrough ladder ───────────────────────────────────────
//
// CaggSource: one of the four CAG view names.
// AggregateSource: CaggSource | 'tag_samples' (raw is the terminal fall-through target).
//
// nextFinerSource() maps each level to the next smaller-bucket source.
// sourceDisplayName() maps to the response's source label.

type CaggSource =
  | 'tag_samples_1s_cagg'
  | 'tag_samples_10s_cagg'
  | 'tag_samples_1min_cagg'
  | 'tag_samples_10min_cagg';

type AggregateSource = CaggSource | 'tag_samples';

function nextFinerSource(s: AggregateSource): AggregateSource {
  switch (s) {
    case 'tag_samples_10min_cagg': return 'tag_samples_1min_cagg';
    case 'tag_samples_1min_cagg':  return 'tag_samples_10s_cagg';
    case 'tag_samples_10s_cagg':   return 'tag_samples_1s_cagg';
    case 'tag_samples_1s_cagg':    return 'tag_samples';
    case 'tag_samples':            throw new Error('no finer source than tag_samples (raw)');
  }
}

function sourceDisplayName(s: AggregateSource): '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'raw' {
  if (s === 'tag_samples') return 'raw';
  return s.replace('tag_samples_', '') as '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg';
}

// ── Test seams ─────────────────────────────────────────────────────────────────
//
// __test_watermarkOverride: production leaves null. Tests set current to a
// Map<string, number> (ms since epoch) keyed by source name to deterministically
// control fall-through. Reset to null in afterEach.
//
// __test_lastUsedSources: populated by getTrendTile after each aggregate call so
// integration tests can assert which sources the recursion reached. Set<string>
// so cross-package imports don't need the private AggregateSource type.
//
// __test_getWatermarkMs: direct access to the watermark catalog query so tests
// can assert the live path without going through getTrendTile.

export const __test_watermarkOverride: { current: Map<string, number> | null } = {
  current: null,
};

export const __test_lastUsedSources: { current: Set<string> } = { current: new Set() };

export async function __test_getWatermarkMs(source: string): Promise<number> {
  return getWatermarkMs(source as AggregateSource);
}

// ── Watermark lookup ──────────────────────────────────────────────────────────
//
// Returns the CAG's materialization watermark in ms since epoch.
// Returns Infinity for tag_samples (raw has no watermark — always current).
// Returns 0 if the CAG has never been refreshed (null watermark → fall through entirely).
//
// cagg_watermark() lives in _timescaledb_internal (confirmed in 2.26.3).
// It takes mat_hypertable_id (from _timescaledb_catalog.continuous_agg) and
// returns microseconds as bigint. Divide by 1000n for ms.
//
// Cost: <1 ms per call. Not cached — query once per request per level reached.

async function getWatermarkMs(source: AggregateSource): Promise<number> {
  if (source === 'tag_samples') return Infinity;

  if (__test_watermarkOverride.current !== null) {
    const v = __test_watermarkOverride.current.get(source);
    if (v !== undefined) return v;
  }

  const result = await timescalePool.query(
    `SELECT _timescaledb_internal.cagg_watermark(ca.mat_hypertable_id) AS wm_us
     FROM _timescaledb_catalog.continuous_agg ca
     WHERE ca.user_view_schema = 'public'
       AND ca.user_view_name = $1`,
    [source],
  );

  const wmUs: string | null =
    (result.rows[0] as { wm_us: string | null } | undefined)?.wm_us ?? null;
  if (wmUs === null) return 0; // never refreshed — fall through entirely
  return Number(BigInt(wmUs) / 1000n);
}

// ── Raw query ──────────────────────────────────────────────────────────────────
//
// Returns COV samples in [startTime, endTime). No gapfill — raw is COV-driven.
// Per-tag arrays (ts, value) preserve sample chronology.
// Tags with no samples get { tagId, ts: [], value: [] }.

async function queryRaw(
  tagIds: number[],
  startTime: bigint,
  endTime: bigint,
): Promise<RawTrendTile> {
  const t0 = LOG_TILE_QUERIES ? performance.now() : 0;

  // Run the in-window query and the bounded-prev query in parallel (§5.5 contract).
  // Bounded-prev: latest sample per tag in [startTime - 5 min, startTime).
  // DISTINCT ON (tag_id) with ORDER BY tag_id, ts DESC returns the most recent row per tag.
  const [result, prevResult] = await Promise.all([
    timescalePool.query(
      `SELECT tag_id,
              (extract(epoch from ts) * 1000)::bigint AS ts_ms,
              value
       FROM tag_samples
       WHERE tag_id = ANY($1::int[])
         AND ts >= to_timestamp($2::bigint / 1000.0)
         AND ts <  to_timestamp($3::bigint / 1000.0)
       ORDER BY tag_id, ts`,
      [tagIds, startTime, endTime],
    ),
    timescalePool.query(
      `SELECT DISTINCT ON (tag_id)
              tag_id,
              (extract(epoch from ts) * 1000)::bigint AS ts_ms,
              value
       FROM tag_samples
       WHERE tag_id = ANY($1::int[])
         AND ts <  to_timestamp($2::bigint / 1000.0)
         AND ts >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
       ORDER BY tag_id, ts DESC`,
      [tagIds, startTime],
    ),
  ]);

  if (LOG_TILE_QUERIES) {
    console.log(
      `[trends] source=raw tag_count=${tagIds.length} bucket_s=0` +
      ` start=${startTime} end=${endTime} bucket_count=n/a elapsed_ms=${(performance.now() - t0).toFixed(1)}`,
    );
  }

  // Build prev map: tagId → most-recent prior sample within the 5-minute window.
  const prevMap = new Map<number, { ts: bigint; value: number | null }>();
  for (const row of prevResult.rows as { tag_id: number; ts_ms: bigint | string; value: number | null }[]) {
    prevMap.set(row.tag_id, { ts: BigInt(row.ts_ms), value: row.value });
  }

  const seriesMap = new Map<number, RawTrendSeries>();
  for (const id of tagIds) seriesMap.set(id, { tagId: id, ts: [], value: [] });

  for (const row of result.rows as { tag_id: number; ts_ms: bigint | string; value: number | null }[]) {
    const series = seriesMap.get(row.tag_id);
    if (!series) continue;
    series.ts.push(BigInt(row.ts_ms));
    series.value.push(row.value);
  }

  // Attach prev to each series that has a prior sample.
  for (const id of tagIds) {
    const series = seriesMap.get(id)!;
    const prev = prevMap.get(id);
    if (prev) series.prev = prev;
  }

  if (LOG_TILE_QUERIES) {
    for (const id of tagIds) {
      const p = prevMap.get(id);
      console.log(`[trends] raw prev tag=${id} ${p ? `ts=${p.ts} value=${p.value}` : 'none'}`);
    }
  }

  return {
    source: 'raw',
    startTime,
    endTime,
    series: tagIds.map(id => seriesMap.get(id)!),
  };
}

// ── Segment result ─────────────────────────────────────────────────────────────

interface SegmentResult {
  servedStart: number;  // ms — start of first bucket
  servedEnd: number;    // ms — end of last bucket
  n: number;            // bucket count in this segment
  valuesByTag: Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>;
}

// ── AggRow (shared by both SQL templates) ──────────────────────────────────────

type AggRow = {
  tag_id: number;
  gf_bucket: Date;  // node-postgres returns TimescaleDB timestamps as Date objects
  val: number | null;
  bucket_min: number | null;
  bucket_max: number | null;
  bucket_null_count: string | number | null;
};

// ── Query one segment from one source ─────────────────────────────────────────
//
// Both CAG and raw-as-aggregate use the §5.5 gapfill+locf+bounded-prev template.
// Column names differ: CAG uses bucket/last/null_count; raw uses ts/value.
//
// DO NOT use named prepared statements (generic-plan regime breaks chunk pruning).

async function querySegment(
  source: AggregateSource,
  tagIds: number[],
  startTime: bigint,
  endTime: bigint,
  bucketSMs: number,
  cutoffMs: bigint,
): Promise<SegmentResult> {
  const t0 = LOG_TILE_QUERIES ? performance.now() : 0;

  let sql: string;
  if (source === 'tag_samples') {
    // Raw-as-aggregate: gapfill+locf on raw tag_samples.
    // Distinct from queryRaw() — returns bucketed values, not COV samples.
    sql = `
      WITH gapfilled AS (
        SELECT s.tag_id,
               time_bucket_gapfill(
                 $1::int * INTERVAL '1 millisecond',
                 s.ts,
                 to_timestamp($2::bigint / 1000.0),
                 to_timestamp($3::bigint / 1000.0)
               ) AS gf_bucket,
               locf(
                 last(s.value, s.ts),
                 prev => (SELECT value FROM tag_samples
                           WHERE tag_id = s.tag_id
                             AND ts <  to_timestamp($2::bigint / 1000.0)
                             AND ts >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
                           ORDER BY ts DESC
                           LIMIT 1)
               ) AS val,
               min(s.value) AS bucket_min,
               max(s.value) AS bucket_max,
               count(*) FILTER (WHERE s.value IS NULL) AS bucket_null_count
        FROM tag_samples s
        WHERE s.tag_id = ANY($4::int[])
          AND s.ts >= to_timestamp($2::bigint / 1000.0)
          AND s.ts <  to_timestamp($3::bigint / 1000.0)
        GROUP BY s.tag_id, gf_bucket
      )
      SELECT tag_id,
             gf_bucket,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE val        END AS val,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_min END AS bucket_min,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_max END AS bucket_max,
             bucket_null_count
      FROM gapfilled
      ORDER BY tag_id, gf_bucket
    `;
  } else {
    // CAG source: uses bucket/last/null_count columns.
    // Source table is a closed literal from CaggSource — never from user input.
    sql = `
      WITH gapfilled AS (
        SELECT s.tag_id,
               time_bucket_gapfill(
                 $1::int * INTERVAL '1 millisecond',
                 s.bucket,
                 to_timestamp($2::bigint / 1000.0),
                 to_timestamp($3::bigint / 1000.0)
               ) AS gf_bucket,
               locf(
                 last(s.last, s.bucket),
                 prev => (SELECT last FROM ${source}
                           WHERE tag_id = s.tag_id
                             AND bucket <  to_timestamp($2::bigint / 1000.0)
                             AND bucket >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
                           ORDER BY bucket DESC
                           LIMIT 1)
               ) AS val,
               min(s.min) AS bucket_min,
               max(s.max) AS bucket_max,
               sum(s.null_count) AS bucket_null_count
        FROM ${source} s
        WHERE s.tag_id = ANY($4::int[])
          AND s.bucket >= to_timestamp($2::bigint / 1000.0)
          AND s.bucket <  to_timestamp($3::bigint / 1000.0)
        GROUP BY s.tag_id, gf_bucket
      )
      SELECT tag_id,
             gf_bucket,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE val        END AS val,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_min END AS bucket_min,
             CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_max END AS bucket_max,
             bucket_null_count
      FROM gapfilled
      ORDER BY tag_id, gf_bucket
    `;
  }

  const result = await timescalePool.query(sql, [bucketSMs, startTime, endTime, tagIds, cutoffMs]);

  if (LOG_TILE_QUERIES) {
    console.log(
      `[trends] source=${sourceDisplayName(source)} tag_count=${tagIds.length}` +
      ` bucket_s=${bucketSMs / 1000} start=${startTime} end=${endTime}` +
      ` elapsed_ms=${(performance.now() - t0).toFixed(1)}`,
    );
  }

  // Collect per-tag arrays (value/min/max) and track the first/last bucket timestamp.
  const valuesByTag = new Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>();
  for (const id of tagIds) valuesByTag.set(id, { value: [], min: [], max: [] });

  let firstBucketMs: number | null = null;
  let lastBucketMs:  number | null = null;

  for (const row of result.rows as AggRow[]) {
    const arrs = valuesByTag.get(row.tag_id);
    if (!arrs) continue;
    const bucketMs = row.gf_bucket.getTime();
    if (firstBucketMs === null || bucketMs < firstBucketMs) firstBucketMs = bucketMs;
    if (lastBucketMs  === null || bucketMs > lastBucketMs)  lastBucketMs  = bucketMs;

    const nullCount = row.bucket_null_count != null ? Number(row.bucket_null_count) : 0;

    if (nullCount > 0) {
      // Mixed-null bucket — null-as-gap rule (§2.1).
      arrs.value.push(null);
      arrs.min.push(null);
      arrs.max.push(null);
    } else if (row.bucket_min === null) {
      // Empty (gapfilled) bucket — COV semantics: value held constant.
      // Band collapses to the LOCF'd last. May itself be null at the leading
      // edge if the bounded prev lookup returned NULL; that's correct.
      arrs.value.push(row.val);
      arrs.min.push(row.val);
      arrs.max.push(row.val);
    } else {
      // Normal bucket — measured spread.
      arrs.value.push(row.val);
      arrs.min.push(row.bucket_min);
      arrs.max.push(row.bucket_max);
    }
  }

  // Compute the served bucket grid for this segment.
  //
  // All-absent fallback: when no tag has rows, gapfill emits nothing.
  // Derive n from epoch-alignment math aligned to the Postgres epoch (2000-01-01),
  // which is what TimescaleDB time_bucket() uses as its origin for sub-day intervals.
  //   n = ceil((endMs - PG) / B) - floor((startMs - PG) / B)
  // Math.floor handles negative offsets correctly (rounds toward -Infinity).
  const sMs = Number(startTime);
  const eMs = Number(endTime);
  let n: number;
  let servedStart: number;
  let servedEnd: number;

  if (firstBucketMs !== null) {
    n           = Math.round((lastBucketMs! - firstBucketMs) / bucketSMs) + 1;
    servedStart = firstBucketMs;
    servedEnd   = firstBucketMs + n * bucketSMs;
  } else {
    // No rows: gapfill emits nothing when every tag has zero source rows.
    // Derive the bucket grid via an actual time_bucket() query — the JS formula
    // using POSTGRES_EPOCH_MS gives wrong alignment for interval-type buckets
    // (TimescaleDB 2.26.3 does not align interval buckets to either epoch).
    const alignResult = await timescalePool.query(
      `SELECT extract(epoch from
                time_bucket($1::int * INTERVAL '1 millisecond',
                            to_timestamp($2::bigint / 1000.0))
              ) * 1000 AS first_ms`,
      [bucketSMs, startTime],
    );
    const firstMs = Number((alignResult.rows[0] as { first_ms: string | number }).first_ms);
    n             = Math.ceil((eMs - firstMs) / bucketSMs);
    servedStart   = firstMs;
    servedEnd     = firstMs + n * bucketSMs;
  }

  // Tags completely absent from this segment get null×n to fill the grid.
  // Tags with rows must match n exactly (gapfill invariant; check value length — all
  // three arrays are built in lockstep so one check suffices).
  for (const id of tagIds) {
    const arrs = valuesByTag.get(id)!;
    if (arrs.value.length === 0) {
      valuesByTag.set(id, {
        value: new Array<number | null>(n).fill(null),
        min:   new Array<number | null>(n).fill(null),
        max:   new Array<number | null>(n).fill(null),
      });
    } else if (arrs.value.length !== n) {
      throw new Error(
        `querySegment: tag ${id} yielded ${arrs.value.length} buckets but grid is ${n}` +
        ` — gapfill output is inconsistent (source=${source}, bucketSMs=${bucketSMs})`,
      );
    }
  }

  return { servedStart, servedEnd, n, valuesByTag };
}

// ── Recursive fall-through ────────────────────────────────────────────────────
//
// Serves [startTime, endTime) from `source`, recursing to the next-finer source
// for any portion that extends past the source's materialization watermark.
//
// Split boundary is rounded DOWN to the nearest bucket boundary at bucketSMs,
// so the CAG half and the finer-source half cover disjoint bucket sets.
//
// Raw (tag_samples) is always current — Infinity watermark, no recursion.

async function queryRecursive(
  source: AggregateSource,
  tagIds: number[],
  startTime: bigint,
  endTime: bigint,
  bucketSMs: number,
  cutoffMs: bigint,
): Promise<{ segments: SegmentResult[]; usedSources: Set<AggregateSource> }> {
  const watermarkMs = await getWatermarkMs(source);
  const endTimeMs   = Number(endTime);

  if (source === 'tag_samples' || endTimeMs <= watermarkMs) {
    // Full range is covered by this source — no fall-through.
    __test_lastUsedSources.current.add(source);
    const seg = await querySegment(source, tagIds, startTime, endTime, bucketSMs, cutoffMs);
    return { segments: [seg], usedSources: new Set([source]) };
  }

  // Fall-through needed. Compute the split point: the bucket boundary at or
  // below the watermark (so the CAG half only covers fully-materialized buckets).
  // Query the actual time_bucket() result from TimescaleDB — TimescaleDB 2.26.3's
  // interval-type buckets use a non-obvious alignment that does not match either
  // the Unix or Postgres epoch, so a DB round-trip is required.
  const splitResult = await timescalePool.query(
    `SELECT extract(epoch from
              time_bucket($1::int * INTERVAL '1 millisecond',
                          to_timestamp($2::bigint / 1000.0))
            ) * 1000 AS split_ms`,
    [bucketSMs, BigInt(watermarkMs)],
  );
  const splitBoundaryMs = Number((splitResult.rows[0] as { split_ms: string | number }).split_ms);

  if (splitBoundaryMs <= Number(startTime)) {
    // Nothing in this source covers the requested range — fall through entirely.
    // This source contributed no data; do NOT add it to __test_lastUsedSources.
    const finer = nextFinerSource(source);
    return queryRecursive(finer, tagIds, startTime, endTime, bucketSMs, cutoffMs);
  }

  // Split: CAG covers [startTime, splitBoundary); finer source covers [splitBoundary, endTime).
  __test_lastUsedSources.current.add(source);
  const splitBoundary = BigInt(splitBoundaryMs);
  const finer         = nextFinerSource(source);

  // Pass splitBoundary - 1n to the left segment's endTime so that gapfill's
  // finish is 1 ms before the boundary bucket start. Since splitBoundaryMs is
  // an exact bucket boundary (from time_bucket()), finish = boundary - 1 lands
  // inside the PRIOR bucket, so gapfill does not emit the boundary bucket in
  // the left half. The right half then owns that bucket exclusively.
  const [leftSeg, rightResult] = await Promise.all([
    querySegment(source, tagIds, startTime, splitBoundary - 1n, bucketSMs, cutoffMs),
    queryRecursive(finer, tagIds, splitBoundary, endTime, bucketSMs, cutoffMs),
  ]);

  return {
    segments:    [leftSeg, ...rightResult.segments],
    usedSources: new Set([source, ...rightResult.usedSources]),
  };
}

// ── Public entry point ─────────────────────────────────────────────────────────

export async function getTrendTile(
  tagIds: number[],
  startTime: bigint,
  endTime: bigint,
  bucketCount: number,
): Promise<TrendTile> {
  // ── Validation ──────────────────────────────────────────────────────────────

  if (
    !Array.isArray(tagIds) ||
    tagIds.length === 0 ||
    tagIds.length > 8 ||
    tagIds.some(id => !Number.isInteger(id) || id <= 0)
  ) {
    throw codeError(
      'tagIds must be a non-empty array of 1–8 positive integers',
      'INVALID_TAG_IDS',
    );
  }

  if (startTime <= 0n || endTime <= 0n || endTime <= startTime) {
    throw codeError(
      'endTime must be greater than startTime; both must be positive',
      'INVALID_RANGE',
    );
  }

  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 2500) {
    throw codeError('bucketCount must be an integer in 1..2500', 'INVALID_BUCKET_COUNT');
  }

  // Derive bucketSMs as an integer first; bucketS follows exactly from it.
  // Computing bucketS = spanMs / (bucketCount * 1000) directly risks a fractional
  // result — e.g., 1_555_250 ms / 250_000 = 6.221 which round-trips to
  // bucketSMs = 6220.8 (float error). Computing integer ms first eliminates this.
  const bucketSMs = Math.round(Number(endTime - startTime) / bucketCount);
  const bucketS   = bucketSMs / 1000;

  if (bucketS <= 0 || bucketS > 14746) {
    throw codeError(
      `Derived bucketS ${bucketS} is outside the valid range (0, 14746]`,
      'INVALID_BUCKET_S',
    );
  }

  // ── Raw dispatch (bucketS < 1.0) — no watermark fall-through ────────────────

  if (bucketS < 1.0) {
    return queryRaw(tagIds, startTime, endTime);
  }

  // ── Aggregate dispatch (§6.3) ────────────────────────────────────────────────

  let dispatchSource: CaggSource;
  if      (bucketS < 16)   dispatchSource = 'tag_samples_1s_cagg';
  else if (bucketS < 160)  dispatchSource = 'tag_samples_10s_cagg';
  else if (bucketS < 1600) dispatchSource = 'tag_samples_1min_cagg';
  else                     dispatchSource = 'tag_samples_10min_cagg';

  // ── Data-extent cutoff ───────────────────────────────────────────────────────
  // Gapfill+LOCF propagates past the last real sample into future buckets.
  // Query MAX(ts) once and null out any gf_bucket beyond that point in each segment.
  const cutoffResult = await timescalePool.query(
    `SELECT EXTRACT(EPOCH FROM COALESCE(MAX(ts), 'infinity'::timestamptz)) * 1000 AS cutoff_ms
     FROM tag_samples
     WHERE tag_id = ANY($1)`,
    [tagIds],
  );
  const rawCutoffMs = Number(cutoffResult.rows[0].cutoff_ms);
  const cutoffMs: bigint = Number.isFinite(rawCutoffMs)
    ? BigInt(Math.floor(rawCutoffMs))
    : 9_999_999_999_999n; // no data → far-future sentinel, CASE never fires

  __test_lastUsedSources.current = new Set();
  const { segments, usedSources } = await queryRecursive(
    dispatchSource, tagIds, startTime, endTime, bucketSMs, cutoffMs,
  );

  // ── Remove seam duplicates ──────────────────────────────────────────────────
  //
  // time_bucket_gapfill generates one extra bucket past its finish argument:
  // the bucket at time_bucket(finish) + bucket_width. When the left half's
  // finish is splitBoundary - 1ms, this extra bucket lands exactly at
  // splitBoundary — the same bucket the right half starts at. Drop it from the
  // left half; the finer-source value from the right half is preferred.
  for (let i = 0; i < segments.length - 1; i++) {
    const left  = segments[i]!;
    const right = segments[i + 1]!;
    if (left.servedEnd - bucketSMs === right.servedStart) {
      for (const arrs of left.valuesByTag.values()) {
        arrs.value.pop();
        arrs.min.pop();
        arrs.max.pop();
      }
      left.n       -= 1;
      left.servedEnd -= bucketSMs;
    }
  }

  // ── Merge segments ──────────────────────────────────────────────────────────

  const totalN          = segments.reduce((sum, s) => sum + s.n, 0);
  const servedStartTime = BigInt(segments[0].servedStart);
  const servedEndTime   = BigInt(segments[segments.length - 1].servedEnd);

  // Defensive: merged n must match the natural gapfill grid for the full range.
  if (totalN !== bucketCount && totalN !== bucketCount + 1) {
    throw new Error(
      `getTrendTile: unexpected merged bucket count ${totalN},` +
      ` expected ${bucketCount} or ${bucketCount + 1}` +
      ` (source=${dispatchSource}, bucketS=${bucketS}, start=${startTime}, end=${endTime})`,
    );
  }

  const series: AggregateTrendSeries[] = tagIds.map(id => {
    const value: (number | null)[] = [];
    const min:   (number | null)[] = [];
    const max:   (number | null)[] = [];
    for (const seg of segments) {
      const segArrs = seg.valuesByTag.get(id);
      if (segArrs) {
        value.push(...segArrs.value);
        min.push(...segArrs.min);
        max.push(...segArrs.max);
      } else {
        value.push(...new Array<number | null>(seg.n).fill(null));
        min.push(...new Array<number | null>(seg.n).fill(null));
        max.push(...new Array<number | null>(seg.n).fill(null));
      }
    }
    return { tagId: id, value, min, max };
  });

  // ── Source label ─────────────────────────────────────────────────────────────
  // 'mixed' whenever any fall-through occurred (usedSources ≠ {dispatchSource}).
  // Single-source with no fall-through uses the dispatch source's display name.

  const source: AggregateTrendTile['source'] =
    (usedSources.size === 1 && usedSources.has(dispatchSource))
      ? (sourceDisplayName(dispatchSource) as Exclude<AggregateTrendTile['source'], 'mixed'>)
      : 'mixed';

  if (!Number.isInteger(bucketSMs)) {
    throw new Error(`getTrendTile: bucketSMs must be integer ms, got ${bucketSMs}`);
  }

  return { source, startTime: servedStartTime, endTime: servedEndTime, bucketSMs, n: totalN, series };
}

// ── getTrendExtent ─────────────────────────────────────────────────────────────

/**
 * Returns the global oldest and newest tag_samples timestamps in ms since epoch.
 * Returns { oldestMs: null, newestMs: null } when the hypertable is empty.
 * TimescaleDB resolves min/max via chunk metadata — no full table scan.
 */
export async function getTrendExtent(): Promise<{
  oldestMs: bigint | null;
  newestMs: bigint | null;
}> {
  const res = await timescalePool.query(
    `SELECT (extract(epoch from min(ts)) * 1000)::bigint AS oldest_ms,
            (extract(epoch from max(ts)) * 1000)::bigint AS newest_ms
     FROM tag_samples`,
  );
  const row = res.rows[0] as { oldest_ms: string | null; newest_ms: string | null };
  return {
    oldestMs: row.oldest_ms !== null ? BigInt(row.oldest_ms) : null,
    newestMs: row.newest_ms !== null ? BigInt(row.newest_ms) : null,
  };
}
