import type { MetaLevel } from '@caro/tag-registry-shared';
import type { TagPathIndex } from './tagPathIndex.js';
export type { MetaLevel };
export type { TagPathIndex };

/** Tag definition from the backend in-memory tag map. */
export interface TagDef {
  tag_id: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  module_id: string;
  module_type: string;
  eng_min: number | null;
  eng_max: number | null;
  unit: string | null;
  meta: MetaLevel[];
}

/** Live value pushed via WebSocket. null value = bad quality (device offline / telemetry lost). */
export interface LiveValue {
  value: number | boolean | string | number[] | boolean[] | string[] | null;
}

/** Node in the subtree returned by useTagSubtree. */
export interface NestedTagNode {
  name: string;
  type: string;
  tag: TagDef | null;
  children: Record<string, NestedTagNode> | null;
}

/** Client-side WebSocket connection statistics. */
export interface WsStats {
  connected: boolean;
  latencyMs: number | null;       // PING/PONG round-trip
  messagesPerSec: number;         // SNAPSHOT + DELTA messages received per second
  bytesPerSec: number;            // WebSocket bytes received per second
  subscribedCount: number;        // number of unique tags currently subscribed on server
}

/** Stable data portion of the context — identity only changes when tagMapLoaded flips. */
export interface HmiDataContextValue {
  tagMap: Map<number, TagDef>;
  tagPathIndex: TagPathIndex;
  getLiveValue: (tagId: number) => LiveValue;
  subscribeLiveValue: (tagId: number, callback: (lv: LiveValue) => void) => () => void;
  subscribeTrend: (
    tagId: number,
    callback: (moduleTs: number, value: number | boolean | string | null) => void,
  ) => () => void;
  writeTag: (tagId: number, value: number | boolean | string) => Promise<void>;
}

/** Shape of the context value shared between provider and hooks. */
export interface HmiContextValue extends HmiDataContextValue {
  wsStats: WsStats;
}
