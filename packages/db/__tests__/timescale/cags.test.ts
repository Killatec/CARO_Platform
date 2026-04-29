import { describe, it, expect, afterAll } from 'vitest';

// ── Guard: skip all integration tests if TimescaleDB is not configured ─────────

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

if (HAVE_TIMESCALE) {
  afterAll(async () => {
    const pool = (await import('../../timescale/pool.js')).default;
    await pool.end();
  });
}

// ── CAG catalogue ─────────────────────────────────────────────────────────────

const CAGG_NAMES = [
  'tag_samples_1s_cagg',
  'tag_samples_10s_cagg',
  'tag_samples_1min_cagg',
  'tag_samples_10min_cagg',
] as const;

type CaggName = typeof CAGG_NAMES[number];

// ── Per-CAG schema tests ──────────────────────────────────────────────────────
//
// Each block runs 5 assertions per CAG:
//   1. View is registered in timescaledb_information.continuous_aggregates.
//   2. Materialised columns match spec shape: bucket, tag_id, last, null_count,
//      min, max (in that ordinal order).
//   3. A refresh policy job is attached with schedule_interval = 1 minute.
//   4. A compression policy job is attached with compress_after = 1 hour.
//   5. Compression layout: segmentby = tag_id, orderby = bucket DESC.

for (const viewName of CAGG_NAMES) {
  describe.skipIf(!HAVE_TIMESCALE)(`CAG schema: ${viewName}`, async () => {
    const pool = (await import('../../timescale/pool.js')).default;

    it('exists in timescaledb_information.continuous_aggregates', async () => {
      const res = await pool.query(
        `SELECT 1
         FROM timescaledb_information.continuous_aggregates
         WHERE view_name = $1 AND view_schema = 'public'`,
        [viewName],
      );
      expect(res.rows).toHaveLength(1);
    });

    it('materialises columns: bucket, tag_id, last, null_count, min, max', async () => {
      const res = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [viewName],
      );
      const cols = (res.rows as { column_name: string }[]).map(r => r.column_name);
      expect(cols).toEqual(['bucket', 'tag_id', 'last', 'null_count', 'min', 'max']);
    });

    it('has a refresh policy with schedule_interval = 1 minute', async () => {
      const res = await pool.query(
        // timescaledb_information.jobs stores the CAG view name in hypertable_name
        // (not the internal _materialized_hypertable_N name), so join on view_name.
        `SELECT j.schedule_interval
         FROM timescaledb_information.jobs j
         JOIN timescaledb_information.continuous_aggregates ca
           ON ca.view_name = j.hypertable_name
          AND j.hypertable_schema = 'public'
         WHERE ca.view_name = $1
           AND j.proc_name = 'policy_refresh_continuous_aggregate'`,
        [viewName],
      );
      expect(res.rows).toHaveLength(1);
      // Normalise the PG interval to seconds for comparison.
      const { schedule_interval } = res.rows[0] as { schedule_interval: unknown };
      const epochRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM $1::interval) AS secs`,
        [schedule_interval],
      );
      expect(Number((epochRes.rows[0] as { secs: string }).secs)).toBe(60);
    });

    it('has a compression policy with compress_after = 1 hour', async () => {
      const res = await pool.query(
        `SELECT j.config->>'compress_after' AS compress_after
         FROM timescaledb_information.jobs j
         JOIN timescaledb_information.continuous_aggregates ca
           ON ca.view_name = j.hypertable_name
          AND j.hypertable_schema = 'public'
         WHERE ca.view_name = $1
           AND j.proc_name = 'policy_compression'`,
        [viewName],
      );
      expect(res.rows).toHaveLength(1);
      const { compress_after } = res.rows[0] as { compress_after: string };
      const epochRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM $1::interval) AS secs`,
        [compress_after],
      );
      expect(Number((epochRes.rows[0] as { secs: string }).secs)).toBe(3600); // 1 hour
    });

    it('compression layout: segmentby=tag_id, orderby=bucket DESC', async () => {
      // In TimescaleDB 2.18+, compression settings for CAG materialized
      // hypertables are in timescaledb_information.hypertable_columnstore_settings
      // (not pg_class.reloptions, which is null for materialized views).
      // The `hypertable` column is schema-qualified: '<schema>.<relname>'.
      const res = await pool.query(
        `SELECT cs.segmentby, cs.orderby
         FROM timescaledb_information.hypertable_columnstore_settings cs
         JOIN timescaledb_information.continuous_aggregates ca
           ON cs.hypertable::text = ca.materialization_hypertable_schema || '.' || ca.materialization_hypertable_name
         WHERE ca.view_name = $1`,
        [viewName],
      );
      expect(res.rows).toHaveLength(1);
      const row = res.rows[0] as { segmentby: string; orderby: string };
      expect(row.segmentby).toBe('tag_id');
      expect(row.orderby).toBe('bucket DESC');
    });
  });
}

// ── Retention policy tests ────────────────────────────────────────────────────

describe.skipIf(!HAVE_TIMESCALE)('CAG retention policies', async () => {
  const pool = (await import('../../timescale/pool.js')).default;

  it.each<[CaggName, number]>([
    ['tag_samples_1s_cagg',    14],
    ['tag_samples_10s_cagg',   90],
    ['tag_samples_1min_cagg', 365],
  ])('%s has retention = %d days', async (viewName, expectedDays) => {
    const res = await pool.query(
      `SELECT j.config->>'drop_after' AS drop_after
       FROM timescaledb_information.jobs j
       JOIN timescaledb_information.continuous_aggregates ca
         ON ca.view_name = j.hypertable_name
        AND j.hypertable_schema = 'public'
       WHERE ca.view_name = $1
         AND j.proc_name = 'policy_retention'`,
      [viewName],
    );
    expect(res.rows).toHaveLength(1);
    const { drop_after } = res.rows[0] as { drop_after: string };
    const daysRes = await pool.query(
      `SELECT EXTRACT(EPOCH FROM $1::interval) / 86400.0 AS days`,
      [drop_after],
    );
    expect(Number((daysRes.rows[0] as { days: string }).days)).toBe(expectedDays);
  });

  it('tag_samples_10min_cagg has NO retention policy (indefinite retention)', async () => {
    const res = await pool.query(
      `SELECT 1
       FROM timescaledb_information.jobs j
       JOIN timescaledb_information.continuous_aggregates ca
         ON ca.view_name = j.hypertable_name
        AND j.hypertable_schema = 'public'
       WHERE ca.view_name = 'tag_samples_10min_cagg'
         AND j.proc_name = 'policy_retention'`,
    );
    expect(res.rows).toHaveLength(0);
  });
});
