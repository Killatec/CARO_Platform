import { ERROR_CODES } from './constants.js';
import type { Template, TemplateEntry, ValidationResult, ValidationMessage } from './types.js';
import { extractTemplate } from './types.js';

type TemplateMapInput = Map<string, Template | TemplateEntry> | Record<string, Template | TemplateEntry> | null | undefined;

export function validateGraph(templateMap: TemplateMapInput): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  if (!templateMap) {
    return { valid: true, errors: [], warnings: [] };
  }

  let templates: Map<string, Template | TemplateEntry>;
  if (templateMap instanceof Map) {
    templates = templateMap;
  } else {
    templates = new Map(Object.entries(templateMap));
  }

  const templateObjects = new Map<string, Template>();
  for (const [name, value] of templates.entries()) {
    if (value && typeof value === 'object') {
      templateObjects.set(name, extractTemplate(value));
    }
  }

  const allNames = Array.from(templateObjects.keys());
  const uniqueNames = new Set(allNames);
  if (allNames.length !== uniqueNames.size) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Duplicate template names detected in the graph',
    });
  }

  for (const [templateName, template] of templateObjects.entries()) {
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name && !templateObjects.has(child.template_name)) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.INVALID_REFERENCE,
            message: `Template "${templateName}" references unknown template "${child.template_name}"`,
            ref: { template_name: templateName, child_template: child.template_name },
          });
        }
      }
    }
  }

  const circularRefs = detectCircularReferences(templateObjects);
  for (const cycle of circularRefs) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.CIRCULAR_REFERENCE,
      message: `Circular reference detected: ${cycle.join(' -> ')}`,
      ref: { cycle: cycle as unknown as string },
    });
  }

  const valid = errors.length === 0 && warnings.length === 0;
  return { valid, errors, warnings };
}

function detectCircularReferences(templateMap: Map<string, Template>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(templateName: string): void {
    if (!templateMap.has(templateName)) return;

    if (recStack.has(templateName)) {
      const cycleStart = path.indexOf(templateName);
      const cycle = [...path.slice(cycleStart), templateName];
      cycles.push(cycle);
      return;
    }

    if (visited.has(templateName)) return;

    visited.add(templateName);
    recStack.add(templateName);
    path.push(templateName);

    const template = templateMap.get(templateName)!;
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name) {
          dfs(child.template_name);
        }
      }
    }

    recStack.delete(templateName);
    path.pop();
  }

  for (const templateName of templateMap.keys()) {
    if (!visited.has(templateName)) {
      dfs(templateName);
    }
  }

  return cycles;
}
