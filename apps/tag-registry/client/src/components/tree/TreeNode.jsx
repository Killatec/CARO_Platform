import React, { useMemo, useState } from 'react';
import { Badge } from '@caro/ui/primitives';
import { loadRoot } from '../../api/templates.js';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual } from '../../../../shared/utils.js';

/**
 * TreeNode - single node in asset tree
 * Renders a single node with collapsible children.
 * Non-tag nodes are valid drop targets for template leaves dragged from TemplatesTree.
 */
export function TreeNode({ node, ownPath, parentPath = null, parentTemplateName = null, childIndex = null, expandedNodes = {}, onToggleExpand }) {
  const [isDragOver, setIsDragOver] = useState(false);

  // undefined = not yet toggled = expanded (default); false = explicitly collapsed
  const isExpanded = expandedNodes[ownPath] !== false;

  const selectedSystemTreeNode    = useUIStore(state => state.selectedSystemTreeNode);
  const setSelectedSystemTreeNode = useUIStore(state => state.setSelectedSystemTreeNode);

  const templateMap         = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap = useTemplateGraphStore(state => state.originalTemplateMap);
  const injectTemplateGraph = useTemplateGraphStore(state => state.injectTemplateGraph);
  const updateTemplate      = useTemplateGraphStore(state => state.updateTemplate);

  if (!node) return null;

  const { template_name, asset_name, template, children = [] } = node;
  const displayName = asset_name || template_name;
  const isSelected = selectedSystemTreeNode === ownPath;
  const hasChildren = children.length > 0;
  const isValidDropTarget = template.template_type !== 'tag';

  const isDirty = useMemo(() => {
    if (!parentTemplateName || childIndex === null) return false;
    const originalParent = originalTemplateMap.get(parentTemplateName)?.template;
    const currentParent  = templateMap.get(parentTemplateName)?.template;
    const originalChild  = originalParent?.children?.[childIndex];
    const currentChild   = currentParent?.children?.[childIndex];
    if (!originalChild) return true; // new child
    return deepNotEqual(originalChild, currentChild);
  }, [parentTemplateName, childIndex, originalTemplateMap, templateMap]);

  const handleRemoveChild = (e) => {
    e.stopPropagation();
    const parent = templateMap.get(parentTemplateName)?.template;
    if (!parent) return;
    const updatedChildren = parent.children.filter((_, i) => i !== childIndex);
    updateTemplate(parentTemplateName, { children: updatedChildren });
    if (selectedSystemTreeNode === ownPath) {
      setSelectedSystemTreeNode(null);
    }
  };

  const handleDrop = async (droppedTemplateName) => {
    // Ensure the dropped template and its subgraph are in the store before
    // adding it as a child — prevents INVALID_REFERENCE validation errors
    // and ensures the System Tree can render the new child immediately.
    if (!templateMap.has(droppedTemplateName)) {
      try {
        const data = await loadRoot(droppedTemplateName);
        injectTemplateGraph(data.templates);
      } catch {
        // Cannot safely add a reference to a template we cannot resolve.
        return;
      }
    }

    // Re-read from store after the await — the React closure templateMap
    // may be stale after injectTemplateGraph updated the store.
    const parent = useTemplateGraphStore.getState().templateMap.get(template_name)?.template;
    if (!parent) return;

    const newChild = {
      template_name: droppedTemplateName,
      asset_name: droppedTemplateName,
      fields: {},
    };

    updateTemplate(template_name, { children: [...(parent.children ?? []), newChild] });
  };

  return (
    <div className="select-none" data-tree-node>
      {/* Node row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 whitespace-nowrap ${
          isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
        } ${
          isDragOver ? 'bg-blue-50 border-l-4 border-blue-300 border-dashed' : ''
        }`}
        onClick={() => setSelectedSystemTreeNode(ownPath, parentPath, asset_name || null, parentTemplateName, childIndex)}
        onDragOver={e => {
          if (!isValidDropTarget) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragOver(false);
          const droppedTemplateName = e.dataTransfer.getData('text/plain');
          if (droppedTemplateName) handleDrop(droppedTemplateName);
        }}
      >
        {/* Expand/collapse arrow */}
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.(ownPath);
            }}
            className="w-4 h-4 flex items-center justify-center hover:bg-gray-200 rounded"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}

        {/* Node name */}
        <span className={`flex-1 text-sm ${isDirty ? 'font-semibold text-orange-700' : isSelected ? 'font-normal text-blue-800' : 'font-normal text-gray-800'}`}>{displayName}</span>

        {/* Template type badge */}
        <Badge variant="default" className="text-xs">
          {template.template_type}
        </Badge>

        {/* Remove child — only on non-root nodes */}
        {parentTemplateName !== null && (
          <button
            type="button"
            onClick={handleRemoveChild}
            title="Remove child instance"
            className="ml-1 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="ml-6 border-l-2 border-gray-200">
          {children.map((child, idx) => (
            <TreeNode
              key={idx}
              node={child}
              ownPath={`${ownPath}.${child.asset_name}`}
              parentPath={ownPath}
              parentTemplateName={template_name}
              childIndex={idx}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
