// Integration tests needing a pre-tile seed write must use tileIndex >= 1.
// tileIndex 0 has tileStart = 0, and writes at `tileStart - N` fall outside
// the [TEST_RANGE_START, TEST_RANGE_END] sandbox bounds, which writeTestSamples rejects.
import { writeTagSamples } from '../../timescale/samples.js';
import timescalePool from '../../timescale/pool.js';
import type { TagSampleRow } from '../../timescale/samples.js';

export { timescalePool };
export type { TagSampleRow };

export const TEST_RANGE_START = 0; // epoch ms — 1970-01-01T00:00:00Z
export const TEST_RANGE_END   = Date.UTC(1999, 11, 31, 23, 59, 59); // 1999-12-31T23:59:59Z

export async function writeTestSamples(rows: TagSampleRow[]): Promise<void> {
  for (const row of rows) {
    if (row.ts < TEST_RANGE_START || row.ts > TEST_RANGE_END) {
      throw new Error(
        `writeTestSamples: ts ${row.ts} for tagId ${row.tagId} falls outside the test sandbox ` +
        `[${TEST_RANGE_START}, ${TEST_RANGE_END}]. Use timestamps before 2000-01-01.`,
      );
    }
  }
  await writeTagSamples(rows);
}

export async function resetTestRange(): Promise<void> {
  await timescalePool.query(
    `DELETE FROM tag_samples
     WHERE ts >= to_timestamp($1 / 1000.0)
       AND ts <= to_timestamp($2 / 1000.0)`,
    [TEST_RANGE_START, TEST_RANGE_END],
  );
}
