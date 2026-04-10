/** Tag definition from the backend in-memory tag map. */
export interface TagDef {
  tag_id: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  module_id: string;
  eng_min: number | null;
  eng_max: number | null;
  unit: string | null;
  meta: MetaLevel[];
}

/** Single level in the tag provenance chain (meta[0] = root, meta[last] = tag leaf). */
export interface MetaLevel {
  type: string;
  name: string;
  fields: Record<string, unknown>;
}

/** Live value pushed via WebSocket. null value = bad quality (device offline / telemetry lost). */
export interface LiveValue {
  value: number | boolean | string | null;
}

/** Node in the subtree returned by useTagSubtree. */
export interface NestedTagNode {
  name: string;
  type: string;
  tag: TagDef | null;
  children: Record<string, NestedTagNode> | null;
}

/** Shape of the context value shared between provider and hooks. */
export interface HmiContextValue {
  tagMap: Map<number, TagDef>;
  getLiveValue: (tagId: number) => LiveValue;
  subscribeLiveValue: (tagId: number, callback: (lv: LiveValue) => void) => () => void;
  writeTag: (tagId: number, value: number | boolean | string) => Promise<void>;
}
