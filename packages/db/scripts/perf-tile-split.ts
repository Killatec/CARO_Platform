import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const N_TAGS         = 5;
const BUCKET_SAMPLES = 8;
const TOTAL_BUCKETS  = 1000;
const TILE_COUNT     = 4;
const TILE_BUCKETS   = TOTAL_BUCKETS / TILE_COUNT;   // 250 per tile
const PER_TRIAL      = 100;
const WARMUP         = 5;
const SEED           = parseInt(process.env.PERF_SEED ?? '42', 10);
const SAMPLE_PROBE_TAGS = 5;
const PROBE_WINDOW_MS   = 5 * 60 * 1000;

// Mirrors the hardcoded `max` in timescale/pool.ts.
// Mode B fires TILE_COUNT=4 concurrent queries; the pool must have >= 4 connections.
const TIMESCALE_POOL_MAX = 10;

// ── Pool concurrency guard ────────────────────────────────────────────────────

console.log(`timescalePool max connections: ${TIMESCALE_POOL_MAX}`);
if (TIMESCALE_POOL_MAX < TILE_COUNT) {
  console.error(
    `ERROR: pool max (${TIMESCALE_POOL_MAX}) < TILE_COUNT (${TILE_COUNT}). ` +
    `Mode B queries would serialize — comparison would be meaningless. ` +
    `Increase pool max to >= ${TILE_COUNT} in timescale/pool.ts.`,
  );
  process.exit(1);
}

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

