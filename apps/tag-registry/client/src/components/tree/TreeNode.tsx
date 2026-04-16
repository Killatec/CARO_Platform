import React, { useMemo, useState, useRef } from 'react';
import { Badge } from '@caro/ui/primitives';
import { loadRoot } from '../../api/templates.js';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual } from '@caro/tag-registry-shared';
import type { ChildRef } from '@caro/tag-registry-shared';
import type { TreeNodeData } from '../../utils/resolveTree.js';
import {
  parseDragData,
  getActiveDragData,
  setActiveDragData,
  clearActiveDragData,
} from '../../utils/dragTypes.js';

// ── Drop zone ─────────────────────────────────────────────────────────────────
//
// Each non-root row has three logical zones:
//   top    (8 px)  – insert this item as a sibling BEFORE this child
//   body           – add a new child to this node (existing behaviour)
//   bottom (8 px)  – insert this item as a sibling AFTER this child
//
// Root nodes expose only the body zone (they have no parent to insert into).
// Tag nodes expose only top/bottom (tags cannot have children).

type DropZone = 'none' | 'top' | 'body' | 'bottom';

interface TreeNodeProps {
  node: TreeNodeData;
  ownPath: string;
  parentPath?: string | null;
  parentTemplateName?: string | null;
  childIndex?: number | null;
  expandedNodes?: Record<string, boolean>;
  onToggleExpand?: (path: string) => void;
}

/**
 * TreeNode - single node in asset tree
 */
