import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_N               = 20;
const BUCKET_COUNT_VALUES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const;
const BUCKET_SAMPLES      = 16;   // fixed bucket interval = BUCKET_SAMPLES × SAMPLE_INTERVAL_MS
const PER_CASE            = 100;
const WARMUP              = 10;
const SEED                = parseInt(process.env.PERF_SEED ?? '42', 10);
const SAMPLE_PROBE_TAGS   = 5;
const PROBE_WINDOW_MS     = 5 * 60 * 1000;

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

const SAMPLE_INTERVAL_MS  = median(deltas);
const bucketIntervalMs    = BUCKET_SAMPLES * SAMPLE_INTERVAL_MS;

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

// ── Startup compression snapshot for uncompressed range ──────────────────────

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
// $1 = bucket interval ms (float8), $2 = tag_id[], $3 = start ms (bigint), $4 = end ms (bigint)
// start/finish args to time_bucket_gapfill guarantee exactly bucketCount buckets,
// provided startMs is aligned to a bucket boundary (see runCase).

// $3/$4 are passed as JS Date objects so pg serialises them as ISO strings.
// PostgreSQL parses those to exact µs — no float8 division imprecision that
// would push `start` one µs before a bucket boundary and emit an extra bucket.
//
// time_bucket_gapfill treats `finish` as INCLUSIVE (emits a bucket whose start
// equals finish). To get exactly bucketCount buckets, pass finish - 1 ms so it
// lands inside the last intended bucket, not on the next boundary.
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
// time_bucket's actual alignment origin is NOT necessarily the PG epoch (2000-01-01).
// Query `time_bucket(bw, PG_EPOCH)` at startup to find where PG_EPOCH falls in the
// bucket grid, then use that as the alignment base for all startMs computations.
// This guarantees startMs lands exactly on a bucket boundary and
// time_bucket_gapfill emits exactly bucketCount rows per tag.

const PG_EPOCH_MS = 946684800000;

const originRes = await timescalePool.query<{ origin: Date }>(`
  SELECT time_bucket(
    make_interval(secs => $1::float8 / 1000.0),
    '2000-01-01 00:00:00 UTC'::timestamptz
  ) AS origin
`, [bucketIntervalMs]);

const BUCKET_ORIGIN_MS = originRes.rows[0].origin.getTime();
console.log(`Bucket origin (time_bucket of PG_EPOCH): ${new Date(BUCKET_ORIGIN_MS).toISOString()}  (offset ${BUCKET_ORIGIN_MS - PG_EPOCH_MS}ms from PG_EPOCH)`);

function alignToBucket(rawMs: number): number {
  return BUCKET_ORIGIN_MS + Math.floor((rawMs - BUCKET_ORIGIN_MS) / bucketIntervalMs) * bucketIntervalMs;
}

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

// ── Case runner ───────────────────────────────────────────────────────────────

type CaseStats = { times: number[]; rowMismatches: number };

