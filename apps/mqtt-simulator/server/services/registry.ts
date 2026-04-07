// registry.ts — loads active tags from PostgreSQL at simulator startup.
// Spec: CARO_MQTT_Simulator_Bootstrap v1.13 §6
//
// The active-tag query lives in @caro/db/registry.getActiveTags().
// This module only adds the simulator-specific transformation:
// extracting module_id from the meta ancestry array.

import { getActiveTags } from '@caro/db';

export interface SimTag {
  tag_id: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  module_id: string;
}

interface MetaLevel {
  type: string;
  name: string;
}

// meta is stored root→leaf in the DB (spec says leaf→root but implementation differs).
// find() is order-agnostic.
function getModuleId(meta: unknown): string {
  const levels = meta as MetaLevel[];
  const moduleAncestor = levels.find(m => m.type === 'module');
  return moduleAncestor?.name ?? 'unknown';
}

/**
 * Returns active tags shaped for the simulator: flat array with module_id derived from meta.
 */
export async function loadTagRegistry(): Promise<SimTag[]> {
  const rows = await getActiveTags();

  if (rows.length === 0) {
    throw new Error('tag_registry returned no active tags — apply a registry revision first.');
  }

  return rows.map(row => ({
    tag_id:      row.tag_id,
    tag_path:    row.tag_path,
    data_type:   row.data_type,
    is_setpoint: row.is_setpoint,
    module_id:   getModuleId(row.meta),
  }));
}
