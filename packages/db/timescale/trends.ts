import timescalePool from './pool.js';

const LOG_TILE_QUERIES = process.env.TIMESCALE_LOG_TILE_QUERIES === '1';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RawTrendSeries {
  tagId: number;
  ts: number[];
  value: (number | null)[];
}

export interface AggregateTrendSeries {
  tagId: number;
  value: (number | null)[];
}

export interface RawTrendTile {
  bucketS: 0;
  tileIndex: number;
  tileSpanMs: number;
  series: RawTrendSeries[];
}

export interface AggregateTrendTile {
  bucketS: number;
  tileIndex: number;
  tileSpanMs: number;
  tsStart: number;
  n: number;
  series: AggregateTrendSeries[];
}

export type TrendTile = RawTrendTile | AggregateTrendTile;

// ── Tile span table (§10.2) ──────────────────────────────────────────────────

const TILE_SPANS: Record<number, number> = {
  0:   3_600_000,   // 1 h   — raw COV tile
  1:     600_000,   // 10 min — 600 buckets × 1 s
  10:  6_000_000,   // 100 min — 600 buckets × 10 s
  60: 36_000_000,   // 10 h   — 600 buckets × 1 min
  600: 360_000_000, // 100 h  — 600 buckets × 10 min
};

const ALLOWED_BUCKET_S = new Set([0, 1, 10, 60, 600]);

export function tileSpanFor(bucketS: number): number {
  const span = TILE_SPANS[bucketS];
  if (span === undefined) {
    const err = new Error(`Invalid bucketS: ${bucketS}`);
    (err as NodeJS.ErrnoException & { code: string }).code = 'INVALID_BUCKET_S';
    throw err;
  }
  return span;
}

// ── Validation helpers ───────────────────────────────────────────────────────

function codeError(message: string, code: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  return err;
}

function validateTagIds(tagIds: number[]): void {
  if (
    tagIds.length === 0 ||
    tagIds.some(id => !Number.isInteger(id) || id <= 0)
  ) {
    throw codeError('tagIds must be a non-empty array of positive integers', 'INVALID_TAG_IDS');
  }
}

function validateTileIndex(tileIndex: number): void {
  if (!Number.isInteger(tileIndex) || tileIndex < 0) {
    throw codeError('tileIndex must be a non-negative integer', 'INVALID_TILE_INDEX');
  }
}

function validateBucketS(bucketS: number): void {
  if (!ALLOWED_BUCKET_S.has(bucketS)) {
    throw codeError(`bucketS must be one of ${[...ALLOWED_BUCKET_S].join(', ')}`, 'INVALID_BUCKET_S');
  }
}

// ── Pure assembly for aggregate series ───────────────────────────────────────
//
// Exported for direct unit testing. Walks buckets in order, carrying the last
// seen value (LOCF). Tags absent from `seeds` get null as their initial carry.
// Every output series has exactly `bucketCount` entries in `tagIds` order.
//
// `rowsByTag` values use `bucketMs` as a bucket-start timestamp in ms (instant),
// not a duration — these retain the ms suffix intentionally.

export function assembleAggregateSeries(
  tagIds: number[],
  seeds: Map<number, number | null>,
  rowsByTag: Map<number, Array<{ bucketMs: bigint; lastVal: number | null }>>,
  tileStartMs: number,
  bucketS: number,
  bucketCount: number,
): AggregateTrendSeries[] {
  return tagIds.map(tagId => {
    let carry: number | null = seeds.has(tagId) ? (seeds.get(tagId) ?? null) : null;
    const rows = rowsByTag.get(tagId) ?? [];
    let ri = 0;
    const value: Array<number | null> = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
      const bucketStartMs = BigInt(tileStartMs + i * bucketS * 1_000);
      if (ri < rows.length && rows[ri].bucketMs === bucketStartMs) {
        carry = rows[ri].lastVal;
        ri++;
      }
      value[i] = carry;
    }
    return { tagId, value };
  });
}

// ── Raw query ────────────────────────────────────────────────────────────────

