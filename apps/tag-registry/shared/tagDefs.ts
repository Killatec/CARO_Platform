import { MQTT_MODULE_TYPE, IN_TAG_NAME_FIELD, ERROR_CODES } from './constants.js';
import { resolveRegistry } from './resolveRegistry.js';
import type { MetaLevel, Template, TemplateEntry, ValidationMessage } from './types.js';
import { extractTemplate } from './types.js';

/**
 * Template-level "Tag Defs" export — one file per MQTT module template.
 * Spec: RF_Control Docs/CARO_MIGRATION.md D32; tag_registry_spec.md §12.1.
 *
 * `tags` is a tree nested by tag_name segment: `Comb.Fwd.Gain` becomes
 * tags.Comb.Fwd.Gain = { data_type }. A node is a leaf iff it has a
 * `data_type` key. The consumer generates a C++ struct from it for
 * compile-time, name-addressed tag access.
 *
 * Each leaf carries only data_type. tag_id, direction/is_setpoint, unit,
 * eng_min/eng_max, trendable, scale/offset and format are excluded by
 * decision (see D32), not by omission — do not add them here.
 * Nothing in this file depends on any instance of the template.
 */

/** The key that marks a tree node as a leaf. Reserved — no tag_name segment may use it. */
export const TAG_DEF_LEAF_KEY = 'data_type';

/**
 * The key that names the template a group node is exactly one instance of
 * (CARO_MQTT_Interface P70). Reserved — no tag_name segment may use it. The
 * consumer's generator emits one C type, caro_tpl_<name>_t, per template.
 */
export const TAG_DEF_TEMPLATE_KEY = '_template';

const RESERVED_SEGMENTS = [TAG_DEF_LEAF_KEY, TAG_DEF_TEMPLATE_KEY];

const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface TagDefLeaf {
  data_type: string;
}

/** Child nodes by segment, plus an optional `_template` string (TAG_DEF_TEMPLATE_KEY). */
export interface TagDefGroup {
  [segment: string]: TagDefNode | string;
}

export type TagDefNode = TagDefLeaf | TagDefGroup;

export interface TagDefsFile {
  _generated: string;
  template_name: string;
  /** Registry revision the export was taken at — the saved templates equal what that revision applied. */
  tag_registry_rev: number;
  tags: TagDefGroup;
}

export const TAG_DEFS_BANNER =
  'GENERATED FILE - DO NOT EDIT. Produced by the CARO Tag Registry "Generate Tag Defs" export ' +
  '(template-level, no instance data). Regenerate instead of editing. "tags" is nested by ' +
  'tag_name segment; a node with a "data_type" key is a leaf. A group node with a "_template" key is ' +
  'exactly one instance of that registry template, and every node marked with one template has the ' +
  'same members. tag_registry_rev is the Tag Registry ' +
  'revision the export was taken at: the saved templates matched what that revision applied.';

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
 * Module-relative tag_name: the dot-joined asset_names of the meta levels
 * *below* the (first) module level whose In_Tag_Name is true. The module level
 * itself is never included, whatever its In_Tag_Name — whether an instance
 * shows its own name (e.g. "RF1") is an instance decision.
 *
 * The single rule for both consumers, which must agree by exact string match
 * (tag_registry_spec §12.1, CARO_MQTT_Spec §7.4):
 * - the Generate Tag Defs export, whose meta starts at the module template
 *   (meta[0] is the module);
 * - the HMI's handshake TAG_LIST, whose registry meta has levels above the
 *   module (e.g. the system root).
 *
 * Returns null when meta has no module level.
 */
export function moduleRelativeTagName(meta: MetaLevel[]): string | null {
  const moduleIndex = meta.findIndex(level => level.type === 'module');
  if (moduleIndex === -1) return null;
  return meta
    .slice(moduleIndex + 1)
    .filter(level => level.fields?.[IN_TAG_NAME_FIELD] === true)
    .map(level => level.name)
    .join('.');
}

interface ResolvedTagDef {
  /** Module-relative tag_name: dot-joined asset_names of levels below the module with In_Tag_Name true. */
  tagName: string;
  dataType: string;
  /** Full asset path from the module root — for error messages only, never exported. */
  sourcePath: string;
  /** Every container instance the tag sits inside, below the module, by asset path relative to the module. */
  instancePaths: string[];
  /** The instances among those whose own level has In_Tag_Name true, i.e. that own a tree node. */
  namedInstances: { nodePath: string; instancePath: string; templateName: string }[];
}

/**
 * Resolves a module template on its own (as if it were the root), so meta[0]
 * is the module level. The exported tag_name is the module-relative tag_name
 * (moduleRelativeTagName); this export has no instance dependency.
 */
function resolveTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): ResolvedTagDef[] {
  return resolveRegistry(templateMap, moduleTemplateName, { withTemplateNames: true })
    .map(tag => {
      // meta[0] is the module and the last level is the tag; the levels between
      // are container instances. meta[i].name is asset path segment i.
      const instancePaths: string[] = [];
      const namedInstances: ResolvedTagDef['namedInstances'] = [];
      const nameSegments: string[] = [];
      for (let i = 1; i < tag.meta.length - 1; i++) {
        const level = tag.meta[i];
        const instancePath = tag.meta.slice(1, i + 1).map(l => l.name).join('.');
        instancePaths.push(instancePath);
        if (level.fields?.[IN_TAG_NAME_FIELD] === true) {
          nameSegments.push(level.name);
          namedInstances.push({ nodePath: nameSegments.join('.'), instancePath, templateName: level.template_name ?? '' });
        }
      }
      return {
        tagName: moduleRelativeTagName(tag.meta) ?? '',
        dataType: tag.data_type,
        sourcePath: tag.tag_path,
        instancePaths,
        namedInstances,
      };
    })
    .sort((a, b) => compareCodeUnits(a.tagName, b.tagName));
}

/**
 * Tree node path -> template name, for every group node that is exactly one
 * template instance: the instance's own level has In_Tag_Name true (otherwise
 * it has no node — its children merged into the parent), it is the only
 * instance mapped to that node, and every leaf under the node comes from
 * inside it (descendants flattened in by In_Tag_Name false levels count).
 * A node that mixes in content from elsewhere is not marked.
 */
function findTemplateNodes(resolved: ResolvedTagDef[]): Map<string, string> {
  const owners = new Map<string, Map<string, string>>(); // nodePath -> instancePath -> template
  for (const r of resolved) {
    for (const n of r.namedInstances) {
      const m = owners.get(n.nodePath) ?? new Map<string, string>();
      m.set(n.instancePath, n.templateName);
      owners.set(n.nodePath, m);
    }
  }
  const marks = new Map<string, string>();
  for (const [nodePath, instances] of owners) {
    if (instances.size !== 1) continue;
    const [[instancePath, templateName]] = [...instances];
    const under = resolved.filter(r => r.tagName.startsWith(`${nodePath}.`));
    if (under.length > 0 && under.every(r => r.instancePaths.includes(instancePath))) {
      marks.set(nodePath, templateName);
    }
  }
  return marks;
}

/**
 * Module-relative tag defs as a tree nested by tag_name segment. Keys are
 * inserted in code-unit order so the written file reads in canonical order
 * (except integer-like keys, which JS objects always enumerate first — the
 * hash sorts explicitly, so this affects file layout only).
 *
 * Throws if a name is both a leaf and an ancestor of another name, or uses
 * the reserved leaf key as a segment — validateTagDefs reports both first.
 */
export function buildTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): TagDefGroup {
  return buildTree(resolveTagDefs(templateMap, moduleTemplateName), moduleTemplateName);
}

function buildTree(resolved: ResolvedTagDef[], moduleTemplateName: string): TagDefGroup {
  const marks = findTemplateNodes(resolved);
  // Prototype-less nodes: asset_names only forbid dots, so a segment such as
  // "__proto__" or "constructor" must land as an ordinary own key.
  // A marked node gets `_template` as its first key, when it is created.
  const newGroup = (nodePath: string): TagDefGroup => {
    const g = Object.create(null) as TagDefGroup;
    const templateName = marks.get(nodePath);
    if (templateName !== undefined) g[TAG_DEF_TEMPLATE_KEY] = templateName;
    return g;
  };
  const root = Object.create(null) as TagDefGroup;
  for (const { tagName, dataType } of resolved) {
    const segments = tagName.split('.');
    const leafName = segments.pop()!;
    let group = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const next = (group[segment] ??= newGroup(segments.slice(0, i + 1).join('.')));
      if (typeof next === 'string' || TAG_DEF_LEAF_KEY in next) {
        throw new Error(`Tag Defs "${moduleTemplateName}": "${tagName}" is below leaf "${segment}"`);
      }
      group = next as TagDefGroup;
    }
    if (
      leafName in group ||
      segments.some(seg => RESERVED_SEGMENTS.includes(seg)) ||
      RESERVED_SEGMENTS.includes(leafName)
    ) {
      throw new Error(`Tag Defs "${moduleTemplateName}": "${tagName}" cannot be placed as a leaf`);
    }
    group[leafName] = { data_type: dataType };
  }
  return root;
}

