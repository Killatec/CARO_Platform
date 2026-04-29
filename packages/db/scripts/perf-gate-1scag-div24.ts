import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// ── Gate 2: 1s CAG, ~6.83h window, 4 parallel tiles × 250 buckets ─────────────
// bucket_s = 24.58 s (Div=24.58)  →  tileSpan ≈ 1.707h  →  totalWindow ≈ 6.83h
// Default N = 8 (override with --n=<value>).
// Pass criterion: wall-clock mean ≤ 40 ms on the worst of compressed/uncompressed.
//
// Diagnostics:
//   D1 — expanded percentile distribution + slowest 5 trial report
//   D2 — single-query control: 1×1000 buckets over the full window
//   D3 — N sweep: N=1, 4, 8 (50 trials + 5 warmup each)
//   D4 — EXPLAIN (ANALYZE, BUFFERS) on one representative tile query

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { n: number; prepared: boolean; prevBound: string | null } {
  const args = process.argv.slice(2);
  let n = 8;
  let prepared = false;
  let prevBound: string | null = '5 minutes';
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--n=')) {
      n = parseInt(args[i].slice(4), 10);
    } else if (args[i] === '--n' && i + 1 < args.length) {
      n = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--prepared') {
      prepared = true;
    } else if (args[i] === '--no-prev-bound') {
      prevBound = null;
    } else if (args[i].startsWith('--prev-bound=')) {
      prevBound = args[i].slice('--prev-bound='.length).trim();
    } else if (args[i] === '--prev-bound' && i + 1 < args.length) {
      prevBound = args[i + 1].trim();
      i++;
    }
  }
  if (isNaN(n) || n < 1) throw new Error(`Invalid --n value: must be a positive integer`);
  if (prevBound !== null && prevBound.length === 0) throw new Error(`--prev-bound value is empty; use --no-prev-bound to disable`);
  return { n, prepared, prevBound };
}

const { n: N_TAGS, prepared: PREPARED, prevBound: PREV_BOUND } = parseArgs();
const QUERY_NAME = 'gate-1scag-div24';

// ── Constants ─────────────────────────────────────────────────────────────────

const TILE_COUNT      = 4;
const TILE_BUCKETS    = 250;
const TOTAL_BUCKETS   = TILE_COUNT * TILE_BUCKETS;   // 1000
const BUCKET_S        = 24.58;
const BUCKET_MS       = Math.round(BUCKET_S * 1000); // 24 580 ms
const TILE_SPAN_MS    = TILE_BUCKETS * BUCKET_MS;    // 6 145 000 ms ≈ 1.707h
const TOTAL_SPAN_MS   = TILE_COUNT  * TILE_SPAN_MS;  // 24 580 000 ms ≈ 6.83h
const PER_TRIAL       = 100;
const WARMUP          = 10;
const D3_TRIALS       = 50;
const D3_WARMUP       = 5;
const D3_N_VALUES     = [1, 4, 8] as const;
const SEED            = parseInt(process.env.PERF_SEED ?? '42', 10);
const PASS_MEAN_MS    = 40;
const CAG_VIEW        = 'tag_samples_1s_cagg';

const TIMESCALE_POOL_MAX = 10;
if (TIMESCALE_POOL_MAX < TILE_COUNT) {
  console.error(`ERROR: pool max (${TIMESCALE_POOL_MAX}) < TILE_COUNT (${TILE_COUNT}).`);
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

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(s.length * p) - 1];
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function fmt(n: number): string { return n.toFixed(2); }

