import { getActiveTags } from '@caro/db';
import type { ActiveTag } from '@caro/db';
import type { TagDef, MetaLevel } from '@caro/hmi-context';

export interface TagMapResult {
  tagMap: Map<number, TagDef>;
  moduleTagIds: Map<string, number[]>;
  trendableTagIds: Set<number>;
}

function getModuleId(meta: MetaLevel[]): string {
  return meta.find(m => m.type === 'module')?.name ?? 'unknown';
}

/**
 * Walk meta from root (meta[0]) to leaf (meta[last]).
 * First level that contains the field wins. Returns null if not found.
 */
function getMetaField<T>(meta: MetaLevel[], key: string): T | null {
  for (const level of meta) {
    const val = level.fields[key];
    if (val !== undefined && val !== null) return val as T;
  }
  return null;
}

export async function loadTagMap(rows?: ActiveTag[]): Promise<TagMapResult> {
  if (!rows) rows = await getActiveTags();

  const tagMap = new Map<number, TagDef>();
  const moduleTagIds = new Map<string, number[]>();
  const trendableTagIds = new Set<number>();

  for (const row of rows) {
    const meta = (row.meta as MetaLevel[]) ?? [];
    const moduleId = getModuleId(meta);

    const tagDef: TagDef = {
      tag_id:      row.tag_id,
      tag_path:    row.tag_path,
      data_type:   row.data_type as TagDef['data_type'],
      is_setpoint: row.is_setpoint,
      module_id:   moduleId,
      module_type: row.module_type ?? 'MQTT',
      eng_min:     getMetaField<number>(meta, 'eng_min'),
      eng_max:     getMetaField<number>(meta, 'eng_max'),
      unit:        getMetaField<string>(meta, 'unit'),
      meta,
    };

    tagMap.set(row.tag_id, tagDef);

    if (!moduleTagIds.has(moduleId)) moduleTagIds.set(moduleId, []);
    moduleTagIds.get(moduleId)!.push(row.tag_id);

    if (row.trends ?? false) trendableTagIds.add(row.tag_id);
  }

  return { tagMap, moduleTagIds, trendableTagIds };
}
