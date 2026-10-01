import { MQTT_MODULE_TYPE, IN_TAG_NAME_FIELD, ERROR_CODES } from './constants.js';
import { hashTagDefs } from './hashTemplate.js';
import { resolveRegistry } from './resolveRegistry.js';
import type { Template, TemplateEntry, ValidationMessage } from './types.js';
import { extractTemplate } from './types.js';

/**
 * Template-level "Tag Defs" export — one file per MQTT module template.
 * Spec: RF_Control Docs/CARO_MIGRATION.md D32.
 *
 * Deliberately carries only tag_name, direction and data_type. tag_id, unit,
 * eng_min/eng_max, trendable, scale/offset, format and is_setpoint are excluded
 * by decision (see D32's table), not by omission — do not add them here.
 * Nothing in this file depends on any instance of the template.
 */

export type TagDirection = 'Set' | 'Mon';

export interface TagDefEntry {
  /** Module-relative tag_name: dot-joined asset_names of levels below the module with In_Tag_Name true. */
  tag_name: string;
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
  'the canonical JSON of "tags" (keys sorted, no whitespace, entries sorted by tag_name).';

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

interface ResolvedTagDef {
  entry: TagDefEntry;
  /** Full asset path from the module root — for error messages only, never exported. */
  sourcePath: string;
}

/**
 * Resolves a module template on its own (as if it were the root). The exported
 * tag_name is the module-relative tag_name: asset_names of levels *below* the
 * module whose In_Tag_Name is true. The module level itself (meta[0]) is always
 * skipped — whether an instance carries its name (e.g. "RF1") is an instance
 * decision, and this export has no instance dependency.
 */
function resolveTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): ResolvedTagDef[] {
  return resolveRegistry(templateMap, moduleTemplateName)
    .map(tag => ({
      entry: {
        tag_name: tag.meta
          .slice(1)
          .filter(level => level.fields?.[IN_TAG_NAME_FIELD] === true)
          .map(level => level.name)
          .join('.'),
        direction: tag.is_setpoint ? 'Set' : 'Mon',
        data_type: tag.data_type,
      } satisfies TagDefEntry,
      sourcePath: tag.tag_path,
    }))
    .sort((a, b) => compareCodeUnits(a.entry.tag_name, b.entry.tag_name));
}

/** Module-relative tag defs, sorted by tag_name in code-unit order. */
export function buildTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): TagDefEntry[] {
  return resolveTagDefs(templateMap, moduleTemplateName).map(r => r.entry);
}

/**
 * Module-relative names must be usable as identifiers on their own: non-empty
 * and unique (case-insensitive, matching the registry's DUPLICATE_TAG_NAME
 * rule). A system-level validation can pass while these fail, because the
 * module instance's own name (e.g. "RF1.") may be what disambiguates there.
 */
export function validateTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): ValidationMessage[] {
  const resolved = resolveTagDefs(templateMap, moduleTemplateName);
  const errors: ValidationMessage[] = [];

  for (const r of resolved) {
    if (r.entry.tag_name === '') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.TAG_NAME_EMPTY,
        message: `"${r.sourcePath}": no level below module "${moduleTemplateName}" has ${IN_TAG_NAME_FIELD} set to true`,
        ref: { template_name: moduleTemplateName, tag_path: r.sourcePath },
      });
    }
  }

  const groups = new Map<string, ResolvedTagDef[]>();
  for (const r of resolved) {
    if (r.entry.tag_name === '') continue;
    const key = r.entry.tag_name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sources = group.map(r => r.sourcePath).join(', ');
    for (const r of group) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.DUPLICATE_TAG_NAME,
        message: `module-relative tag_name "${r.entry.tag_name}" in "${moduleTemplateName}" is not unique — resolved by: ${sources}`,
        ref: { template_name: moduleTemplateName, tag_path: r.sourcePath },
      });
    }
  }

  return errors;
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
