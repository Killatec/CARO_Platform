import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import timescalePool from '../timescale/pool.js';

// ── Chunk definitions ─────────────────────────────────────────────────────────

const CHUNKS = [
  {
    name: '_hyper_1_3_chunk',
    label: 'Compressed',
    startMs: 1776859200000,
    endMs:   1776902400000,
  },
  {
    name: '_hyper_1_5_chunk',
    label: 'Uncompressed',
    startMs: 1776902400000,
    endMs:   1776945600000,
  },
] as const;

const TAG_ID      = 1091;
const WINDOW_MS   = 5 * 60 * 1000; // 5 minutes
const PER_CHUNK   = 100;
const WARMUP      = 10;

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

// ── Build test cases ──────────────────────────────────────────────────────────

type Case = { chunkIdx: 0 | 1; startMs: number; endMs: number };

const cases: Case[] = [];
for (let ci = 0; ci < CHUNKS.length; ci++) {
  const chunk = CHUNKS[ci as 0 | 1];
  const maxStart = chunk.endMs - WINDOW_MS;
  for (let i = 0; i < PER_CHUNK; i++) {
    const startMs = chunk.startMs + Math.floor(Math.random() * (maxStart - chunk.startMs));
    cases.push({ chunkIdx: ci as 0 | 1, startMs, endMs: startMs + WINDOW_MS });
  }
}

// Shuffle (Fisher-Yates)
for (let i = cases.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [cases[i], cases[j]] = [cases[j], cases[i]];
}

// ── Query runner ──────────────────────────────────────────────────────────────

type Result = { chunkIdx: 0 | 1; durationMs: number; rows: number; error?: string };

const SQL = `
  SELECT ts, value
    FROM tag_samples
   WHERE tag_id = $1
     AND ts >= to_timestamp($2::bigint / 1000.0)
     AND ts <  to_timestamp($3::bigint / 1000.0)
   ORDER BY ts
`;

process.on('SIGINT', async () => {
  await timescalePool.end();
  process.exit(0);
});

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('=== Perf battery: single-tag 5-min raw queries ===');
console.log(`Tag: ${TAG_ID}  |  Window: 5 min  |  Total cases: ${cases.length}  |  Warm-up: ${WARMUP}`);
console.log('Running...\n');

let errorCount = 0;
const results: Result[] = [];

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  let durationMs = 0;
  let rows = 0;
  let error: string | undefined;

  try {
    const t0 = performance.now();
    const res = await timescalePool.query(SQL, [TAG_ID, BigInt(c.startMs), BigInt(c.endMs)]);
    durationMs = performance.now() - t0;
    rows = res.rowCount ?? 0;
  } catch (e: unknown) {
    error = (e as Error).message;
    errorCount++;
  }

  if (i >= WARMUP) {
    results.push({ chunkIdx: c.chunkIdx, durationMs, rows, error });
  }
}

await timescalePool.end();

// ── Reporting ─────────────────────────────────────────────────────────────────

const totalRecorded = results.length;
console.log(`Total queries (after ${WARMUP} warm-up): ${totalRecorded}  (errors: ${errorCount})\n`);

for (let ci = 0; ci < CHUNKS.length; ci++) {
  const chunk = CHUNKS[ci as 0 | 1];
  const group = results.filter(r => r.chunkIdx === ci && !r.error);
  const times = group.map(r => r.durationMs);
  const rowCounts = group.map(r => r.rows);
  const zeroRows = group.filter(r => r.rows === 0).length;

  if (times.length === 0) {
    console.log(`── ${chunk.label} chunk (${chunk.name}) ──`);
    console.log('  No results recorded.\n');
    continue;
  }

  const first5 = times.slice(0, 5).map(fmt);
  const last5  = times.slice(-5).map(fmt);

  console.log(`── ${chunk.label} chunk (${chunk.name}) ──`);
  console.log(`Runs:    ${times.length}${zeroRows > 0 ? `  (${zeroRows} returned zero rows)` : ''}`);
  console.log(
    `Times:   min=${fmt(Math.min(...times))}ms  mean=${fmt(mean(times))}ms  ` +
    `median=${fmt(median(times))}ms  p95=${fmt(p95(times))}ms  ` +
    `max=${fmt(Math.max(...times))}ms  std=${fmt(stddev(times))}ms`,
  );
  console.log(
    `Rows:    min=${Math.min(...rowCounts)}  mean=${Math.round(mean(rowCounts))}  max=${Math.max(...rowCounts)}`,
  );
  console.log(`First 5: [${first5.join(', ')}]`);
  console.log(`Last 5:  [${last5.join(', ')}]\n`);
}
