import timescalePool from './pool.js';

const LOG_TILE_QUERIES = process.env.TIMESCALE_LOG_TILE_QUERIES === '1';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RawTrendSeries {
  tagId: number;
  ts: bigint[];
  value: (number | null)[];
}

export interface AggregateTrendSeries {
  tagId: number;
  value: (number | null)[];
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
 */
export interface AggregateTrendTile {
  source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'mixed';
  startTime: bigint;
  endTime: bigint;
  bucketS: number;
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

// ── Watermark override (test seam) ─────────────────────────────────────────────
//
// Production leaves this null. Tests set current to a Map<AggregateSource, number>
// (ms since epoch) before each test to deterministically control fall-through.
// Reset to null in afterEach to restore production watermark queries.

export const __test_watermarkOverride: { current: Map<AggregateSource, number> | null } = {
  current: null,
};

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

  const result = await timescalePool.query(
    `SELECT tag_id,
            (extract(epoch from ts) * 1000)::bigint AS ts_ms,
            value
     FROM tag_samples
     WHERE tag_id = ANY($1::int[])
       AND ts >= to_timestamp($2::bigint / 1000.0)
       AND ts <  to_timestamp($3::bigint / 1000.0)
     ORDER BY tag_id, ts`,
    [tagIds, startTime, endTime],
  );

  if (LOG_TILE_QUERIES) {
    console.log(
      `[trends] source=raw tag_count=${tagIds.length} bucket_s=0` +
      ` start=${startTime} end=${endTime} bucket_count=n/a elapsed_ms=${(performance.now() - t0).toFixed(1)}`,
    );
  }

  const seriesMap = new Map<number, RawTrendSeries>();
  for (const id of tagIds) seriesMap.set(id, { tagId: id, ts: [], value: [] });

  for (const row of result.rows as { tag_id: number; ts_ms: bigint | string; value: number | null }[]) {
    const series = seriesMap.get(row.tag_id);
    if (!series) continue;
    series.ts.push(BigInt(row.ts_ms));
    series.value.push(row.value);
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
  servedStart: number;                          // ms — start of first bucket
  servedEnd: number;                            // ms — end of last bucket
  n: number;                                    // bucket count in this segment
  valuesByTag: Map<number, (number | null)[]>;  // n values per tag
}

// ── AggRow (shared by both SQL templates) ──────────────────────────────────────

type AggRow = {
  tag_id: number;
  gf_bucket: Date;  // node-postgres returns TimescaleDB timestamps as Date objects
  val: number | null;
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
  bucketS: number,
  bucketSMs: number,
): Promise<SegmentResult> {
  const t0 = LOG_TILE_QUERIES ? performance.now() : 0;

  let sql: string;
  if (source === 'tag_samples') {
    // Raw-as-aggregate: gapfill+locf on raw tag_samples.
    // Distinct from queryRaw() — returns bucketed values, not COV samples.
    sql = `
      SELECT s.tag_id,
             time_bucket_gapfill(
               make_interval(secs => $1::float8),
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
             count(*) FILTER (WHERE s.value IS NULL) AS bucket_null_count
      FROM tag_samples s
      WHERE s.tag_id = ANY($4::int[])
        AND s.ts >= to_timestamp($2::bigint / 1000.0)
        AND s.ts <  to_timestamp($3::bigint / 1000.0)
      GROUP BY s.tag_id, gf_bucket
      ORDER BY s.tag_id, gf_bucket
    `;
  } else {
    // CAG source: uses bucket/last/null_count columns.
    // Source table is a closed literal from CaggSource — never from user input.
    sql = `
      SELECT s.tag_id,
             time_bucket_gapfill(
               make_interval(secs => $1::float8),
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
             sum(s.null_count) AS bucket_null_count
      FROM ${source} s
      WHERE s.tag_id = ANY($4::int[])
        AND s.bucket >= to_timestamp($2::bigint / 1000.0)
        AND s.bucket <  to_timestamp($3::bigint / 1000.0)
      GROUP BY s.tag_id, gf_bucket
      ORDER BY s.tag_id, gf_bucket
    `;
  }

  const result = await timescalePool.query(sql, [bucketS, startTime, endTime, tagIds]);

  if (LOG_TILE_QUERIES) {
    console.log(
      `[trends] source=${sourceDisplayName(source)} tag_count=${tagIds.length}` +
      ` bucket_s=${bucketS} start=${startTime} end=${endTime}` +
      ` elapsed_ms=${(performance.now() - t0).toFixed(1)}`,
    );
  }

  // Collect per-tag value arrays and track the first/last bucket timestamp.
  const valuesByTag = new Map<number, (number | null)[]>();
  for (const id of tagIds) valuesByTag.set(id, []);

  let firstBucketMs: number | null = null;
  let lastBucketMs:  number | null = null;

  for (const row of result.rows as AggRow[]) {
    const arr = valuesByTag.get(row.tag_id);
    if (!arr) continue;
    const bucketMs = row.gf_bucket.getTime();
    if (firstBucketMs === null || bucketMs < firstBucketMs) firstBucketMs = bucketMs;
    if (lastBucketMs  === null || bucketMs > lastBucketMs)  lastBucketMs  = bucketMs;
    const nullCount = row.bucket_null_count != null ? Number(row.bucket_null_count) : 0;
    arr.push(nullCount > 0 ? null : row.val);
  }

  // Compute the served bucket grid for this segment.
  //
  // All-absent fallback: when no tag has rows, gapfill emits nothing.
  // Derive n from epoch-alignment math:
  //   n = ceil(endMs / B) - floor(startMs / B)
  // This equals (end - floor(start/B)*B) / B and correctly handles both
  // aligned and unaligned startTime for the sub-range.
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
    const firstMs = Math.floor(sMs / bucketSMs) * bucketSMs;
    n             = Math.ceil(eMs / bucketSMs) - Math.floor(sMs / bucketSMs);
    servedStart   = firstMs;
    servedEnd     = firstMs + n * bucketSMs;
  }

