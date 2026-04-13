// registry.ts — loads active tags from PostgreSQL at simulator startup.
// Spec: CARO_MQTT_Simulator_Bootstrap v1.13 §6
//
// The active-tag query lives in @caro/db/registry.getActiveTags().
// This module filters to MQTT module_type and maps module_id from row.module.

import { getActiveTags } from '@caro/db';

export interface SimTag {
  tag_id: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  module_id: string;
}

/**
 * Returns active MQTT tags shaped for the simulator: flat array with module_id from row.module.
 */
export async function loadTagRegistry(): Promise<SimTag[]> {
  const rows = await getActiveTags();

  const mqttRows = rows.filter(row => row.module_type === 'MQTT');

  if (mqttRows.length === 0) {
    throw new Error('tag_registry returned no active MQTT tags — apply a registry revision first.');
  }

  return mqttRows.map(row => ({
    tag_id:      row.tag_id,
    tag_path:    row.tag_path,
    data_type:   row.data_type,
    is_setpoint: row.is_setpoint,
    module_id:   row.module ?? 'unknown',
  }));
}
