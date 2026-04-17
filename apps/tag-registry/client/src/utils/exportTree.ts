import type { TemplateEntry } from '@caro/tag-registry-shared';

export interface ExportNode {
  asset_name: string | null;
  template_type: string;
  children: ExportNode[];
}

/**
 * Build a slim JSON-serializable representation of the system tree.
 * Only asset_name, template_type, and children are included at every level.
 * Pure function — no side effects.
 */
export function exportTree(
  templateMap: Map<string, TemplateEntry>,
  rootTemplateName: string
): ExportNode | null {
  if (!templateMap || !rootTemplateName) {
    return null;
  }

  const rootEntry = templateMap.get(rootTemplateName);
  if (!rootEntry || !rootEntry.template) {
    return null;
  }

  function buildNode(template_name: string, asset_name: string | null): ExportNode | null {
    const entry = templateMap.get(template_name);
    if (!entry || !entry.template) {
      return null;
    }

    const template = entry.template;

    const node: ExportNode = {
      asset_name,
      template_type: template.template_type,
      children: [],
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

  return buildNode(rootTemplateName, rootTemplateName);
}
