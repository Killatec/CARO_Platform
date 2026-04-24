import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import timescalePool from '../timescale/pool.js';

// ── Chunk 3 time range (compressed) ──────────────────────────────────────────

// 2026-04-22T12:00:00Z → 2026-04-23T00:00:00Z  (_hyper_1_3_chunk)
const CHUNK_START_MS = 1776859200000; // 2026-04-22T12:00:00.000Z
const CHUNK_END_MS   = 1776902400000; // 2026-04-23T00:00:00.000Z
const WINDOW_MS      = 5 * 60 * 1000; // 5 minutes

const WINDOW_COUNT   = 100;
const RUNS_PER_N     = 100;
const WARMUP         = 10;
const MAX_N          = 20;

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

function fmt(n: number, dec = 2): string { return n.toFixed(dec); }

// ── Fisher-Yates shuffle (in-place) ──────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Resolve trendable tag pool ────────────────────────────────────────────────

const POOL_SQL = `
  SELECT tag_id FROM tag_samples
   WHERE ts >= to_timestamp(1776859200000::bigint / 1000.0)
     AND ts <  to_timestamp(1776902400000::bigint / 1000.0)
   GROUP BY tag_id
  HAVING count(*) > 10000
   ORDER BY tag_id
`;

console.log('Resolving trendable tag pool via fallback SQL (no explicit trendable concept in @caro/db)...');
const poolRes = await timescalePool.query<{ tag_id: number }>(POOL_SQL);
const tagPool: number[] = poolRes.rows.map(r => r.tag_id);
console.log(`Trendable pool size: ${tagPool.length} tags\n`);

if (tagPool.length < MAX_N) {
  console.error(`Pool size ${tagPool.length} < MAX_N ${MAX_N}. Aborting.`);
  await timescalePool.end();
  process.exit(1);
}

// ── Generate 100 fixed window starts ─────────────────────────────────────────

const maxStart = CHUNK_END_MS - WINDOW_MS;
const windows: number[] = Array.from({ length: WINDOW_COUNT }, () =>
  CHUNK_START_MS + Math.floor(Math.random() * (maxStart - CHUNK_START_MS)),
);

// ── Query ─────────────────────────────────────────────────────────────────────

const SQL = `
  SELECT tag_id, ts, value
    FROM tag_samples
   WHERE tag_id = ANY($1::int[])
     AND ts >= to_timestamp($2::bigint / 1000.0)
     AND ts <  to_timestamp($3::bigint / 1000.0)
   ORDER BY tag_id, ts
`;

process.on('SIGINT', async () => {
  await timescalePool.end();
  process.exit(0);
});

// ── Warm-up: 10 queries at N=10 ───────────────────────────────────────────────

console.log(`Running ${WARMUP} warm-up queries (N=10)...`);
for (let i = 0; i < WARMUP; i++) {
  const startMs = windows[i % WINDOW_COUNT];
  const ids = shuffle([...tagPool]).slice(0, 10);
  await timescalePool.query(SQL, [ids, BigInt(startMs), BigInt(startMs + WINDOW_MS)]);
}
console.log('Warm-up done.\n');

// ── Main battery ──────────────────────────────────────────────────────────────

console.log('=== Perf battery: 5-min raw queries, scaling tag count 1→20 ===');
console.log(`Chunk:         _hyper_1_3_chunk (compressed)`);
console.log(`Trendable pool size: ${tagPool.length}`);
console.log(`Window count:  ${WINDOW_COUNT} (shared across tag counts)`);
console.log(`Runs per N:    ${RUNS_PER_N}\n`);

type NResult = {
  n: number;
  times: number[];
  rows: number[];
  errors: number;
};

const wallStart = performance.now();
const allResults: NResult[] = [];
let totalErrors = 0;

for (let n = 1; n <= MAX_N; n++) {
  const times: number[] = [];
  const rows: number[] = [];
  let errors = 0;

  for (let i = 0; i < RUNS_PER_N; i++) {
    const startMs = windows[i % WINDOW_COUNT];
    const ids = shuffle([...tagPool]).slice(0, n);

    try {
      const t0 = performance.now();
      const res = await timescalePool.query(SQL, [ids, BigInt(startMs), BigInt(startMs + WINDOW_MS)]);
      times.push(performance.now() - t0);
      rows.push(res.rowCount ?? 0);
    } catch (e: unknown) {
      errors++;
      totalErrors++;
    }
  }

  allResults.push({ n, times, rows, errors });
}

const wallMs = performance.now() - wallStart;

// ── Report ────────────────────────────────────────────────────────────────────

const COL = {
  N:       4,
  min:     8,
  mean:    9,
  median: 11,
  p95:     9,
  max:     9,
  std:     8,
  rows:   12,
};

function pad(s: string, w: number): string { return s.padStart(w); }

const header =
  `${pad('N', COL.N)} | ${pad('min_ms', COL.min)} | ${pad('mean_ms', COL.mean)} | ` +
  `${pad('median_ms', COL.median)} | ${pad('p95_ms', COL.p95)} | ` +
  `${pad('max_ms', COL.max)} | ${pad('std_ms', COL.std)} | ${pad('mean_rows', COL.rows)}`;

const divider = '─'.repeat(header.length);

console.log(header);
console.log(divider);

const meanByN: number[] = [];
const p95ByN:  number[] = [];

for (const r of allResults) {
  const { n, times, rows } = r;
  const mn = mean(times);
  const pc = p95(times);
  meanByN.push(mn);
  p95ByN.push(pc);

  const zeroRows = rows.filter(x => x === 0).length;
  const zeroNote = zeroRows > 0 ? ` [${zeroRows} zero-row]` : '';

  console.log(
    `${pad(String(n), COL.N)} | ` +
    `${pad(fmt(Math.min(...times)), COL.min)} | ` +
    `${pad(fmt(mn), COL.mean)} | ` +
    `${pad(fmt(median(times)), COL.median)} | ` +
    `${pad(fmt(pc), COL.p95)} | ` +
    `${pad(fmt(Math.max(...times)), COL.max)} | ` +
    `${pad(fmt(stddev(times)), COL.std)} | ` +
    `${pad(Math.round(mean(rows)).toLocaleString(), COL.rows)}` +
    zeroNote,
  );
}

console.log('');
console.log(`mean_ms by N: [${meanByN.map(x => fmt(x)).join(', ')}]`);
console.log(`p95_ms  by N: [${p95ByN.map(x => fmt(x)).join(', ')}]`);
console.log('');
console.log(`Wall-clock time: ${fmt(wallMs / 1000)}s`);
console.log(`Total errors: ${totalErrors}`);

await timescalePool.end();