/**
 * Module-relative names must be usable as identifiers on their own and fit the
 * nested shape:
 * - non-empty (TAG_NAME_EMPTY);
 * - unique, case-insensitive, matching the registry's DUPLICATE_TAG_NAME rule
 *   (DUPLICATE_TAG_NAME). A system-level validation can pass while this fails,
 *   because the module instance's own name (e.g. "RF1.") may disambiguate there;
 * - no name is a strict prefix of another, e.g. `Comb.Fwd` beside
 *   `Comb.Fwd.Gain` — the node would have to be leaf and group at once
 *   (TAG_NAME_LEAF_AND_GROUP). Case-insensitive, like the duplicate rule;
 * - no segment equals the leaf key `data_type` or the template key `_template`,
 *   which would make a node ambiguous (TAG_NAME_RESERVED_SEGMENT);
 * - every template name a node is marked with is a C identifier
 *   (TEMPLATE_NAME_INVALID) — the consumer's generator rejects anything else.
 *
 * No shape check is needed for `_template`: instance overrides only touch the
 * instance's own level, and a node mixing in outside content is never marked,
 * so every node marked with one template has the same members by construction.
 */
export function validateTagDefs(templateMap: TemplateMapInput, moduleTemplateName: string): ValidationMessage[] {
  const resolved = resolveTagDefs(templateMap, moduleTemplateName);
  const errors: ValidationMessage[] = [];
  const ref = (r: ResolvedTagDef) => ({ template_name: moduleTemplateName, tag_path: r.sourcePath });

  for (const r of resolved) {
    if (r.tagName === '') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.TAG_NAME_EMPTY,
        message: `"${r.sourcePath}": no level below module "${moduleTemplateName}" has ${IN_TAG_NAME_FIELD} set to true`,
        ref: ref(r),
      });
    } else {
      const reserved = r.tagName.split('.').find(seg => RESERVED_SEGMENTS.includes(seg));
      if (reserved !== undefined) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.TAG_NAME_RESERVED_SEGMENT,
          message: `tag_name "${r.tagName}" in "${moduleTemplateName}" uses the reserved segment "${reserved}" — resolved by: ${r.sourcePath}`,
          ref: ref(r),
        });
      }
    }
  }

  const named = resolved.filter(r => r.tagName !== '');
  const groups = new Map<string, ResolvedTagDef[]>();
  for (const r of named) {
    const key = r.tagName.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sources = group.map(r => r.sourcePath).join(', ');
    for (const r of group) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.DUPLICATE_TAG_NAME,
        message: `module-relative tag_name "${r.tagName}" in "${moduleTemplateName}" is not unique — resolved by: ${sources}`,
        ref: ref(r),
      });
    }
  }

  // One error per leaf that is also an ancestor, listing the names below it.
  for (const [key, leaves] of groups) {
    const below = named.filter(r => r.tagName.toLowerCase().startsWith(`${key}.`));
    if (below.length === 0) continue;
    const shown = below.slice(0, 3).map(r => r.tagName).join(', ');
    const names = below.length > 3 ? `${shown} and ${below.length - 3} more` : shown;
    for (const r of leaves) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.TAG_NAME_LEAF_AND_GROUP,
        message: `tag_name "${r.tagName}" in "${moduleTemplateName}" is a tag and also the parent of ${names} — the nested export cannot express a node that is both`,
        ref: ref(r),
      });
    }
  }

  // One error per template name that would mark a node but is not a C identifier.
  const byTemplate = new Map<string, string[]>();
  for (const [nodePath, templateName] of findTemplateNodes(resolved)) {
    byTemplate.set(templateName, [...(byTemplate.get(templateName) ?? []), nodePath]);
  }
  for (const [templateName, nodePaths] of byTemplate) {
    if (C_IDENTIFIER.test(templateName)) continue;
    errors.push({
      severity: 'error',
      code: ERROR_CODES.TEMPLATE_NAME_INVALID,
      message: `template "${templateName}" (marking ${nodePaths.join(', ')} in "${moduleTemplateName}") is not a C identifier — the Tag Defs consumer names its type caro_tpl_<template>_t`,
      ref: { template_name: moduleTemplateName, child_template: templateName },
    });
  }

  return errors;
}

/** tagRegistryRev: the registry revision the saved templates match (checked by the caller). */
export function buildTagDefsFile(
  templateMap: TemplateMapInput,
  moduleTemplateName: string,
  tagRegistryRev: number,
): TagDefsFile {
  return {
    _generated: TAG_DEFS_BANNER,
    template_name: moduleTemplateName,
    tag_registry_rev: tagRegistryRev,
    tags: buildTagDefs(templateMap, moduleTemplateName),
  };
}
