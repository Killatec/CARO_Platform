import { ERROR_CODES } from './constants.js';
import type { Template, TemplateEntry, ValidationResult, ValidationMessage } from './types.js';
import { extractTemplate } from './types.js';

type TemplateMapInput =
  | Map<string, Template | TemplateEntry>
  | Record<string, Template | TemplateEntry>
  | null
  | undefined;

interface ValidateParentTypesOptions {
  requiredParentTypes?: string[];
  uniqueParentTypes?: boolean;
}

export function validateParentTypes(
  templateMap: TemplateMapInput,
  rootName: string | null | undefined,
  options: ValidateParentTypesOptions = {},
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  if (!templateMap || !rootName) {
    return { errors, warnings };
  }

  const { requiredParentTypes = [], uniqueParentTypes = false } = options;

  if (requiredParentTypes.length === 0 && !uniqueParentTypes) {
    return { errors, warnings };
  }

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

  const tagAncestorChains: Array<{ template_name: string; ancestorTypes: string[] }> = [];

  function walkHierarchy(templateName: string, ancestorChain: string[] = []): void {
    const template = templates.get(templateName);
    if (!template) return;

    const currentChain = [...ancestorChain, template.template_type];

    if (template.template_type === 'tag') {
      tagAncestorChains.push({ template_name: templateName, ancestorTypes: currentChain });
      return;
    }

    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name) {
          walkHierarchy(child.template_name, currentChain);
        }
      }
    }
  }

  walkHierarchy(rootName);

  for (const { template_name, ancestorTypes } of tagAncestorChains) {
    for (const requiredType of requiredParentTypes) {
      if (!ancestorTypes.includes(requiredType)) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.PARENT_TYPE_MISSING,
          message: `Tag "${template_name}" is missing required ancestor type "${requiredType}"`,
          ref: { template_name, required_type: requiredType },
        });
      }
    }

    if (uniqueParentTypes) {
      const typeCounts = new Map<string, number>();
      for (const type of ancestorTypes) {
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }

      for (const [type, count] of typeCounts.entries()) {
        if (count > 1) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.DUPLICATE_PARENT_TYPE,
            message: `Tag "${template_name}" has duplicate ancestor type "${type}" (${count} occurrences)`,
            ref: { template_name, duplicate_type: type },
          });
        }
      }
    }
  }

  return { errors, warnings };
}
