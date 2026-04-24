import timescalePool from './pool.js';

export async function pingTimescale(): Promise<void> {
  await timescalePool.query('SELECT 1');
}

export interface TagSampleRow {
  ts: number;
  tagId: number;
  value: number | null;
}

/**
 * Bulk-inserts tag samples into the tag_samples hypertable.
 *
 * ts is epoch milliseconds; converted to TIMESTAMPTZ via to_timestamp(t/1000.0).
 * Uses unnest arrays to send a single round-trip regardless of row count.
 */
export async function writeTagSamples(rows: TagSampleRow[]): Promise<void> {
  if (rows.length === 0) return;

  const tsArr:    bigint[]         = rows.map(r => BigInt(r.ts));
  const tagArr:   number[]         = rows.map(r => r.tagId);
  const valArr:   (number | null)[] = rows.map(r => r.value);

  await timescalePool.query(
    `INSERT INTO tag_samples (ts, tag_id, value)
     SELECT to_timestamp(t / 1000.0), tid, v
     FROM unnest($1::bigint[], $2::int[], $3::double precision[]) AS s(t, tid, v)`,
    [tsArr, tagArr, valArr]
  );
}