function fmtStats(xs: number[]): string {
  return (
    `min=${fmt(Math.min(...xs))}ms  mean=${fmt(mean(xs))}ms  ` +
    `median=${fmt(median(xs))}ms  p95=${fmt(p95(xs))}ms  ` +
    `max=${fmt(Math.max(...xs))}ms  std=${fmt(stddev(xs))}ms`
  );
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

if (tagRes.rows.length < N_TAGS) {
  throw new Error(
    `Need at least ${N_TAGS} trendable tags, found only ${tagRes.rows.length}.`,
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
const bucketIntervalMs   = BUCKET_SAMPLES * SAMPLE_INTERVAL_MS;
const totalSpanMs        = TOTAL_BUCKETS * bucketIntervalMs;
const tileSpanMs         = TILE_BUCKETS  * bucketIntervalMs;

// ── Compute time ranges ───────────────────────────────────────────────────────

const compressedRes = await timescalePool.query<{ start_ms: Date; end_ms: Date }>(`
  SELECT MIN(c.range_start) AS start_ms, MAX(c.range_end) AS end_ms
  FROM timescaledb_information.chunks c
  JOIN chunk_compression_stats('tag_samples') cs ON cs.chunk_name = c.chunk_name
  WHERE c.hypertable_name = 'tag_samples'
    AND c.hypertable_schema = 'public'
    AND c.is_compressed = true
`);

const compRow = compressedRes.rows[0];
if (!compRow?.start_ms) throw new Error('No compressed chunks found in tag_samples');

const compressedRange = {
  label:   'Compressed',
  startMs: compRow.start_ms.getTime(),
  endMs:   compRow.end_ms.getTime(),
};

const chunkRes = await timescalePool.query<{ range_start: Date }>(`
  SELECT range_start
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples'
    AND hypertable_schema = 'public'
  ORDER BY range_start DESC
  LIMIT 1
`);

if (chunkRes.rows.length === 0) throw new Error('No chunks found in tag_samples');

const uncompressedRange = {
  label:   'Uncompressed',
  startMs: chunkRes.rows[0].range_start.getTime(),
  endMs:   nowMs,
};

// ── Startup compression snapshot ──────────────────────────────────────────────

type ChunkSnapshot = { chunk_name: string; was_compressed: boolean };

const snapshotRes = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
  SELECT chunk_name, is_compressed
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples'
    AND hypertable_schema = 'public'
    AND range_start < to_timestamp($1::bigint / 1000.0)
    AND range_end   > to_timestamp($2::bigint / 1000.0)
`, [BigInt(uncompressedRange.endMs), BigInt(uncompressedRange.startMs)]);

const startupSnapshot: ChunkSnapshot[] = snapshotRes.rows.map(r => ({
  chunk_name:     r.chunk_name,
  was_compressed: r.is_compressed,
}));

// ── SQL ───────────────────────────────────────────────────────────────────────
// $1 = bucket interval ms (float8), $2 = tag_id[], $3 = start (Date → timestamptz),
// $4 = end (Date → timestamptz).  finish - 1ms makes it exclusive so gapfill emits
// exactly (end - start) / bucketIntervalMs buckets.

const SQL = `
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

// ── Calibrate bucket origin ───────────────────────────────────────────────────
// time_bucket's grid origin is NOT the PG epoch in general.  Query the DB to find
// where PG_EPOCH lands on the grid, then use that as the alignment base so that
// every startMs computed here falls exactly on a bucket boundary.

const PG_EPOCH_MS = 946684800000;

const originRes = await timescalePool.query<{ origin: Date }>(`
  SELECT time_bucket(
    make_interval(secs => $1::float8 / 1000.0),
    '2000-01-01 00:00:00 UTC'::timestamptz
  ) AS origin
`, [bucketIntervalMs]);

const BUCKET_ORIGIN_MS = originRes.rows[0].origin.getTime();
console.log(
  `Bucket origin: ${new Date(BUCKET_ORIGIN_MS).toISOString()}  ` +
  `(offset ${BUCKET_ORIGIN_MS - PG_EPOCH_MS}ms from PG_EPOCH)`,
);

function alignToBucket(rawMs: number): number {
  return BUCKET_ORIGIN_MS + Math.floor((rawMs - BUCKET_ORIGIN_MS) / bucketIntervalMs) * bucketIntervalMs;
}

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

// ── Range runner ──────────────────────────────────────────────────────────────

type RangeStats = {
  modeATimes:      number[];
  modeBWallTimes:  number[];
  modeBTileTimes:  number[];   // all individual tile latencies, flat (PER_TRIAL × TILE_COUNT)
  modeAMismatches: number;
  modeBMismatches: number;     // count of individual tile queries with wrong row count
};

async function runRange(
  range: { label: string; startMs: number; endMs: number },
): Promise<RangeStats | null> {
  // Smallest aligned startMs that fits the full span inside the range.
  const alignedRangeStart = alignToBucket(range.startMs) < range.startMs
    ? alignToBucket(range.startMs) + bucketIntervalMs
    : alignToBucket(range.startMs);
  if (alignedRangeStart + totalSpanMs > range.endMs) return null;

  const maxRawStart = range.endMs - totalSpanMs;

  const modeATimes:      number[] = [];
  const modeBWallTimes:  number[] = [];
  const modeBTileTimes:  number[] = [];
  let modeAMismatches = 0;
  let modeBMismatches = 0;

  for (let i = 0; i < PER_TRIAL + WARMUP; i++) {
    const tagIds   = shuffle([...trendablePool]).slice(0, N_TAGS);
    const rawStart = range.startMs + Math.floor(rng() * (maxRawStart - range.startMs));

    // Align to PG-epoch bucket boundary so gapfill emits exactly the expected bucket count.
    let baseStart = alignToBucket(rawStart);
    if (baseStart < range.startMs) baseStart += bucketIntervalMs;
    const baseEnd = baseStart + totalSpanMs;

    // Mode A — single query over the full 1000-bucket span
    const t0A  = performance.now();
    const resA = await timescalePool.query(SQL, [
      bucketIntervalMs, tagIds, new Date(baseStart), new Date(baseEnd),
    ]);
    const dtA  = performance.now() - t0A;

    // Mode B — 4 parallel queries of 250 buckets each, same tags and baseStart
    // Each tile promise captures its own t0 synchronously before being handed to
    // Promise.all, so per-tile timing is accurate even under parallelism.
    const t0B = performance.now();
    const tilePromises = Array.from({ length: TILE_COUNT }, (_, t) => {
      const tStart = baseStart + t * tileSpanMs;
      const tEnd   = tStart + tileSpanMs;
      const t0t    = performance.now();
      return timescalePool.query(SQL, [
        bucketIntervalMs, tagIds, new Date(tStart), new Date(tEnd),
      ]).then(res => ({ res, dt: performance.now() - t0t }));
    });
    const tileResults = await Promise.all(tilePromises);
    const wallB       = performance.now() - t0B;

    if (i >= WARMUP) {
      modeATimes.push(dtA);
      if (resA.rows.length !== N_TAGS * TOTAL_BUCKETS) modeAMismatches++;

      modeBWallTimes.push(wallB);
      for (const { res, dt } of tileResults) {
        modeBTileTimes.push(dt);
        if (res.rows.length !== N_TAGS * TILE_BUCKETS) modeBMismatches++;
      }
    }
  }

  return { modeATimes, modeBWallTimes, modeBTileTimes, modeAMismatches, modeBMismatches };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const totalSpanSec  = totalSpanMs / 1000;
const tileSec       = tileSpanMs  / 1000;

// Per range: (WARMUP + PER_TRIAL) trials × (1 Mode A query + TILE_COUNT Mode B queries)
const totalQueries  = 2 * (WARMUP + PER_TRIAL) * (1 + TILE_COUNT);
const estMinLo      = Math.round(totalQueries * 20  / 60_000);
const estMinHi      = Math.round(totalQueries * 200 / 60_000);

console.log('\n=== Perf battery: tile-split (Mode A: 1×1000 vs Mode B: 4×250 parallel) ===');
console.log(
  `Seed: ${SEED}  |  Tags: ${N_TAGS}  |  BucketSamples: ${BUCKET_SAMPLES}  |  ` +
  `Trials: ${PER_TRIAL} per mode per range  |  Warmup: ${WARMUP}`,
);
console.log(`Derived SAMPLE_INTERVAL_MS: ${SAMPLE_INTERVAL_MS.toFixed(1)} ms`);
console.log(`Bucket interval:            ${bucketIntervalMs.toFixed(1)} ms  (${BUCKET_SAMPLES} × sample interval)`);
console.log(`Total span  (1000 buckets): ${totalSpanSec.toFixed(1)} s`);
console.log(`Tile span   (250 buckets):  ${tileSec.toFixed(1)} s`);
console.log(`Trendable pool: ${trendablePool.length} tags`);
console.log(
  `Total queries: ${totalQueries.toLocaleString()} — estimated ${estMinLo}–${estMinHi} min` +
  (estMinHi > 30 ? '  ! Consider reducing PER_TRIAL if the run may outlast the open chunk.' : ''),
);

const nextHourMs = Math.floor(nowMs / 3_600_000) * 3_600_000 + 3_600_000;
const estEndMs   = nowMs + estMinHi * 60_000;

if (estEndMs > nextHourMs + 5 * 60_000) {
  console.log('! Run may outlast current open chunk');
  console.log(`  Now:                ${new Date(nowMs).toISOString()}`);
  console.log(`  Next hour boundary: ${new Date(nextHourMs).toISOString()}`);
  console.log(`  Estimated end:      ${new Date(estEndMs).toISOString()}`);
  console.log('  Consider reducing PER_TRIAL or running closer to the top of the hour.');
  console.log();
}

console.log('\nRanges:');
console.log(`  Compressed    ${new Date(compressedRange.startMs).toISOString()} → ${new Date(compressedRange.endMs).toISOString()}`);
console.log(`  Uncompressed  ${new Date(uncompressedRange.startMs).toISOString()} → now (${new Date(uncompressedRange.endMs).toISOString()})`);
console.log('\nRunning...\n');

type ComparisonRow = {
  range:  string;
  mode:   string;
  meanMs: number | null;
  p95Ms:  number | null;
};
const comparisonRows: ComparisonRow[] = [];

for (const range of [compressedRange, uncompressedRange]) {
  const bar = '═'.repeat(70);
  console.log(bar);
  console.log(`  ${range.label}  (span=${totalSpanSec.toFixed(1)}s, bucket=${fmt(bucketIntervalMs)}ms)`);
  console.log(bar);

  const stats = await runRange(range);

  if (stats === null) {
    console.log(`  SKIPPED — span ${totalSpanSec.toFixed(1)}s exceeds range`);
    comparisonRows.push({ range: range.label, mode: 'A (1×1000)', meanMs: null, p95Ms: null });
    comparisonRows.push({ range: range.label, mode: 'B (4×250)',  meanMs: null, p95Ms: null });
    console.log();
    continue;
  }

  const { modeATimes, modeBWallTimes, modeBTileTimes, modeAMismatches, modeBMismatches } = stats;

  const mismatchA = modeAMismatches > 0 ? `  ! ROW_MISMATCH x${modeAMismatches}` : '';
  const mismatchB = modeBMismatches > 0 ? `  ! TILE_MISMATCH x${modeBMismatches}` : '';

  console.log(`── Mode A  (1 query × 1000 buckets) ──────────────────────────────────`);
  console.log(`  ${fmtStats(modeATimes)}  rows=${N_TAGS * TOTAL_BUCKETS}${mismatchA}`);
  console.log(`── Mode B  wall-clock (${TILE_COUNT} parallel × ${TILE_BUCKETS} buckets) ──────────────────`);
  console.log(`  ${fmtStats(modeBWallTimes)}  rows=${N_TAGS * TOTAL_BUCKETS}${mismatchB}`);
  console.log(`── Mode B  per-query  (${modeBTileTimes.length} individual tile queries) ─────────────`);
  console.log(`  ${fmtStats(modeBTileTimes)}  rows=${N_TAGS * TILE_BUCKETS}`);
  console.log();

  comparisonRows.push({
    range: range.label, mode: 'A (1×1000)',
    meanMs: mean(modeATimes), p95Ms: p95(modeATimes),
  });
  comparisonRows.push({
    range: range.label, mode: 'B (4×250)',
    meanMs: mean(modeBWallTimes), p95Ms: p95(modeBWallTimes),
  });
}

const runEndMs      = Date.now();
const runElapsedMin = Math.round((runEndMs - nowMs) / 60_000);

// ── End-of-run compression check ─────────────────────────────────────────────

const endSnapshotRes = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
  SELECT chunk_name, is_compressed
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples'
    AND hypertable_schema = 'public'
    AND range_start < to_timestamp($1::bigint / 1000.0)
    AND range_end   > to_timestamp($2::bigint / 1000.0)
`, [BigInt(uncompressedRange.endMs), BigInt(uncompressedRange.startMs)]);

const endSnapshotMap = new Map(endSnapshotRes.rows.map(r => [r.chunk_name, r.is_compressed]));
const compromised    = startupSnapshot.filter(
  s => !s.was_compressed && endSnapshotMap.get(s.chunk_name) === true,
);

await pool.end().catch(() => {});
await timescalePool.end().catch(() => {});

// ── Comparison table ──────────────────────────────────────────────────────────

console.log('── Comparison ─────────────────────────────────────────────────────────');
const C = [16, 14, 12, 12] as const;
const pad = (s: string, w: number) => s.padEnd(w);
console.log([pad('Range', C[0]), pad('Mode', C[1]), pad('mean', C[2]), pad('p95', C[3])].join(''));
console.log('─'.repeat(C[0] + C[1] + C[2] + C[3]));
for (const row of comparisonRows) {
  const meanStr = row.meanMs !== null ? `${fmt(row.meanMs)}ms` : '—';
  const p95Str  = row.p95Ms  !== null ? `${fmt(row.p95Ms)}ms`  : '—';
  console.log([
    pad(row.range, C[0]),
    pad(row.mode,  C[1]),
    pad(meanStr,   C[2]),
    pad(p95Str,    C[3]),
  ].join(''));
}
console.log();

if (compromised.length > 0) {
  console.log('! UNCOMPRESSED RANGE COMPROMISED');
  for (const c of compromised) {
    console.log(`  Chunk ${c.chunk_name} got compressed during the run.`);
  }
  console.log('  Uncompressed results may reflect compressed-chunk performance.');
  console.log(`  Runtime: ${runElapsedMin} min. Start: ${new Date(nowMs).toISOString()}. End: ${new Date(runEndMs).toISOString()}.`);
}
