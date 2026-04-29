// Sandbox window: pre-2000 timestamps that never collide with real operational data.
// Starts at epoch 0 so we have ~30 years of headroom; real ops data begins after
// platform deployment (post-2025). visually obvious in a DB inspector.
//
// IMPORTANT: getTrendTile requires startTime > 0n. Tests must choose tile ranges
// that are strictly positive (e.g., startTime = 3_600_000n, not 0n), while still
// writing raw samples anywhere within [TEST_RANGE_START, TEST_RANGE_END].

import { writeTagSamples } from '../../timescale/samples.js';
import timescalePool from '../../timescale/pool.js';

export { timescalePool };

export const TEST_RANGE_START = 0n;                    // epoch ms — 1970-01-01T00:00:00Z
export const TEST_RANGE_END   = 946_684_799_000n;      // epoch ms — 1999-12-31T23:59:59Z

export interface TestSample {
  tagId: number;
  ts: bigint;    // epoch ms — must fall within [TEST_RANGE_START, TEST_RANGE_END]
  value: number | null;
}

export async function writeTestSamples(samples: TestSample[]): Promise<void> {
  for (const s of samples) {
    if (s.ts < TEST_RANGE_START || s.ts > TEST_RANGE_END) {
      throw new Error(
        `writeTestSamples: ts ${s.ts} for tagId ${s.tagId} falls outside the test sandbox ` +
        `[${TEST_RANGE_START}, ${TEST_RANGE_END}]. Use timestamps before 2000-01-01.`,
      );
    }
  }
  // writeTagSamples expects ts: number (epoch ms); Number(bigint) is safe here
  // because these are pre-2000 timestamps well below Number.MAX_SAFE_INTEGER.
  await writeTagSamples(samples.map(s => ({
    ts:    Number(s.ts),
    tagId: s.tagId,
    value: s.value,
  })));
}

export async function resetTestRange(): Promise<void> {
  await timescalePool.query(
    `DELETE FROM tag_samples
     WHERE ts >= to_timestamp($1::bigint / 1000.0)
       AND ts <= to_timestamp($2::bigint / 1000.0)`,
    [TEST_RANGE_START, TEST_RANGE_END],
  );
}

/**
 * Returns a tag_id that has at least one sample in the last 5 minutes.
 * Returns null if no such tag exists (test should skip rather than fail).
 * Used by live-edge integration tests to avoid hardcoded tag IDs.
 */
export async function pickRecentlyActiveTagId(): Promise<number | null> {
  const res = await timescalePool.query(
    `SELECT tag_id
     FROM tag_samples
     WHERE ts > now() - INTERVAL '5 minutes'
     GROUP BY tag_id
     LIMIT 1`,
  );
  return (res.rows[0] as { tag_id: number } | undefined)?.tag_id ?? null;
}

// Materialises (or clears) the sandbox window for the given CAG.
// Must be called after writeTestSamples (to materialise) or after resetTestRange
// (to clear the CAG of previously materialised test rows).
// Note: CALL refresh_continuous_aggregate() cannot run inside a transaction block;
// pool.query() uses autocommit per statement, so this is safe.
export async function refreshTestCagg(
  viewName: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg',
): Promise<void> {
  const fullName = `tag_samples_${viewName}`;
  await timescalePool.query(
    `CALL refresh_continuous_aggregate(
       $1,
       to_timestamp($2::bigint / 1000.0),
       to_timestamp($3::bigint / 1000.0)
     )`,
    [fullName, TEST_RANGE_START, TEST_RANGE_END],
  );
}
