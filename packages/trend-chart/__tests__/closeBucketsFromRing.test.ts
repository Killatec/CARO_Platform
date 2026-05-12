import { describe, it, expect } from 'vitest';
import { closeBucketsFromRing } from '../src/closeBucketsFromRing.js';
import { TS_BUCKET_ORIGIN_MS } from '../src/level.js';

// All timestamps are anchored to TS_BUCKET_ORIGIN_MS so bucket boundaries
// are exact multiples of bucketSMs from the origin.
const ORIGIN = TS_BUCKET_ORIGIN_MS;
const BUCKET_SMS = 1000; // 1-second buckets (as number, per helper signature)
const BIG_END = BigInt(Number.MAX_SAFE_INTEGER); // open upper bound (include all)

/** ms timestamp within a given bucket index at a given intra-bucket offset. */
function tAt(bucketIdx: number, offsetMs = 500): bigint {
  return ORIGIN + BigInt(bucketIdx * BUCKET_SMS + offsetMs);
}

/** Build an entry array from [moduleTs, value] pairs. */
function entries(
  pairs: [bigint, number | null][],
): { moduleTs: bigint; value: number | null }[] {
  return pairs.map(([moduleTs, value]) => ({ moduleTs, value }));
}

describe('closeBucketsFromRing — three-case rule', () => {
  it('normal: two entries in one bucket, next-bucket entry closes it → (last, min, max)', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), 5],
        [tAt(0, 200), 7],
        [tAt(0, 300), 6],
        [tAt(1, 100), 0], // triggers close of bucket 0
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.ts).toEqual([ORIGIN]);
    expect(result.value).toEqual([6]);
    expect(result.min).toEqual([5]);
    expect(result.max).toEqual([7]);
    expect(result.nullCount).toEqual([0]);
  });

  it('mixed-null: non-null then null in same bucket → (null, null, null); lkv reset', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), 5],
        [tAt(0, 200), null],
        [tAt(1, 100), 1], // triggers close
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.value).toEqual([null]);
    expect(result.min).toEqual([null]);
    expect(result.max).toEqual([null]);
    expect(result.nullCount).toEqual([1]);
  });

  it('empty bucket after normal close → LOCF from lastKnownValue', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), 9], // bucket 0: normal → lkv=9
        [tAt(2, 100), 3], // jumps to bucket 2 → closes 0 (normal), 1 (empty, lkv=9)
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.value).toEqual([9, 9]); // bucket 0 normal, bucket 1 LOCF
    expect(result.min).toEqual([9, 9]);
    expect(result.max).toEqual([9, 9]);
  });

  it('empty bucket after mixed-null close → (null, null, null)', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), null], // mixed-null → lkv=null
        [tAt(2, 100), 3],    // closes 0 (mixed-null), 1 (empty, lkv=null)
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.value).toEqual([null, null]);
    expect(result.min).toEqual([null, null]);
    expect(result.max).toEqual([null, null]);
  });

  it('open bucket (no subsequent entry) is NOT included in output', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), 5],
        [tAt(0, 400), 7],
        // No entry in bucket 1 to close bucket 0
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.ts).toHaveLength(0);
    expect(result.value).toHaveLength(0);
  });

  it('rangeStart / rangeEnd filter entries before bucketing', () => {
    // Only entries within [rangeStart, rangeEnd) contribute.
    // Entry at tAt(0,100) is below rangeStart; entry at tAt(2,100) is at/above rangeEnd.
    const rangeStart = tAt(0, 200);           // exclude first entry
    const rangeEnd   = tAt(2, 100);           // exclude last entry
    const result = closeBucketsFromRing(
      entries([
        [tAt(0, 100), 10],  // filtered out (< rangeStart)
        [tAt(0, 300), 20],  // included
        [tAt(1, 100), 30],  // included → closes bucket 0
        [tAt(2, 100), 40],  // filtered out (>= rangeEnd)
      ]),
      BUCKET_SMS, rangeStart, rangeEnd,
    );
    // Only bucket 0 closes (from entry at tAt(0,300)); bucket 1 remains open
    expect(result.ts).toEqual([ORIGIN]);
    expect(result.value).toEqual([20]);
  });

  it('out-of-order entry is dropped silently (does not corrupt state)', () => {
    const result = closeBucketsFromRing(
      entries([
        [tAt(1, 100), 5],   // bucket 1 open
        [tAt(0, 100), 99],  // out of order → dropped
        [tAt(2, 100), 7],   // closes bucket 1 (normal: last=5)
      ]),
      BUCKET_SMS, 0n, BIG_END,
    );
    expect(result.ts).toEqual([ORIGIN + BigInt(BUCKET_SMS)]);
    expect(result.value).toEqual([5]);   // out-of-order entry had no effect
    expect(result.min).toEqual([5]);
    expect(result.max).toEqual([5]);
  });
});
