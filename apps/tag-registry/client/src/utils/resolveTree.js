/**
 * Resolve template hierarchy into a tree structure for rendering
 * Pure function - no side effects
 *
 * @param {Map} templateMap - Template map (Map of name -> { template, hash })
 * @param {string} rootName - Root template name
 * @returns {Object} Tree structure { template_name, asset_name, template, children }
 */
export function resolveTree(templateMap, rootName) {
  if (!templateMap || !rootName) {
    return null;
  }

  // Get root template entry
  const rootEntry = templateMap.get(rootName);
  if (!rootEntry || !rootEntry.template) {
    return null;
  }

  const rootTemplate = rootEntry.template;

  /**
   * Build tree node recursively
   */
  function buildNode(template_name, asset_name = null) {
    const entry = templateMap.get(template_name);
    if (!entry || !entry.template) {
      return null;
    }

    const template = entry.template;

    const node = {
      template_name,
      asset_name,
      template,
      children: []
    };

    // Recurse into children
    if (template.children && Array.isArray(template.children)) {
      for (const child of template.children) {
        if (child.template_name && child.asset_name) {
          const childNode = buildNode(child.template_name, child.asset_name);
          if (childNode) {
            node.children.push(childNode);
          }
        }
      }
    }

    return node;
  }

  return buildNode(rootName, null);
}