export function TreeNode({
  node, ownPath, parentPath = null, parentTemplateName = null,
  childIndex = null, expandedNodes = {}, onToggleExpand
}: TreeNodeProps): React.ReactElement | null {
  const [dropZone, setDropZone] = useState<DropZone>('none');
  const rowRef = useRef<HTMLDivElement>(null);

  const isExpanded = expandedNodes[ownPath] !== false;

  const selectedSystemTreeNode    = useUIStore(state => state.selectedSystemTreeNode);
  const setSelectedSystemTreeNode = useUIStore(state => state.setSelectedSystemTreeNode);

  const templateMap         = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap = useTemplateGraphStore(state => state.originalTemplateMap);
  const injectTemplateGraph = useTemplateGraphStore(state => state.injectTemplateGraph);
  const updateTemplate      = useTemplateGraphStore(state => state.updateTemplate);
  const reorderChild        = useTemplateGraphStore(state => state.reorderChild);
  const insertChild         = useTemplateGraphStore(state => state.insertChild);

  if (!node) return null;

  const { template_name, asset_name, template, children = [] } = node;
  const displayName       = asset_name || template_name;
  const isSelected        = selectedSystemTreeNode === ownPath;
  const hasChildren       = children.length > 0;
  const isTag             = template.template_type === 'tag';
  const isRoot            = parentTemplateName === null;
  const isBodyDropTarget  = !isTag; // non-tag nodes accept "add child" body drops

  const isDirty = useMemo(() => {
    if (!parentTemplateName || childIndex === null) return false;
    const originalParent = originalTemplateMap.get(parentTemplateName)?.template;
    const currentParent  = templateMap.get(parentTemplateName)?.template;
    const originalChild  = originalParent?.children?.[childIndex];
    const currentChild   = currentParent?.children?.[childIndex];
    if (!originalChild) return true;
    return deepNotEqual(originalChild, currentChild);
  }, [parentTemplateName, childIndex, originalTemplateMap, templateMap]);

  // ── Drop zone calculation ─────────────────────────────────────────────────
  //
  // Called during onDragOver. Uses the global active-drag tracker because the
  // HTML5 DnD spec does not allow reading dataTransfer values during dragover.

  function computeDropZone(e: React.DragEvent<HTMLDivElement>): DropZone {
    const data = getActiveDragData();
    if (!data) return 'none';

    const row = rowRef.current;
    if (!row) return 'none';
    const rect = row.getBoundingClientRect();
    const y    = e.clientY - rect.top;

    if (data.source === 'system-tree') {
      // Only allow reorder within the same parent.
      if (isRoot || childIndex === null) return 'none';
      if (data.parentTemplateName !== parentTemplateName) return 'none';

      // Split at mid-point: top half → insert before, bottom half → insert after.
      const zone: DropZone = y < rect.height / 2 ? 'top' : 'bottom';

      // No-op guard: would this reorder actually change anything?
      const rawToIndex  = zone === 'top' ? childIndex : childIndex + 1;
      const adjustedTo  = rawToIndex > data.childIndex ? rawToIndex - 1 : rawToIndex;
      if (adjustedTo === data.childIndex) return 'none';

      return zone;
    }

    if (data.source === 'template-panel') {
      // Root nodes only accept body drops (append child).
      if (isRoot) return isBodyDropTarget ? 'body' : 'none';

      // Non-root: 8 px top/bottom bands for positional insert, middle for body.
      if (y < 8)                   return 'top';
      if (y > rect.height - 8)     return 'bottom';
      return isBodyDropTarget ? 'body' : 'none';
    }

    return 'none';
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleRemoveChild = (e: React.MouseEvent) => {
    e.stopPropagation();
    const parent = templateMap.get(parentTemplateName!)?.template;
    if (!parent) return;
    const updatedChildren = parent.children.filter((_, i) => i !== childIndex);
    updateTemplate(parentTemplateName!, { children: updatedChildren });
    if (selectedSystemTreeNode === ownPath) {
      setSelectedSystemTreeNode(null);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (parentTemplateName === null || childIndex === null) return;
    const data = {
      source: 'system-tree' as const,
      parentTemplateName,
      childIndex,
      templateName: template_name,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(data));
    e.dataTransfer.setData('text/plain', template_name);
    e.dataTransfer.effectAllowed = 'move';
    setActiveDragData(data);
  };

  const handleDropEvent = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Read both sources: use parseDragData (reads actual transfer values, only
    // valid inside onDrop) as the authoritative payload.
    const data = parseDragData(e);
    const zone = dropZone; // snapshot before clearing
    setDropZone('none');

    if (!data || zone === 'none') return;

    // ── System-tree reorder ──────────────────────────────────────────────
    if (data.source === 'system-tree') {
      if (isRoot || childIndex === null || parentTemplateName === null) return;
      if (data.parentTemplateName !== parentTemplateName) return; // cross-parent: ignore

      const fromIndex = data.childIndex;
      const toIndex   = zone === 'top' ? childIndex : childIndex + 1;
      reorderChild(parentTemplateName, fromIndex, toIndex);
      return;
    }

    // ── Template-panel add/insert ────────────────────────────────────────
    if (data.source === 'template-panel') {
      const droppedName = data.templateName;

      if (!templateMap.has(droppedName)) {
        try {
          const loaded = await loadRoot(droppedName);
          if (loaded) injectTemplateGraph(loaded.templates);
        } catch {
          return;
        }
      }

      const newChild: ChildRef = {
        template_name: droppedName,
        asset_name:    droppedName,
        fields:        {},
      };

      if (zone === 'body') {
        // Append as child of this node (existing behaviour).
        const fresh = useTemplateGraphStore.getState().templateMap.get(template_name)?.template;
        if (!fresh) return;
        insertChild(template_name, newChild, (fresh.children ?? []).length);
      } else {
        // Insert as sibling inside the parent at the computed position.
        if (parentTemplateName === null || childIndex === null) return;
        const atIndex = zone === 'top' ? childIndex : childIndex + 1;
        insertChild(parentTemplateName, newChild, atIndex);
      }
    }
  };

  // ── Derived styles ────────────────────────────────────────────────────────

  const rowClass = [
    'relative flex items-center gap-2 px-3 py-2 cursor-pointer whitespace-nowrap',
    'hover:bg-gray-100',
    isSelected  ? 'bg-blue-50 border-l-4 border-blue-600' : '',
    dropZone === 'body' ? 'bg-blue-50 border border-blue-300 border-dashed' : '',
  ].filter(Boolean).join(' ');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="select-none" data-tree-node>
      <div
        ref={rowRef}
        className={rowClass}
        draggable={parentTemplateName !== null}
        onDragStart={handleDragStart}
        onDragEnd={() => clearActiveDragData()}
        onClick={() => setSelectedSystemTreeNode(ownPath, parentPath, asset_name || null, parentTemplateName, childIndex)}
        onDragOver={e => {
          const zone = computeDropZone(e);
          if (zone === 'none') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = getActiveDragData()?.source === 'system-tree' ? 'move' : 'copy';
          setDropZone(zone);
        }}
        onDragLeave={() => setDropZone('none')}
        onDrop={handleDropEvent}
      >
        {/* Top insert indicator — 2 px blue line at the top edge */}
        {dropZone === 'top' && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 pointer-events-none z-10" />
        )}

        {hasChildren && (
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand?.(ownPath); }}
            className="w-4 h-4 flex items-center justify-center hover:bg-gray-200 rounded"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}

        <span className={`flex-1 text-sm ${
          isDirty   ? 'font-semibold text-orange-700' :
          isSelected ? 'font-normal text-blue-800'    :
                       'font-normal text-gray-800'
        }`}>
          {displayName}
        </span>

        <Badge variant="default" className="text-xs">
          {template.template_type}
        </Badge>

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

        {/* Bottom insert indicator — 2 px blue line at the bottom edge */}
        {dropZone === 'bottom' && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 pointer-events-none z-10" />
        )}
      </div>

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
