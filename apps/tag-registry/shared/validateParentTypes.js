import { ERROR_CODES } from './constants.js';

/**
 * Validate parent type rules (VALIDATE_REQUIRED_PARENT_TYPES, VALIDATE_UNIQUE_PARENT_TYPES).
 *
 * @param {Map<string, Object>|Object} templateMap - Template map (Map or object of name -> { template, hash })
 * @param {string} rootName - Root template name
 * @param {Object} options - { requiredParentTypes: string[], uniqueParentTypes: boolean }
 * @returns {Object} { errors: [], warnings: [] }
 */
export function validateParentTypes(templateMap, rootName, options = {}) {
  const errors = [];
  const warnings = [];

  if (!templateMap || !rootName) {
    return { errors, warnings };
  }

  const { requiredParentTypes = [], uniqueParentTypes = false } = options;

  // Skip validation if no rules are configured
  if (requiredParentTypes.length === 0 && !uniqueParentTypes) {
    return { errors, warnings };
  }

  // Convert to Map for processing
  let workingMap;
  if (templateMap instanceof Map) {
    workingMap = templateMap;
  } else {
    workingMap = new Map(Object.entries(templateMap));
  }

  // Extract template objects
  const templates = new Map();
  for (const [name, value] of workingMap.entries()) {
    if (value && typeof value === 'object') {
      templates.set(name, value.template || value);
    }
  }

  // Walk hierarchy and collect all tags with their ancestor chains
  const tagAncestorChains = [];

  function walkHierarchy(templateName, ancestorChain = []) {
    const template = templates.get(templateName);
    if (!template) {
      return;
    }

    const currentChain = [...ancestorChain, template.template_type];

    // If this is a tag, record its ancestor chain
    if (template.template_type === 'tag') {
      tagAncestorChains.push({
        template_name: templateName,
        ancestorTypes: currentChain
      });
      return;
    }

    // Recurse into children
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name) {
          walkHierarchy(child.template_name, currentChain);
        }
      }
    }
  }

  walkHierarchy(rootName);

  // Validate each tag's ancestor chain
  for (const { template_name, ancestorTypes } of tagAncestorChains) {
    // Check required parent types
    for (const requiredType of requiredParentTypes) {
      if (!ancestorTypes.includes(requiredType)) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.PARENT_TYPE_MISSING,
          message: `Tag "${template_name}" is missing required ancestor type "${requiredType}"`,
          ref: { template_name, required_type: requiredType }
        });
      }
    }

    // Check unique parent types
    if (uniqueParentTypes) {
      const typeCounts = new Map();
      for (const type of ancestorTypes) {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }

      for (const [type, count] of typeCounts.entries()) {
        if (count > 1) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.DUPLICATE_PARENT_TYPE,
            message: `Tag "${template_name}" has duplicate ancestor type "${type}" (${count} occurrences)`,
            ref: { template_name, duplicate_type: type }
          });
        }
      }
    }
  }

  return { errors, warnings };
}
