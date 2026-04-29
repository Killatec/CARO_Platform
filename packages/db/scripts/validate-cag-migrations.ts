import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/caro-hmi/server/.env') });

import timescalePool from '../timescale/pool.js';
import { pingTimescale, runTimescaleMigrations } from '../index.js';

const EXPECTED_CAGS = [
  'tag_samples_1s_cagg',
  'tag_samples_10s_cagg',
  'tag_samples_1min_cagg',
  'tag_samples_10min_cagg',
] as const;

// CAGs that must have a retention policy (1s=14d, 10s=90d, 1min=365d)
const CAGS_WITH_RETENTION = new Set(['tag_samples_1s_cagg', 'tag_samples_10s_cagg', 'tag_samples_1min_cagg']);

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failures++;
  }
}

// ── 1. Ping ───────────────────────────────────────────────────────────────────

console.log('\n=== validate-cag-migrations ===\n');
console.log('Pinging TimescaleDB...');
await pingTimescale();
console.log('OK\n');

// ── 2. Run migrations ─────────────────────────────────────────────────────────

// Resolve migrations directory relative to this source file (tsx runs from
// packages/db/scripts/, not from the compiled dist/timescale/ the default path assumes).
const migrationsDir = path.resolve(__dirname, '../../../db/timescale/migrations');

console.log('Running runTimescaleMigrations()...');
const t0 = performance.now();
const results = await runTimescaleMigrations(migrationsDir);
const elapsed = performance.now() - t0;

console.log(`\nMigration results (total: ${elapsed.toFixed(0)} ms):`);
for (const r of results) {
  console.log(`  ${r.status === 'ok' ? '✓' : r.status === 'skipped' ? '–' : '✗'} ${r.file} [${r.status}]`);
}

// ── 3. CAG summary table ──────────────────────────────────────────────────────

console.log('\n── CAG summary ──────────────────────────────────────────────────');

const cagsRes = await timescalePool.query(`
  SELECT
    ca.view_name,
    ca.materialization_hypertable_name
  FROM timescaledb_information.continuous_aggregates ca
  WHERE ca.view_schema = 'public'
    AND ca.view_name LIKE 'tag_samples_%_cagg'
  ORDER BY ca.view_name
`);

const cagRows = cagsRes.rows as { view_name: string; materialization_hypertable_name: string }[];

const jobsRes = await timescalePool.query(`
  SELECT
    ca.view_name,
    j.proc_name,
    j.schedule_interval,
    j.config->>'compress_after' AS compress_after,
    j.config->>'drop_after'     AS drop_after
  FROM timescaledb_information.jobs j
  JOIN timescaledb_information.continuous_aggregates ca
    ON ca.materialization_hypertable_name = j.hypertable_name
   AND ca.materialization_hypertable_schema = j.hypertable_schema
  WHERE ca.view_name LIKE 'tag_samples_%_cagg'
  ORDER BY ca.view_name, j.proc_name
`);

type JobRow = {
  view_name: string;
  proc_name: string;
  schedule_interval: unknown;
  compress_after: string | null;
  drop_after: string | null;
};
const jobRows = jobsRes.rows as JobRow[];

// Row-count per CAG
const countResults: Record<string, number> = {};
for (const cag of EXPECTED_CAGS) {
  const r = await timescalePool.query(
    `SELECT COUNT(*) AS n FROM ${cag}`
  );
  countResults[cag] = Number((r.rows[0] as { n: string }).n);
}

console.log(
  '\n' +
  ['view_name', 'mat_hypertable', 'refresh_interval', 'compress_after', 'drop_after', 'row_count']
    .map(h => h.padEnd(30)).join('  ')
);
console.log('-'.repeat(180));

for (const cag of cagRows) {
  const refreshJob = jobRows.find(j => j.view_name === cag.view_name && j.proc_name === 'policy_refresh_continuous_aggregate');
  const compressJob = jobRows.find(j => j.view_name === cag.view_name && j.proc_name === 'policy_compression');
  const retentionJob = jobRows.find(j => j.view_name === cag.view_name && j.proc_name === 'policy_retention');

  console.log(
    [
      cag.view_name,
      cag.materialization_hypertable_name,
      String(refreshJob?.schedule_interval ?? '—'),
      compressJob?.compress_after ?? '—',
      retentionJob?.drop_after ?? '∞ (none)',
      String(countResults[cag.view_name] ?? '?'),
    ].map(v => v.padEnd(30)).join('  ')
  );
}

// ── 4. Assertions ─────────────────────────────────────────────────────────────

console.log('\n── Assertions ───────────────────────────────────────────────────');

const presentCags = new Set(cagRows.map(r => r.view_name));

for (const name of EXPECTED_CAGS) {
  assert(presentCags.has(name), `${name} exists`);
}

assert(!presentCags.has('caro_samples_1s'), 'caro_samples_1s no longer exists');

for (const name of EXPECTED_CAGS) {
  const refreshJob = jobRows.find(j => j.view_name === name && j.proc_name === 'policy_refresh_continuous_aggregate');
  assert(!!refreshJob, `${name} has refresh policy`);

  const compressJob = jobRows.find(j => j.view_name === name && j.proc_name === 'policy_compression');
  assert(!!compressJob, `${name} has compression policy`);

  const retentionJob = jobRows.find(j => j.view_name === name && j.proc_name === 'policy_retention');
  if (CAGS_WITH_RETENTION.has(name)) {
    assert(!!retentionJob, `${name} has retention policy`);
  } else {
    assert(!retentionJob, `${name} has NO retention policy (indefinite)`);
  }
}

// Check caro_samples_1s via information_schema in case it somehow survived as a non-CAG view
const staleRes = await timescalePool.query(`
  SELECT 1 FROM timescaledb_information.continuous_aggregates
  WHERE view_name = 'caro_samples_1s' AND view_schema = 'public'
`);
assert(staleRes.rows.length === 0, 'caro_samples_1s absent from timescaledb_information.continuous_aggregates');

// ── 5. Result ─────────────────────────────────────────────────────────────────

console.log(`\n── Result ───────────────────────────────────────────────────────`);
if (failures === 0) {
  console.log(`All assertions passed.\n`);
} else {
  console.error(`${failures} assertion(s) FAILED.\n`);
}

await timescalePool.end();
process.exit(failures === 0 ? 0 : 1);