function printD1Stats(
  label: string,
  xs: number[],
  indexed: { dt: number; idx: number }[],
  passThreshold?: number,
): void {
  const verdict = passThreshold !== undefined
    ? `  → ${mean(xs) <= passThreshold ? 'PASS' : 'FAIL'}`
    : '';
  console.log(
    `  ${label}: ` +
    `p50=${fmt(pct(xs, 0.50))}ms  p75=${fmt(pct(xs, 0.75))}ms  ` +
    `p90=${fmt(pct(xs, 0.90))}ms  p95=${fmt(pct(xs, 0.95))}ms  ` +
    `p99=${fmt(pct(xs, 0.99))}ms  mean=${fmt(mean(xs))}ms  ` +
    `max=${fmt(Math.max(...xs))}ms  std=${fmt(stddev(xs))}ms${verdict}`,
  );
  const top5 = [...indexed].sort((a, b) => b.dt - a.dt).slice(0, 5);
  console.log(
    `  slowest 5: ` +
    top5.map(t => `#${t.idx}=${fmt(t.dt)}ms`).join('  '),
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

if (tagRes.rows.length < Math.max(N_TAGS, ...D3_N_VALUES)) {
  throw new Error(
    `Need at least ${Math.max(N_TAGS, ...D3_N_VALUES)} trendable tags, found only ${tagRes.rows.length}.`,
  );
}

const trendablePool: number[] = tagRes.rows.map(r => Number(r.tag_id));

// ── Resolve CAG materialization hypertable ────────────────────────────────────

const cagHtRes = await timescalePool.query<{
  materialization_hypertable_name:   string;
  materialization_hypertable_schema: string;
}>(`
  SELECT materialization_hypertable_name, materialization_hypertable_schema
  FROM timescaledb_information.continuous_aggregates
  WHERE view_name = $1
`, [CAG_VIEW]);

if (cagHtRes.rows.length === 0) {
  console.error(
    `CAG_BLOCKED: view '${CAG_VIEW}' not found in continuous_aggregates.\n` +
    `Has the T005 migration been applied? Run Gate 1 instead.`,
  );
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
}

const CAG_HT        = cagHtRes.rows[0].materialization_hypertable_name;
const CAG_HT_SCHEMA = cagHtRes.rows[0].materialization_hypertable_schema;

// Pre-flight: must have at least one chunk
const cagChunkCnt = await timescalePool.query<{ cnt: string }>(`
  SELECT COUNT(*) AS cnt
  FROM timescaledb_information.chunks
  WHERE hypertable_name = $1 AND hypertable_schema = $2
`, [CAG_HT, CAG_HT_SCHEMA]);

if (parseInt(cagChunkCnt.rows[0].cnt, 10) === 0) {
  console.error(
    `CAG_BLOCKED: '${CAG_VIEW}' has no chunks — not yet materialized.\n` +
    `Wait for the refresh policy or call refresh_continuous_aggregate() manually, then re-run.`,
  );
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
}

// ── Time ranges ───────────────────────────────────────────────────────────────

type Range = { label: string; startMs: number; endMs: number };

const [cagCompRes, cagChunkRes] = await Promise.all([
  timescalePool.query<{ start_ms: Date; end_ms: Date }>(`
    SELECT MIN(range_start) AS start_ms, MAX(range_end) AS end_ms
    FROM timescaledb_information.chunks
    WHERE hypertable_name = $1 AND hypertable_schema = $2 AND is_compressed = true
  `, [CAG_HT, CAG_HT_SCHEMA]),
  timescalePool.query<{ range_start: Date }>(`
    SELECT range_start FROM timescaledb_information.chunks
    WHERE hypertable_name = $1 AND hypertable_schema = $2
    ORDER BY range_start DESC LIMIT 1
  `, [CAG_HT, CAG_HT_SCHEMA]),
]);

const compressedRange: Range | null = cagCompRes.rows[0]?.start_ms
  ? { label: 'Compressed',   startMs: cagCompRes.rows[0].start_ms.getTime(), endMs: cagCompRes.rows[0].end_ms.getTime() }
  : null;

const uncompressedRange: Range | null = cagChunkRes.rows.length > 0
  ? { label: 'Uncompressed', startMs: cagChunkRes.rows[0].range_start.getTime(), endMs: nowMs }
  : null;

// raw uncompressed range for compromise guard
const rawChunkRes = await timescalePool.query<{ range_start: Date }>(`
  SELECT range_start FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples' AND hypertable_schema = 'public'
  ORDER BY range_start DESC LIMIT 1
`);
const rawUncompRange: Range | null = rawChunkRes.rows.length > 0
  ? { label: 'raw-uncompressed', startMs: rawChunkRes.rows[0].range_start.getTime(), endMs: nowMs }
  : null;

// ── Startup snapshots ─────────────────────────────────────────────────────────

type ChunkSnapshot = { chunk_name: string; was_compressed: boolean };

async function snapshotChunks(htName: string, htSchema: string, range: Range): Promise<ChunkSnapshot[]> {
  const res = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
    SELECT chunk_name, is_compressed
    FROM timescaledb_information.chunks
    WHERE hypertable_name = $1 AND hypertable_schema = $2
      AND range_start < to_timestamp($3::bigint / 1000.0)
      AND range_end   > to_timestamp($4::bigint / 1000.0)
  `, [htName, htSchema, BigInt(range.endMs), BigInt(range.startMs)]);
  return res.rows.map(r => ({ chunk_name: r.chunk_name, was_compressed: r.is_compressed }));
}

const [cagSnapshot, rawSnapshot] = await Promise.all([
  uncompressedRange
    ? snapshotChunks(CAG_HT, CAG_HT_SCHEMA, uncompressedRange)
    : Promise.resolve([] as ChunkSnapshot[]),
  rawUncompRange
    ? snapshotChunks('tag_samples', 'public', rawUncompRange)
    : Promise.resolve([] as ChunkSnapshot[]),
]);

// ── Calibrate bucket origin ───────────────────────────────────────────────────

const originRes = await timescalePool.query<{ origin: Date }>(`
  SELECT time_bucket(make_interval(secs => $1::float8 / 1000.0), '2000-01-01 00:00:00 UTC'::timestamptz) AS origin
`, [BUCKET_MS]);

const BUCKET_ORIGIN_MS = originRes.rows[0].origin.getTime();

function alignToBucket(rawMs: number): number {
  return BUCKET_ORIGIN_MS + Math.floor((rawMs - BUCKET_ORIGIN_MS) / BUCKET_MS) * BUCKET_MS;
}

// ── SQL builder ───────────────────────────────────────────────────────────────
// $1 = BUCKET_MS (float8), $2 = tag_id[], $3 = windowStart, $4 = windowEnd
//
// time_bucket_gapfill's planner requires a literal call in GROUP BY — alias resolution
// does not satisfy it. The full expression is repeated verbatim.
// The `prev` subquery is time-bounded when PREV_BOUND is set (mirrors the raw fix).

function buildCAGSQL(prevBound: string | null): string {
  const prevClause = prevBound !== null
    ? `\n               AND bucket >= $3::timestamptz - INTERVAL '${prevBound}'`
    : '';
  return `
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
               AND bucket < $3::timestamptz${prevClause}
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
}

const CAG_SQL = buildCAGSQL(PREV_BOUND);

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

// ── Gate runner (4-tile parallel) ─────────────────────────────────────────────

type TileParams = { tagIds: number[]; tileStart: Date; tileEnd: Date };

type GateStats = {
  wallTimes:      number[];
  indexedWall:    { dt: number; idx: number }[];
  perTileTimes:   number[];
  tileMismatches: number;
  totalNullVals:  number;
  totalRows:      number;
  lastTileParams: TileParams;
};

async function runGate(
  range: Range,
  count: number,
  warmup: number,
  tagCount: number,
): Promise<GateStats | null> {
  let alignedStart = alignToBucket(range.startMs);
  if (alignedStart < range.startMs) alignedStart += BUCKET_MS;
  if (alignedStart + TOTAL_SPAN_MS > range.endMs) return null;

  const maxRawStart    = range.endMs - TOTAL_SPAN_MS;
  const wallTimes:     number[] = [];
  const indexedWall:   { dt: number; idx: number }[] = [];
  const perTileTimes:  number[] = [];
  let   tileMismatches = 0;
  let   totalNullVals  = 0;
  let   totalRows      = 0;
  let   lastTileParams: TileParams = { tagIds: [], tileStart: new Date(0), tileEnd: new Date(0) };

  for (let i = 0; i < count + warmup; i++) {
    const tagIds = shuffle([...trendablePool]).slice(0, tagCount);
    const raw    = range.startMs + Math.floor(rng() * (maxRawStart - range.startMs));
    let   base   = alignToBucket(raw);
    if (base < range.startMs) base += BUCKET_MS;

    const t0wall = performance.now();
    const tilePromises = Array.from({ length: TILE_COUNT }, (_, t) => {
      const tStart = base + t * TILE_SPAN_MS;
      const tEnd   = tStart + TILE_SPAN_MS;
      const t0t    = performance.now();
      const q = PREPARED
        ? { name: QUERY_NAME, text: CAG_SQL, values: [BUCKET_MS, tagIds, new Date(tStart), new Date(tEnd)] }
        : { text: CAG_SQL, values: [BUCKET_MS, tagIds, new Date(tStart), new Date(tEnd)] };
      return timescalePool.query<{ tag_id: number; bucket: Date; val: number | null }>(q)
        .then(res => ({
          rows:     res.rows.length,
          nullVals: res.rows.filter(r => r.val === null).length,
          dt:       performance.now() - t0t,
        }));
    });
    const tiles  = await Promise.all(tilePromises);
    const dtWall = performance.now() - t0wall;

    if (i >= warmup) {
      const trialIdx = i - warmup;
      wallTimes.push(dtWall);
      indexedWall.push({ dt: dtWall, idx: trialIdx });
      for (const tile of tiles) {
        perTileTimes.push(tile.dt);
        if (tile.rows !== tagCount * TILE_BUCKETS) tileMismatches++;
        totalNullVals += tile.nullVals;
        totalRows     += tile.rows;
      }
      lastTileParams = {
        tagIds,
        tileStart: new Date(base),
        tileEnd:   new Date(base + TILE_SPAN_MS),
      };
    }
  }

  return { wallTimes, indexedWall, perTileTimes, tileMismatches, totalNullVals, totalRows, lastTileParams };
}

// ── D2: Single-query control (1×1000 buckets) ─────────────────────────────────

type SingleStats = {
  times:      number[];
  indexed:    { dt: number; idx: number }[];
  mismatches: number;
  lastParams: { tagIds: number[]; start: Date; end: Date };
};

async function runSingleQuery(range: Range, count: number, warmup: number, tagCount: number): Promise<SingleStats | null> {
  let alignedStart = alignToBucket(range.startMs);
  if (alignedStart < range.startMs) alignedStart += BUCKET_MS;
  if (alignedStart + TOTAL_SPAN_MS > range.endMs) return null;

  const maxRawStart = range.endMs - TOTAL_SPAN_MS;
  const times:   number[] = [];
  const indexed: { dt: number; idx: number }[] = [];
  let   mismatches = 0;
  let   lastParams = { tagIds: [] as number[], start: new Date(0), end: new Date(0) };

  for (let i = 0; i < count + warmup; i++) {
    const tagIds = shuffle([...trendablePool]).slice(0, tagCount);
    const raw    = range.startMs + Math.floor(rng() * (maxRawStart - range.startMs));
    let   base   = alignToBucket(raw);
    if (base < range.startMs) base += BUCKET_MS;
    const end    = base + TOTAL_SPAN_MS;

    const q   = PREPARED
      ? { name: QUERY_NAME + '-single', text: CAG_SQL, values: [BUCKET_MS, tagIds, new Date(base), new Date(end)] }
      : { text: CAG_SQL, values: [BUCKET_MS, tagIds, new Date(base), new Date(end)] };
    const t0  = performance.now();
    const res = await timescalePool.query(q);
    const dt  = performance.now() - t0;

    if (i >= warmup) {
      const trialIdx = i - warmup;
      times.push(dt);
      indexed.push({ dt, idx: trialIdx });
      if (res.rows.length !== tagCount * TOTAL_BUCKETS) mismatches++;
      lastParams = { tagIds, start: new Date(base), end: new Date(end) };
    }
  }

  return { times, indexed, mismatches, lastParams };
}

// ── Header ────────────────────────────────────────────────────────────────────

console.log('=== Gate 2: tag_samples_1s_cagg CAG  4×250 tiles  ~6.83h window ===');
console.log(
  `N: ${N_TAGS} (override with --n=<value>)  |  ` +
  `bucket_s: ${BUCKET_S} (Div=24.58)  |  tileSpan: ${(TILE_SPAN_MS / 3_600_000).toFixed(3)}h  |  totalWindow: ${(TOTAL_SPAN_MS / 3_600_000).toFixed(3)}h`,
);
console.log(`prev-bound: ${PREV_BOUND ?? 'none (unbounded)'}  |  Mode: ${PREPARED ? 'PREPARED' : 'UNPREPARED'}`);
console.log(`Seed: ${SEED}  |  Trials: ${PER_TRIAL}+${WARMUP} warmup`);
console.log(`Pass criterion: wall-clock mean ≤ ${PASS_MEAN_MS} ms on the worst of compressed/uncompressed`);
console.log(`CAG view: ${CAG_VIEW}  |  CAG hypertable: ${CAG_HT_SCHEMA}.${CAG_HT}`);
console.log(`Trendable pool: ${trendablePool.length} tags`);
console.log(`Bucket origin:  ${new Date(BUCKET_ORIGIN_MS).toISOString()}`);

console.log('\nRanges:');
if (compressedRange) {
  console.log(`  Compressed    ${new Date(compressedRange.startMs).toISOString()} → ${new Date(compressedRange.endMs).toISOString()}`);
} else {
  console.log('  Compressed    NONE — no compressed CAG chunks (will be skipped)');
}
if (uncompressedRange) {
  const spanH = (uncompressedRange.endMs - uncompressedRange.startMs) / 3_600_000;
  const ok    = spanH * 3600 * 1000 >= TOTAL_SPAN_MS;
  console.log(
    `  Uncompressed  ${new Date(uncompressedRange.startMs).toISOString()} → now (${new Date(nowMs).toISOString()})` +
    (ok ? '' : `  ! span=${spanH.toFixed(2)}h < required ${(TOTAL_SPAN_MS / 3_600_000).toFixed(2)}h — will be skipped`),
  );
} else {
  console.log('  Uncompressed  NONE — no CAG chunks');
}
console.log('\nRunning...\n');

// ── Run gate + D2 + D3 per range ──────────────────────────────────────────────

type GateResult = {
  range:          string;
  stats:          GateStats | null;
  singleStats:    SingleStats | null;
  d3Results:      Array<{ n: number; stats: GateStats | null }>;
  skippedWhy?:    string;
};

const results: GateResult[] = [];
let explainParams: TileParams | null = null;

for (const range of [compressedRange, uncompressedRange]) {
  if (range === null) continue;

  console.log(`═══ ${range.label} ${'═'.repeat(Math.max(1, 72 - range.label.length))}`);

  // ── Gate run (D1 data) ─────────────────────────────────────────────────────
  console.log(`\n── 4-tile parallel (D1) ──────────────────────────────────────────────────`);
  const gateStats = await runGate(range, PER_TRIAL, WARMUP, N_TAGS);

  if (gateStats === null) {
    const why = `span ${((range.endMs - range.startMs) / 3_600_000).toFixed(2)}h < required ${(TOTAL_SPAN_MS / 3_600_000).toFixed(2)}h`;
    console.log(`  SKIPPED — ${why}`);
    results.push({ range: range.label, stats: null, singleStats: null, d3Results: [], skippedWhy: why });
    console.log();
    continue;
  }

  const mm = gateStats.tileMismatches > 0 ? `  ! TILE_MISMATCH ×${gateStats.tileMismatches}` : '';
  printD1Stats(`wall-clock (${PER_TRIAL} trials)`, gateStats.wallTimes, gateStats.indexedWall, PASS_MEAN_MS);
  printD1Stats(`per-tile   (${PER_TRIAL * TILE_COUNT} queries)`, gateStats.perTileTimes, gateStats.perTileTimes.map((dt, i) => ({ dt, idx: i })));
  console.log(`  expected rows/tile: ${N_TAGS * TILE_BUCKETS}${mm}`);
  const nullRate = gateStats.totalRows > 0 ? (gateStats.totalNullVals / gateStats.totalRows * 100).toFixed(3) : '0.000';
  console.log(`  null val rows: ${gateStats.totalNullVals} / ${gateStats.totalRows} (${nullRate}%)`);
  const first15 = gateStats.indexedWall
    .filter(e => e.idx < 15)
    .sort((a, b) => a.idx - b.idx);
  console.log(`  first 15 trials: ${first15.map(e => `#${e.idx}=${fmt(e.dt)}ms`).join('  ')}`);

  if (explainParams === null) explainParams = gateStats.lastTileParams;

  // ── D2: Single-query control ───────────────────────────────────────────────
  console.log(`\n── D2: single-query control (1×${TOTAL_BUCKETS} buckets) ──────────────────────────`);
  const singleStats = await runSingleQuery(range, PER_TRIAL, WARMUP, N_TAGS);

  if (singleStats === null) {
    console.log('  SKIPPED — range too narrow (same reason as gate)');
  } else {
    const smm = singleStats.mismatches > 0 ? `  ! ROW_MISMATCH ×${singleStats.mismatches}` : '';
    printD1Stats(`single-query (${PER_TRIAL} trials)`, singleStats.times, singleStats.indexed);
    console.log(`  expected rows: ${N_TAGS * TOTAL_BUCKETS}${smm}`);
    const pFactor = mean(singleStats.times) / mean(gateStats.wallTimes);
    console.log(`  parallelism factor: ${pFactor.toFixed(2)}× (single/parallel wall mean; >1 = tiles faster)`);
  }

  // ── D3: N sweep ───────────────────────────────────────────────────────────
  console.log(`\n── D3: N sweep (N∈{${D3_N_VALUES.join(',')}}, ${D3_TRIALS} trials + ${D3_WARMUP} warmup each) ─────────────`);

  // Predicted per-query means from gapfill battery (compressed, BS≈24, extrapolated):
  const d3Predicted: Record<number, number> = { 1: 6.5, 4: 10.0, 8: 14.0 };
  const d3Results: Array<{ n: number; stats: GateStats | null }> = [];

  for (const sweepN of D3_N_VALUES) {
    const s = await runGate(range, D3_TRIALS, D3_WARMUP, sweepN);
    d3Results.push({ n: sweepN, stats: s });
    if (s === null) {
      console.log(`  N=${sweepN}  SKIPPED`);
    } else {
      const pred = d3Predicted[sweepN];
      const tileM = fmt(mean(s.perTileTimes));
      const wallM = fmt(mean(s.wallTimes));
      const wallP = fmt(pct(s.wallTimes, 0.95));
      console.log(
        `  N=${sweepN}  wall mean=${wallM}ms  p95=${wallP}ms  tile mean=${tileM}ms  ` +
        `(predicted tile ~${pred}ms)`,
      );
    }
  }

  results.push({ range: range.label, stats: gateStats, singleStats, d3Results });
  console.log();
}

const runEndMs = Date.now();

// ── D4: EXPLAIN ANALYZE ───────────────────────────────────────────────────────

console.log(`── D4: EXPLAIN (ANALYZE, BUFFERS) — ${PREPARED ? 'EXECUTE prepared stmt' : 'literal SQL'} ─────────────`);
if (explainParams !== null) {
  const ep = explainParams;
  console.log(
    `  tagIds: [${ep.tagIds.slice(0, 4).join(', ')}${ep.tagIds.length > 4 ? ', ...' : ''}]` +
    `  window: ${ep.tileStart.toISOString()} → ${ep.tileEnd.toISOString()}`,
  );
  console.log();
  try {
    let planRows: string[];
    if (PREPARED) {
      const client = await timescalePool.connect();
      try {
        await client.query(
          `PREPARE _g2_explain (float8, int[], timestamptz, timestamptz) AS ${CAG_SQL}`,
        );
        const res = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) EXECUTE _g2_explain($1, $2, $3, $4)`,
          [BUCKET_MS, ep.tagIds, ep.tileStart, ep.tileEnd],
        );
        planRows = res.rows.map(r => r['QUERY PLAN']);
      } finally {
        await client.query('DEALLOCATE _g2_explain').catch(() => {});
        client.release();
      }
    } else {
      const res = await timescalePool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${CAG_SQL}`,
        [BUCKET_MS, ep.tagIds, ep.tileStart, ep.tileEnd],
      );
      planRows = res.rows.map(r => r['QUERY PLAN']);
    }
    for (const line of planRows) console.log('  ' + line);
  } catch (e) {
    console.log(`  EXPLAIN failed: ${(e as Error).message}`);
  }
} else {
  console.log('  No successful run to use as representative query.');
}
console.log();

// ── Compromise check ──────────────────────────────────────────────────────────

async function checkCompromised(
  htName: string,
  htSchema: string,
  snap: ChunkSnapshot[],
  range: Range | null,
): Promise<string[]> {
  if (!range || snap.length === 0) return [];
  const res = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
    SELECT chunk_name, is_compressed FROM timescaledb_information.chunks
    WHERE hypertable_name = $1 AND hypertable_schema = $2
      AND range_start < to_timestamp($3::bigint / 1000.0)
      AND range_end   > to_timestamp($4::bigint / 1000.0)
  `, [htName, htSchema, BigInt(range.endMs), BigInt(range.startMs)]);
  const endMap = new Map(res.rows.map(r => [r.chunk_name, r.is_compressed]));
  return snap.filter(s => !s.was_compressed && endMap.get(s.chunk_name) === true).map(s => s.chunk_name);
}

const [cagCompromised, rawCompromised] = await Promise.all([
  checkCompromised(CAG_HT, CAG_HT_SCHEMA, cagSnapshot, uncompressedRange),
  checkCompromised('tag_samples', 'public', rawSnapshot, rawUncompRange),
]);

await pool.end().catch(() => {});
await timescalePool.end().catch(() => {});

// ── Summary ───────────────────────────────────────────────────────────────────

const runMin = Math.round((runEndMs - nowMs) / 60_000);
console.log('── Gate 2 Summary ──────────────────────────────────────────────────────────');
console.log(`${'Range'.padEnd(16)} ${'4T mean'.padStart(10)} ${'4T p95'.padStart(10)} ${'1Q mean'.padStart(10)} ${'pFactor'.padStart(9)}  verdict`);
console.log('─'.repeat(74));
for (const { range, stats, singleStats, skippedWhy } of results) {
  if (stats === null) {
    console.log(`${range.padEnd(16)} ${'SKIPPED'.padStart(10)}  ${skippedWhy ?? ''}`);
    continue;
  }
  const wm  = fmt(mean(stats.wallTimes));
  const wp  = fmt(pct(stats.wallTimes, 0.95));
  const sm  = singleStats ? fmt(mean(singleStats.times)) : '—';
  const pf  = singleStats ? `${(mean(singleStats.times) / mean(stats.wallTimes)).toFixed(2)}×` : '—';
  const ver = mean(stats.wallTimes) <= PASS_MEAN_MS ? 'PASS' : 'FAIL';
  console.log(
    `${range.padEnd(16)} ${(wm + 'ms').padStart(10)} ${(wp + 'ms').padStart(10)} ${(sm + 'ms').padStart(10)} ${pf.padStart(9)}  ${ver}`,
  );
}

console.log('\nD3 N-sweep (wall-clock mean):');
console.log(`${'Range'.padEnd(14)} ${'N=1'.padStart(10)} ${'N=4'.padStart(10)} ${'N=8'.padStart(10)}`);
console.log('─'.repeat(48));
for (const { range, d3Results } of results) {
  const cells = d3Results.map(r =>
    r.stats ? (fmt(mean(r.stats.wallTimes)) + 'ms').padStart(10) : '—'.padStart(10),
  );
  console.log(`${range.padEnd(14)} ${cells.join(' ')}`);
}

const measuredMeans = results.filter(r => r.stats !== null).map(r => mean(r.stats!.wallTimes));
const overallVerdict = measuredMeans.length === 0
  ? 'SKIPPED'
  : measuredMeans.every(m => m <= PASS_MEAN_MS) ? 'PASS' : 'FAIL';
console.log(`\nOverall Gate 2: ${overallVerdict}`);
console.log(`Runtime: ${runMin} min  |  N: ${N_TAGS}  |  Start: ${new Date(nowMs).toISOString()}  |  End: ${new Date(runEndMs).toISOString()}`);

if (cagCompromised.length > 0 || rawCompromised.length > 0) {
  console.log('\n! CHUNKS COMPRESSED DURING RUN:');
  for (const c of cagCompromised) console.log(`  CAG chunk ${c} got compressed`);
  for (const c of rawCompromised) console.log(`  raw chunk ${c} got compressed`);
  console.log('  Uncompressed results may reflect compressed-chunk performance.');
}
