import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import timescalePool from '../timescale/pool.js';

const TAG_ID    = 1091;
const WINDOW_MS = 1 * 60 * 1000; // 1 minute
const PER_CHUNK = 100;
const WARMUP    = 10;

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

// ── Query ─────────────────────────────────────────────────────────────────────

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

// 1. Discover chunks dynamically
type ChunkRow = { chunk_name: string; range_start: Date; range_end: Date; is_compressed: boolean };
const chunkRes = await timescalePool.query<ChunkRow>(`
  SELECT chunk_name, range_start, range_end, is_compressed
  FROM timescaledb_information.chunks
  WHERE hypertable_name = 'tag_samples'
    AND hypertable_schema = 'public'
  ORDER BY range_start DESC
`);

const compressedRow   = chunkRes.rows.find(r => r.is_compressed);
const uncompressedRow = chunkRes.rows.find(r => !r.is_compressed);

if (!compressedRow)   throw new Error('No compressed chunk found in tag_samples');
if (!uncompressedRow) throw new Error('No uncompressed chunk found in tag_samples — is data still accumulating?');

const nowMs = Date.now();

type ChunkDef = { name: string; label: string; startMs: number; endMs: number };

const CHUNKS: ChunkDef[] = [
  {
    name:    compressedRow.chunk_name,
    label:   'Compressed',
    startMs: compressedRow.range_start.getTime(),
    endMs:   compressedRow.range_end.getTime(),
  },
  {
    name:    uncompressedRow.chunk_name,
    label:   'Uncompressed',
    startMs: uncompressedRow.range_start.getTime(),
    endMs:   nowMs,  // cap at now — chunk is still being written
  },
];

// Guard: each chunk must span at least one query window
for (const chunk of CHUNKS) {
  const spanMs = chunk.endMs - chunk.startMs;
  if (spanMs < WINDOW_MS) {
    throw new Error(
      `${chunk.label} chunk ${chunk.name} span is ${spanMs}ms — ` +
      `too narrow for a ${WINDOW_MS}ms query window. Try again later.`,
    );
  }
}

// 2. Build test cases
type Case = { chunkIdx: number; startMs: number; endMs: number };
const cases: Case[] = [];
for (let ci = 0; ci < CHUNKS.length; ci++) {
  const chunk   = CHUNKS[ci];
  const maxStart = chunk.endMs - WINDOW_MS;
  for (let i = 0; i < PER_CHUNK; i++) {
    const startMs = chunk.startMs + Math.floor(Math.random() * (maxStart - chunk.startMs));
    cases.push({ chunkIdx: ci, startMs, endMs: startMs + WINDOW_MS });
  }
}

// Shuffle (Fisher-Yates)
for (let i = cases.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [cases[i], cases[j]] = [cases[j], cases[i]];
}

// 3. Run battery
console.log('=== Perf battery: single-tag 1-min raw queries ===');
console.log(`Tag: ${TAG_ID}  |  Window: 1 min  |  Per-chunk: ${PER_CHUNK}  |  Warm-up: ${WARMUP}`);
for (const chunk of CHUNKS) {
  const endLabel = chunk.label === 'Uncompressed'
    ? `now (${new Date(chunk.endMs).toISOString()})`
    : new Date(chunk.endMs).toISOString();
  console.log(`  ${chunk.label.padEnd(14)} ${chunk.name}  ${new Date(chunk.startMs).toISOString()} → ${endLabel}`);
}
console.log('Running...\n');

type Result = { chunkIdx: number; durationMs: number; rows: number; error?: string };
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

// 4. Report
const totalRecorded = results.length;
console.log(`Total queries (after ${WARMUP} warm-up): ${totalRecorded}  (errors: ${errorCount})\n`);

for (let ci = 0; ci < CHUNKS.length; ci++) {
  const chunk    = CHUNKS[ci];
  const group    = results.filter(r => r.chunkIdx === ci && !r.error);
  const times    = group.map(r => r.durationMs);
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
