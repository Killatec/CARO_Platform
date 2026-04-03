import { MAX_TAG_PATH_LENGTH, ERROR_CODES } from './constants.js';

/**
 * Resolve a template hierarchy into a flat tag registry.
 * Pure function - client-side in Phase 1, server-side in Phase 2.
 *
 * @param {Map<string, Object>|Object} templateMap - Template map (Map or object of name -> { template, hash })
 * @param {string} rootName - Root template name
 * @returns {Array<Object>} Array of { tag_path, data_type, is_setpoint, meta }
 */
export function resolveRegistry(templateMap, rootName) {
  if (!templateMap || !rootName) {
    return [];
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

  const tags = [];
  const errors = [];

  /**
   * Walk hierarchy recursively
   * @param {string} templateName - Current template name
   * @param {Array<string>} assetPath - Array of asset_names from root to current position
   * @param {Array<Object>} metaChain - Array of { type, name, fields } from root to current position
   * @param {Object} instanceOverrides - Field overrides set by the parent's children entry for this instance
   */
  function walkHierarchy(templateName, assetPath = [], metaChain = [], instanceOverrides = {}) {
    const template = templates.get(templateName);
    if (!template) {
      return;
    }

    // Extract default values from field definitions, then apply instance overrides
    const templateFieldDefaults = Object.fromEntries(
      Object.entries(template.fields || {}).map(([k, def]) => [k, def.default])
    );
    const resolvedFields = { ...templateFieldDefaults, ...instanceOverrides };

    // If this is a tag, create the tag entry
    if (template.template_type === 'tag') {
      // Build tag_path: rootName + "." + asset path joined by dots
      const tag_path = rootName + '.' + assetPath.join('.');

      // Check tag_path length
      if (tag_path.length > MAX_TAG_PATH_LENGTH) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.TAG_PATH_TOO_LONG,
          message: `Tag path "${tag_path}" exceeds maximum length of ${MAX_TAG_PATH_LENGTH} characters`,
          tag_path
        });
        return;
      }

      // Build meta array (root-to-tag)
      const meta = [
        ...metaChain,
        {
          type: template.template_type,
          name: assetPath[assetPath.length - 1] || rootName,
          fields: resolvedFields
        }
      ];

      // Derive trends: true if any meta level has a field keyed "trends" (case-insensitive) with value true
      const trends = meta.some(level =>
        Object.entries(level.fields || {}).some(
          ([k, v]) => k.toLowerCase() === 'trends' && v === true
        )
      );

      tags.push({
        tag_path,
        data_type: template.data_type,
        is_setpoint: template.is_setpoint,
        trends,
        meta
      });

      return;
    }

    // Not a tag - recurse into children
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (!child.template_name || !child.asset_name) {
          continue;
        }

        // Build meta entry for this level using resolved fields
        const metaEntry = {
          type: template.template_type,
          name: assetPath[assetPath.length - 1] || rootName,
          fields: resolvedFields
        };

        // Recurse, passing child's instance overrides so they are merged at the next level
        walkHierarchy(
          child.template_name,
          [...assetPath, child.asset_name],
          [...metaChain, metaEntry],
          child.fields || {}
        );
      }
    }
  }

  // Start walking from root
  walkHierarchy(rootName, [], []);


  return tags;
}
