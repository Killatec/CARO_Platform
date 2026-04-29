import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_N             = 8;
const BS_VALUES         = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const BUCKET_COUNT      = 250;
const PER_CASE          = 100;
const WARMUP            = 10;
const SEED              = parseInt(process.env.PERF_SEED ?? '42', 10);
const SAMPLE_PROBE_TAGS = 5;
const PROBE_WINDOW_MS   = 5 * 60 * 1000;
const CAG_VIEW          = 'tag_samples_1s_cagg';

// Total: 8 × 8 × 100 × 4 = 25,600 queries + 4×10 warmup.

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makePrng(SEED);

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Statistics helpers ────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.95) - 1];
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function fmt(n: number): string { return n.toFixed(2); }
function fmtPad(n: number | null, w: number): string {
  return n === null ? '—'.padStart(w) : n.toFixed(2).padStart(w);
}

// ── nowMs ─────────────────────────────────────────────────────────────────────

const nowMs = Date.now();

// ── Trendable pool ────────────────────────────────────────────────────────────

const tagRes = await pool.query<{ tag_id: number }>(`
  SELECT tag_id FROM (
    SELECT DISTINCT ON (tag_id) tag_id, trends, retired
    FROM tag_registry
    ORDER BY tag_id, registry_rev DESC
  ) latest
  WHERE retired = false AND trends = true
  ORDER BY tag_id
`);

if (tagRes.rows.length < MAX_N) {
  throw new Error(
    `Need at least ${MAX_N} trendable tags, found only ${tagRes.rows.length}. ` +
    `Lower MAX_N or add more trendable tags to the registry.`,
  );
}

const trendablePool: number[] = tagRes.rows.map(r => Number(r.tag_id));

// ── Derive SAMPLE_INTERVAL_MS ─────────────────────────────────────────────────

const probeTagIds = trendablePool.slice(0, SAMPLE_PROBE_TAGS);

const probeRes = await timescalePool.query<{ delta_ms: string }>(`
  SELECT EXTRACT(EPOCH FROM (
    LEAD(ts) OVER (PARTITION BY tag_id ORDER BY ts) - ts
  )) * 1000 AS delta_ms
  FROM tag_samples
  WHERE tag_id = ANY($1::int[])
    AND ts >= to_timestamp($2::bigint / 1000.0)
    AND ts <  to_timestamp($3::bigint / 1000.0)
`, [probeTagIds, BigInt(nowMs - PROBE_WINDOW_MS), BigInt(nowMs)]);

const deltas = probeRes.rows
  .map(r => parseFloat(r.delta_ms))
  .filter(d => !isNaN(d) && d > 0 && d < 60_000);

if (deltas.length < 10) {
  throw new Error(
    `Too few inter-sample deltas (${deltas.length}) in last ${PROBE_WINDOW_MS / 60_000} min ` +
    `across ${SAMPLE_PROBE_TAGS} probe tags — is the simulator running?`,
  );
}

const SAMPLE_INTERVAL_MS = median(deltas);

// ── Resolve CAG materialization hypertable ────────────────────────────────────
// TimescaleDB creates an internal hypertable for each CAG; its name is needed
// to query chunk ranges and compression state for the CAG separately from raw.

const cagHtRes = await timescalePool.query<{
  materialization_hypertable_name:   string;
  materialization_hypertable_schema: string;
}>(`
  SELECT materialization_hypertable_name, materialization_hypertable_schema
  FROM timescaledb_information.continuous_aggregates
  WHERE view_name = $1
`, [CAG_VIEW]);

if (cagHtRes.rows.length === 0) {
  throw new Error(
    `CAG view '${CAG_VIEW}' not found in continuous_aggregates. ` +
    `Has T005 migration been applied and the CAG created?`,
  );
}

const CAG_HYPERTABLE        = cagHtRes.rows[0].materialization_hypertable_name;
const CAG_HYPERTABLE_SCHEMA = cagHtRes.rows[0].materialization_hypertable_schema;

