import { fetchTile } from './api.js';
import { MAX_BUCKET_S } from './level.js';
import type { FetchTileParams, TileApiResponse } from './api.js';

export type GatedFetchFn = (args: FetchTileParams) => Promise<TileApiResponse>;

/**
 * Builds the gated fetch tile callback used throughout the hook.
 *
 * Checks per-tile bucketS against the server cap before calling fetchTile.
 * Rejects with a sentinel error code on CLIENT_OVER_RANGE or CLIENT_PRE_EPOCH
 * so callers can silently skip without logging.
 *
 * Every fetch site in the hook MUST use this wrapper — it is the single
 * chokepoint for all tile fetches.
 */
export function buildGatedFetchTile(
  setRangeExceeded: (exceeded: boolean) => void,
): GatedFetchFn {
  return (args: FetchTileParams): Promise<TileApiResponse> => {
    // Defense in depth: upstream tilesForViewport and ensureCovered filters should prevent
    // pre-epoch tiles, but guard here in case a future call site bypasses those filters.
    if (args.startTime < 0n) {
      return Promise.reject(
        Object.assign(new Error('tile start before epoch — skipped client-side'),
                      { code: 'CLIENT_PRE_EPOCH' }),
      );
    }
    const tileSpanMs = Number(args.endTime - args.startTime);
    const bucketS    = tileSpanMs / (args.bucketCount * 1000);
    if (bucketS > MAX_BUCKET_S) {
      setRangeExceeded(true);
      return Promise.reject(
        Object.assign(new Error('viewport over range — fetch skipped client-side'),
                      { code: 'CLIENT_OVER_RANGE' }),
      );
    }
    setRangeExceeded(false);
    return fetchTile(args);
  };
}
