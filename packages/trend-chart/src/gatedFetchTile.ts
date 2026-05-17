import { fetchTile } from './api.js';
import { MAX_BUCKET_S } from './level.js';
import type { FetchTileParams, TileApiResponse } from './api.js';

export type GatedFetchFn = (args: FetchTileParams) => Promise<TileApiResponse>;

const CLIENT_FETCH_SENTINELS = ['CLIENT_UNDER_RANGE', 'CLIENT_OVER_RANGE', 'CLIENT_PRE_EPOCH'] as const;

/**
 * True when an error is one of the three client-side fetch sentinels
 * (under-range, over-range, pre-epoch). Catch handlers use this to skip
 * silently — these aren't fetch failures, they're predicate misses.
 */
export function isClientFetchSentinel(e: { code?: string } | undefined | null): boolean {
  return e != null && typeof e.code === 'string' && (CLIENT_FETCH_SENTINELS as readonly string[]).includes(e.code);
}

/**
 * Builds the gated fetch tile callback used throughout the hook.
 *
 * Checks per-tile bucketS against the server cap before calling fetchTile.
 * Rejects with a sentinel error code on CLIENT_UNDER_RANGE, CLIENT_OVER_RANGE,
 * or CLIENT_PRE_EPOCH so callers can silently skip without logging.
 *
 * Every fetch site in the hook MUST use this wrapper — it is the single
 * chokepoint for all tile fetches.
 */
export function buildGatedFetchTile(): GatedFetchFn {
  return (args: FetchTileParams): Promise<TileApiResponse> => {
    // Defense in depth: upstream tilesForViewport and ensureCovered filters should prevent
    // pre-epoch tiles, but guard here in case a future call site bypasses those filters.
    if (args.startTime < 0n) {
      return Promise.reject(
        Object.assign(new Error('tile start before epoch — skipped client-side'),
                      { code: 'CLIENT_PRE_EPOCH' }),
      );
    }

    const tileSpanBigint = args.endTime - args.startTime;

    // Check that bucketSMs (bigint integer division) is non-zero.
    // Below this, the server's time_bucket receives a 0-second interval and
    // breaks. Equivalent to tile span < bucketCount ms.
    // For the live-spine (bucketCount=2×500=1000): triggers at span < 1000n ms = MIN_VIEWPORT_SPAN_MS.
    // For history tiles (bucketCount=500): triggers at span < 500n ms (viewport < MIN_VIEWPORT_SPAN_MS
    // is caught by the main-effect pre-check; this guards any bypass path).
    if (tileSpanBigint / BigInt(args.bucketCount) === 0n) {
      return Promise.reject(
        Object.assign(new Error('tile bucketSMs would be 0 — fetch skipped client-side'),
                      { code: 'CLIENT_UNDER_RANGE' }),
      );
    }

    const tileSpanMs = Number(tileSpanBigint);
    const bucketS    = tileSpanMs / (args.bucketCount * 1000);
    if (bucketS > MAX_BUCKET_S) {
      return Promise.reject(
        Object.assign(new Error('viewport over range — fetch skipped client-side'),
                      { code: 'CLIENT_OVER_RANGE' }),
      );
    }

    return fetchTile(args);
  };
}
