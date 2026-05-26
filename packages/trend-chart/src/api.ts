import { apiClient } from '@caro/ui';

export interface FetchTileParams {
  tagIds: number[];
  startTime: bigint;
  endTime: bigint;
  bucketCount: number;
}

export type TileApiResponse =
  | {
      source: 'raw';
      startTime: number;
      endTime: number;
      /** DbPipeline commit watermark (ms since epoch). Client uses this as the live-ring trim threshold and terminal-cache signal. */
      committedThroughTs: number;
      series: Array<{
        tagId: number;
        ts: number[];
        value: (number | null)[];
        /** Most recent sample before startTime (§5.5 bounded-prev, v0.9+). */
        prev?: { ts: number; value: number | null };
      }>;
    }
  | {
      source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'tag_samples' | 'mixed';
      startTime: number;
      endTime: number;
      /** DbPipeline commit watermark (ms since epoch). Client uses this as the live-ring trim threshold and terminal-cache signal. */
      committedThroughTs: number;
      bucketSMs: number;
      n: number;
      series: Array<{
        tagId: number;
        value: (number | null)[];
        min:   (number | null)[];
        max:   (number | null)[];
      }>;
    };

/**
 * Fetches one tile from /api/v1/trends/tile.
 * Throws synchronously for invalid params; throws asynchronously on transport
 * failure, non-ok envelope, or API-level error. Caller decides retry policy.
 */
export async function fetchTile(params: FetchTileParams): Promise<TileApiResponse> {
  if (params.tagIds.length === 0) {
    throw new Error('fetchTile: tagIds must not be empty');
  }
  if (params.tagIds.length > 8) {
    throw new Error('fetchTile: tagIds.length exceeds maximum of 8');
  }

  const path =
    `/trends/tile` +
    `?tag_ids=${params.tagIds.join(',')}` +
    `&start_time=${params.startTime.toString()}` +
    `&end_time=${params.endTime.toString()}` +
    `&bucket_count=${params.bucketCount}`;

  return apiClient.get<TileApiResponse>(path);
}
