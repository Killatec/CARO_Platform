import { MAX_TAG_PATH_LENGTH, ERROR_CODES, DEFAULT_DATA_TYPE } from './constants.js';
import type { Template, TemplateEntry, MetaLevel, ResolvedTag } from './types.js';
import { extractTemplate } from './types.js';

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

      tags.push({
        tag_path,
        data_type: typeof resolvedFields.data_type === 'string' ? resolvedFields.data_type : DEFAULT_DATA_TYPE,
        module: moduleLevel?.name ?? null,
        module_type: typeof moduleTypeRaw === 'string' ? moduleTypeRaw : null,
        is_setpoint: typeof resolvedFields.is_setpoint === 'boolean' ? resolvedFields.is_setpoint : false,
        trends,
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

        walkHierarchy(
          child.template_name,
          [...assetPath, child.asset_name],
          [...metaChain, metaEntry],
          (child.fields as Record<string, unknown>) || {},
        );
      }
    }
  }

  walkHierarchy(rootName, [], [], {});
  return tags;
}
