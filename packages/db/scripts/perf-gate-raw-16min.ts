import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// ── Gate 1: Raw tag_samples, 16-min window, 4 parallel tiles × 250 buckets ────
// bucket_s = 0.96 s  →  tileSpan = 4 min  →  totalWindow = 16 min
// Default N = 8 (override with --n=<value>).
// Default prev-bound = '5 minutes' (override with --prev-bound=<interval> or --no-prev-bound).
// Pass criterion: wall-clock mean ≤ 40 ms on the worst of compressed/uncompressed.

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
const QUERY_NAME = 'gate-raw-16min';

// ── Constants ─────────────────────────────────────────────────────────────────

const TILE_COUNT    = 4;
const TILE_BUCKETS  = 250;
const BUCKET_S      = 0.96;
const BUCKET_MS     = Math.round(BUCKET_S * 1000);   // 960 ms
const TILE_SPAN_MS  = TILE_BUCKETS * BUCKET_MS;       // 240 000 ms = 4 min
const TOTAL_SPAN_MS = TILE_COUNT * TILE_SPAN_MS;      // 960 000 ms = 16 min
const PER_TRIAL     = 100;
const WARMUP        = 10;
const SEED          = parseInt(process.env.PERF_SEED ?? '42', 10);
const PASS_MEAN_MS  = 40;

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

// ── SQL builder ───────────────────────────────────────────────────────────────
// The `prev` correlated subquery is time-bounded when PREV_BOUND is set.
// Without the bound, the planner enumerates all tag_samples chunks (~14 ms planning per tile).
// With a 5-min bound, the planner prunes to at most 2 chunks regardless of retention age.

function buildSQL(prevBound: string | null): string {
  const prevClause = prevBound !== null
    ? `\n               AND ts >= $3::timestamptz - INTERVAL '${prevBound}'`
    : '';
  return `
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
               AND ts < $3::timestamptz${prevClause}
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
}

const SQL = buildSQL(PREV_BOUND);

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

// ── Time ranges ───────────────────────────────────────────────────────────────

const [compressedRes, chunkRes, chunkCountRes] = await Promise.all([
  timescalePool.query<{ start_ms: Date; end_ms: Date }>(`
    SELECT MIN(c.range_start) AS start_ms, MAX(c.range_end) AS end_ms
    FROM timescaledb_information.chunks c
    JOIN chunk_compression_stats('tag_samples') cs ON cs.chunk_name = c.chunk_name
    WHERE c.hypertable_name = 'tag_samples'
      AND c.hypertable_schema = 'public'
      AND c.is_compressed = true
  `),
  timescalePool.query<{ range_start: Date }>(`
    SELECT range_start
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'tag_samples'
      AND hypertable_schema = 'public'
    ORDER BY range_start DESC
    LIMIT 1
  `),
  timescalePool.query<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'tag_samples'
      AND hypertable_schema = 'public'
  `),
]);

const compRow = compressedRes.rows[0];
if (!compRow?.start_ms) throw new Error('No compressed chunks found in tag_samples');

const TOTAL_CHUNK_COUNT = parseInt(chunkCountRes.rows[0].cnt, 10);

const compressedRange = {
  label:   'Compressed',
  startMs: compRow.start_ms.getTime(),
  endMs:   compRow.end_ms.getTime(),
};

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

// ── Calibrate bucket origin ───────────────────────────────────────────────────

const originRes = await timescalePool.query<{ origin: Date }>(`
  SELECT time_bucket(
    make_interval(secs => $1::float8 / 1000.0),
    '2000-01-01 00:00:00 UTC'::timestamptz
  ) AS origin
`, [BUCKET_MS]);

const BUCKET_ORIGIN_MS = originRes.rows[0].origin.getTime();

function alignToBucket(rawMs: number): number {
  return BUCKET_ORIGIN_MS + Math.floor((rawMs - BUCKET_ORIGIN_MS) / BUCKET_MS) * BUCKET_MS;
}

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

// ── Range runner ──────────────────────────────────────────────────────────────

type TileParams = { tagIds: number[]; tileStart: Date; tileEnd: Date };

type RangeStats = {
  wallTimes:      number[];
  indexedWall:    { dt: number; idx: number }[];
  perTileTimes:   number[];
  tileMismatches: number;
  totalNullVals:  number;
  totalRows:      number;
  lastTileParams: TileParams;
};

