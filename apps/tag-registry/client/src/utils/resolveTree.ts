import type { Template, TemplateEntry } from '@caro/tag-registry-shared';

export interface TreeNodeData {
  template_name: string;
  asset_name: string | null;
  template: Template;
  children: TreeNodeData[];
}

/**
 * Resolve template hierarchy into a tree structure for rendering
 * Pure function - no side effects
 */
export function resolveTree(
  templateMap: Map<string, TemplateEntry>,
  rootName: string
): TreeNodeData | null {
  if (!templateMap || !rootName) {
    return null;
  }

  const rootEntry = templateMap.get(rootName);
  if (!rootEntry || !rootEntry.template) {
    return null;
  }

  function buildNode(template_name: string, asset_name: string | null = null): TreeNodeData | null {
    const entry = templateMap.get(template_name);
    if (!entry || !entry.template) {
      return null;
    }

    const template = entry.template;

    const node: TreeNodeData = {
      template_name,
      asset_name,
      template,
      children: []
    };

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
