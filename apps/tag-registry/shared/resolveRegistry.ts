import { MAX_TAG_PATH_LENGTH, DEFAULT_DATA_TYPE, TYPES_WITH_UNIT, type DataType } from './constants.js';
import type { Template, TemplateEntry, MetaLevel, ResolvedTag } from './types.js';
import { extractTemplate } from './types.js';

/**
 * Resolves the best value for a display field by walking the meta chain from root to leaf.
 *
 * Resolution rules:
 *   1. Lower level (closer to root) takes priority — first level with any match wins.
 *   2. More specific dotted key wins within the same level:
 *      "I.RSS.unit" (specificity 2) beats "I.unit" (specificity 1) beats "unit" (specificity 0).
 *
 * At each meta level i, `relPath = assetPath.slice(i)` represents the remaining path
 * segments from that node down to the tag. A dotted key "A.B.unit" matches when its
 * prefix segments ["A","B"] are a leading subsequence of relPath.
 */
function resolveDisplayField(
  fieldName: string,
  meta: MetaLevel[],
  assetPath: string[],
): unknown {
  for (let i = 0; i < meta.length; i++) {
    const level = meta[i];
    const relPath = assetPath.slice(i);

    let bestMatch: unknown = undefined;
    let bestSpecificity = -1;

    for (const [key, value] of Object.entries(level.fields)) {
      if (value === undefined || value === null) continue;

      // Case 1: direct field match (key === fieldName, specificity 0).
      if (key === fieldName) {
        if (0 > bestSpecificity) {
          bestMatch = value;
          bestSpecificity = 0;
        }
      }

      // Case 2: dotted field match — key ends with ".fieldName" and its prefix
      // is a leading subsequence of relPath (specificity = prefix segment count).
      if (key.endsWith('.' + fieldName)) {
        const prefix = key.slice(0, -(fieldName.length + 1));
        const prefixSegments = prefix.split('.');
        if (
          prefixSegments.length > 0 &&
          prefixSegments.length <= relPath.length &&
          prefixSegments.every((seg, j) => seg === relPath[j])
        ) {
          if (prefixSegments.length > bestSpecificity) {
            bestMatch = value;
            bestSpecificity = prefixSegments.length;
          }
        }
      }
    }

    if (bestSpecificity >= 0) {
      return bestMatch;
    }
  }

  return null;
}

type TemplateMapInput =
  | Map<string, Template | TemplateEntry>
  | Record<string, Template | TemplateEntry>
  | null
  | undefined;

export function resolveRegistry(
  templateMap: TemplateMapInput,
  rootName: string | null | undefined,
): ResolvedTag[] {
  if (!templateMap || !rootName) return [];

  let workingMap: Map<string, Template | TemplateEntry>;
  if (templateMap instanceof Map) {
    workingMap = templateMap;
  } else {
    workingMap = new Map(Object.entries(templateMap));
  }

  const templates = new Map<string, Template>();
  for (const [name, value] of workingMap.entries()) {
    if (value && typeof value === 'object') {
      templates.set(name, extractTemplate(value));
    }
  }

  const tags: ResolvedTag[] = [];

  function walkHierarchy(
    templateName: string,
    assetPath: string[],
    metaChain: MetaLevel[],
    instanceOverrides: Record<string, unknown>,
  ): void {
    const template = templates.get(templateName);
    if (!template) return;

    const templateFieldDefaults = Object.fromEntries(
      Object.entries(template.fields || {}).map(([k, def]) => [k, def.default]),
    );
    const resolvedFields: Record<string, unknown> = { ...templateFieldDefaults, ...instanceOverrides };

    if (template.template_type === 'tag') {
      const tag_path = rootName + '.' + assetPath.join('.');

      if (tag_path.length > MAX_TAG_PATH_LENGTH) {
        // path too long — skip silently (error surfaced by resolveRegistry callers via validateGraph)
        return;
      }

      const meta: MetaLevel[] = [
        ...metaChain,
        {
          type: template.template_type,
          name: assetPath[assetPath.length - 1] ?? rootName,
          fields: resolvedFields,
        },
      ];

      const trends = meta.some(level =>
        Object.entries(level.fields || {}).some(
          ([k, v]) => k.toLowerCase() === 'trends' && v === true,
        ),
      );

      const moduleLevel = metaChain.find(level => level.type === 'module');
      const moduleTypeRaw = moduleLevel?.fields?.Module_Type;

      const resolvedDataType = typeof resolvedFields.data_type === 'string' ? resolvedFields.data_type : DEFAULT_DATA_TYPE;
      const hasUnit = TYPES_WITH_UNIT.has(resolvedDataType as DataType);

      const rawUnit   = hasUnit ? resolveDisplayField('unit',    meta, assetPath) : null;
      const rawFormat = hasUnit ? resolveDisplayField('format',  meta, assetPath) : null;
      const rawMin    = hasUnit ? resolveDisplayField('eng_min', meta, assetPath) : null;
      const rawMax    = hasUnit ? resolveDisplayField('eng_max', meta, assetPath) : null;

      tags.push({
        tag_path,
        data_type: resolvedDataType,
        module: moduleLevel?.name ?? null,
        module_type: typeof moduleTypeRaw === 'string' ? moduleTypeRaw : null,
        is_setpoint: typeof resolvedFields.is_setpoint === 'boolean' ? resolvedFields.is_setpoint : false,
        trends,
        unit:    typeof rawUnit   === 'string' ? rawUnit   : null,
        format:  typeof rawFormat === 'string' ? rawFormat : null,
        eng_min: typeof rawMin    === 'number' ? rawMin    : null,
        eng_max: typeof rawMax    === 'number' ? rawMax    : null,
        meta,
      });

      return;
    }

    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (!child.template_name || !child.asset_name) continue;

        const metaEntry: MetaLevel = {
          type: template.template_type,
          name: assetPath[assetPath.length - 1] ?? rootName,
          fields: resolvedFields,
        };

        const childDirectFields = (child.fields as Record<string, unknown>) || {};

        walkHierarchy(
          child.template_name,
          [...assetPath, child.asset_name],
          [...metaChain, metaEntry],
          childDirectFields,
        );
      }
    }
  }

  walkHierarchy(rootName, [], [], {});
  return tags;
}