async function runGate(
  range: { label: string; startMs: number; endMs: number },
  count: number,
  warmup: number,
  tagCount: number,
): Promise<RangeStats | null> {
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
        ? { name: QUERY_NAME, text: SQL, values: [BUCKET_MS, tagIds, new Date(tStart), new Date(tEnd)] }
        : { text: SQL, values: [BUCKET_MS, tagIds, new Date(tStart), new Date(tEnd)] };
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

// ── Header ────────────────────────────────────────────────────────────────────

const totalQueries = 2 * (PER_TRIAL + WARMUP) * TILE_COUNT;
const estMinLo     = Math.round(totalQueries * 10  / 60_000);
const estMinHi     = Math.round(totalQueries * 200 / 60_000);

console.log('=== Gate 1: raw tag_samples  4×250 tiles  16-min window ===');
console.log(
  `N: ${N_TAGS} (override with --n=<value>)  |  ` +
  `bucket_s: ${BUCKET_S}  |  tileSpan: ${TILE_SPAN_MS / 1000}s  |  totalWindow: ${TOTAL_SPAN_MS / 1000}s`,
);
console.log(`prev-bound: ${PREV_BOUND ?? 'none (unbounded)'}  |  Mode: ${PREPARED ? 'PREPARED' : 'UNPREPARED'}`);
console.log(`Seed: ${SEED}  |  Trials: ${PER_TRIAL}+${WARMUP} warmup`);
console.log(`Pass criterion: wall-clock mean ≤ ${PASS_MEAN_MS} ms on the worst of compressed/uncompressed`);
console.log(`Trendable pool: ${trendablePool.length} tags  |  Total tag_samples chunks: ${TOTAL_CHUNK_COUNT}`);
console.log(`Bucket origin:  ${new Date(BUCKET_ORIGIN_MS).toISOString()}`);
console.log(
  `Total tile queries: ${totalQueries.toLocaleString()} — estimated ${estMinLo}–${estMinHi} min`,
);
console.log('\nRanges:');
console.log(`  Compressed    ${new Date(compressedRange.startMs).toISOString()} → ${new Date(compressedRange.endMs).toISOString()}`);

const uncompSpanMin = (uncompressedRange.endMs - uncompressedRange.startMs) / 60_000;
const uncompOk      = uncompSpanMin >= TOTAL_SPAN_MS / 60_000;
console.log(
  `  Uncompressed  ${new Date(uncompressedRange.startMs).toISOString()} → now (${new Date(nowMs).toISOString()})` +
  (uncompOk ? '' : `  ! span=${uncompSpanMin.toFixed(1)} min < required ${TOTAL_SPAN_MS / 60_000} min — will be skipped`),
);
console.log('\nRunning...\n');

// ── Run ───────────────────────────────────────────────────────────────────────

type GateResult = {
  range:          string;
  stats:          RangeStats | null;
  skippedWhy?:    string;
};

const results: GateResult[] = [];
let explainParams: TileParams | null = null;

for (const range of [compressedRange, uncompressedRange]) {
  console.log(`── ${range.label} ────────────────────────────────────────────────────────────────`);
  const stats = await runGate(range, PER_TRIAL, WARMUP, N_TAGS);

  if (stats === null) {
    const why = `span ${((range.endMs - range.startMs) / 60_000).toFixed(1)} min < required ${TOTAL_SPAN_MS / 60_000} min`;
    console.log(`  SKIPPED — ${why}`);
    results.push({ range: range.label, stats: null, skippedWhy: why });
  } else {
    const mm = stats.tileMismatches > 0 ? `  ! TILE_MISMATCH ×${stats.tileMismatches}` : '';
    printD1Stats(`wall-clock (${PER_TRIAL} trials)`, stats.wallTimes, stats.indexedWall, PASS_MEAN_MS);
    printD1Stats(`per-tile   (${PER_TRIAL * TILE_COUNT} queries)`, stats.perTileTimes, stats.perTileTimes.map((dt, i) => ({ dt, idx: i })));
    console.log(`  expected rows/tile: ${N_TAGS * TILE_BUCKETS}${mm}`);
    const nullRate = stats.totalRows > 0 ? (stats.totalNullVals / stats.totalRows * 100).toFixed(3) : '0.000';
    console.log(`  null val rows: ${stats.totalNullVals} / ${stats.totalRows} (${nullRate}%)`);
    const first15 = stats.indexedWall
      .filter(e => e.idx < 15)
      .sort((a, b) => a.idx - b.idx);
    console.log(`  first 15 trials: ${first15.map(e => `#${e.idx}=${fmt(e.dt)}ms`).join('  ')}`);
    results.push({ range: range.label, stats });
    if (explainParams === null) explainParams = stats.lastTileParams;
  }
  console.log();
}

const runEndMs = Date.now();

// ── D4: EXPLAIN ANALYZE ───────────────────────────────────────────────────────

console.log(`── D4: EXPLAIN (ANALYZE, BUFFERS) — literal SQL ─────────────`);
if (explainParams !== null) {
  const ep = explainParams;
  console.log(`  tagIds: [${ep.tagIds.slice(0, 4).join(', ')}${ep.tagIds.length > 4 ? ', ...' : ''}]  window: ${ep.tileStart.toISOString()} → ${ep.tileEnd.toISOString()}`);
  console.log();
  try {
    const res = await timescalePool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${SQL}`,
      [BUCKET_MS, ep.tagIds, ep.tileStart, ep.tileEnd],
    );
    for (const row of res.rows) console.log('  ' + row['QUERY PLAN']);
  } catch (e) {
    console.log(`  EXPLAIN failed: ${(e as Error).message}`);
  }
} else {
  console.log('  No successful run to use as representative query.');
}
console.log();

// ── Compromise check ──────────────────────────────────────────────────────────

const endSnapshotRes = await timescalePool.query<{ chunk_name: string; is_compressed: boolean }>(`
  SELECT chunk_name, is_compressed
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples'
    AND hypertable_schema = 'public'
    AND range_start < to_timestamp($1::bigint / 1000.0)
    AND range_end   > to_timestamp($2::bigint / 1000.0)
`, [BigInt(uncompressedRange.endMs), BigInt(uncompressedRange.startMs)]);

const endMap      = new Map(endSnapshotRes.rows.map(r => [r.chunk_name, r.is_compressed]));
const compromised = startupSnapshot.filter(s => !s.was_compressed && endMap.get(s.chunk_name) === true);

await pool.end().catch(() => {});
await timescalePool.end().catch(() => {});

// ── Summary ───────────────────────────────────────────────────────────────────

const runMin = Math.round((runEndMs - nowMs) / 60_000);
console.log('── Gate 1 Summary ──────────────────────────────────────────────────────────');
console.log(`${'Range'.padEnd(16)} ${'mean'.padStart(10)} ${'p95'.padStart(10)} ${'tile mean'.padStart(12)} ${'tile p95'.padStart(10)}  verdict`);
console.log('─'.repeat(74));
for (const { range, stats, skippedWhy } of results) {
  if (stats === null) {
    console.log(`${range.padEnd(16)} ${'SKIPPED'.padStart(10)}  ${skippedWhy ?? ''}`);
    continue;
  }
  const wm  = fmt(mean(stats.wallTimes));
  const wp  = fmt(pct(stats.wallTimes, 0.95));
  const tm  = fmt(mean(stats.perTileTimes));
  const tp  = fmt(pct(stats.perTileTimes, 0.95));
  const ver = mean(stats.wallTimes) <= PASS_MEAN_MS ? 'PASS' : 'FAIL';
  console.log(
    `${range.padEnd(16)} ${(wm + 'ms').padStart(10)} ${(wp + 'ms').padStart(10)} ${(tm + 'ms').padStart(12)} ${(tp + 'ms').padStart(10)}  ${ver}`,
  );
}

const measuredMeans = results.filter(r => r.stats !== null).map(r => mean(r.stats!.wallTimes));
const overallVerdict = measuredMeans.length === 0
  ? 'SKIPPED'
  : measuredMeans.every(m => m <= PASS_MEAN_MS) ? 'PASS' : 'FAIL';
console.log(`\nOverall Gate 1: ${overallVerdict}`);
console.log(`Runtime: ${runMin} min  |  N: ${N_TAGS}  |  prev-bound: ${PREV_BOUND ?? 'none'}  |  Start: ${new Date(nowMs).toISOString()}  |  End: ${new Date(runEndMs).toISOString()}`);

if (compromised.length > 0) {
  console.log('\n! UNCOMPRESSED RANGE COMPROMISED during run:');
  for (const c of compromised) console.log(`  ${c.chunk_name} got compressed`);
  console.log('  Uncompressed results may reflect compressed-chunk performance.');
}
