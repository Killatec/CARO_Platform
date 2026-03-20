import { ERROR_CODES } from './constants.js';

/**
 * Validate the full template graph.
 *
 * @param {Map<string, Object>|Object} templateMap - Map or object of template_name -> template or { template, hash }
 * @returns {Object} { valid: boolean, errors: [], warnings: [] }
 */
export function validateGraph(templateMap) {
  const errors = [];
  const warnings = [];

  if (!templateMap) {
    return { valid: true, errors: [], warnings: [] };
  }

  // Convert to Map if it's an object
  let templates;
  if (templateMap instanceof Map) {
    templates = templateMap;
  } else {
    templates = new Map(Object.entries(templateMap));
  }

  // Extract template objects (handle both { template, hash } and direct template)
  const templateObjects = new Map();
  for (const [name, value] of templates.entries()) {
    if (value && typeof value === 'object') {
      // Check if it's a wrapper object with { template, hash }
      if (value.template) {
        templateObjects.set(name, value.template);
      } else {
        templateObjects.set(name, value);
      }
    }
  }

  // Check for duplicate template names (should be handled by Map, but check anyway)
  const allNames = Array.from(templateObjects.keys());
  const uniqueNames = new Set(allNames);
  if (allNames.length !== uniqueNames.size) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Duplicate template names detected in the graph'
    });
  }

  // Check for broken references
  for (const [templateName, template] of templateObjects.entries()) {
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name && !templateObjects.has(child.template_name)) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.INVALID_REFERENCE,
            message: `Template "${templateName}" references unknown template "${child.template_name}"`,
            ref: { template_name: templateName, child_template: child.template_name }
          });
        }
      }
    }
  }

  // Check for circular references
  const circularRefs = detectCircularReferences(templateObjects);
  for (const cycle of circularRefs) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.CIRCULAR_REFERENCE,
      message: `Circular reference detected: ${cycle.join(' -> ')}`,
      ref: { cycle }
    });
  }

  const valid = errors.length === 0 && warnings.length === 0;
  return { valid, errors, warnings };
}

/**
 * Detect circular references in the template graph using DFS.
 *
 * @param {Map<string, Object>} templateMap - Map of template_name -> template
 * @returns {Array<Array<string>>} Array of cycles (each cycle is an array of template names)
 */
function detectCircularReferences(templateMap) {
  const cycles = [];
  const visited = new Set();
  const recStack = new Set();
  const path = [];

  function dfs(templateName) {
    if (!templateMap.has(templateName)) {
      return;
    }

    if (recStack.has(templateName)) {
      // Found a cycle - extract it from the path
      const cycleStart = path.indexOf(templateName);
      const cycle = [...path.slice(cycleStart), templateName];
      cycles.push(cycle);
      return;
    }

    if (visited.has(templateName)) {
      return;
    }

    visited.add(templateName);
    recStack.add(templateName);
    path.push(templateName);

    const template = templateMap.get(templateName);
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

  // Start DFS from each template
  for (const templateName of templateMap.keys()) {
    if (!visited.has(templateName)) {
      dfs(templateName);
    }
  }

  return cycles;
}