  // Tags completely absent from this segment get null×n to fill the grid.
  // Tags with rows must match n exactly (gapfill invariant).
  for (const id of tagIds) {
    const arr = valuesByTag.get(id)!;
    if (arr.length === 0) {
      valuesByTag.set(id, new Array<number | null>(n).fill(null));
    } else if (arr.length !== n) {
      throw new Error(
        `querySegment: tag ${id} yielded ${arr.length} buckets but grid is ${n}` +
        ` — gapfill output is inconsistent (source=${source}, bucketS=${bucketS})`,
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
  bucketS: number,
  bucketSMs: number,
): Promise<{ segments: SegmentResult[]; usedSources: Set<AggregateSource> }> {
  const watermarkMs = await getWatermarkMs(source);
  const endTimeMs   = Number(endTime);

  if (source === 'tag_samples' || endTimeMs <= watermarkMs) {
    // Full range is covered by this source — no fall-through.
    const seg = await querySegment(source, tagIds, startTime, endTime, bucketS, bucketSMs);
    return { segments: [seg], usedSources: new Set([source]) };
  }

  // Fall-through needed. Compute the split point: the bucket boundary at or
  // below the watermark (so the CAG half only covers fully-materialized buckets).
  const splitBoundaryMs = Math.floor(watermarkMs / bucketSMs) * bucketSMs;

  if (splitBoundaryMs <= Number(startTime)) {
    // Nothing in this source covers the requested range — fall through entirely.
    const finer = nextFinerSource(source);
    return queryRecursive(finer, tagIds, startTime, endTime, bucketS, bucketSMs);
  }

  // Split: CAG covers [startTime, splitBoundary); finer source covers [splitBoundary, endTime).
  // Run both in parallel — independent DB round-trips.
  const splitBoundary = BigInt(splitBoundaryMs);
  const finer         = nextFinerSource(source);

  const [leftSeg, rightResult] = await Promise.all([
    querySegment(source, tagIds, startTime, splitBoundary, bucketS, bucketSMs),
    queryRecursive(finer, tagIds, splitBoundary, endTime, bucketS, bucketSMs),
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

  const bucketS = Number(endTime - startTime) / (bucketCount * 1000);
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

  const bucketSMs = Math.round(bucketS * 1000);

  const { segments, usedSources } = await queryRecursive(
    dispatchSource, tagIds, startTime, endTime, bucketS, bucketSMs,
  );

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
    const values: (number | null)[] = [];
    for (const seg of segments) {
      const segValues = seg.valuesByTag.get(id) ?? new Array<number | null>(seg.n).fill(null);
      values.push(...segValues);
    }
    return { tagId: id, value: values };
  });

  // ── Source label ─────────────────────────────────────────────────────────────
  // 'mixed' whenever any fall-through occurred (usedSources ≠ {dispatchSource}).
  // Single-source with no fall-through uses the dispatch source's display name.

  const source: AggregateTrendTile['source'] =
    (usedSources.size === 1 && usedSources.has(dispatchSource))
      ? (sourceDisplayName(dispatchSource) as Exclude<AggregateTrendTile['source'], 'mixed'>)
      : 'mixed';

  return { source, startTime: servedStartTime, endTime: servedEndTime, bucketS, n: totalN, series };
}
