import { apiClient } from '@caro/ui';

/** Mirrors HandshakeDetails in server/src/handshake-controller.ts (GET /api/v1/handshake/:moduleId). */
export interface HandshakeDetails {
  module_id: string;
  status:    number;
  request: {
    ts_ms: number;
    ts_utc_ms: unknown;
    instance_id: unknown;
    ip: unknown;
    fw_hash: unknown;
    tag_registry_template: unknown;
    tag_registry_rev: unknown;
  } | null;
  tag_list: { ts_ms: number; tags: number; bytes: number } | null;
  confirm:  { ts_ms: number; missing_ids: string[]; unknown_tags: string[]; truncated: boolean } | null;
  push: {
    ts_ms: number;
    outcome: 'acked' | 'timeout' | 'no_sets' | 'store_error';
    sets: number;
    unpopulated: number;
    rejected: { tag_id: number; rejection_code: string | null }[];
    consecutive_timeouts: number;
  } | null;
}

export function getHandshakeDetails(moduleId: string): Promise<HandshakeDetails> {
  return apiClient.get<HandshakeDetails>(`/handshake/${encodeURIComponent(moduleId)}`);
}