async function runCase(
  tagCount: number,
  bucketCount: number,
  range: { startMs: number; endMs: number },
  count: number,
  warmup = 0,
): Promise<CaseStats | null> {
  const querySpanMs = bucketCount * bucketIntervalMs;

  // Smallest aligned startMs that fits inside the range.
  // alignToBucket floors to PG-epoch-aligned boundary; result may be one bucket
  // width below range.startMs, so the aligned lower bound bumps up one step.
  const alignedRangeStart = alignToBucket(range.startMs) < range.startMs
    ? alignToBucket(range.startMs) + bucketIntervalMs
    : alignToBucket(range.startMs);
  if (alignedRangeStart + querySpanMs > range.endMs) return null;  // range too narrow

  const maxRawStart = range.endMs - querySpanMs;
  const times: number[]  = [];
  let rowMismatches = 0;
  const expectedRows = tagCount * bucketCount;

  for (let i = 0; i < count + warmup; i++) {
    const tagIds   = shuffle([...trendablePool]).slice(0, tagCount);
    const rawStart = range.startMs + Math.floor(rng() * (maxRawStart - range.startMs));

    // Align to PG-epoch bucket boundary so time_bucket_gapfill emits exactly bucketCount buckets.
    let startMs = alignToBucket(rawStart);
    if (startMs < range.startMs) startMs += bucketIntervalMs;
    const endMs = startMs + querySpanMs;

    const t0  = performance.now();
    const res = await timescalePool.query(SQL, [
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
  const mismatchNote = rowMismatches > 0 ? `  ! ROW_MISMATCH x${rowMismatches}` : '';
  return (
    `min=${fmt(Math.min(...times))}ms  mean=${fmt(mean(times))}ms  ` +
    `median=${fmt(median(times))}ms  p95=${fmt(p95(times))}ms  ` +
    `max=${fmt(Math.max(...times))}ms  std=${fmt(stddev(times))}ms  ` +
    `rows=${expectedRows}${mismatchNote}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const totalQueries = MAX_N * BUCKET_COUNT_VALUES.length * PER_CASE * 2 + WARMUP;
const estMinLo     = Math.round(totalQueries * 20  / 60_000);
const estMinHi     = Math.round(totalQueries * 200 / 60_000);

const maxSpanMs  = Math.max(...BUCKET_COUNT_VALUES) * bucketIntervalMs;
const maxSpanMin = maxSpanMs / 60_000;

console.log('=== Perf battery: time_bucket_gapfill + locf (N=1..20, bucketCount=100..1000) ===');
console.log(
  `Seed: ${SEED}  |  BucketSamples: ${BUCKET_SAMPLES} (fixed)  |  Per-case: ${PER_CASE}  |  ` +
  `Warm-up: ${WARMUP} (N=1, BC=100, compressed)`,
);
console.log(`Derived SAMPLE_INTERVAL_MS: ${SAMPLE_INTERVAL_MS.toFixed(1)} ms`);
console.log(`Bucket interval:            ${bucketIntervalMs.toFixed(1)} ms  (${BUCKET_SAMPLES} × sample interval)`);
console.log(
  `Span at BC=1000:            ${maxSpanMin.toFixed(1)} min` +
  (maxSpanMin > 60
    ? '  ! Exceeds one chunk — uncompressed cells at BC=1000 will likely be SKIPPED.'
    : maxSpanMin > 30
      ? '  ! May span chunk boundary — expect SKIPPED cells on the uncompressed path at high BC.'
      : ''),
);
console.log(`Trendable pool: ${trendablePool.length} tags`);
console.log(
  `Total queries: ${totalQueries.toLocaleString()} — estimated ${estMinLo}–${estMinHi} min` +
  (estMinHi > 30 ? '  ! Consider halving PER_CASE if latency at large N/BC is high.' : ''),
);

const nextHourMs = Math.floor(nowMs / 3_600_000) * 3_600_000 + 3_600_000;
const estEndMs   = nowMs + estMinHi * 60_000;

if (estEndMs > nextHourMs + 5 * 60_000) {
  console.log('! Run may outlast current open chunk');
  console.log(`  Now:                ${new Date(nowMs).toISOString()}`);
  console.log(`  Next hour boundary: ${new Date(nextHourMs).toISOString()}`);
  console.log(`  Estimated end:      ${new Date(estEndMs).toISOString()}`);
  console.log('  Consider reducing PER_CASE or running closer to the top of the hour.');
  console.log();
}

console.log('\nRanges:');
console.log(`  Compressed    ${new Date(compressedRange.startMs).toISOString()} → ${new Date(compressedRange.endMs).toISOString()}`);
console.log(`  Uncompressed  ${new Date(uncompressedRange.startMs).toISOString()} → now (${new Date(uncompressedRange.endMs).toISOString()})`);
console.log('\nRunning...\n');

// matrices[n-1][bcIdx] = mean latency ms, or null if skipped
const compMatrix:   (number | null)[][] = Array.from({ length: MAX_N },
  () => new Array(BUCKET_COUNT_VALUES.length).fill(null));
const uncompMatrix: (number | null)[][] = Array.from({ length: MAX_N },
  () => new Array(BUCKET_COUNT_VALUES.length).fill(null));

for (let n = 1; n <= MAX_N; n++) {
  for (const [bcIdx, bc] of BUCKET_COUNT_VALUES.entries()) {
    const querySpanMs  = bc * bucketIntervalMs;
    const warmupCount  = (n === 1 && bc === 100) ? WARMUP : 0;
    const expectedRows = n * bc;

    const comp   = await runCase(n, bc, compressedRange,   PER_CASE, warmupCount);
    const uncomp = await runCase(n, bc, uncompressedRange, PER_CASE);

    const caseLabel = `N=${n}, BC=${bc}  (bucket=${fmt(bucketIntervalMs)}ms, span=${fmt(querySpanMs / 1000)}s)`;
    console.log(`── ${caseLabel} ${'─'.repeat(Math.max(1, 70 - caseLabel.length))}`);

    if (comp !== null) {
      compMatrix[n - 1][bcIdx] = mean(comp.times);
      console.log(`  Compressed    ${summarise(comp, expectedRows)}`);
    } else {
      console.log(`  Compressed    SKIPPED — span ${fmt(querySpanMs / 1000)}s exceeds range`);
    }

    if (uncomp !== null) {
      uncompMatrix[n - 1][bcIdx] = mean(uncomp.times);
      console.log(`  Uncompressed  ${summarise(uncomp, expectedRows)}`);
    } else {
      console.log(`  Uncompressed  SKIPPED — span ${fmt(querySpanMs / 1000)}s exceeds range`);
    }

    console.log();
  }
}

const runEndMs      = Date.now();
const runElapsedMin = Math.round((runEndMs - nowMs) / 60_000);

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

// ── Matrix output (tab-separated for spreadsheet paste) ───────────────────────

function printMatrix(label: string, mat: (number | null)[][]): void {
  console.log(`── ${label} ──`);
  const bcHeaders = BUCKET_COUNT_VALUES.map(String);
  console.log(['N\\BC', ...bcHeaders].join('\t'));
  for (let n = 1; n <= MAX_N; n++) {
    const row = mat[n - 1].map(v => v === null ? '—' : v.toFixed(2));
    console.log([String(n), ...row].join('\t'));
  }
  console.log();
}

printMatrix('Compressed mean latency (ms) — rows=N, cols=bucketCount', compMatrix);
printMatrix('Uncompressed mean latency (ms) — rows=N, cols=bucketCount', uncompMatrix);

if (compromised.length > 0) {
  console.log('! UNCOMPRESSED RANGE COMPROMISED');
  for (const c of compromised) {
    console.log(`  Chunk ${c.chunk_name} got compressed during the run.`);
  }
  console.log('  Uncompressed results in later battery cases may reflect compressed-chunk performance.');
  console.log(`  Runtime: ${runElapsedMin} min. Start: ${new Date(nowMs).toISOString()}. End: ${new Date(runEndMs).toISOString()}.`);
}
