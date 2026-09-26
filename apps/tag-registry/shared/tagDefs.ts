import { MQTT_MODULE_TYPE } from './constants.js';
import { hashTagDefs } from './hashTemplate.js';
import { resolveRegistry } from './resolveRegistry.js';
import type { Template, TemplateEntry } from './types.js';
import { extractTemplate } from './types.js';

/**
 * Template-level "Tag Defs" export — one file per MQTT module template.
 * Spec: RF_Control Docs/CARO_MIGRATION.md D32.
 *
 * Deliberately carries only tag_path, direction and data_type. tag_id, unit,
 * eng_min/eng_max, trendable, scale/offset, format and is_setpoint are excluded
 * by decision (see D32's table), not by omission — do not add them here.
 * Nothing in this file depends on any instance of the template.
 */

export type TagDirection = 'Set' | 'Mon';

export interface TagDefEntry {
  /** Path below the module level — the truncated form TAG_LIST carries (CARO_MQTT_Spec §7.4). */
  tag_path: string;
  direction: TagDirection;
  data_type: string;
}

export interface TagDefsFile {
  _generated: string;
  template_name: string;
  /** "sha256:<hex>" over the canonical JSON of `tags`. */
  content_hash: string;
  tags: TagDefEntry[];
}

export const TAG_DEFS_BANNER =
  'GENERATED FILE - DO NOT EDIT. Produced by the CARO Tag Registry "Generate Tag Defs" export ' +
  '(template-level, no instance data). Regenerate instead of editing. content_hash is SHA-256 of ' +
  'the canonical JSON of "tags" (keys sorted, no whitespace, entries sorted by tag_path).';

type TemplateMapInput =
  | Map<string, Template | TemplateEntry>
  | Record<string, Template | TemplateEntry>;

/** Code-unit order, not locale order — a C consumer must be able to reproduce it with strcmp. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Names of all module templates in the map whose own Module_Type default is
 * MQTT, sorted. HMI-type modules are excluded — their tags are produced
 * in-process by the HMI server and never cross MQTT.
 */
export function listMqttModuleTemplates(templateMap: TemplateMapInput): string[] {
  const entries = templateMap instanceof Map ? [...templateMap.values()] : Object.values(templateMap);
  return entries
    .map(extractTemplate)
    .filter(t => t.template_type === 'module' && t.fields?.Module_Type?.default === MQTT_MODULE_TYPE)
    .map(t => t.template_name)
    .sort(compareCodeUnits);
}

/**
 * Resolves a module template on its own (as if it were the root) and returns
 * its tags with paths relative to the module, sorted by tag_path.
 */
export function buildTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): TagDefEntry[] {
  const prefixLength = moduleTemplateName.length + 1;
  return resolveRegistry(templateMap, moduleTemplateName)
    .map((tag): TagDefEntry => ({
      tag_path: tag.tag_path.slice(prefixLength),
      direction: tag.is_setpoint ? 'Set' : 'Mon',
      data_type: tag.data_type,
    }))
    .sort((a, b) => compareCodeUnits(a.tag_path, b.tag_path));
}

export function buildTagDefsFile(templateMap: TemplateMapInput, moduleTemplateName: string): TagDefsFile {
  const tags = buildTagDefs(templateMap, moduleTemplateName);
  return {
    _generated: TAG_DEFS_BANNER,
    template_name: moduleTemplateName,
    content_hash: `sha256:${hashTagDefs(tags)}`,
    tags,
  };
}
