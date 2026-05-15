import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGatedFetchTile, CLIENT_UNDER_RANGE } from '../src/gatedFetchTile.js';
import { fetchTile } from '../src/api.js';
import { MIN_VIEWPORT_SPAN_MS, TREND_VIEWER_DEFAULTS } from '../src/level.js';
import type { FetchTileParams } from '../src/api.js';

vi.mock('../src/api.js', () => ({
  fetchTile: vi.fn(),
}));

const mockFetchTile = vi.mocked(fetchTile);

// Live-spine bucket count: visibleTilesPerWindow * bucketCount (matches liveSpineFetch.ts).
// At this bucketCount, the bucketSMs===0n threshold equals span < MIN_VIEWPORT_SPAN_MS.
const LIVE_SPINE_BUCKET_COUNT =
  TREND_VIEWER_DEFAULTS.visibleTilesPerWindow * TREND_VIEWER_DEFAULTS.bucketCount; // = 1000

function makeFetchParams(startTime: bigint, endTime: bigint, bucketCount = LIVE_SPINE_BUCKET_COUNT): FetchTileParams {
  return { tagIds: [1], startTime, endTime, bucketCount };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTile.mockResolvedValue({
    source: '1min_cagg',
    startTime: 0,
    endTime: 3_600_000,
    responseTailTs: 9_000_000,
    bucketSMs: 3600,
    n: LIVE_SPINE_BUCKET_COUNT,
    series: [],
  });
});

describe('buildGatedFetchTile — CLIENT_UNDER_RANGE', () => {
  it('live-spine span < MIN_VIEWPORT_SPAN_MS rejects with CLIENT_UNDER_RANGE and calls setRangeTooNarrow(true)', async () => {
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    // span = MIN_VIEWPORT_SPAN_MS - 1 = 999ms; bucketSMs = 999 / 1000 = 0n → triggers
    const start = 1_000_000n;
    const end   = start + MIN_VIEWPORT_SPAN_MS - 1n;

    await expect(gated(makeFetchParams(start, end))).rejects.toMatchObject({ code: CLIENT_UNDER_RANGE });
    expect(setRangeTooNarrow).toHaveBeenCalledWith(true);
    expect(setRangeExceeded).not.toHaveBeenCalled();
    expect(mockFetchTile).not.toHaveBeenCalled();
  });

  it('live-spine span === MIN_VIEWPORT_SPAN_MS passes through and calls fetchTile', async () => {
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    // span = 1000n; bucketSMs = 1000 / 1000 = 1n → passes
    const start = 1_000_000n;
    const end   = start + MIN_VIEWPORT_SPAN_MS;

    await gated(makeFetchParams(start, end));
    expect(mockFetchTile).toHaveBeenCalled();
    expect(setRangeTooNarrow).toHaveBeenCalledWith(false);
  });

  it('history tile at MIN_VIEWPORT_SPAN_MS/2 span with half the bucket count passes', async () => {
    // A history tile of 500ms with bucketCount=500: bucketSMs = 500/500 = 1n → passes.
    // This is the exact tile produced when viewport = MIN_VIEWPORT_SPAN_MS with 2 visible tiles.
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    const HISTORY_BUCKET_COUNT = TREND_VIEWER_DEFAULTS.bucketCount; // 500
    const start = 1_000_000n;
    const end   = start + MIN_VIEWPORT_SPAN_MS / 2n; // 500ms

    await gated(makeFetchParams(start, end, HISTORY_BUCKET_COUNT));
    expect(mockFetchTile).toHaveBeenCalled();
    expect(setRangeTooNarrow).toHaveBeenCalledWith(false);
  });

  it('normal viewport span calls fetchTile and resets both flags', async () => {
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    const start = 1_000_000n;
    const end   = start + 3_600_000n; // 1 hour

    await gated(makeFetchParams(start, end));
    expect(mockFetchTile).toHaveBeenCalled();
    expect(setRangeExceeded).toHaveBeenCalledWith(false);
    expect(setRangeTooNarrow).toHaveBeenCalledWith(false);
  });
});

describe('buildGatedFetchTile — CLIENT_OVER_RANGE', () => {
  it('bucketS > MAX_BUCKET_S rejects with CLIENT_OVER_RANGE and calls setRangeExceeded(true)', async () => {
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    // Large span that yields bucketS > MAX_BUCKET_S even at live-spine bucketCount=1000.
    const overSpan = BigInt(14746 + 1) * BigInt(LIVE_SPINE_BUCKET_COUNT) * 1000n;
    const start = 1_000_000n;

    await expect(gated(makeFetchParams(start, start + overSpan))).rejects.toMatchObject({ code: 'CLIENT_OVER_RANGE' });
    expect(setRangeExceeded).toHaveBeenCalledWith(true);
    expect(setRangeTooNarrow).not.toHaveBeenCalled();
    expect(mockFetchTile).not.toHaveBeenCalled();
  });
});

describe('buildGatedFetchTile — CLIENT_PRE_EPOCH', () => {
  it('startTime < 0n rejects with CLIENT_PRE_EPOCH without calling either setter', async () => {
    const setRangeExceeded = vi.fn();
    const setRangeTooNarrow = vi.fn();
    const gated = buildGatedFetchTile(setRangeExceeded, setRangeTooNarrow);

    await expect(gated(makeFetchParams(-1000n, 0n))).rejects.toMatchObject({ code: 'CLIENT_PRE_EPOCH' });
    expect(setRangeExceeded).not.toHaveBeenCalled();
    expect(setRangeTooNarrow).not.toHaveBeenCalled();
    expect(mockFetchTile).not.toHaveBeenCalled();
  });
});
