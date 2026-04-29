import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import pool          from '../pool.js';
import timescalePool from '../timescale/pool.js';

// SET work_mem once per connection when the pool establishes it.
// Deferred via setImmediate so our SET runs after pg's own connection-init
// queries finish — avoids the "client already executing a query" deprecation.
// Session-scoped: resets automatically when the connection closes — no global side effects.
timescalePool.on('connect', (client) => {
  setImmediate(() => { client.query("SET work_mem = '64MB'").catch(() => {}); });
});

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_MS = 1 * 60 * 1000;  // 1 minute
const PER_CHUNK = 100;             // queries per N per range
const WARMUP    = 10;              // discarded queries at start (N=1, compressed)
const MAX_N     = 20;
const SEED      = parseInt(process.env.PERF_SEED ?? '42', 10);

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
// Math.random() is not seedable; mulberry32 gives reproducible sequences.

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

// ── Compute time ranges ───────────────────────────────────────────────────────

const nowMs = Date.now();

// Compressed: full span of all compressed chunks — MIN(range_start) → MAX(range_end).
// Join with chunk_compression_stats() to filter to chunks the compression job has
// actually processed, then sample random 1-min windows uniformly across that entire
// history. This distributes load across all compressed chunks rather than
// hammering a single 1-hour window.
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

// Uncompressed: current (in-progress) chunk — range_start to now.
// Query timescaledb_information.chunks rather than flooring to the hour:
// the DB is the authoritative source for where the current chunk actually
// begins, guarding against edge cases (server restart mid-hour, manual
// chunk operations, etc.).
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

// Guard: each range must hold at least one full query window
for (const range of [compressedRange, uncompressedRange]) {
  const spanMs = range.endMs - range.startMs;
  if (spanMs < WINDOW_MS) {
    throw new Error(
      `${range.label} range span is ${spanMs}ms — too narrow for a ${WINDOW_MS}ms window.`,
    );
  }
}

// ── Fetch trendable tag pool from tag_registry ────────────────────────────────
// Mirrors getActiveTags(): DISTINCT ON selects the latest registry_rev per tag.

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

// ── SQL ───────────────────────────────────────────────────────────────────────

const SQL = `
  SELECT tag_id, ts, value
    FROM tag_samples
   WHERE tag_id = ANY($1::int[])
     AND ts >= to_timestamp($2::bigint / 1000.0)
     AND ts <  to_timestamp($3::bigint / 1000.0)
   ORDER BY tag_id, ts
`;

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  await timescalePool.end().catch(() => {});
  process.exit(0);
});

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
function fmtPad(n: number, w = 7): string { return n.toFixed(2).padStart(w); }

// ── Query runner ──────────────────────────────────────────────────────────────

type RangeStats = {
  times: number[];
  rowCounts: number[];
};

async function runRange(
  tagCount: number,
  range: { startMs: number; endMs: number },
  count: number,
  warmup = 0,
): Promise<RangeStats> {
  const maxStart = range.endMs - WINDOW_MS;
  const times: number[]     = [];
  const rowCounts: number[] = [];

  for (let i = 0; i < count + warmup; i++) {
    // Fresh random tag selection each query — realistic mixed workload where each
    // request arrives for a different tag set, as it would from real operator sessions
    const tagIds = shuffle([...trendablePool]).slice(0, tagCount);
    const startMs = range.startMs + Math.floor(rng() * (maxStart - range.startMs));

    const t0  = performance.now();
    const res = await timescalePool.query(SQL, [tagIds, BigInt(startMs), BigInt(startMs + WINDOW_MS)]);
    const dt  = performance.now() - t0;

    if (i >= warmup) {
      times.push(dt);
      rowCounts.push(res.rowCount ?? 0);
    }
  }

  return { times, rowCounts };
}

function summarise(s: RangeStats): string {
  const { times, rowCounts } = s;
  return (
    `min=${fmt(Math.min(...times))}ms  mean=${fmt(mean(times))}ms  ` +
    `median=${fmt(median(times))}ms  p95=${fmt(p95(times))}ms  ` +
    `max=${fmt(Math.max(...times))}ms  std=${fmt(stddev(times))}ms  ` +
    `rows=${Math.round(mean(rowCounts))}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const wmRes = await timescalePool.query<{ current: string }>("SELECT current_setting('work_mem') AS current");
console.log(`work_mem (per pool connection): ${wmRes.rows[0].current}`);

console.log('=== Perf battery: multi-tag 1-min raw queries (N=1..20) ===');
console.log(
  `Seed: ${SEED}  |  Window: 1 min  |  Per-chunk: ${PER_CHUNK}  |  Warm-up: ${WARMUP} (N=1, compressed)`,
);
console.log(`Trendable pool: ${trendablePool.length} tags\n`);
console.log('Ranges:');
console.log(`  Compressed    ${new Date(compressedRange.startMs).toISOString()} → ${new Date(compressedRange.endMs).toISOString()}`);
console.log(`  Uncompressed  ${new Date(uncompressedRange.startMs).toISOString()} → now (${new Date(uncompressedRange.endMs).toISOString()})`);
console.log('\nRunning...\n');

type Row = { n: number; compMean: number; uncompMean: number };
const summaryRows: Row[] = [];

for (let n = 1; n <= MAX_N; n++) {
  // Warmup only on the first N to prime the connection and query planner
  const warmupCount = n === 1 ? WARMUP : 0;

  const comp   = await runRange(n, compressedRange,   PER_CHUNK, warmupCount);
  const uncomp = await runRange(n, uncompressedRange, PER_CHUNK);

  console.log(`── N=${n} ${'─'.repeat(70 - String(n).length)}`);
  console.log(`  Compressed    ${summarise(comp)}`);
  console.log(`  Uncompressed  ${summarise(uncomp)}\n`);

  summaryRows.push({ n, compMean: mean(comp.times), uncompMean: mean(uncomp.times) });
}

await pool.end().catch(() => {});
await timescalePool.end().catch(() => {});

// ── Summary table ─────────────────────────────────────────────────────────────

console.log('── Summary: mean latency (ms) ──────────────────────────────────────────');
console.log(' N  │ Compressed │ Uncompressed');
console.log('────┼────────────┼─────────────');
for (const row of summaryRows) {
  console.log(
    ` ${String(row.n).padStart(2)} │${fmtPad(row.compMean, 10)} │${fmtPad(row.uncompMean, 11)}`,
  );
}

// Curve arrays for copy-paste into notes
const compCurve   = summaryRows.map(r => parseFloat(r.compMean.toFixed(2)));
const uncompCurve = summaryRows.map(r => parseFloat(r.uncompMean.toFixed(2)));
console.log(`\ncompressed_mean_ms by N:   [${compCurve.join(', ')}]`);
console.log(`uncompressed_mean_ms by N: [${uncompCurve.join(', ')}]`);
