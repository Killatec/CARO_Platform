import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTile } from '../src/api.js';
import type { TileApiResponse } from '../src/api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const AGG_BODY: { ok: true; data: TileApiResponse } = {
  ok: true,
  data: {
    source: '1min_cagg',
    startTime: 0,
    endTime: 3_600_000,
    bucketSMs: 3_600,
    n: 500,
    series: [{
      tagId: 1,
      value: new Array(500).fill(1.0),
      min:   new Array(500).fill(0.9),
      max:   new Array(500).fill(1.1),
    }],
  },
};

const RAW_BODY: { ok: true; data: TileApiResponse } = {
  ok: true,
  data: {
    source: 'raw',
    startTime: 0,
    endTime: 3_600_000,
    series: [{ tagId: 1, ts: [100, 200, 300], value: [1.0, 2.0, null] }],
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchTile', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs URL with correct query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(AGG_BODY));

    await fetchTile({ tagIds: [1, 2], startTime: 0n, endTime: 3_600_000n, bucketCount: 500 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/trends/tile');
    expect(calledUrl).toContain('tag_ids=1,2');
    expect(calledUrl).toContain('start_time=0');
    expect(calledUrl).toContain('end_time=3600000');
    expect(calledUrl).toContain('bucket_count=500');
  });

  it('throws synchronously on tagIds.length > 8', async () => {
    await expect(
      fetchTile({ tagIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], startTime: 0n, endTime: 1000n, bucketCount: 500 }),
    ).rejects.toThrow('tagIds.length exceeds maximum of 8');
    // Validated before any await — no network call fires.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws on non-2xx status with the API error code', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ ok: false, error: { code: 'INVALID_TAG_IDS', message: 'Bad request' } }, 400),
    );

    await expect(
      fetchTile({ tagIds: [1], startTime: 0n, endTime: 1000n, bucketCount: 500 }),
    ).rejects.toMatchObject({ code: 'INVALID_TAG_IDS', message: 'Bad request' });
  });

  it('throws on { ok: false } envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } }),
    );

    await expect(
      fetchTile({ tagIds: [1], startTime: 0n, endTime: 1000n, bucketCount: 500 }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('returns parsed data on { ok: true }', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(AGG_BODY));

    const result = await fetchTile({ tagIds: [1], startTime: 0n, endTime: 3_600_000n, bucketCount: 500 });

    expect(result.source).toBe('1min_cagg');
    expect(result.series).toHaveLength(1);
    if (result.source !== 'raw') {
      expect(result.n).toBe(500);
      expect(result.bucketSMs).toBe(3_600);
    }
  });

  it('handles BigInt-as-Number response timestamps correctly', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(AGG_BODY));

    const result = await fetchTile({ tagIds: [1], startTime: 0n, endTime: 3_600_000n, bucketCount: 500 });

    expect(typeof result.startTime).toBe('number');
    expect(typeof result.endTime).toBe('number');
    expect(result.startTime).toBe(0);
    expect(result.endTime).toBe(3_600_000);
  });

  it('aggregate response: min and max arrays present and aligned with value', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(AGG_BODY));

    const result = await fetchTile({ tagIds: [1], startTime: 0n, endTime: 3_600_000n, bucketCount: 500 });

    expect(result.source).not.toBe('raw');
    if (result.source !== 'raw') {
      expect(result.series[0]!.min).toHaveLength(500);
      expect(result.series[0]!.max).toHaveLength(500);
      expect(result.series[0]!.min[0]).toBe(0.9);
      expect(result.series[0]!.max[0]).toBe(1.1);
    }
  });

  it('raw response: series includes ts and value arrays', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(RAW_BODY));

    const result = await fetchTile({ tagIds: [1], startTime: 0n, endTime: 3_600_000n, bucketCount: 500 });

    expect(result.source).toBe('raw');
    if (result.source === 'raw') {
      expect(result.series[0]!.ts).toEqual([100, 200, 300]);
      expect(result.series[0]!.value).toEqual([1.0, 2.0, null]);
    }
  });
});