// ── Time ranges per table ─────────────────────────────────────────────────────

type Range = { label: string; startMs: number; endMs: number };

type TableRanges = {
  compressedRange:      Range | null;
  uncompressedRange:    Range | null;   // null when the hypertable has no chunks at all
  compressedChunkCount: number;
};

async function getRanges(hypertable: string, schema = 'public'): Promise<TableRanges> {
  const [compRes, chunkRes, cntRes] = await Promise.all([
    timescalePool.query<{ start_ms: Date; end_ms: Date }>(`
      SELECT MIN(range_start) AS start_ms, MAX(range_end) AS end_ms
      FROM timescaledb_information.chunks
      WHERE hypertable_name = $1
        AND hypertable_schema = $2
        AND is_compressed = true
    `, [hypertable, schema]),
    timescalePool.query<{ range_start: Date }>(`
      SELECT range_start
      FROM timescaledb_information.chunks
      WHERE hypertable_name = $1
        AND hypertable_schema = $2
      ORDER BY range_start DESC
      LIMIT 1
    `, [hypertable, schema]),
    timescalePool.query<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM timescaledb_information.chunks
      WHERE hypertable_name = $1
        AND hypertable_schema = $2
        AND is_compressed = true
    `, [hypertable, schema]),
  ]);

  const compressedChunkCount = parseInt(cntRes.rows[0].cnt, 10);
  const compRow = compRes.rows[0];

  return {
    compressedRange: compRow?.start_ms
      ? { label: 'Compressed', startMs: compRow.start_ms.getTime(), endMs: compRow.end_ms.getTime() }
      : null,
    uncompressedRange: chunkRes.rows.length > 0
      ? { label: 'Uncompressed', startMs: chunkRes.rows[0].range_start.getTime(), endMs: nowMs }
      : null,
    compressedChunkCount,
  };
}

const [rawRanges, cagRanges] = await Promise.all([
  getRanges('tag_samples', 'public'),
  getRanges(CAG_HYPERTABLE, CAG_HYPERTABLE_SCHEMA),
]);

// ── Startup compression snapshot ──────────────────────────────────────────────
// Capture which uncompressed chunks exist at start so mid-run compression is
// detected and flagged at end.

type ChunkSnapshot = { chunk_name: string; was_compressed: boolean };

async function snapshotChunks(hypertable: string, schema: string, range: Range): Promise<ChunkSnapshot[]> {
  const res = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
    SELECT chunk_name, is_compressed
    FROM timescaledb_information.chunks
    WHERE hypertable_name = $1
      AND hypertable_schema = $2
      AND range_start < to_timestamp($3::bigint / 1000.0)
      AND range_end   > to_timestamp($4::bigint / 1000.0)
  `, [hypertable, schema, BigInt(range.endMs), BigInt(range.startMs)]);
  return res.rows.map(r => ({ chunk_name: r.chunk_name, was_compressed: r.is_compressed }));
}

const [rawSnapshot, cagSnapshot] = await Promise.all([
  snapshotChunks('tag_samples', 'public', rawRanges.uncompressedRange!),
  cagRanges.uncompressedRange
    ? snapshotChunks(CAG_HYPERTABLE, CAG_HYPERTABLE_SCHEMA, cagRanges.uncompressedRange)
    : Promise.resolve([] as ChunkSnapshot[]),
]);

// ── Bucket intervals ──────────────────────────────────────────────────────────
// Raw:  BS × SAMPLE_INTERVAL_MS (native write cadence)
// CAG:  BS × 1000 ms            (CAG's native 1s bucket, multiples thereof)

const rawBucketIntervals: number[] = BS_VALUES.map(bs => bs * SAMPLE_INTERVAL_MS);
const cagBucketIntervals: number[] = BS_VALUES.map(bs => bs * 1000);

// ── Calibrate bucket origins ──────────────────────────────────────────────────
// time_bucket's alignment grid origin is NOT the PG epoch. Querying
// time_bucket(bw, PG_EPOCH) at startup gives the actual origin for each bw,
// so random startMs values can be snapped to a valid bucket boundary and
// time_bucket_gapfill emits exactly BUCKET_COUNT rows per tag.
// One query per (table, BS) = 16 queries total, run in parallel.

async function calibrateOrigin(bwMs: number): Promise<number> {
  const res = await timescalePool.query<{ origin: Date }>(`
    SELECT time_bucket(
      make_interval(secs => $1::float8 / 1000.0),
      '2000-01-01 00:00:00 UTC'::timestamptz
    ) AS origin
  `, [bwMs]);
  return res.rows[0].origin.getTime();
}

const [rawOrigins, cagOrigins] = await Promise.all([
  Promise.all(rawBucketIntervals.map(calibrateOrigin)),
  Promise.all(cagBucketIntervals.map(calibrateOrigin)),
]);

// ── SQL ───────────────────────────────────────────────────────────────────────
// $1 = bucket interval ms (float8)
// $2 = tag_id[]
// $3 = window start (timestamptz)  — aligned to bucket boundary
// $4 = window end   (timestamptz)  — start + BUCKET_COUNT × bw
//
// finish = $4 - 1ms so gapfill's inclusive upper bound lands inside the last
// intended bucket rather than emitting an extra bucket at the next boundary.

const RAW_SQL = `
  SELECT s.tag_id,
         time_bucket_gapfill(
           make_interval(secs => $1::float8 / 1000.0),
           s.ts,
           $3::timestamptz,
           $4::timestamptz - interval '1 millisecond'
         ) AS bucket,
         locf(
           last(value, s.ts),
           prev => (
             SELECT value
             FROM tag_samples
             WHERE tag_id = s.tag_id
               AND ts < $3::timestamptz
             ORDER BY ts DESC
             LIMIT 1
           )
         ) AS val
    FROM tag_samples s
   WHERE s.tag_id = ANY($2::int[])
     AND s.ts >= $3::timestamptz
     AND s.ts <  $4::timestamptz
   GROUP BY s.tag_id, bucket
   ORDER BY s.tag_id, bucket
`;

// CAG variant: time column is `bucket` (1s pre-aggregated); aggregate uses
// the `last` column (last(value, ts) materialised by the CAG definition).
// time_bucket_gapfill's planner scans GROUP BY for a literal function call;
// alias resolution doesn't satisfy it, so the full expression is repeated.
const CAG_SQL = `
  SELECT s.tag_id,
         time_bucket_gapfill(
           make_interval(secs => $1::float8 / 1000.0),
           s.bucket,
           $3::timestamptz,
           $4::timestamptz - interval '1 millisecond'
         ) AS bucket,
         locf(
           last(s.last, s.bucket),
           prev => (
             SELECT "last"
             FROM tag_samples_1s_cagg
             WHERE tag_id = s.tag_id
               AND bucket < $3::timestamptz
             ORDER BY bucket DESC
             LIMIT 1
           )
         ) AS val
    FROM tag_samples_1s_cagg s
   WHERE s.tag_id = ANY($2::int[])
     AND s.bucket >= $3::timestamptz
     AND s.bucket <  $4::timestamptz
   GROUP BY s.tag_id, time_bucket_gapfill(
              make_interval(secs => $1::float8 / 1000.0),
              s.bucket,
              $3::timestamptz,
              $4::timestamptz - interval '1 millisecond'
            )
   ORDER BY s.tag_id, bucket
`;

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

// ── Case runner ───────────────────────────────────────────────────────────────

type CaseStats = { times: number[]; rowMismatches: number };

function alignToBucket(rawMs: number, originMs: number, bucketIntervalMs: number): number {
  return originMs + Math.floor((rawMs - originMs) / bucketIntervalMs) * bucketIntervalMs;
}

async function runCase(
  sql: string,
  bucketIntervalMs: number,
  bucketOriginMs: number,
  tagCount: number,
  range: Range,
  count: number,
  warmup = 0,
): Promise<CaseStats | null> {
  const querySpanMs = BUCKET_COUNT * bucketIntervalMs;

  // Bump aligned range start up by one bucket width if it falls below range.startMs.
  let alignedRangeStart = alignToBucket(range.startMs, bucketOriginMs, bucketIntervalMs);
  if (alignedRangeStart < range.startMs) alignedRangeStart += bucketIntervalMs;
  if (alignedRangeStart + querySpanMs > range.endMs) return null;

  const maxRawStart  = range.endMs - querySpanMs;
  const times: number[] = [];
  let rowMismatches  = 0;
  const expectedRows = tagCount * BUCKET_COUNT;

  for (let i = 0; i < count + warmup; i++) {
    const tagIds    = shuffle([...trendablePool]).slice(0, tagCount);
    const rawStart  = range.startMs + Math.floor(rng() * (maxRawStart - range.startMs));
    let   startMs   = alignToBucket(rawStart, bucketOriginMs, bucketIntervalMs);
    if (startMs < range.startMs) startMs += bucketIntervalMs;
    const endMs     = startMs + querySpanMs;

    const t0  = performance.now();
    const res = await timescalePool.query(sql, [
      bucketIntervalMs,
      tagIds,
      new Date(startMs),
      new Date(endMs),
    ]);
    const dt = performance.now() - t0;

    if (i >= warmup) {
      times.push(dt);
      if (res.rows.length !== expectedRows) rowMismatches++;
    }
  }

  return { times, rowMismatches };
}

function summarise(s: CaseStats, expectedRows: number): string {
  const { times, rowMismatches } = s;
  const note = rowMismatches > 0 ? `  ! ROW_MISMATCH x${rowMismatches}` : '';
  return (
    `min=${fmt(Math.min(...times))}ms  mean=${fmt(mean(times))}ms  ` +
    `median=${fmt(median(times))}ms  p95=${fmt(p95(times))}ms  ` +
    `max=${fmt(Math.max(...times))}ms  std=${fmt(stddev(times))}ms  ` +
    `rows=${expectedRows}${note}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const totalQueries = MAX_N * BS_VALUES.length * PER_CASE * 4 + WARMUP * 4;
const estMinLo     = Math.round(totalQueries * 10  / 60_000);
const estMinHi     = Math.round(totalQueries * 100 / 60_000);

console.log('=== Perf battery: gapfill raw vs CAG (N=1..8, BS=1,2,4,8,16,32,64,128) ===');
console.log(
  `Seed: ${SEED}  |  Buckets: ${BUCKET_COUNT}  |  Per-case: ${PER_CASE}  |  ` +
  `Warm-up: ${WARMUP} per sub-battery (first cell)`,
);
console.log(`Derived SAMPLE_INTERVAL_MS:        ${SAMPLE_INTERVAL_MS.toFixed(1)} ms`);
console.log(`CAG materialization hypertable:    ${CAG_HYPERTABLE}`);
console.log(`Trendable pool:                    ${trendablePool.length} tags`);
console.log(
  `Total queries: ${totalQueries.toLocaleString()} — estimated ${estMinLo}–${estMinHi} min`,
);

// Next-hour boundary warning
const nextHourMs = Math.floor(nowMs / 3_600_000) * 3_600_000 + 3_600_000;
const estEndMs   = nowMs + estMinHi * 60_000;
if (estEndMs > nextHourMs + 5 * 60_000) {
  console.log('! Run may outlast current open chunk');
  console.log(`  Now:                ${new Date(nowMs).toISOString()}`);
  console.log(`  Next hour boundary: ${new Date(nextHourMs).toISOString()}`);
  console.log(`  Estimated end:      ${new Date(estEndMs).toISOString()}`);
  console.log('  Consider reducing PER_CASE or running closer to the top of the hour.');
}

// Ranges + pre-flight
console.log('\nRanges:');
console.log(`  raw  (tag_samples / ${rawRanges.compressedChunkCount} compressed chunks):`);
if (rawRanges.compressedRange) {
  console.log(`    Compressed    ${new Date(rawRanges.compressedRange.startMs).toISOString()} → ${new Date(rawRanges.compressedRange.endMs).toISOString()}`);
} else {
  console.log('    Compressed    NONE — raw-compressed sub-battery will be skipped');
}
if (rawRanges.uncompressedRange) {
  console.log(`    Uncompressed  ${new Date(rawRanges.uncompressedRange.startMs).toISOString()} → now (${new Date(nowMs).toISOString()})`);
} else {
  console.log('    Uncompressed  NONE — no chunks at all');
}

console.log(`  cag  (${CAG_HYPERTABLE} / ${cagRanges.compressedChunkCount} compressed chunks):`);
if (cagRanges.compressedRange) {
  console.log(`    Compressed    ${new Date(cagRanges.compressedRange.startMs).toISOString()} → ${new Date(cagRanges.compressedRange.endMs).toISOString()}`);
} else {
  console.log(`    Compressed    NONE (0 compressed chunks) — cag-compressed sub-battery will be skipped`);
  console.log(`    ! Manually compress a chunk first if you want this data:`);
  console.log(`      SELECT compress_chunk(i) FROM show_chunks('${CAG_VIEW}') AS i LIMIT 1;`);
}
if (cagRanges.uncompressedRange) {
  console.log(`    Uncompressed  ${new Date(cagRanges.uncompressedRange.startMs).toISOString()} → now (${new Date(nowMs).toISOString()})`);
} else {
  console.log('    Uncompressed  NONE — no chunks at all');
}

console.log('\nRunning...\n');

// ── Matrix storage ────────────────────────────────────────────────────────────
// [n-1][bsIdx] = mean latency ms or null (skipped)

type Matrix = (number | null)[][];

function makeMatrix(): Matrix {
  return Array.from({ length: MAX_N }, () => new Array(BS_VALUES.length).fill(null));
}

const matrices = {
  rawComp:   makeMatrix(),
  rawUncomp: makeMatrix(),
  cagComp:   makeMatrix(),
  cagUncomp: makeMatrix(),
};

// Warmup fires once per sub-battery on the first cell where runCase returns non-null.
// If the first cell is skipped (span too wide), warmup defers to the next non-null cell.
const warmedUp = { rawComp: false, rawUncomp: false, cagComp: false, cagUncomp: false };

for (let n = 1; n <= MAX_N; n++) {
  for (const [bsIdx, bs] of BS_VALUES.entries()) {
    const rawBwMs = rawBucketIntervals[bsIdx];
    const cagBwMs = cagBucketIntervals[bsIdx];
    const rawOrig = rawOrigins[bsIdx];
    const cagOrig = cagOrigins[bsIdx];
    const rawSpan = BUCKET_COUNT * rawBwMs;
    const cagSpan = BUCKET_COUNT * cagBwMs;

    const caseLabel =
      `N=${n}, BS=${bs}  ` +
      `(raw=${fmt(rawBwMs)}ms/bucket span=${fmt(rawSpan / 1000)}s  ` +
      `cag=${fmt(cagBwMs / 1000)}s/bucket span=${fmt(cagSpan / 1000)}s)`;
    console.log(`── ${caseLabel} ${'─'.repeat(Math.max(1, 70 - caseLabel.length))}`);

    // raw-compressed
    if (rawRanges.compressedRange) {
      const wu = !warmedUp.rawComp ? WARMUP : 0;
      const s  = await runCase(RAW_SQL, rawBwMs, rawOrig, n, rawRanges.compressedRange, PER_CASE, wu);
      if (s !== null) {
        if (wu > 0) warmedUp.rawComp = true;
        matrices.rawComp[n - 1][bsIdx] = mean(s.times);
        console.log(`  raw  Compressed    ${summarise(s, n * BUCKET_COUNT)}`);
      } else {
        console.log(`  raw  Compressed    SKIPPED — span ${fmt(rawSpan / 1000)}s exceeds range`);
      }
    } else {
      console.log('  raw  Compressed    SKIPPED — no compressed chunks');
    }

    // raw-uncompressed
    if (rawRanges.uncompressedRange) {
      const wu = !warmedUp.rawUncomp ? WARMUP : 0;
      const s  = await runCase(RAW_SQL, rawBwMs, rawOrig, n, rawRanges.uncompressedRange, PER_CASE, wu);
      if (s !== null) {
        if (wu > 0) warmedUp.rawUncomp = true;
        matrices.rawUncomp[n - 1][bsIdx] = mean(s.times);
        console.log(`  raw  Uncompressed  ${summarise(s, n * BUCKET_COUNT)}`);
      } else {
        console.log(`  raw  Uncompressed  SKIPPED — span ${fmt(rawSpan / 1000)}s exceeds range`);
      }
    } else {
      console.log('  raw  Uncompressed  SKIPPED — no chunks');
    }

    // cag-compressed
    if (cagRanges.compressedRange) {
      const wu = !warmedUp.cagComp ? WARMUP : 0;
      const s  = await runCase(CAG_SQL, cagBwMs, cagOrig, n, cagRanges.compressedRange, PER_CASE, wu);
      if (s !== null) {
        if (wu > 0) warmedUp.cagComp = true;
        matrices.cagComp[n - 1][bsIdx] = mean(s.times);
        console.log(`  cag  Compressed    ${summarise(s, n * BUCKET_COUNT)}`);
      } else {
        console.log(`  cag  Compressed    SKIPPED — span ${fmt(cagSpan / 1000)}s exceeds range`);
      }
    } else {
      console.log('  cag  Compressed    SKIPPED — no compressed chunks');
    }

    // cag-uncompressed
    if (cagRanges.uncompressedRange) {
      const wu = !warmedUp.cagUncomp ? WARMUP : 0;
      const s  = await runCase(CAG_SQL, cagBwMs, cagOrig, n, cagRanges.uncompressedRange, PER_CASE, wu);
      if (s !== null) {
        if (wu > 0) warmedUp.cagUncomp = true;
        matrices.cagUncomp[n - 1][bsIdx] = mean(s.times);
        console.log(`  cag  Uncompressed  ${summarise(s, n * BUCKET_COUNT)}`);
      } else {
        console.log(`  cag  Uncompressed  SKIPPED — span ${fmt(cagSpan / 1000)}s exceeds range`);
      }
    } else {
      console.log('  cag  Uncompressed  SKIPPED — no chunks');
    }

    console.log();
  }
}

const runEndMs      = Date.now();
const runElapsedMin = Math.round((runEndMs - nowMs) / 60_000);

// ── End-of-run compression check ─────────────────────────────────────────────

async function checkCompromised(
  hypertable: string,
  schema: string,
  startupSnap: ChunkSnapshot[],
  uncompRange: Range | null,
): Promise<string[]> {
  if (uncompRange === null || startupSnap.length === 0) return [];
  const res = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
    SELECT chunk_name, is_compressed
    FROM timescaledb_information.chunks
    WHERE hypertable_name = $1
      AND hypertable_schema = $2
      AND range_start < to_timestamp($3::bigint / 1000.0)
      AND range_end   > to_timestamp($4::bigint / 1000.0)
  `, [hypertable, schema, BigInt(uncompRange.endMs), BigInt(uncompRange.startMs)]);
  const endMap = new Map(res.rows.map(r => [r.chunk_name, r.is_compressed]));
  return startupSnap
    .filter(s => !s.was_compressed && endMap.get(s.chunk_name) === true)
    .map(s => s.chunk_name);
}

const [rawCompromised, cagCompromised] = await Promise.all([
  checkCompromised('tag_samples', 'public', rawSnapshot, rawRanges.uncompressedRange),
  checkCompromised(CAG_HYPERTABLE, CAG_HYPERTABLE_SCHEMA, cagSnapshot, cagRanges.uncompressedRange),
]);

await pool.end().catch(() => {});
await timescalePool.end().catch(() => {});

// ── Matrix output (tab-separated for spreadsheet paste) ───────────────────────

function printMatrix(label: string, mat: Matrix): void {
  console.log(`── ${label} ──`);
  console.log(['N\\BS', ...BS_VALUES.map(String)].join('\t'));
  for (let n = 1; n <= MAX_N; n++) {
    const row = mat[n - 1].map(v => v === null ? '—' : v.toFixed(2));
    console.log([String(n), ...row].join('\t'));
  }
  console.log();
}

printMatrix('raw-compressed   mean latency (ms) — rows=N, cols=BS', matrices.rawComp);
printMatrix('raw-uncompressed mean latency (ms) — rows=N, cols=BS', matrices.rawUncomp);
printMatrix('cag-compressed   mean latency (ms) — rows=N, cols=BS', matrices.cagComp);
printMatrix('cag-uncompressed mean latency (ms) — rows=N, cols=BS', matrices.cagUncomp);

// ── Comparison summary: N=5, BS=8 ────────────────────────────────────────────

const REP_N    = 5;
const REP_BS   = 8;
const repBsIdx = (BS_VALUES as readonly number[]).indexOf(REP_BS);

function repCell(mat: Matrix): number | null {
  return repBsIdx === -1 ? null : mat[REP_N - 1][repBsIdx];
}

function speedupStr(raw: number | null, cag: number | null): string {
  if (raw === null || cag === null || cag === 0) return '—';
  return (raw / cag).toFixed(2) + 'x';
}

const rawCompCell   = repCell(matrices.rawComp);
const rawUncompCell = repCell(matrices.rawUncomp);
const cagCompCell   = repCell(matrices.cagComp);
const cagUncompCell = repCell(matrices.cagUncomp);

console.log(`── Comparison: N=${REP_N}, BS=${REP_BS} (representative cell) ─────────────────────────`);
console.log(' table  │ Compressed │ Uncompressed');
console.log('────────┼────────────┼─────────────');
console.log(` raw    │${fmtPad(rawCompCell, 10)} │${fmtPad(rawUncompCell, 12)}`);
console.log(` cag    │${fmtPad(cagCompCell, 10)} │${fmtPad(cagUncompCell, 12)}`);
console.log('────────┼────────────┼─────────────');
console.log(` speedup│${speedupStr(rawCompCell, cagCompCell).padStart(10)} │${speedupStr(rawUncompCell, cagUncompCell).padStart(12)}`);
console.log('  (speedup = raw/cag; >1 means CAG is faster)');

// ── Compromise warnings ───────────────────────────────────────────────────────

if (rawCompromised.length > 0 || cagCompromised.length > 0) {
  console.log('\n! UNCOMPRESSED RANGE COMPROMISED');
  for (const c of rawCompromised) console.log(`  raw chunk ${c} got compressed during the run`);
  for (const c of cagCompromised) console.log(`  cag chunk ${c} got compressed during the run`);
  console.log('  Uncompressed results in later cases may reflect compressed-chunk performance.');
  console.log(`  Runtime: ${runElapsedMin} min. Start: ${new Date(nowMs).toISOString()}. End: ${new Date(runEndMs).toISOString()}.`);
}