async function queryRaw(
  tagIds: number[],
  tileIndex: number,
  tileSpanMs: number,
): Promise<RawTrendTile> {
  const tsStart = tileIndex * tileSpanMs;
  const tsEnd   = tsStart + tileSpanMs;

  const t0 = performance.now();

  const result = await timescalePool.query(
    `SELECT tag_id,
            (extract(epoch from ts) * 1000)::bigint AS ts_ms,
            value
     FROM tag_samples
     WHERE tag_id = ANY($1::int[])
       AND ts >= to_timestamp($2 / 1000.0)
       AND ts <  to_timestamp($3 / 1000.0)
     ORDER BY tag_id, ts`,
    [tagIds, tsStart, tsEnd],
  );

  if (LOG_TILE_QUERIES) {
    const dur = (performance.now() - t0).toFixed(1);
    console.log(`[trends] path=raw       tag_count=${tagIds.length} bucket_s=0  tile_index=${tileIndex} duration_ms=${dur}`);
  }

  // Group rows by tag_id, preserving request order
  const seriesMap = new Map<number, RawTrendSeries>();
  for (const id of tagIds) {
    seriesMap.set(id, { tagId: id, ts: [], value: [] });
  }

  for (const row of result.rows as { tag_id: number; ts_ms: bigint | string; value: number | null }[]) {
    const series = seriesMap.get(row.tag_id);
    if (!series) continue;
    series.ts.push(Number(row.ts_ms));
    series.value.push(row.value);
  }

  return {
    bucketS: 0,
    tileIndex,
    tileSpanMs,
    series: tagIds.map(id => seriesMap.get(id)!),
  };
}

// ── Aggregate query ──────────────────────────────────────────────────────────

async function queryAggregate(
  tagIds: number[],
  bucketS: number,
  tileIndex: number,
): Promise<AggregateTrendTile> {
  const tileSpanMs  = tileSpanFor(bucketS);
  const tsStart     = tileIndex * tileSpanMs;
  const tsEnd       = tsStart + tileSpanMs;
  const bucketCount = tileSpanMs / (bucketS * 1_000); // always 600

  const t0 = performance.now();

  // Query 1 (seeds) and Query 2 (bucket-last) run in parallel.
  const [seedResult, bucketResult] = await Promise.all([
    timescalePool.query(
      `WITH t AS (SELECT unnest($1::int[]) AS tag_id)
       SELECT t.tag_id,
              (SELECT value FROM tag_samples
                WHERE tag_id = t.tag_id
                  AND ts < to_timestamp($2::bigint / 1000.0)
                ORDER BY ts DESC LIMIT 1) AS prev
       FROM t`,
      [tagIds, BigInt(tsStart)],
    ),
    timescalePool.query(
      `SELECT tag_id,
              (extract(epoch from time_bucket(
                 make_interval(secs => $4::double precision), ts
               )) * 1000)::bigint AS bucket_ms,
              last(value, ts) AS last_val
       FROM tag_samples
       WHERE tag_id = ANY($1::int[])
         AND ts >= to_timestamp($2::bigint / 1000.0)
         AND ts <  to_timestamp($3::bigint / 1000.0)
       GROUP BY tag_id, bucket_ms
       ORDER BY tag_id, bucket_ms`,
      [tagIds, BigInt(tsStart), BigInt(tsEnd), bucketS],
    ),
  ]);

  if (LOG_TILE_QUERIES) {
    const dur = (performance.now() - t0).toFixed(1);
    console.log(`[trends] path=aggregate tag_count=${tagIds.length} bucket_s=${bucketS} tile_index=${tileIndex} duration_ms=${dur}`);
  }

  // Build seeds map: every requested tag_id is present (CTE unnest guarantees it),
  // prev is null when no prior sample exists.
  const seeds = new Map<number, number | null>();
  for (const row of seedResult.rows as { tag_id: number; prev: number | null }[]) {
    seeds.set(row.tag_id, row.prev ?? null);
  }

  // Build rowsByTag map: preserve BigInt bucket_ms (a bucket-start timestamp in ms)
  // for exact cursor comparison in assembleAggregateSeries.
  const rowsByTag = new Map<number, Array<{ bucketMs: bigint; lastVal: number | null }>>();
  for (const row of bucketResult.rows as { tag_id: number; bucket_ms: bigint | string; last_val: number | null }[]) {
    const bucketMsVal = BigInt(row.bucket_ms);
    if (!rowsByTag.has(row.tag_id)) rowsByTag.set(row.tag_id, []);
    rowsByTag.get(row.tag_id)!.push({ bucketMs: bucketMsVal, lastVal: row.last_val });
  }

  const series = assembleAggregateSeries(tagIds, seeds, rowsByTag, tsStart, bucketS, bucketCount);

  return { bucketS, tileIndex, tileSpanMs, tsStart, n: bucketCount, series };
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function getTrendTile(
  tagIds: number[],
  bucketS: number,
  tileIndex: number,
): Promise<TrendTile> {
  validateTagIds(tagIds);
  validateTileIndex(tileIndex);
  validateBucketS(bucketS);

  const tileSpanMs = tileSpanFor(bucketS);

  if (bucketS === 0) {
    return queryRaw(tagIds, tileIndex, tileSpanMs);
  }

  return queryAggregate(tagIds, bucketS, tileIndex);
}
